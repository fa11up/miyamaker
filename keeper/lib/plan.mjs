// One vault's batch: read it, value it in ETH, quote every hop, size the balancing-swap floor, build ConvertParams in
// the order the vault wants, and simulate the exact call. Everything is read at ONE block so quotes, balances and the
// simulation agree with each other.
import { decodeErrorResult, decodeEventLog, encodeFunctionData, getAddress } from "viem";
import { registryAbi, routesAbi, vaultAbi } from "./abi.mjs";
import { ETH, parseRoute, readRoutes, reverseRoute } from "./routes.mjs";
import { applyMargin, hopFloors, quoteRoute, quoteV4 } from "./quote.mjs";
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

/** The open batch at `blockNumber`: tokens in the vault's order, and each one's pending amount. */
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

/**
 * Quote every token of the batch. Per token: the amount the route gets (ETH: minus the keeper reward, as the vault
 * does), each hop's expected output and floor, the expected IMD, and the token's value in ETH.
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
    const hops = routes.get(token);
    if (!hops) throw new Error(`no route for ${token}`);
    const routeIn = token === ETH ? amount - reward : amount;
    const outs = await quoteRoute(client, cfg, hops, routeIn, blockNumber);
    const floors = hopFloors(outs, cfg.HOP_MARGIN_BPS);
    let ethValue;
    if (token === ETH) ethValue = amount;
    else {
      const k = hops.findIndex((h) => h.tokenOut === ETH);
      ethValue = k >= 0 ? outs[k] : await imdToEth(outs.at(-1));
    }
    items.push({ token, amount, routeIn, kind: "route", hops, outs, floors, imdOut: outs.at(-1), ethValue });
  }
  const batchEth = items.reduce((s, x) => s + x.ethValue, 0n);
  const routedImd = items.reduce((s, x) => s + (x.kind === "route" ? x.imdOut : 0n), 0n);
  return { items, batchEth, reward, routedImd, blockNumber };
}

/** ConvertParams with tokens exactly as openBatchTokens() returned them, minOuts aligned to them. */
export function buildParams(tokens, items, minSplitOut, deadline) {
  const byToken = new Map(items.map((x) => [getAddress(x.token), x]));
  if (byToken.size !== tokens.length) throw new Error(`quoted ${byToken.size} tokens, batch has ${tokens.length}`);
  return {
    tokens: tokens.map((t) => getAddress(t)),
    minOuts: tokens.map((t) => {
      const x = byToken.get(getAddress(t));
      if (!x) throw new Error(`no quote for ${t}`);
      return x.kind === "route" ? x.floors : [];
    }),
    minSplitOut,
    deadline,
  };
}

/**
 * The vault swaps its tokens one after another, so routes that share a pool (ETH, USDC, WBTC and cbBTC all end in
 * ETH -> IMD) each move the price for the next: independent quotes overstate the later ones (0.12% for USDC after
 * 0.2 ETH on the fork, 2026-11-08). With a simulation at hand, each route's last floor is capped at its simulated IMD
 * out with the route's compounded margin, so the floors stay a margin under what the call will really do.
 */
export function capFloorsToSim(items, converted, marginBps) {
  const sim = new Map(converted.map((c) => [getAddress(c.token), c.imdValue]));
  return items.map((x) => {
    if (x.kind !== "route" || !sim.has(getAddress(x.token))) return x;
    const h = x.floors.length;
    const capped = hopFloors([...Array(h - 1).fill(0n), sim.get(getAddress(x.token))], marginBps).at(-1);
    if (capped >= x.floors[h - 1]) return x;
    return { ...x, floors: [...x.floors.slice(0, -1), capped], simImdOut: sim.get(getAddress(x.token)) };
  });
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
  const out = { split: null, converted: [], batch: null };
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
  }
  return out;
}

/**
 * minSplitOut. Primary: simulate the exact call (per-hop floors set, minSplitOut = 1) with eth_simulateV1 and read the
 * SplitSwap event: the vault's own sizing, every pass included. Fallback (node without eth_simulateV1): pass 1
 * reproduced off chain and quoted, a lower bound of the total. Either way minus SPLIT_MARGIN_BPS.
 */
export async function sizeSplit(client, cfg, ctx, batch, quoted, { from, deadline }) {
  // The probe runs with no hop floors (0 is allowed per hop; only the split needs a non-zero floor), so it shows what
  // each route really yields when the vault runs them one after another through shared pools.
  const probe = buildParams(batch.tokens, quoted.items.map((x) => ({ ...x, floors: x.floors.map(() => 0n) })), 1n, deadline);
  const data = encodeFunctionData({ abi: vaultAbi, functionName: "convertAndAddLiquidity", args: [probe] });
  const free = await freeAlignmentBalances(client, ctx.vault, ctx, batch.blockNumber);
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
