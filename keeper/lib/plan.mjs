// One vault's batch: read it, quote every hop and the one ETH -> IMD leg, leave out what a route can't absorb, value
// the rest in ETH, size the balancing-swap floor, build ConvertParams (exact amounts) and simulate the exact call.
// Everything is read at ONE block so quotes, balances and the simulation agree with each other.
import { decodeErrorResult, decodeEventLog, encodeFunctionData, formatEther, getAddress } from "viem";
import { registryAbi, routesAbi, vaultAbi } from "./abi.mjs";
import { ETH, endsInEth, parseRoute, readRoutes, reverseRoute } from "./routes.mjs";
import { applyMargin, hopFloors, quoteRoute, quoteV4, routeImpactBps, spotOut } from "./quote.mjs";
import { estimateSplit, freeAlignmentBalances } from "./split.mjs";
import { simulateV1 } from "./rpc.mjs";

/** The vault's fixed config (set once at initialize), read once per process. */
export async function vaultContext(client, vault) {
  vault = getAddress(vault);
  const r = (functionName) => client.readContract({ address: vault, abi: vaultAbi, functionName });
  const [infer, imd, routes, registry, poolManager, key, reward, rewardBps] = await Promise.all([
    r("infer"), r("imd"), r("routes"), r("registry"), r("poolManager"), r("alignmentPoolKey"), r("CONVERSION_REWARD"),
    r("MAX_CONVERSION_REWARD_BPS"),
  ]);
  return {
    vault, infer: getAddress(infer), imd: getAddress(imd), routes: getAddress(routes), registry: getAddress(registry),
    poolManager: getAddress(poolManager), key, inferIsCurrency0: getAddress(key.currency0) === getAddress(infer),
    reward, rewardBps,
  };
}

/** UniAlignmentVault._conversionReward. */
export const conversionReward = (ethPending, reward, rewardBps) => {
  const cap = (ethPending * rewardBps) / 10_000n;
  return cap < reward ? cap : reward;
};

/** What is pending at `blockNumber`: the tokens (any order; the vault takes any subset) and each one's amount. */
export async function readBatch(client, ctx, blockNumber) {
  const [tokens, closedBatches, keeper] = await Promise.all([
    client.readContract({ address: ctx.vault, abi: vaultAbi, functionName: "openBatchTokens", blockNumber }),
    client.readContract({ address: ctx.vault, abi: vaultAbi, functionName: "closedBatches", blockNumber }),
    client.readContract({ address: ctx.registry, abi: registryAbi, functionName: "conversionKeeper", blockNumber }),
  ]);
  const amounts = await Promise.all(
    tokens.map((t) => client.readContract({ address: ctx.vault, abi: vaultAbi, functionName: "pendingByToken", args: [t], blockNumber })),
  );
  return { tokens: tokens.map((t) => getAddress(t)), amounts, closedBatches, keeper: getAddress(keeper), blockNumber };
}

/** Why a token is left out of this batch (it stays pending in the vault for a later one), or null. */
function absorbCheck(impactBps, cfg) {
  if (impactBps != null && impactBps > cfg.MAX_IMPACT_BPS) return `price impact ${impactBps} bps > MAX_IMPACT_BPS ${cfg.MAX_IMPACT_BPS}`;
  return null;
}

/**
 * The market reference for tokens worth ~1 USD (cfg.USD_TOKENS): 1 USD in ETH through the ETH/USDC pool, and in IMD
 * through the ETH route, both at spot. Returns { ethFor(token, amount), imdFor(token, amount) } or null (no USD
 * pool configured / no ETH route).
 */
export async function usdReference(client, cfg, ethRoute, blockNumber) {
  const pool = cfg.REFERENCE_USD_POOL;
  if (!pool || !ethRoute) return null;
  const probe = 10n ** 16n; // 0.01 ETH
  const usdHop = { kind: 4, tokenIn: ETH, tokenOut: getAddress(pool.token), fee: pool.fee, tickSpacing: pool.tickSpacing };
  const usdPerProbe = await spotOut(client, cfg, [usdHop], probe, blockNumber); // USD units (pool.decimals) per 0.01 ETH
  const imdPerProbe = await spotOut(client, cfg, ethRoute, probe, blockNumber);
  if (usdPerProbe === 0n || imdPerProbe === 0n) return null;
  const usdScale = 10n ** BigInt(pool.decimals);
  const ethFor = (token, amount) => {
    const dec = BigInt(cfg.USD_TOKENS[getAddress(token)]);
    const usd = (amount * usdScale) / 10n ** dec; // in the USD pool token's units
    return (usd * probe) / usdPerProbe;
  };
  return { ethFor, imdFor: (token, amount) => (ethFor(token, amount) * imdPerProbe) / probe, usdPerProbe, imdPerProbe };
}

/** How much worse `realized` is than `reference`, in bps (0 when at or better than it). */
export const deviationBps = (realized, reference) => (reference === 0n || realized >= reference ? 0 : Number(((reference - realized) * 10_000n) / reference));

const shortErr = (e) => {
  const raw = e?.cause?.raw ?? e?.raw ?? e?.cause?.data ?? "";
  if (typeof raw === "string" && raw.includes("7a5ed734")) return "NotEnoughLiquidity";
  return (e?.shortMessage ?? e?.message ?? String(e)).split("\n")[0].slice(0, 120);
};

/**
 * Quote the batch the way the vault will run it (UniAlignmentVault.convertAndAddLiquidity):
 * - every token's own hops: a route ending in ETH yields ETH for the leg, a route ending in IMD (imdUSD) yields IMD;
 * - ONE ETH -> IMD swap along the ETH route for all of the batch's ETH (pending ETH minus the keeper reward, plus every
 *   route that ended in ETH), its IMD shared by each token's ETH;
 * - IMD as is; INFER valued at the alignment pool's INFER -> IMD quote.
 * A token whose route fails to quote, whose price impact is over MAX_IMPACT_BPS, or (USD tokens) whose route pays more
 * than MAX_REFERENCE_DEVIATION_BPS under the market reference, is SKIPPED: it stays pending in the vault and the rest
 * converts. If the leg itself is over the limit, the largest ETH contributors to it are dropped
 * until it is not. Every included token converts exactly its pending amount at `batch.blockNumber`: what arrives later
 * stays pending.
 */
export async function quoteBatch(client, cfg, ctx, batch, { routes } = {}) {
  const { blockNumber } = batch;
  routes ??= await readRoutes(client, ctx.routes, batch.tokens, { imd: ctx.imd, infer: ctx.infer, blockNumber });
  let ethRoute = routes.get(ETH);
  if (!ethRoute) {
    const raw = await client.readContract({ address: ctx.routes, abi: routesAbi, functionName: "getRoute", args: [ETH], blockNumber });
    ethRoute = raw.length ? parseRoute(ETH, raw, ctx.imd) : null;
  }
  const imdToEth = async (imdAmount) => {
    if (imdAmount === 0n) return 0n;
    if (!ethRoute) throw new Error("no ETH route: cannot value IMD in ETH");
    return (await quoteRoute(client, cfg, reverseRoute(ethRoute), imdAmount, blockNumber)).at(-1);
  };

  let ref; // the USD reference, read once if a USD token is pending
  const ethIdx = batch.tokens.indexOf(ETH);
  const reward = conversionReward(ethIdx >= 0 ? batch.amounts[ethIdx] : 0n, ctx.reward, ctx.rewardBps);
  const items = [];
  for (const [i, token] of batch.tokens.entries()) {
    const amount = batch.amounts[i];
    if (token === ctx.imd) {
      items.push({ token, amount, kind: "imd", hops: [], outs: [], floors: [], imdOut: amount, ethValue: await imdToEth(amount) });
      continue;
    }
    if (token === ctx.infer) {
      // INFER needs no route; it is valued here at the alignment pool's INFER -> IMD quote (the vault values it at the
      // balancing swap's realized rate).
      const { key, inferIsCurrency0 } = ctx;
      const imdOut = await quoteV4(client, cfg, key, inferIsCurrency0, amount, blockNumber);
      items.push({ token, amount, kind: "infer", hops: [], outs: [], floors: [], imdOut: 0n, inferImdValue: imdOut, ethValue: await imdToEth(imdOut) });
      continue;
    }
    if (token === ETH) {
      items.push({ token, amount, kind: "eth", hops: [], outs: [], floors: [], ethIn: amount - reward, ethValue: amount });
      continue;
    }
    const hops = routes.get(token);
    if (!hops) throw new Error(`no route for ${token}`);
    const toEth = endsInEth(hops);
    const kind = toEth ? "toEth" : "route";
    let outs;
    let impactBps = null;
    try {
      outs = await quoteRoute(client, cfg, hops, amount, blockNumber);
      impactBps = await routeImpactBps(client, cfg, hops, amount, outs.at(-1), blockNumber);
    } catch (e) {
      items.push({ token, amount, kind, hops, outs: [], floors: [], skip: `quote failed: ${shortErr(e)}`, ethValue: 0n });
      continue;
    }
    let skip = absorbCheck(impactBps, cfg);
    // Reference check (USD tokens): what the route yields vs 1 USD at market (ETH/USDC and the ETH route).
    let refDeviationBps = null;
    if (cfg.USD_TOKENS?.[token] != null) {
      ref ??= await usdReference(client, cfg, ethRoute, blockNumber);
      if (ref) {
        const want = toEth ? ref.ethFor(token, amount) : ref.imdFor(token, amount);
        refDeviationBps = deviationBps(outs.at(-1), want);
        if (!skip && refDeviationBps > cfg.MAX_REFERENCE_DEVIATION_BPS) {
          skip = `route pays ${refDeviationBps} bps under the market reference (1 USD via ETH/USDC and IMD/ETH: ${toEth ? `${formatEther(want)} ETH` : `${formatEther(want)} IMD`}, route ${toEth ? formatEther(outs.at(-1)) : formatEther(outs.at(-1))}) > MAX_REFERENCE_DEVIATION_BPS ${cfg.MAX_REFERENCE_DEVIATION_BPS}`;
        }
      }
    }
    const floors = hopFloors(outs, cfg.HOP_MARGIN_BPS);
    const item = { token, amount, kind, hops, outs, floors, impactBps, refDeviationBps, skip };
    if (toEth) Object.assign(item, { ethIn: outs.at(-1), ethValue: outs.at(-1) });
    else Object.assign(item, { imdOut: outs.at(-1), ethValue: skip ? 0n : await imdToEth(outs.at(-1)) });
    items.push(item);
  }

  // The ETH leg: everything that reaches ETH, in one swap. Over the impact limit: drop the largest contributor, again.
  let leg = null;
  for (;;) {
    const onLeg = items.filter((x) => !x.skip && (x.kind === "eth" || x.kind === "toEth") && x.ethIn > 0n);
    const ethIn = onLeg.reduce((s, x) => s + x.ethIn, 0n);
    if (ethIn === 0n) break;
    if (!ethRoute) throw new Error("no ETH route: the batch's ETH cannot reach IMD");
    let outs;
    let impactBps = null;
    let err = null;
    try {
      outs = await quoteRoute(client, cfg, ethRoute, ethIn, blockNumber);
      impactBps = await routeImpactBps(client, cfg, ethRoute, ethIn, outs.at(-1), blockNumber);
    } catch (e) {
      err = `ETH leg quote failed: ${shortErr(e)}`;
    }
    const why = err ?? absorbCheck(impactBps, cfg);
    if (!why) {
      // The leg's input carries the slippage of the routes that fed it: offset its floors by their longest route.
      const offset = Math.max(0, ...onLeg.map((x) => x.hops.length));
      leg = { hops: ethRoute, ethIn, outs, floors: hopFloors(outs, cfg.HOP_MARGIN_BPS, offset), impactBps, offset };
      const imdOut = outs.at(-1);
      for (const x of onLeg) x.imdOut = (imdOut * x.ethIn) / ethIn;
      break;
    }
    const biggest = onLeg.reduce((m, x) => (x.ethIn > m.ethIn ? x : m));
    biggest.skip = `ETH leg (${formatEther(ethIn)} ETH): ${why}; left out as its largest input`;
  }

  const included = items.filter((x) => !x.skip);
  for (const x of items) if (x.skip) x.ethValue = 0n;
  const batchEth = included.reduce((s, x) => s + x.ethValue, 0n);
  const routedImd = included.reduce((s, x) => s + (x.kind === "route" || x.kind === "eth" || x.kind === "toEth" ? (x.imdOut ?? 0n) : 0n), 0n);
  const includesEth = included.some((x) => x.token === ETH);
  return { items, included, leg, batchEth, reward: includesEth ? reward : 0n, routedImd, blockNumber };
}

/**
 * ConvertParams for the included tokens (in the batch's order): each converts exactly the amount read, with one floor
 * per hop of its own route; ethLegMinOuts floors the batch's one ETH -> IMD swap.
 */
export function buildParams(quoted, minSplitOut, deadline) {
  const inc = quoted.included;
  if (inc.length === 0) throw new Error("nothing to convert: every token was skipped");
  const seen = new Set();
  for (const x of inc) {
    const t = getAddress(x.token);
    if (seen.has(t)) throw new Error(`token ${t} twice`);
    seen.add(t);
    if (!(x.amount > 0n)) throw new Error(`token ${t}: amount must be positive`);
  }
  return {
    tokens: inc.map((x) => getAddress(x.token)),
    amounts: inc.map((x) => x.amount),
    minOuts: inc.map((x) => (x.kind === "route" || x.kind === "toEth" ? x.floors : [])),
    ethLegMinOuts: quoted.leg ? quoted.leg.floors : [],
    minSplitOut,
    deadline,
  };
}

/** The same params with every hop and leg floor at 0 (the simulation probe: shows what the call really yields). */
const probeParams = (quoted, deadline) => {
  const p = buildParams(quoted, 1n, deadline);
  return { ...p, minOuts: p.minOuts.map((f) => f.map(() => 0n)), ethLegMinOuts: p.ethLegMinOuts.map(() => 0n) };
};

/**
 * Safety net from the simulation: a last floor above what the call really yields at this block (a quote that
 * overstated, e.g. two routes sharing a pool, which the spec's table avoids) is lowered to the simulated output minus
 * its compounded margin. Routes ending in IMD use their TokenConverted value; the ETH leg its EthLegSwapped output.
 */
export function capFloorsToSim(quoted, simLogs, marginBps) {
  const sim = new Map(simLogs.converted.map((c) => [getAddress(c.token), c.imdValue]));
  const cap = (floors, simOut, offset) => {
    const h = floors.length;
    const capped = hopFloors([...Array(h - 1).fill(0n), simOut], marginBps, offset).at(-1);
    return capped >= floors[h - 1] ? floors : [...floors.slice(0, -1), capped];
  };
  const included = quoted.included.map((x) => {
    if (x.kind !== "route" || !sim.has(getAddress(x.token))) return x;
    const floors = cap(x.floors, sim.get(getAddress(x.token)), 0);
    return floors === x.floors ? x : { ...x, floors, simImdOut: sim.get(getAddress(x.token)) };
  });
  let { leg } = quoted;
  if (leg && simLogs.leg) {
    const floors = cap(leg.floors, simLogs.leg.imdOut, leg.offset);
    if (floors !== leg.floors) leg = { ...leg, floors, simImdOut: simLogs.leg.imdOut };
  }
  return { ...quoted, included, leg };
}

/** The error name of a vault revert (BadParams, InsufficientOutput, ...), or a short message. */
export function revertName(e) {
  const data = e?.data ?? e?.cause?.data ?? e?.cause?.cause?.data ?? e?.error?.data;
  const hex = typeof data === "string" ? data : data?.data;
  if (typeof hex === "string" && hex.startsWith("0x") && hex.length >= 10) {
    try {
      return decodeErrorResult({ abi: vaultAbi, data: hex }).errorName;
    } catch { /* not one of the vault's */ }
  }
  let c = e;
  while (c) {
    if (c.data?.errorName) return c.data.errorName;
    c = c.cause;
  }
  return (e?.shortMessage ?? e?.message ?? String(e)).slice(0, 160);
}

/** Parse the vault's events out of simulation logs. */
export function readSimLogs(logs, vault) {
  const out = { split: null, converted: [], batch: null, leg: null };
  for (const l of logs) {
    if (getAddress(l.address) !== getAddress(vault)) continue;
    let ev;
    try {
      ev = decodeEventLog({ abi: vaultAbi, data: l.data, topics: l.topics });
    } catch {
      continue;
    }
    if (ev.eventName === "SplitSwap") out.split = ev.args;
    else if (ev.eventName === "TokenConverted") out.converted.push(ev.args);
    else if (ev.eventName === "BatchConverted") out.batch = ev.args;
    else if (ev.eventName === "EthLegSwapped") out.leg = ev.args;
  }
  return out;
}

/**
 * minSplitOut. Primary: simulate the exact call (per-hop floors set, minSplitOut = 1) with eth_simulateV1 and read the
 * SplitSwap event: the vault's own sizing, every pass included. Fallback (node without eth_simulateV1): pass 1
 * reproduced off chain and quoted, a lower bound of the total. Either way minus SPLIT_MARGIN_BPS.
 */
export async function sizeSplit(client, cfg, ctx, batch, quoted, { from, deadline }) {
  // The probe runs with no hop or leg floors (0 is allowed; only the split needs a non-zero floor), so it shows what
  // each route and the ETH leg really yield at this block.
  const probe = probeParams(quoted, deadline);
  const data = encodeFunctionData({ abi: vaultAbi, functionName: "convertAndAddLiquidity", args: [probe] });
  const free = await freeAlignmentBalances(client, ctx.vault, ctx, batch.blockNumber);
  // IMD/INFER that stays pending (left out, or not part of this call) is not free for the vault's balancing.
  const staying = (token) => {
    const i = batch.tokens.indexOf(token);
    const pend = i >= 0 ? batch.amounts[i] : 0n;
    const conv = quoted.included.find((x) => x.token === token)?.amount ?? 0n;
    return pend - conv;
  };
  const sub = (a, b) => (a > b ? a - b : 0n);
  free.freeInfer = sub(free.freeInfer, staying(ctx.infer));
  free.freeImd = sub(free.freeImd, staying(ctx.imd));
  const offchain = await estimateSplit(client, cfg, {
    key: ctx.key, inferIsCurrency0: ctx.inferIsCurrency0, ...free, routedImd: quoted.routedImd, blockNumber: batch.blockNumber,
  });
  const sim = await simulateV1(client, { from, to: ctx.vault, data }, batch.blockNumber);
  let source;
  let splitOut;
  let simLogs = null;
  if (sim) {
    if (!sim.ok) {
      const err = revertName({ data: sim.error?.data, message: sim.error?.message });
      return { error: err, sim };
    }
    simLogs = readSimLogs(sim.logs, ctx.vault);
    source = "simulation";
    splitOut = simLogs.split ? simLogs.split.amountOut : 0n;
  } else {
    source = "offchain-pass1";
    splitOut = offchain ? offchain.amountOut : 0n;
  }
  let minSplitOut = splitOut === 0n ? 0n : applyMargin(splitOut, cfg.SPLIT_MARGIN_BPS);
  if (splitOut !== 0n && minSplitOut === 0n) minSplitOut = 1n; // a swap needs a non-zero floor (ZeroFloor)
  return { source, splitOut, minSplitOut, offchain, simLogs, simGas: sim?.gasUsed ?? null };
}
