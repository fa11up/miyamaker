#!/usr/bin/env node
// Read-only mainnet smoke: a batch of every payment token in contracts/script/config/1.json at a sample amount (~0.2 ETH
// worth each, the fork test's sizing), quoted the way the keeper quotes a vault (own hops, one ETH -> IMD leg, skip
// rules), with each hop's quote and floor, the batch's ETH value, the balancing swap's size and floor for a fresh vault,
// and what each configured contribution minimum is worth. No keys, no transactions: eth_call only.
//
//   npm run smoke [-- path/to/1.json]     RPC: SMOKE_RPC_URL (default https://ethereum-rpc.publicnode.com)
import { readFileSync } from "node:fs";
import { createPublicClient, formatEther, getAddress, http, parseEther } from "viem";
import { mainnet } from "viem/chains";
import { applyEnv } from "../lib/config.mjs";
import base from "../config.example.mjs";
import { ETH, endsInEth, reverseRoute, routesFromConfig } from "../lib/routes.mjs";
import { applyMargin, quoteRoute, quoteV4, v4Key, verifyQuoters } from "../lib/quote.mjs";
import { deviationBps, quoteBatch, usdReference } from "../lib/plan.mjs";
import { estimateSplit, poolState } from "../lib/split.mjs";
import { simulateV1 } from "../lib/rpc.mjs";
import { worthIt } from "../lib/decide.mjs";
import { fmt, symbolOf } from "../lib/tokens.mjs";

const file = process.argv[2] ?? new URL("../../contracts/script/config/1.json", import.meta.url).pathname;
const json = JSON.parse(readFileSync(file, "utf8"));
const cfg = applyEnv(base, {});
const url = process.env.SMOKE_RPC_URL ?? "https://ethereum-rpc.publicnode.com";
const client = createPublicClient({ chain: mainnet, transport: http(url, { timeout: 30_000, retryCount: 2 }) });

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

const blockNumber = await client.getBlockNumber();
console.log(`block ${blockNumber} via ${new URL(url).host}; config ${file.split("/").slice(-3).join("/")}`);
console.log(`margins: HOP_MARGIN_BPS ${cfg.HOP_MARGIN_BPS} (compounding per hop), SPLIT_MARGIN_BPS ${cfg.SPLIT_MARGIN_BPS}`);

const qc = await verifyQuoters(client, cfg);
console.log(`quoters OK: V4Quoter.poolManager ${qc.poolManager}; QuoterV2.factory ${qc.v3Factory}, WETH9 ${qc.weth}`);
const probe = await simulateV1(client, { from: "0x0000000000000000000000000000000000000001", to: "0x0000000000000000000000000000000000000002", data: "0x" }, blockNumber);
console.log(`eth_simulateV1: ${probe ? "supported (minSplitOut from the vault's own SplitSwap event)" : "NOT supported (off-chain pass-1 fallback)"}`);

const routes = routesFromConfig(json);
const ethRoute = routes.get(ETH);
const SAMPLE_ETH = parseEther("0.2");
const imdFor02 = (await quoteRoute(client, cfg, ethRoute, SAMPLE_ETH, blockNumber)).at(-1);
// A sample of `token` worth ~imdAmount IMD at the spot price of its route's first v4 pool (as the fork test sizes
// imdUSD): a reverse quote would test the pool's other side, which can be thinner.
const spotSample = async (token, imdAmount) => {
  const h = routes.get(token)[0];
  if (h.kind !== 4 || h.tokenOut !== IMD) throw new Error(`no spot sizing for ${token}`);
  const { key: k } = v4Key(h.tokenIn, h.tokenOut, h.fee, h.tickSpacing);
  const { sqrtP } = await poolState(client, json.poolManager, k, blockNumber);
  const Q = 1n << 96n;
  // P = currency1 per currency0
  return k.currency0 === IMD ? (((imdAmount * sqrtP) / Q) * sqrtP) / Q : (((imdAmount * Q) / sqrtP) * Q) / sqrtP;
};
const SAMPLES = {
  [ETH]: SAMPLE_ETH,
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": 600_000_000n,
  "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599": 600_000n,
  "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf": 600_000n,
};
const inferSample = await quoteV4(client, cfg, key, !inferIsCurrency0, imdFor02, blockNumber); // IMD -> INFER
const imdToEthQ = async (imd) => (await quoteRoute(client, cfg, reverseRoute(ethRoute), imd, blockNumber)).at(-1);

// One batch of every payment token at ~0.2 ETH each, quoted exactly as the keeper quotes a vault's batch
// (lib/plan.mjs quoteBatch): own hops, one ETH leg, skip rules (MAX_IMPACT_BPS), floors.
const tokens = [...routes.keys(), IMD, INFER];
const amounts = [];
for (const t of tokens) amounts.push(t === IMD ? imdFor02 : t === INFER ? inferSample : (SAMPLES[t] ?? (await spotSample(t, imdFor02))));
const ctx = { imd: IMD, infer: INFER, key, inferIsCurrency0, reward: 1_200_000_000_000_000n, rewardBps: 100n, routes: null };
const q = await quoteBatch(client, cfg, ctx, { tokens, amounts, blockNumber }, { routes });
console.log(`MAX_IMPACT_BPS ${cfg.MAX_IMPACT_BPS}, MAX_REFERENCE_DEVIATION_BPS ${cfg.MAX_REFERENCE_DEVIATION_BPS} (USD tokens)`);
for (const x of q.items) {
  const head = `\n${symbolOf(x.token)}  in ${fmt(x.token, x.amount)}  (~${formatEther(x.ethValue)} ETH)${x.impactBps != null ? `  impact ${x.impactBps} bps` : ""}`;
  if (x.skip) {
    const also = x.refDeviationBps != null && !/reference/.test(x.skip) ? ` (and ${x.refDeviationBps} bps under the market reference)` : "";
    console.log(`${head}\n  SKIPPED (would stay pending): ${x.skip}${also}`);
    continue;
  }
  console.log(`${head}${x.hops.length ? "" : x.kind === "eth" ? `  -> ETH leg with ${formatEther(x.ethIn)} ETH (net of the keeper reward)` : "  no route"}`);
  x.hops.forEach((h, i) => {
    const pool = h.kind === 4 ? `v4 ${h.fee}/${h.tickSpacing}` : `v3 ${h.fee}`;
    console.log(`  hop ${i} ${symbolOf(h.tokenIn)}->${symbolOf(h.tokenOut)} [${pool}]  quote ${fmt(h.tokenOut, x.outs[i])}  floor ${fmt(h.tokenOut, x.floors[i])}  (raw ${x.floors[i]})`);
  });
  if (x.kind === "toEth" || x.kind === "eth") console.log(`  share of the ETH leg: ${fmt(IMD, x.imdOut)}`);
}
if (q.leg) {
  const h = q.leg.hops[0];
  console.log(`\nETH leg [v4 ${h.fee}/${h.tickSpacing}]: ${formatEther(q.leg.ethIn)} ETH -> ${fmt(IMD, q.leg.outs.at(-1))} in one swap, impact ${q.leg.impactBps} bps, floor ${fmt(IMD, q.leg.floors.at(-1))} (raw ${q.leg.floors.at(-1)}, margin compounded ${q.leg.offset + 1}x)`);
}
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
  console.log(`  pass-1 quote ${fmt(outTok, split.amountOut)}  minSplitOut ${fmt(outTok, applyMargin(split.amountOut, cfg.SPLIT_MARGIN_BPS))}  (raw ${applyMargin(split.amountOut, cfg.SPLIT_MARGIN_BPS)})`);
}
// The configured contribution minimums (vault factory setMinContribution): what each is worth at this block.
console.log("\nminimum contributions (config/1.json minContributions):");
for (const m of json.minContributions ?? []) {
  const t = getAddress(m.token);
  const amt = BigInt(m.amount);
  let eth;
  if (t === IMD) eth = await imdToEthQ(amt);
  else if (t === INFER) eth = await imdToEthQ(await quoteV4(client, cfg, key, inferIsCurrency0, amt, blockNumber));
  else {
    const hops = routes.get(t);
    const out = (await quoteRoute(client, cfg, hops, amt, blockNumber)).at(-1);
    eth = endsInEth(hops) ? out : await imdToEthQ(out);
  }
  let refNote = "";
  if (cfg.USD_TOKENS[t] != null && routes.get(t)) {
    const r = await usdReference(client, cfg, ethRoute, blockNumber);
    const hops = routes.get(t);
    const out = (await quoteRoute(client, cfg, hops, amt, blockNumber)).at(-1);
    const want = endsInEth(hops) ? r.ethFor(t, amt) : r.imdFor(t, amt);
    const d = deviationBps(out, want);
    refNote = `  reference check at this size: ${d} bps under market (${d > cfg.MAX_REFERENCE_DEVIATION_BPS ? "SKIPPED" : "ok"})`;
  }
  console.log(`  ${symbolOf(t).padEnd(6)} ${fmt(t, amt)}  ~ ${formatEther(eth)} ETH${refNote}`);
}
