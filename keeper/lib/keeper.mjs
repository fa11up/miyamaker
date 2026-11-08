// One tick: resolve any tx in flight, then plan (and, with --execute, send) each vault's conversion.
import { encodeFunctionData, formatEther, formatGwei, getAddress, keccak256, parseAbiItem, parseGwei } from "viem";
import { registryAbi, routesAbi, vaultAbi } from "./abi.mjs";
import { buildParams, capFloorsToSim, quoteBatch, readBatch, revertName, sizeSplit, vaultContext } from "./plan.mjs";
import { gasOk, worthIt } from "./decide.mjs";
import { killSwitch, ledger, preSendCheck } from "./guards.mjs";
import { BUMP_DEN, BUMP_NUM, chainOf, pendingStore, resolvePending } from "./outcome.mjs";
import { fmt, symbolOf } from "./tokens.mjs";

const bpsUp = (x, bps) => (x * (10_000n + BigInt(bps))) / 10_000n;

/**
 * Plan one vault's conversion at the current block: the tokens whose routes can absorb their pending amount, each at
 * exactly the amount read (what lands later stays pending in the vault; a new token or a top-up cannot break the call).
 * A BadParams revert should no longer happen; if one does (the vault and the keeper disagree), it re-reads and
 * re-quotes at most MAX_REQUOTES times, then gives up until the next tick.
 * `hooks.afterQuote(attempt)` runs between quoting and simulating (tests use it to land a contribution there).
 */
export async function planVault(client, cfg, ctx, { from, hooks = {}, crossClient = null } = {}) {
  const attempts = [];
  for (let attempt = 0; attempt <= cfg.MAX_REQUOTES; attempt++) {
    const block = await client.getBlock({ blockTag: "latest" });
    const blockNumber = block.number;
    const batch = await readBatch(client, ctx, blockNumber);
    batch.timestamp = block.timestamp;
    if (batch.tokens.length === 0) return { action: "idle", why: "nothing pending", batch, attempts };
    const sender = from ?? batch.keeper;
    const quoted = await quoteBatch(client, cfg, ctx, batch, { crossClient });
    if (quoted.included.length === 0) return { action: "wait", why: "every pending token was skipped (see each)", batch, quoted, attempts };
    const w = worthIt(quoted.batchEth, cfg);
    if (!w.go) return { action: "wait", why: w.why, batch, quoted, attempts };

    const deadline = block.timestamp + BigInt(cfg.DEADLINE_SECONDS);
    await hooks.afterQuote?.(attempt);
    const split = await sizeSplit(client, cfg, ctx, batch, quoted, { from: sender, deadline });
    if (split.error === "BadParams") {
      attempts.push({ attempt, error: "BadParams", tokens: batch.tokens });
      continue;
    }
    if (split.error) return { action: "refused", why: `simulation reverted: ${split.error}`, batch, quoted, attempts };
    if (split.refuse) return { action: "refused", why: `REFUSED, nothing sent this tick: ${split.refuse}`, batch, quoted, split, attempts };

    const final = split.simLogs ? capFloorsToSim(quoted, split.simLogs, cfg.HOP_MARGIN_BPS) : quoted;
    if (final.refuse?.length) {
      return { action: "refused", why: `REFUSED, nothing sent this tick: the simulation is far under the quotes: ${final.refuse.join("; ")}`, batch, quoted, split, attempts };
    }
    const params = buildParams(final, split.minSplitOut, deadline);
    // The exact call, at the latest state, from the keeper: the last check before anything is signed.
    try {
      await client.simulateContract({ address: ctx.vault, abi: vaultAbi, functionName: "convertAndAddLiquidity", args: [params], account: sender });
    } catch (e) {
      const name = revertName(e);
      if (name === "BadParams") {
        attempts.push({ attempt, error: "BadParams", tokens: batch.tokens });
        continue;
      }
      return { action: "refused", why: `simulation reverted: ${name}`, batch, quoted, split, params, attempts };
    }
    const gas = await client.estimateContractGas({ address: ctx.vault, abi: vaultAbi, functionName: "convertAndAddLiquidity", args: [params], account: sender });
    const gasLimit = bpsUp(gas, cfg.GAS_MARGIN_BPS);
    const baseFeeWei = block.baseFeePerGas ?? 0n;
    const tipWei = parseGwei(String(cfg.TIP_GWEI));
    const g = gasOk({ batchEthWei: quoted.batchEth, gas, baseFeeWei, tipWei }, cfg);
    return {
      action: g.go ? "convert" : "wait", why: g.why, batch, quoted, split, params, gas, gasLimit, baseFeeWei, tipWei,
      gasCheck: g, sender, attempts,
    };
  }
  return { action: "gave-up", why: `BadParams on ${attempts.length} attempts: the batch's token list keeps changing; next tick`, attempts };
}

export function describePlan(ctx, p) {
  const lines = [`vault ${ctx.vault}: ${p.action}${p.why ? ` (${p.why})` : ""}`];
  for (const a of p.quoted?.alerts ?? []) lines.push(`  ALERT: ${a}`);
  if (p.quoted) {
    for (const x of p.quoted.items) {
      const hops = x.outs.map((o, k) => `${symbolOf(x.hops[k].tokenOut)} ${fmt(x.hops[k].tokenOut, o)} floor ${fmt(x.hops[k].tokenOut, x.floors[k])}`);
      if (p.params) {
        const i = p.params.tokens.indexOf(x.token);
        const last = i >= 0 ? p.params.minOuts[i]?.at(-1) : undefined;
        if (last !== undefined && last !== x.floors.at(-1)) hops.push(`(last floor capped to the simulation: ${fmt(ctx.imd, last)})`);
      }
      const impact = `${x.impactBps != null ? `, impact ${x.impactBps} bps` : ""}${x.refDeviationBps != null ? `, ${x.refDeviationBps} bps under reference` : ""}`;
      const tail = hops.length ? `: ${hops.join(" -> ")}${x.kind === "toEth" ? " -> ETH leg" : ""}` : ` (${x.kind === "eth" ? "ETH leg" : `${x.kind}, no route`})`;
      if (x.skip) lines.push(`  SKIPPED ${fmt(x.token, x.amount)} (stays pending): ${x.skip}`);
      else lines.push(`  ${fmt(x.token, x.amount)} ~ ${formatEther(x.ethValue)} ETH${impact}${tail}`);
    }
    const leg = p.quoted.leg;
    if (leg) {
      const fl = p.params?.ethLegMinOuts?.at(-1) ?? leg.floors.at(-1);
      const checks = `${leg.feedDeviationBps != null ? `, ${leg.feedDeviationBps} bps under the IMD price feed (before fees)` : ""}${leg.crossRpc ? `, second RPC ${leg.crossRpc.bps} bps apart` : ""}`;
      lines.push(`  ETH leg: ${formatEther(leg.ethIn)} ETH -> ${fmt(ctx.imd, leg.outs.at(-1))} in one swap, floor ${fmt(ctx.imd, fl)}${leg.impactBps != null ? `, impact ${leg.impactBps} bps` : ""}${checks}`);
    }
    lines.push(`  batch ${formatEther(p.quoted.batchEth)} ETH, keeper reward ${formatEther(p.quoted.reward)} ETH, routed IMD ${fmt(ctx.imd, p.quoted.routedImd)}`);
  }
  if (p.split) {
    const s = p.split;
    const dir = s.simLogs?.split ? (s.simLogs.split.inferToImd ? "INFER->IMD" : "IMD->INFER") : s.offchain ? (s.offchain.inferToImd ? "INFER->IMD" : "IMD->INFER") : "none";
    const outTok = dir === "INFER->IMD" ? ctx.imd : ctx.infer;
    lines.push(`  split ${dir} via ${s.source}: out ${fmt(outTok, s.splitOut)}, minSplitOut ${fmt(outTok, s.minSplitOut)}${s.offchain ? ` (off-chain pass 1: in ${s.offchain.swapAmount}, out ${s.offchain.amountOut})` : ""}`);
  }
  if (p.gasCheck) lines.push(`  gas ${p.gas} (limit ${p.gasLimit}) at ${formatGwei(p.gasCheck.price)} gwei = ${formatEther(p.gasCheck.cost)} ETH, ${p.gasCheck.shareBps} bps of the batch`);
  for (const a of p.attempts ?? []) lines.push(`  attempt ${a.attempt}: ${a.error}, re-read openBatchTokens and re-quoted`);
  return lines.join("\n");
}

/**
 * Vaults to keep: VAULTS, plus (optionally) every VaultDeployed of FACTORY that the registry confirms with isVault.
 * Logs are read in chunks of LOG_CHUNK blocks (default 9,999: many providers cap eth_getLogs at 10,000 blocks) from
 * where the last call stopped (`cache`); a failed chunk throws, so a partial scan is never mistaken for the full list.
 */
export async function discoverVaults(client, cfg, cache = {}) {
  const set = new Set([...cfg.VAULTS, ...(cache.found ?? [])]);
  if (cfg.FACTORY && cfg.DISCOVER_FROM_BLOCK != null) {
    const registry = await client.readContract({ address: cfg.FACTORY, abi: routesAbi, functionName: "registry" });
    const event = parseAbiItem("event VaultDeployed(address indexed vault, uint256 indexed alignmentTargetId)");
    const head = await client.getBlockNumber();
    const chunk = BigInt(cfg.LOG_CHUNK ?? DEFAULT_LOG_CHUNK);
    let from = cache.next ?? BigInt(cfg.DISCOVER_FROM_BLOCK);
    cache.found ??= [];
    while (from <= head) {
      const to = from + chunk - 1n < head ? from + chunk - 1n : head;
      const logs = await client.getLogs({ address: cfg.FACTORY, event, fromBlock: from, toBlock: to });
      for (const l of logs) {
        const v = getAddress(l.args.vault);
        if (!(await client.readContract({ address: registry, abi: registryAbi, functionName: "isVault", args: [v] }))) continue;
        if (!cache.found.includes(v)) cache.found.push(v);
        set.add(v);
      }
      from = to + 1n;
      cache.next = from;
    }
  }
  return [...set];
}
export const DEFAULT_LOG_CHUNK = 9_999;

/**
 * discoverVaults, but a failed scan never stops the tick: the fixed VAULTS and every vault found so far still run (and
 * the tick still settles a tx in flight). The scan resumes from where it stopped next tick.
 */
export async function vaultsToKeep(client, cfg, cache, log = console.log) {
  try {
    return await discoverVaults(client, cfg, cache);
  } catch (e) {
    const known = [...new Set([...cfg.VAULTS, ...(cache.found ?? [])])];
    log(`vault discovery failed (${(e.shortMessage ?? e.message ?? String(e)).split("\n")[0].slice(0, 160)}); keeping the ${known.length} vault(s) already known this tick`);
    return known;
  }
}

/** A record that blocks every other send: one in flight. An expired one only waits to be replaced (same nonce). */
export const isBlocking = (rec) => Boolean(rec) && !rec.expired;

/** The fees a replacement of `rec` (same nonce) must at least pay: +12.5% over its own, plus 1 wei. */
export const bumpOf = (rec) => ({
  nonce: rec.nonce,
  minMaxFeePerGas: (rec.maxFeePerGas * BUMP_NUM) / BUMP_DEN + 1n,
  minMaxPriorityFeePerGas: (rec.maxPriorityFeePerGas * BUMP_NUM) / BUMP_DEN + 1n,
});

const NONCE_TAKEN = /nonce too low|nonce has already been used/i;
const REFUSED = /nonce too low|nonce has already been used|insufficient funds|underpriced|intrinsic gas|max fee per gas less than|refusing to send/i;

/**
 * Sign and send through the private RPC, recording the tx BEFORE it leaves (lib/outcome.mjs). Refuses while another
 * record is in flight. An expired record (dead, its nonce unused) stays on disk until this replaces it: the replacement
 * reuses its nonce at fees bumped from ITS fees, read from disk (so a restart or a skipped tick loses nothing), and the
 * expired record is overwritten only right before the replacement is sent (restored if the send is refused outright).
 */
export async function sendConvert({ client, cfg, account, sender, ctx, plan, log = console.log, now = Date.now }) {
  if (!sender?.configured) return { skipped: "PRIVATE_RPC_URL is not set: refusing to send (no public mempool fallback)" };
  const store = pendingStore(cfg);
  const book = ledger(cfg);
  const prior = store.get();
  if (isBlocking(prior)) return { skipped: `tx ${prior.hash} (nonce ${prior.nonce}) is still in flight: refusing to send another` };
  const reuse = prior ? bumpOf(prior) : undefined;
  let maxPriorityFeePerGas = plan.tipWei;
  let maxFeePerGas = plan.baseFeeWei * 2n + plan.tipWei;
  if (reuse) {
    if (maxFeePerGas < reuse.minMaxFeePerGas) maxFeePerGas = reuse.minMaxFeePerGas;
    if (maxPriorityFeePerGas < reuse.minMaxPriorityFeePerGas) maxPriorityFeePerGas = reuse.minMaxPriorityFeePerGas;
    if (maxPriorityFeePerGas > maxFeePerGas) maxFeePerGas = maxPriorityFeePerGas;
  }
  const latestNonce = BigInt(await client.getTransactionCount({ address: account.address, blockTag: "latest" }));
  const nonce = reuse ? reuse.nonce : latestNonce;
  if (reuse && reuse.nonce !== latestNonce) {
    return { skipped: `expired tx ${prior.hash} holds nonce ${reuse.nonce} but the chain nonce is ${latestNonce}: resolved next tick` };
  }
  const balance = await client.getBalance({ address: account.address });
  const skip = preSendCheck({
    cfg, balance, gasLimit: plan.gasLimit, maxFeePerGas, gasPrice: plan.baseFeeWei + maxPriorityFeePerGas, spentToday: book.spentToday(now()),
  });
  if (skip) return { skipped: skip };

  const data = encodeFunctionData({ abi: vaultAbi, functionName: "convertAndAddLiquidity", args: [plan.params] });
  const signed = await account.signTransaction({
    chainId: cfg.CHAIN_ID, type: "eip1559", to: ctx.vault, data, value: 0n, nonce: Number(nonce), gas: plan.gasLimit,
    maxFeePerGas, maxPriorityFeePerGas,
  });
  const hash = keccak256(signed);
  const worst = plan.gasLimit * maxFeePerGas;
  // Last look before the record is written: nothing else may have taken the slot since `prior` was read.
  const again = store.get();
  if (isBlocking(again) || (again?.hash ?? null) !== (prior?.hash ?? null)) return { skipped: "the pending record changed while signing: not sent" };
  store.set({
    hash, from: account.address, nonce, vault: ctx.vault, deadline: plan.params.deadline, closedBatchesBefore: plan.batch.closedBatches,
    worstWei: worst, maxFeePerGas, maxPriorityFeePerGas, sentAt: new Date(now()).toISOString(),
    ...(prior ? { replaces: prior.hash } : {}),
  });
  book.book(hash, worst, now());
  try {
    await sender.sendRaw(signed);
  } catch (e) {
    const msg = e.message ?? String(e);
    // After an earlier RPC failed in a way that may have delivered it (timeout, 5xx), a later refusal proves nothing
    // ("nonce too low" may be our own tx having landed): unknown, keep the record.
    if (e.ambiguous || !REFUSED.test(msg)) return { hash, unknown: `send outcome unknown: ${msg.slice(0, 160)}` };
    if (NONCE_TAKEN.test(msg)) {
      // The nonce is used on chain, maybe by this very tx. Keep the record and resolve it now: a receipt books the
      // actual cost; otherwise it was replaced (or the read node lags, and it stays pending until it catches up).
      const s = await settlePending(client, cfg, now);
      return { hash, nonceTaken: msg.slice(0, 160), settled: s.line };
    }
    // Refused outright (funds, underpriced): it never entered a mempool, so it is not in flight.
    if (prior) store.set(prior);
    else store.clear();
    book.book(hash, 0n, now());
    return { failed: msg.slice(0, 160) };
  }
  log(`sent ${hash} nonce ${nonce}${prior ? ` (replaces expired ${prior.hash})` : ""} via ${sender.hosts.join(",")}`);
  return { hash, ...(await waitFor(client, cfg, hash, log)) };
}

/** Poll for the receipt up to TX_WAIT_SECONDS. A failed poll (429, 5xx) is not an answer: keep polling, then "unknown". */
async function waitFor(client, cfg, hash, log = console.log) {
  const until = Date.now() + cfg.TX_WAIT_SECONDS * 1000;
  const chain = chainOf(client, vaultAbi);
  let lastErr = null;
  while (Date.now() < until) {
    try {
      const rc = await chain.receipt(hash);
      if (rc) return { receipt: rc.status, block: rc.blockNumber };
    } catch (e) {
      lastErr = (e.shortMessage ?? e.message ?? String(e)).split("\n")[0].slice(0, 120);
      log(`  receipt lookup for ${hash} failed (${lastErr}); still waiting`);
    }
    await new Promise((r) => setTimeout(r, cfg.RECEIPT_POLL_MS ?? 4000));
  }
  return { unknown: `no receipt within ${cfg.TX_WAIT_SECONDS}s${lastErr ? ` (last lookup failed: ${lastErr})` : ""}; resolved next tick` };
}

/** Resolve the record in flight, if any. Returns { blocked, reuse, line }. */
export async function settlePending(client, cfg, now = Date.now) {
  const store = pendingStore(cfg);
  const rec = store.get();
  if (!rec) return { blocked: false };
  const r = await resolvePending(rec, chainOf(client, vaultAbi));
  const book = ledger(cfg);
  if (r.state === "mined" || r.state === "reverted") {
    book.book(rec.hash, r.costWei, now());
    store.clear();
    return { blocked: false, line: `tx ${rec.hash} ${r.state} in block ${r.block}, cost ${formatEther(r.costWei)} ETH` };
  }
  if (r.state === "replaced") {
    book.book(rec.hash, 0n, now()); // ours can never land: it costs nothing
    store.clear();
    return { blocked: false, line: `tx ${rec.hash} replaced (nonce ${rec.nonce} used by another tx); batch ${r.batchConverted ? "was" : "was NOT"} converted` };
  }
  if (r.state === "expired") {
    // Kept on disk (marked) until a replacement is signed and sent: the bump is computed from it every tick.
    if (!rec.expired) store.set({ ...rec, expired: true });
    return { blocked: false, reuse: r.reuse, line: `tx ${rec.hash} never mined and past its deadline (would revert Expired): the next send reuses nonce ${rec.nonce} at fees >= ${r.reuse.minMaxFeePerGas} wei` };
  }
  return { blocked: true, line: `tx ${rec.hash} still pending (${r.secondsToDeadline}s to its deadline): nothing else is sent` };
}

/** One pass over every vault. */
export async function tick({ client, cfg, account, sender, execute, vaults, contexts = new Map(), crossClient = null, log = console.log }) {
  const store = pendingStore(cfg);
  const pend = await settlePending(client, cfg);
  if (pend.line) log(pend.line);
  let blocked = pend.blocked;
  const results = [];
  for (const vault of vaults) {
    try {
      if (!contexts.has(vault)) contexts.set(vault, await vaultContext(client, vault));
      const ctx = contexts.get(vault);
      const plan = await planVault(client, cfg, ctx, { from: account?.address, crossClient });
      log(describePlan(ctx, plan));
      results.push({ vault, plan });
      if (plan.action !== "convert") continue;
      if (!execute) {
        log("  report-only: not sent (run with --execute to send)");
        continue;
      }
      if (blocked || isBlocking(store.get())) {
        blocked = true;
        log("  not sent: a tx from this key is still in flight");
        continue;
      }
      const stop = killSwitch(cfg);
      if (stop) {
        log(`  not sent: ${stop}`);
        continue;
      }
      if (getAddress(plan.batch.keeper) !== account.address) {
        log(`  not sent: registry.conversionKeeper is ${plan.batch.keeper}, this key is ${account.address}`);
        continue;
      }
      const r = await sendConvert({ client, cfg, account, sender, ctx, plan, log });
      log(`  ${JSON.stringify(r, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`);
      results.at(-1).send = r;
      if (r.receipt) await settlePending(client, cfg).then((s) => s.line && log(`  ${s.line}`));
      blocked = isBlocking(store.get());
    } catch (e) {
      log(`vault ${vault}: error ${(e.shortMessage ?? e.message ?? String(e)).slice(0, 200)}`);
      results.push({ vault, error: e });
      // Whatever failed, a record on disk means a tx may be out: nothing else goes this tick. Read the store again
      // (a throw after the record was written leaves no other trace); if the store itself cannot be read, block.
      try {
        if (isBlocking(store.get())) blocked = true;
      } catch {
        blocked = true;
      }
    }
  }
  return results;
}
