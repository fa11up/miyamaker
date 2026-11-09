#!/usr/bin/env node
// Read-only mainnet smoke: a batch of every payment token in contracts/script/config/1.json at a sample amount (~0.2 ETH
// worth each), sourced the way the keeper sources a vault's batch (0x first when ZEROEX_API_KEY is set, the zRouter
// fallback always; one ETH -> IMD leg; the market reference checks), with each swap's source, quote and minOut, the
// batch's ETH value, the balancing swap's size and floor for a fresh vault, and what each configured contribution
// minimum is worth. No keys of ours, no transactions: eth_call and (with a key) 0x quotes only. The 0x taker is a
// placeholder address (no vault is deployed yet), so 0x reports allowance/balance issues; they are expected.
//
//   npm run smoke [-- path/to/1.json]     RPC: SMOKE_RPC_URL (default https://ethereum-rpc.publicnode.com)
import { readFileSync } from "node:fs";
import { createPublicClient, formatEther, getAddress, http, parseEther } from "viem";
import { mainnet } from "viem/chains";
import { applyEnv } from "../lib/config.mjs";
import base from "../config.example.mjs";
import { ETH, fallbackRoutes } from "../lib/zrouter.mjs";
import { applyMargin, quoteRoute, quoteV4, verifyQuoters } from "../lib/quote.mjs";
import { quoteBatch } from "../lib/plan.mjs";
import { describeReferences, referenceReader } from "../lib/reference.mjs";
import { estimateSplit, poolState } from "../lib/split.mjs";
import { simulateV1 } from "../lib/rpc.mjs";
import { worthIt } from "../lib/decide.mjs";
import { fmt, symbolOf } from "../lib/tokens.mjs";
import { readSettlers, zeroExClient } from "../lib/zeroex.mjs";

const file = process.argv[2] ?? new URL("../../contracts/script/config/1.json", import.meta.url).pathname;
const json = JSON.parse(readFileSync(file, "utf8"));
const cfg = applyEnv(base, {});
const url = process.env.SMOKE_RPC_URL ?? "https://ethereum-rpc.publicnode.com";
const client = createPublicClient({ chain: mainnet, transport: http(url, { timeout: 30_000, retryCount: 2 }) });
// A second, independent read RPC for the IMD/ETH spot cross-check (as the keeper does with two READ_RPC_URLS).
const crossUrl = process.env.SMOKE_CROSS_RPC_URL ?? cfg.READ_RPC_URLS.find((u) => new URL(u).host !== new URL(url).host);
const crossClient = crossUrl ? createPublicClient({ chain: mainnet, transport: http(crossUrl, { timeout: 30_000, retryCount: 2 }) }) : null;
const zx = zeroExClient(cfg);
const TAKER = getAddress("0x000000000000000000000000000000000000dEaD"); // placeholder taker for 0x (no vault yet)

const IMD = getAddress(json.imd);
const INFER = getAddress(json.alignmentToken);
const key = {
  currency0: BigInt(INFER) < BigInt(IMD) ? INFER : IMD,
  currency1: BigInt(INFER) < BigInt(IMD) ? IMD : INFER,
  fee: json.alignmentPool.fee,
  tickSpacing: json.alignmentPool.tickSpacing,
  hooks: getAddress(json.alignmentPool.hook),
};
const inferIsCurrency0 = key.currency0 === INFER;

const { number: blockNumber, timestamp: blockTs } = await client.getBlock({ blockTag: "latest" });
console.log(`block ${blockNumber} via ${new URL(url).host}; config ${file.split("/").slice(-3).join("/")}`);
console.log(`margins: HOP_MARGIN_BPS ${cfg.HOP_MARGIN_BPS}, SPLIT_MARGIN_BPS ${cfg.SPLIT_MARGIN_BPS}; MAX_REFERENCE_DEVIATION_BPS ${cfg.MAX_REFERENCE_DEVIATION_BPS}; MAX_IMPACT_BPS ${cfg.MAX_IMPACT_BPS} (zRouter)`);
console.log(`0x: ${zx.enabled ? "ZEROEX_API_KEY set: quotes from the Swap API v2 (AllowanceHolder)" : "SKIPPED (ZEROEX_API_KEY not set): zRouter quotes only"}`);
if (zx.enabled) {
  const s = await readSettlers(client, blockNumber);
  console.log(`0x Settler registry: ${s.length ? s.join(", ") : "UNREADABLE (every 0x quote would be refused)"}`);
}

const qc = await verifyQuoters(client, cfg);
console.log(`quoters OK: V4Quoter.poolManager ${qc.poolManager}; QuoterV2.factory ${qc.v3Factory}, WETH9 ${qc.weth}`);
const probe = await simulateV1(client, { from: "0x0000000000000000000000000000000000000001", to: "0x0000000000000000000000000000000000000002", data: "0x" }, blockNumber);
console.log(`eth_simulateV1: ${probe ? "supported (minSplitOut from the vault's own SplitSwap event)" : "NOT supported (off-chain pass-1 fallback)"}`);
console.log("\nreferences (lib/reference.mjs):");
for (const line of await describeReferences(client, cfg)) console.log(`  ${line}`);
console.log(`  IMD/ETH spot cross-check RPC: ${crossClient ? new URL(crossUrl).host : "none"}`);

const routes = fallbackRoutes(cfg, IMD);
const refs = referenceReader(client, cfg, { blockNumber, now: blockTs, imd: IMD });
const SAMPLE_ETH = parseEther("0.2");
const imdFor02 = (await refs.imdForEth(SAMPLE_ETH)).imd;
// ~0.2 ETH of each token at its reference (Chainlink; imdUSD at 1 USD).
const sample = async (t) => {
  if (t === ETH) return SAMPLE_ETH;
  if (t === IMD) return imdFor02;
  if (t === INFER) return quoteV4(client, cfg, key, !inferIsCurrency0, imdFor02, blockNumber); // IMD -> INFER
  const one = { [6]: 10n ** 6n, [8]: 10n ** 8n, [18]: 10n ** 18n }[cfg.USD_TOKENS[t] ?? cfg.BTC_TOKENS[t] ?? 18];
  const r = await refs.ethFor(t, one);
  return r.err ? one : (one * SAMPLE_ETH) / r.wei;
};
const tokens = [ETH, ...json.paymentTokens.map((a) => getAddress(a))];
const amounts = [];
for (const t of tokens) amounts.push(await sample(t));
const ctx = { vault: TAKER, config: null, imd: IMD, infer: INFER, key, inferIsCurrency0, reward: 1_200_000_000_000_000n, rewardBps: 100n };
const q = await quoteBatch(client, cfg, ctx, { tokens, amounts, blockNumber, timestamp: blockTs }, { zx, crossClient });

const cand = (c, tokenOut) => (!c ? "not asked" : c.err ? `unusable: ${c.err}` : `${fmt(tokenOut, c.expectedOut)} (minOut ${fmt(tokenOut, c.minOut)}${c.impactBps != null ? `, impact ${c.impactBps} bps` : ""})`);
for (const a of q.alerts) console.log(`ALERT: ${a}`);
for (const x of q.items) {
  console.log(`\n${symbolOf(x.token)}  in ${fmt(x.token, x.amount)}  (~${formatEther(x.ethValue)} ETH)${x.refDeviationBps != null ? `  ${x.refDeviationBps} bps under its reference` : ""}`);
  if (x.kind === "swap" && x.candidates) {
    console.log(`  -> ${symbolOf(x.tokenOut)}  0x: ${cand(x.candidates.zx, x.tokenOut)}`);
    console.log(`  -> ${symbolOf(x.tokenOut)}  zRouter ${routes.get(x.token) ? `[${routes.get(x.token).kind === 4 ? "v4" : "v3"} ${routes.get(x.token).fee}]` : ""}: ${cand(x.candidates.zr, x.tokenOut)}`);
    if (!x.skip) console.log(`  picked ${x.swap.source}${x.swap.why ? ` (${x.swap.why})` : ""}${x.toEth ? `; its ETH joins the leg, share ${fmt(IMD, x.imdOut ?? 0n)}` : ""}`);
  } else if (x.kind === "eth") console.log(`  -> the ETH leg with ${formatEther(x.ethIn)} ETH (net of the keeper reward)`);
  if (x.skip) console.log(`  SKIPPED (would stay pending): ${x.skip}`);
}
if (q.leg) {
  const l = q.leg;
  console.log(`\nETH leg: ${formatEther(l.ethIn)} ETH -> IMD, ${l.fed ? "fed by swaps: zRouter only (sells all of msg.value)" : "exact ETH: 0x or zRouter"}`);
  console.log(`  0x: ${cand(l.candidates.zx, IMD)}`);
  console.log(`  zRouter: ${cand(l.candidates.zr, IMD)}`);
  console.log(`  picked ${l.swap.source}; ${l.spotBps} bps from the IMD/ETH spot${l.crossRpc ? `; second RPC ${l.crossRpc.bps} bps apart` : ""}`);
} else console.log("\nETH leg: none at this block (see the skips above)");
const skipped = q.items.filter((x) => x.skip).map((x) => symbolOf(x.token));
if (skipped.length) console.log(`\nskipped at the sample size: ${skipped.join(", ")} (they would stay pending; the rest converts)`);
console.log(`\nbatch of every included token: ${formatEther(q.batchEth)} ETH; ${worthIt(q.batchEth, cfg).go ? "above" : "below"} MIN_BATCH_ETH ${cfg.MIN_BATCH_ETH}; keeper reward ${formatEther(q.reward)} ETH`);
const st = await poolState(client, json.poolManager, key, blockNumber);
console.log(`INFER/IMD pool: sqrtPriceX96 ${st.sqrtP}, liquidity ${st.liquidity}`);
const inferIn = q.included.find((x) => x.token === INFER)?.amount ?? 0n;
const imdIn = q.included.find((x) => x.token === IMD)?.amount ?? 0n;
const split = await estimateSplit(client, cfg, { key, inferIsCurrency0, freeInfer: inferIn, freeImd: imdIn, routedImd: q.routedImd, blockNumber, state: st });
if (!split) console.log("balancing swap: none");
else {
  const outTok = split.inferToImd ? IMD : INFER;
  const inTok = split.inferToImd ? INFER : IMD;
  console.log(`balancing swap (fresh vault, this batch): ${symbolOf(inTok)}->${symbolOf(outTok)} in ${fmt(inTok, split.swapAmount)} of excess ${fmt(inTok, split.excess)}`);
  console.log(`  pass-1 quote ${fmt(outTok, split.amountOut)}  minSplitOut ${fmt(outTok, applyMargin(split.amountOut, cfg.SPLIT_MARGIN_BPS))}`);
}
// The configured contribution minimums (vault factory setMinContribution): what each is worth at this block.
console.log("\nminimum contributions (config/1.json minContributions), valued at the references:");
for (const m of json.minContributions ?? []) {
  const t = getAddress(m.token);
  const amt = BigInt(m.amount);
  let eth;
  if (t === IMD) eth = (await refs.ethForImd(amt)).wei;
  else if (t === INFER) eth = (await refs.ethForImd(await quoteV4(client, cfg, key, inferIsCurrency0, amt, blockNumber))).wei;
  else {
    const r = await refs.ethFor(t, amt);
    eth = r.err ? null : r.wei;
  }
  let fb = "";
  const hop = routes.get(t);
  if (hop) {
    const out = (await quoteRoute(client, cfg, [hop], amt, blockNumber).catch(() => [null])).at(-1);
    fb = out == null ? "  zRouter: quote failed" : `  zRouter at this size: ${fmt(hop.tokenOut, out)}`;
  }
  console.log(`  ${symbolOf(t).padEnd(6)} ${fmt(t, amt)}  ~ ${eth == null ? "?" : formatEther(eth)} ETH${fb}`);
}
console.log(`\n0x ${zx.enabled ? "was used" : "was skipped (no ZEROEX_API_KEY)"}; zRouter quotes ran.`);
