// One tick: resolve any tx in flight, then plan (and, with --execute, send) each vault's conversion.
import { encodeFunctionData, formatEther, formatGwei, getAddress, keccak256, parseAbiItem, parseGwei } from "viem";
import { registryAbi, routesAbi, vaultAbi } from "./abi.mjs";
import { buildParams, capFloorsToSim, quoteBatch, readBatch, revertName, sizeSplit, vaultContext } from "./plan.mjs";
import { gasOk, worthIt } from "./decide.mjs";
import { killSwitch, ledger, preSendCheck } from "./guards.mjs";
import { chainOf, pendingStore, resolvePending } from "./outcome.mjs";
import { fmt, symbolOf } from "./tokens.mjs";

const bpsUp = (x, bps) => (x * (10_000n + BigInt(bps))) / 10_000n;

/**
 * Plan one vault's conversion at the current block: the tokens whose routes can absorb their pending amount, each at
 * exactly the amount read (what lands later stays pending in the vault; a new token or a top-up cannot break the call).
 * A BadParams revert should no longer happen; if one does (the vault and the keeper disagree), it re-reads and
 * re-quotes at most MAX_REQUOTES times, then gives up until the next tick.
 * `hooks.afterQuote(attempt)` runs between quoting and simulating (tests use it to land a contribution there).
 */
export async function planVault(client, cfg, ctx, { from, hooks = {} } = {}) {
  const attempts = [];
  for (let attempt = 0; attempt <= cfg.MAX_REQUOTES; attempt++) {
    const block = await client.getBlock({ blockTag: "latest" });
    const blockNumber = block.number;
    const batch = await readBatch(client, ctx, blockNumber);
    if (batch.tokens.length === 0) return { action: "idle", why: "nothing pending", batch, attempts };
    const sender = from ?? batch.keeper;
    const quoted = await quoteBatch(client, cfg, ctx, batch);
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

    const final = split.simLogs ? capFloorsToSim(quoted, split.simLogs, cfg.HOP_MARGIN_BPS) : quoted;
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
      lines.push(`  ETH leg: ${formatEther(leg.ethIn)} ETH -> ${fmt(ctx.imd, leg.outs.at(-1))} in one swap, floor ${fmt(ctx.imd, fl)}${leg.impactBps != null ? `, impact ${leg.impactBps} bps` : ""}`);
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
 * Logs are read in chunks of LOG_CHUNK blocks from where the last call stopped (`cache`); a failed chunk throws, so a
 * partial scan is never mistaken for the full list.
 */
export async function discoverVaults(client, cfg, cache = {}) {
  const set = new Set([...cfg.VAULTS, ...(cache.found ?? [])]);
  if (cfg.FACTORY && cfg.DISCOVER_FROM_BLOCK != null) {
    const registry = await client.readContract({ address: cfg.FACTORY, abi: routesAbi, functionName: "registry" });
    const event = parseAbiItem("event VaultDeployed(address indexed vault, uint256 indexed alignmentTargetId)");
    const head = await client.getBlockNumber();
    const chunk = BigInt(cfg.LOG_CHUNK ?? 50_000);
    let from = cache.next ?? BigInt(cfg.DISCOVER_FROM_BLOCK);
    cache.found ??= [];
    while (from <= head) {
      const to = from + chunk - 1n < head ? from + chunk - 1n : head;
      const logs = await client.getLogs({ address: cfg.FACTORY, event, fromBlock: from, toBlock: to });
      for (const l of logs) {
        const v = getAddress(l.args.vault);
        if (!(await client.readContract({ address: registry, abi: registryAbi, functionName: "isVault", args: [v] }))) continue;
        cache.found.push(v);
        set.add(v);
      }
      from = to + 1n;
      cache.next = from;
    }
  }
  return [...set];
}

/** Sign and send through the private RPC, recording the tx BEFORE it leaves (lib/outcome.mjs). */
export async function sendConvert({ client, cfg, account, sender, ctx, plan, reuse, log = console.log, now = Date.now }) {
  if (!sender?.configured) return { skipped: "PRIVATE_RPC_URL is not set: refusing to send (no public mempool fallback)" };
  const store = pendingStore(cfg);
  const book = ledger(cfg);
  let maxPriorityFeePerGas = plan.tipWei;
  let maxFeePerGas = plan.baseFeeWei * 2n + plan.tipWei;
  if (reuse) {
    if (maxFeePerGas < reuse.minMaxFeePerGas) maxFeePerGas = reuse.minMaxFeePerGas;
    if (maxPriorityFeePerGas < reuse.minMaxPriorityFeePerGas) maxPriorityFeePerGas = reuse.minMaxPriorityFeePerGas;
  }
  const latestNonce = BigInt(await client.getTransactionCount({ address: account.address, blockTag: "latest" }));
  const nonce = reuse ? reuse.nonce : latestNonce;
  if (reuse && reuse.nonce !== latestNonce) throw new Error(`reuse nonce ${reuse.nonce} but chain nonce is ${latestNonce}`);
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
  store.set({
    hash, from: account.address, nonce, vault: ctx.vault, deadline: plan.params.deadline, closedBatchesBefore: plan.batch.closedBatches,
    worstWei: worst, maxFeePerGas, maxPriorityFeePerGas, sentAt: new Date(now()).toISOString(),
  });
  book.book(hash, worst, now());
  try {
    await sender.sendRaw(signed);
  } catch (e) {
    // Refused outright (nonce, funds, underpriced): it never entered a mempool, so it is not in flight.
    if (/nonce too low|nonce has already been used|insufficient funds|underpriced|intrinsic gas|max fee per gas less than|refusing to send/i.test(e.message)) {
      store.clear();
      book.book(hash, 0n, now());
      return { failed: e.message.slice(0, 160) };
    }
    // Anything else (timeouts, 5xx on every RPC): it may have arrived. Leave the record; the next tick resolves it.
    return { hash, unknown: `send outcome unknown: ${e.message.slice(0, 120)}` };
  }
  log(`sent ${hash} nonce ${nonce} via ${sender.hosts.join(",")}`);
  return { hash, ...(await waitFor(client, cfg, hash)) };
}

async function waitFor(client, cfg, hash) {
  const until = Date.now() + cfg.TX_WAIT_SECONDS * 1000;
  const chain = chainOf(client, vaultAbi);
  while (Date.now() < until) {
    const rc = await chain.receipt(hash);
    if (rc) return { receipt: rc.status, block: rc.blockNumber };
    await new Promise((r) => setTimeout(r, 4000));
  }
  return { unknown: `no receipt within ${cfg.TX_WAIT_SECONDS}s; resolved next tick` };
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
    store.clear();
    return { blocked: false, line: `tx ${rec.hash} replaced (nonce ${rec.nonce} used by another tx); batch ${r.batchConverted ? "was" : "was NOT"} converted` };
  }
  if (r.state === "expired") {
    store.clear();
    return { blocked: false, reuse: r.reuse, line: `tx ${rec.hash} never mined and past its deadline (would revert Expired): nonce ${rec.nonce} reused with bumped fees` };
  }
  return { blocked: true, line: `tx ${rec.hash} still pending (${r.secondsToDeadline}s to its deadline): nothing else is sent` };
}

/** One pass over every vault. */
export async function tick({ client, cfg, account, sender, execute, vaults, contexts = new Map(), log = console.log }) {
  const pend = await settlePending(client, cfg);
  if (pend.line) log(pend.line);
  let reuse = pend.reuse;
  let blocked = pend.blocked;
  const results = [];
  for (const vault of vaults) {
    try {
      if (!contexts.has(vault)) contexts.set(vault, await vaultContext(client, vault));
      const ctx = contexts.get(vault);
      const plan = await planVault(client, cfg, ctx, { from: account?.address });
      log(describePlan(ctx, plan));
      results.push({ vault, plan });
      if (plan.action !== "convert") continue;
      if (!execute) {
        log("  report-only: not sent (run with --execute to send)");
        continue;
      }
      if (blocked) {
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
      const r = await sendConvert({ client, cfg, account, sender, ctx, plan, reuse, log });
      reuse = undefined;
      log(`  ${JSON.stringify(r, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`);
      results.at(-1).send = r;
      if (r.hash && (r.unknown || r.receipt === undefined)) blocked = true;
      if (r.receipt) await settlePending(client, cfg).then((s) => s.line && log(`  ${s.line}`));
    } catch (e) {
      log(`vault ${vault}: error ${(e.shortMessage ?? e.message).slice(0, 200)}`);
      results.push({ vault, error: e });
    }
  }
  return results;
}
