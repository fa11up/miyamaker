// One vault's batch: read it, source every swap (0x first, the keeper's zRouter route as the fallback), check each
// against the market reference, leave out what cannot convert safely, value the rest in ETH, size the balancing-swap
// floor, build ConvertParams (exact amounts, one SwapCall per token, the ETH leg) and simulate the exact call.
// Everything on chain is read at ONE block so quotes, balances, references and the simulation agree with each other.
import { decodeErrorResult, decodeEventLog, encodeFunctionData, formatEther, getAddress, zeroAddress } from "viem";
import { factoryAbi, registryAbi, vaultAbi } from "./abi.mjs";
import { ETH, ZROUTER, fallbackRoutes } from "./zrouter.mjs";
import { applyMargin, quoteV4 } from "./quote.mjs";
import { DEFAULT_IMD_ETH_POOL, imdAtSpot, imdEthKey, referenceReader } from "./reference.mjs";
import { sourceSwap } from "./swaps.mjs";
import { ALLOWANCE_HOLDER, readSettlers } from "./zeroex.mjs";
import { estimateLiquidity, estimateSplit, freeAlignmentBalances, poolState } from "./split.mjs";
import { simulateV1 } from "./rpc.mjs";

/** The vault's fixed config (set once at initialize), read once per process. `config` = its factory (IVaultConfig). */
export async function vaultContext(client, vault) {
  vault = getAddress(vault);
  const r = (functionName) => client.readContract({ address: vault, abi: vaultAbi, functionName });
  const [infer, imd, config, registry, poolManager, key, reward, rewardBps] = await Promise.all([
    r("infer"), r("imd"), r("config"), r("registry"), r("poolManager"), r("alignmentPoolKey"), r("CONVERSION_REWARD"),
    r("MAX_CONVERSION_REWARD_BPS"),
  ]);
  return {
    vault, infer: getAddress(infer), imd: getAddress(imd), config: getAddress(config), registry: getAddress(registry),
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

/** Which swap targets the factory allows at `blockNumber` ({ zeroEx, zRouter }); both assumed allowed without a factory. */
export async function readTargets(client, ctx, blockNumber) {
  if (!ctx.config) return { zeroEx: true, zRouter: true };
  const one = (t) => client.readContract({ address: ctx.config, abi: factoryAbi, functionName: "isSwapTarget", args: [t], blockNumber });
  const [zeroEx, zRouter] = await Promise.all([one(ALLOWANCE_HOLDER), one(ZROUTER)]);
  return { zeroEx, zRouter };
}

/** How much worse `realized` is than `reference`, in bps (0 when at or better than it). */
export const deviationBps = (realized, reference) => (reference === 0n || realized >= reference ? 0 : Number(((reference - realized) * 10_000n) / reference));
/** Signed distance of `realized` from `reference` in bps (negative = under). */
export const signedBps = (realized, reference) => (reference === 0n ? 0 : Number(((realized - reference) * 10_000n) / reference));

const shortErr = (e) => (e?.shortMessage ?? e?.message ?? String(e)).split("\n")[0].slice(0, 120);

/**
 * Quote the batch the way the vault will run it (UniAlignmentVault.convertAndAddLiquidity):
 * - every other token through its own SwapCall: USDC/WBTC/cbBTC to ETH (that ETH joins the leg), imdUSD to IMD
 *   (output per FALLBACK_ROUTES / SWAP_OUTPUT);
 * - ONE ETH -> IMD swap (the ETH leg) for all of the batch's ETH: pending ETH minus the keeper reward, plus every swap
 *   that output ETH; its IMD shared by each token's ETH. The vault sends the leg its whole ETH as value, so a leg fed by
 *   swaps (whose ETH is only known on chain) must sell all of msg.value: zRouter (swapAmount 0). 0x is asked for the
 *   leg only when its ETH is exact (pending ETH alone);
 * - IMD as is; INFER valued at the alignment pool's INFER -> IMD quote.
 * A token is SKIPPED (it stays pending and the rest converts) when neither 0x nor zRouter gives a usable swap, it has
 * no reference price, or its swap pays more than MAX_REFERENCE_DEVIATION_BPS under the reference (market:
 * Chainlink for USD/BTC tokens, the IMD/ETH pool's spot for the IMD side). The ETH leg must be within
 * MAX_REFERENCE_DEVIATION_BPS of the IMD/ETH pool's spot at this block, either way (a pushed pool or a stale quote);
 * under it, its largest ETH contributors are dropped until it fits; over it, or unquotable, the whole leg waits.
 * `zx`: the 0x client (lib/zeroex.mjs; null or disabled = zRouter only). `crossClient`: a second read RPC.
 * `force`: { leg: "zRouter" } etc. to pin a source (a re-plan after a 0x call failed in simulation).
 */
export async function quoteBatch(client, cfg, ctx, batch, { zx = null, crossClient = null, deadline, force = {} } = {}) {
  const { blockNumber } = batch;
  const now = batch.timestamp ?? (await client.getBlock({ blockNumber })).timestamp;
  deadline ??= now + BigInt(cfg.DEADLINE_SECONDS);
  const refs = referenceReader(client, cfg, { blockNumber, now, imd: ctx.imd });
  const routes = fallbackRoutes(cfg, ctx.imd);
  const settlers = zx?.enabled ? await readSettlers(client, blockNumber) : [];
  const targets = await readTargets(client, ctx, blockNumber);
  const alerts = []; // loud lines for the log: a check that refused to convert something
  const imdToEth = async (imd) => {
    if (imd === 0n) return 0n;
    const r = await refs.ethForImd(imd);
    if (r.err) throw new Error(`cannot value IMD in ETH: ${r.err}`);
    return r.wei;
  };
  const outputOf = (token) => {
    const o = cfg.SWAP_OUTPUT?.[token] ?? cfg.SWAP_OUTPUT?.[token.toLowerCase()];
    if (o) return getAddress(o === "IMD" ? ctx.imd : o === "ETH" ? ETH : o);
    return routes.get(token)?.tokenOut ?? ETH;
  };
  const common = { zx, vault: ctx.vault, blockNumber, deadline, settlers, targets };

  const ethIdx = batch.tokens.indexOf(ETH);
  const reward = conversionReward(ethIdx >= 0 ? batch.amounts[ethIdx] : 0n, ctx.reward, ctx.rewardBps);
  const items = [];
  for (const [i, token] of batch.tokens.entries()) {
    const amount = batch.amounts[i];
    if (token === ctx.imd) {
      items.push({ token, amount, kind: "imd", imdOut: amount, ethValue: await imdToEth(amount) });
      continue;
    }
    if (token === ctx.infer) {
      // INFER needs no swap; valued here at the alignment pool's INFER -> IMD quote (the vault values it at the
      // balancing swap's realized rate).
      const imdOut = await quoteV4(client, cfg, ctx.key, ctx.inferIsCurrency0, amount, blockNumber);
      items.push({ token, amount, kind: "infer", imdOut: 0n, inferImdValue: imdOut, ethValue: await imdToEth(imdOut) });
      continue;
    }
    if (token === ETH) {
      items.push({ token, amount, kind: "eth", ethIn: amount - reward, ethValue: amount });
      continue;
    }
    const tokenOut = outputOf(token);
    const toEth = tokenOut === ETH;
    const item = { token, amount, kind: "swap", tokenOut, toEth, ethValue: 0n };
    items.push(item);
    if (!refs.has(token)) {
      item.skip = "no reference price for this token (USD_TOKENS / BTC_TOKENS): not converted blind";
      continue;
    }
    const s = await sourceSwap(client, cfg, { ...common, tokenIn: token, tokenOut, amountIn: amount, hop: routes.get(token) ?? null, only: force[token] ?? null });
    Object.assign(item, { swap: s.chosen, candidates: { zx: s.zx, zr: s.zr } });
    if (s.chosen.err) {
      item.skip = s.chosen.err;
      continue;
    }
    // The reference: the token's independent price in ETH (Chainlink); for a swap to IMD, that ETH in IMD at the
    // IMD/ETH pool's spot (IMD in USD = spot x ETH/USD).
    const r = await refs.ethFor(token, amount);
    let want = null;
    let refNote = null;
    if (r.err) refNote = `reference unavailable: ${r.err}`;
    else if (toEth) want = r.wei;
    else {
      const m = await refs.imdForEth(r.wei);
      if (m.err) refNote = `reference unavailable (IMD side): ${m.err}`;
      else want = m.imd;
    }
    if (want != null) {
      item.refDeviationBps = deviationBps(s.chosen.expectedOut, want);
      item.reference = want;
      if (item.refDeviationBps > cfg.MAX_REFERENCE_DEVIATION_BPS) {
        refNote = `${s.chosen.source} pays ${item.refDeviationBps} bps under the reference (${r.via}${toEth ? "" : " and the IMD/ETH pool's spot"}: ${formatEther(want)} ${toEth ? "ETH" : "IMD"}, swap ${formatEther(s.chosen.expectedOut)}) > MAX_REFERENCE_DEVIATION_BPS ${cfg.MAX_REFERENCE_DEVIATION_BPS}`;
      }
    }
    if (refNote) {
      alerts.push(`${token}: ${refNote}`);
      item.skip = refNote;
      continue;
    }
    if (toEth) Object.assign(item, { ethIn: s.chosen.expectedOut, ethValue: s.chosen.expectedOut });
    else Object.assign(item, { imdOut: s.chosen.expectedOut, ethValue: await imdToEth(s.chosen.expectedOut) });
  }

  // The ETH leg: everything that reaches ETH, in one swap.
  let leg = null;
  for (;;) {
    const onLeg = items.filter((x) => !x.skip && (x.kind === "eth" || (x.kind === "swap" && x.toEth)) && x.ethIn > 0n);
    const ethIn = onLeg.reduce((s, x) => s + x.ethIn, 0n);
    if (ethIn === 0n) break;
    const fed = onLeg.some((x) => x.kind === "swap");
    // Fed by swaps: the vault sends what they really yielded, so only a sell-all-of-msg.value call fits (zRouter).
    const only = force.leg ?? (fed ? "zRouter" : null);
    const s = await sourceSwap(client, cfg, { ...common, tokenIn: ETH, tokenOut: ctx.imd, amountIn: ethIn, hop: routes.get(ETH) ?? null, offset: fed ? 1 : 0, only });
    // Too big for the zRouter pool (and no usable 0x): a size problem, so drop the largest input and try again.
    if (s.chosen.err && s.zr?.err && s.zr.impactBps != null && onLeg.length > 1) {
      const biggest = onLeg.reduce((m, x) => (x.ethIn > m.ethIn ? x : m));
      biggest.skip = `ETH leg (${formatEther(ethIn)} ETH): ${s.zr.err}; left out as its largest input`;
      continue;
    }
    if (s.chosen.err) {
      const why = `ETH leg (${formatEther(ethIn)} ETH) NOT converted this tick: ${s.chosen.err}`;
      alerts.push(why);
      for (const x of onLeg) x.skip = why;
      break;
    }
    const bad = await checkLeg(client, crossClient, cfg, refs, ctx, ethIn, s.chosen, blockNumber);
    if (bad.why) {
      // Under the spot by too much may be size (impact): drop the largest input and try again. Over it, or a check
      // that could not run, is not a size problem.
      if (bad.under && onLeg.length > 1) {
        const biggest = onLeg.reduce((m, x) => (x.ethIn > m.ethIn ? x : m));
        biggest.skip = `ETH leg (${formatEther(ethIn)} ETH): ${bad.why}; left out as its largest input`;
        continue;
      }
      const why = `ETH leg (${formatEther(ethIn)} ETH) NOT converted this tick: ${bad.why}`;
      alerts.push(why);
      for (const x of onLeg) x.skip = why;
      break;
    }
    leg = { ethIn, swap: s.chosen, candidates: { zx: s.zx, zr: s.zr }, fed, spotBps: bad.spotBps, feedDeviationBps: bad.feedDeviationBps, crossRpc: bad.crossRpc };
    const imdOut = s.chosen.expectedOut;
    for (const x of onLeg) x.imdOut = (imdOut * x.ethIn) / ethIn;
    break;
  }

  const included = items.filter((x) => !x.skip);
  for (const x of items) if (x.skip) x.ethValue = 0n;
  const batchEth = included.reduce((s, x) => s + x.ethValue, 0n);
  const routedImd = included.reduce((s, x) => s + (x.kind === "swap" || x.kind === "eth" ? (x.imdOut ?? 0n) : 0n), 0n);
  const includesEth = included.some((x) => x.token === ETH);
  const zxTimes = [...included.map((x) => x.swap), leg?.swap].filter((w) => w?.source === "0x").map((w) => w.quotedAt);
  return {
    items, included, leg, batchEth, reward: includesEth ? reward : 0n, routedImd, blockNumber, alerts, imd: ctx.imd, deadline,
    quotedAt: zxTimes.length ? Math.min(...zxTimes) : null, zeroEx: zx?.enabled ? "on" : (zx?.why ?? "off"),
  };
}

/**
 * The ETH leg against the market: its implied IMD per ETH vs the IMD/ETH pool's spot at the planning block, at most
 * MAX_REFERENCE_DEVIATION_BPS either way (under = too much impact or a pool pushed against us; over = the spot is off
 * from where the quote was made: a pushed pool or a stale quote). With USE_IMD_FEED, also at most
 * MAX_FEED_DEVIATION_BPS under the IMD price feed (fail closed when stale). With a second read RPC, the spot read
 * there must match within CROSS_RPC_MAX_BPS. Returns { why, under } to refuse, else the checks' numbers.
 */
async function checkLeg(client, crossClient, cfg, refs, ctx, ethIn, swap, blockNumber) {
  const out = swap.expectedOut;
  const sp = await refs.imdForEth(ethIn);
  if (sp.err) return { why: `IMD/ETH pool spot unreadable (fail closed): ${sp.err}` };
  const spotBps = signedBps(out, sp.imd);
  const max = cfg.MAX_REFERENCE_DEVIATION_BPS;
  if (spotBps < -max) return { under: true, spotBps, why: `${swap.source} pays ${-spotBps} bps under the IMD/ETH pool's spot (spot ${formatEther(sp.imd)} IMD, leg ${formatEther(out)} IMD) > MAX_REFERENCE_DEVIATION_BPS ${max}` };
  if (spotBps > max) return { spotBps, why: `${swap.source} pays ${spotBps} bps OVER the IMD/ETH pool's spot (spot ${formatEther(sp.imd)} IMD, leg ${formatEther(out)} IMD) > MAX_REFERENCE_DEVIATION_BPS ${max}: the pool was pushed or the quote is stale` };
  let feedDeviationBps = null;
  if (cfg.USE_IMD_FEED) {
    const f = await refs.imdForEthByFeed(ethIn);
    if (f.err) return { why: `IMD price feed unusable (fail closed, USE_IMD_FEED): ${f.err}` };
    feedDeviationBps = deviationBps(out, f.imd);
    const maxFeed = cfg.MAX_FEED_DEVIATION_BPS ?? 300;
    if (feedDeviationBps > maxFeed) return { why: `pays ${feedDeviationBps} bps under the IMD price feed (feed ${formatEther(f.imd)} IMD, leg ${formatEther(out)} IMD) > MAX_FEED_DEVIATION_BPS ${maxFeed}` };
  }
  let crossRpc = null;
  if (crossClient) {
    let other;
    for (let i = 0; ; i++) {
      try {
        const st = await poolState(crossClient, cfg.POOL_MANAGER, imdEthKey(ctx.imd, cfg.IMD_ETH_POOL ?? DEFAULT_IMD_ETH_POOL), blockNumber);
        other = imdAtSpot(ethIn, st.sqrtP);
        break;
      } catch (e) {
        // A second node a block behind may not have the pinned block yet: once more after a moment, then fail closed.
        if (i >= 1) return { why: `second read RPC could not read the IMD/ETH spot (fail closed): ${shortErr(e)}` };
        await new Promise((r) => setTimeout(r, cfg.CROSS_RPC_RETRY_MS ?? 1500));
      }
    }
    const a = sp.imd;
    const diff = other > a ? other - a : a - other;
    const bps = Number((diff * 10_000n) / (a > other ? a : other || 1n));
    const maxCross = cfg.CROSS_RPC_MAX_BPS ?? 0;
    if (bps > maxCross) return { why: `the two read RPCs disagree on the IMD/ETH spot by ${bps} bps > CROSS_RPC_MAX_BPS ${maxCross}` };
    crossRpc = { other, bps };
  }
  return { spotBps, feedDeviationBps, crossRpc };
}

/** The SwapCall the vault ignores (ETH, IMD, INFER; no ETH leg). */
export const EMPTY_SWAP = Object.freeze({ target: zeroAddress, tokenOut: zeroAddress, data: "0x", minOut: 0n });
const swapCall = (w, tokenOut, minOut = w.minOut) => ({ target: getAddress(w.target), tokenOut: getAddress(tokenOut), data: w.data, minOut });

/**
 * ConvertParams for the included tokens (in the batch's order): each converts exactly the amount read through its own
 * SwapCall (empty for ETH/IMD/INFER); `ethLeg` is the batch's one ETH -> IMD swap (empty without one). `split`: the
 * balancing swap's { splitInferToImd, minSplitRate, minLiquidity } (sizeSplit). `floor1`: every minOut, the split rate
 * and the liquidity floor set to 1 (the simulation probe; the vault refuses 0 with ZeroFloor); the direction is kept.
 */
export function buildParams(quoted, split, deadline, { floor1 = false } = {}) {
  const inc = quoted.included;
  if (inc.length === 0) throw new Error("nothing to convert: every token was skipped");
  const seen = new Set();
  for (const x of inc) {
    const t = getAddress(x.token);
    if (seen.has(t)) throw new Error(`token ${t} twice`);
    seen.add(t);
    if (!(x.amount > 0n)) throw new Error(`token ${t}: amount must be positive`);
    if (x.kind === "swap" && !(x.swap?.minOut > 0n)) throw new Error(`token ${t}: a swap needs a non-zero minOut`);
  }
  const needsLeg = inc.some((x) => x.kind === "eth" || (x.kind === "swap" && x.toEth));
  if (needsLeg && !quoted.leg) throw new Error("ETH reaches the leg but there is no ETH leg");
  return {
    tokens: inc.map((x) => getAddress(x.token)),
    amounts: inc.map((x) => x.amount),
    swaps: inc.map((x) => (x.kind === "swap" ? swapCall(x.swap, x.tokenOut, floor1 ? 1n : x.swap.minOut) : EMPTY_SWAP)),
    ethLeg: quoted.leg ? swapCall(quoted.leg.swap, quoted.imd, floor1 ? 1n : quoted.leg.swap.minOut) : EMPTY_SWAP,
    splitInferToImd: Boolean(split?.splitInferToImd),
    minSplitRate: floor1 ? 1n : (split?.minSplitRate ?? 0n),
    minLiquidity: floor1 ? 1n : (split?.minLiquidity ?? 0n),
    deadline,
  };
}

/**
 * The simulation (every minOut 1) against the floors: a swap to IMD (its TokenConverted value) or the ETH leg (its
 * EthLegSwapped) that yields less than its minOut would revert the real call, and one more than 2 x HOP_MARGIN_BPS
 * under its quote means the quote and the simulation disagree too much to trust either. Returns { refuse: [...] }.
 */
export function checkSim(quoted, simLogs, marginBps) {
  const sim = new Map(simLogs.converted.map((c) => [getAddress(c.token), c.imdValue]));
  const refuse = [];
  const maxGap = 2 * Number(marginBps);
  const one = (label, w, simOut) => {
    if (simOut < w.minOut) refuse.push(`${label}: simulated ${simOut} is under its minOut ${w.minOut}`);
    else {
      const gap = deviationBps(simOut, w.expectedOut);
      if (gap > maxGap) refuse.push(`${label}: simulated ${simOut} is ${gap} bps under the quote ${w.expectedOut} (> 2 x HOP_MARGIN_BPS = ${maxGap})`);
    }
  };
  for (const x of quoted.included) {
    if (x.kind === "swap" && !x.toEth && sim.has(getAddress(x.token))) one(`${x.token} (${x.swap.source})`, x.swap, sim.get(getAddress(x.token)));
  }
  if (quoted.leg && simLogs.leg) one(`ETH leg (${quoted.leg.swap.source})`, quoted.leg.swap, simLogs.leg.imdOut);
  return { refuse };
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

/** The rate the vault checks: output wei per 1e18 input wei (UniAlignmentVault._balanceAndAdd, rounded down). */
export const splitRate = (amountIn, amountOut) => (amountIn === 0n ? 0n : (amountOut * 10n ** 18n) / amountIn);

/**
 * The balancing swap's direction and floors and the batch's liquidity floor: { splitInferToImd, minSplitRate,
 * minLiquidity }. Primary: simulate the call (the exact swap calldata, every minOut, the rate and the liquidity floor
 * at 1) with eth_simulateV1 at the planning block, in the direction pass 1 off chain says (re-simulated the other way
 * if the vault answers SplitDirection), and read SplitSwap (direction, in, out: every pass included) and
 * BatchConverted (liquidity). minSplitRate = its rate minus SPLIT_MARGIN_BPS; minLiquidity = its liquidity minus
 * LIQUIDITY_MARGIN_BPS. Fallback (node without eth_simulateV1): pass 1 reproduced off chain and quoted (its rate) and
 * a lower bound of pass 1's add (estimateLiquidity), with the same margins.
 */
export async function sizeSplit(client, cfg, ctx, batch, quoted, { from, deadline }) {
  // The probe runs with every minOut at 1 (the vault refuses 0: ZeroFloor), so it shows what each swap and the ETH leg
  // really yield at this block. The swaps' own calldata (0x minBuyAmount, zRouter amountLimit) still applies.
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
  const state = await poolState(client, cfg.POOL_MANAGER, ctx.key, batch.blockNumber);
  const offchain = await estimateSplit(client, cfg, {
    key: ctx.key, inferIsCurrency0: ctx.inferIsCurrency0, ...free, routedImd: quoted.routedImd, blockNumber: batch.blockNumber, state,
  });
  const simulate = (dir) => {
    const probe = buildParams(quoted, { splitInferToImd: dir }, deadline, { floor1: true });
    const data = encodeFunctionData({ abi: vaultAbi, functionName: "convertAndAddLiquidity", args: [probe] });
    return simulateV1(client, { from, to: ctx.vault, data }, batch.blockNumber);
  };
  const simErr = (sim) => revertName({ data: sim.error?.data, message: sim.error?.message });
  let guess = offchain ? offchain.inferToImd : false;
  let sim = await simulate(guess);
  if (sim && !sim.ok && simErr(sim) === "SplitDirection") {
    guess = !guess; // pass 1 off chain and the vault disagree on the direction: the vault's own answer decides
    sim = await simulate(guess);
  }
  let source;
  let splitOut;
  let splitIn = 0n;
  let splitInferToImd = guess;
  let liquidity;
  let simLogs = null;
  if (sim) {
    if (!sim.ok) return { error: simErr(sim), sim };
    simLogs = readSimLogs(sim.logs, ctx.vault);
    source = "simulation";
    splitOut = simLogs.split ? simLogs.split.amountOut : 0n;
    splitIn = simLogs.split ? simLogs.split.amountIn : 0n;
    if (simLogs.split) splitInferToImd = simLogs.split.inferToImd;
    if (!simLogs.batch) return { refuse: "the simulation emitted no BatchConverted (cannot size the liquidity floor)", source, simLogs, sim };
    liquidity = simLogs.batch.liquidity;
    // Cross-check against pass 1 reproduced off chain (pool state + quoter): the simulated total covers every pass, so
    // it is never under pass 1 alone unless the simulating node and the quotes disagree. Then trust neither.
    if (offchain) {
      const tol = cfg.SPLIT_CHECK_TOLERANCE_BPS ?? 0;
      const sameDir = simLogs.split && simLogs.split.inferToImd === offchain.inferToImd;
      const floor = offchain.amountOut - (offchain.amountOut * BigInt(tol)) / 10_000n;
      if (!sameDir || splitOut < floor) {
        const dir = (b) => (b ? "INFER->IMD" : "IMD->INFER");
        return {
          refuse: `balancing swap: simulated ${simLogs.split ? `${dir(simLogs.split.inferToImd)} out ${splitOut}` : "no swap"} vs off-chain pass 1 ${dir(offchain.inferToImd)} out ${offchain.amountOut}${tol ? ` (tolerance ${tol} bps)` : ""}: the simulation is below the off-chain quote`,
          source, splitOut, offchain, simLogs, sim,
        };
      }
    }
  } else {
    source = "offchain-pass1";
    splitOut = offchain ? offchain.amountOut : 0n;
    splitIn = offchain ? offchain.swapAmount : 0n;
    splitInferToImd = offchain ? offchain.inferToImd : false;
    liquidity = estimateLiquidity({
      amtInfer: free.freeInfer, amtImd: free.freeImd + quoted.routedImd, sqrtP: state.sqrtP, liquidity: state.liquidity,
      inferIsCurrency0: ctx.inferIsCurrency0, fee: ctx.key.fee, split: offchain,
    });
  }
  const rate = splitRate(splitIn, splitOut);
  let minSplitRate = rate === 0n ? 0n : applyMargin(rate, cfg.SPLIT_MARGIN_BPS);
  if (splitIn !== 0n && minSplitRate === 0n) minSplitRate = 1n; // a swap needs a non-zero floor (ZeroFloor)
  const liqMargin = cfg.LIQUIDITY_MARGIN_BPS ?? (cfg.SPLIT_MARGIN_BPS ?? 0) + 2 * (cfg.HOP_MARGIN_BPS ?? 0);
  if (!(liquidity > 0n)) return { refuse: `the batch would add no liquidity (${source})`, source, offchain, simLogs, sim };
  let minLiquidity = applyMargin(liquidity, liqMargin);
  if (minLiquidity === 0n) minLiquidity = 1n; // the vault refuses 0 (ZeroFloor)
  return {
    source, splitOut, splitIn, splitRate: rate, splitInferToImd, minSplitRate, liquidity, minLiquidity, offchain, simLogs,
    simGas: sim?.gasUsed ?? null,
  };
}
