#!/usr/bin/env node
// Read-only mainnet smoke: quote every route in contracts/script/config/1.json for a sample amount (~0.2 ETH worth,
// the fork test's sizing), print each hop's quote and floor, the batch's ETH value, and the balancing swap's size and
// floor for a fresh vault receiving all of it. No keys, no transactions: eth_call only.
//
//   npm run smoke [-- path/to/1.json]     RPC: SMOKE_RPC_URL (default https://ethereum-rpc.publicnode.com)
import { readFileSync } from "node:fs";
import { createPublicClient, formatEther, getAddress, http, parseEther } from "viem";
import { mainnet } from "viem/chains";
import { applyEnv } from "../lib/config.mjs";
import base from "../config.example.mjs";
import { ETH, reverseRoute, routesFromConfig } from "../lib/routes.mjs";
import { applyMargin, hopFloors, quoteRoute, quoteV4, v4Key, verifyQuoters } from "../lib/quote.mjs";
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

const q = await verifyQuoters(client, cfg);
console.log(`quoters OK: V4Quoter.poolManager ${q.poolManager}; QuoterV2.factory ${q.v3Factory}, WETH9 ${q.weth}`);
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
const imdToEth = async (imd) => (await quoteRoute(client, cfg, reverseRoute(ethRoute), imd, blockNumber)).at(-1);

const failed = [];
let totalEth = 0n;
let routedImd = 0n;
const rows = [];
for (const [token, hops] of routes) {
  const amount = SAMPLES[token] ?? (await spotSample(token, imdFor02));
  let outs;
  try {
    outs = await quoteRoute(client, cfg, hops, amount, blockNumber);
  } catch (e) {
    const raw = e?.cause?.raw ?? e?.raw ?? "";
    console.log(`\n${symbolOf(token)}  in ${fmt(token, amount)}: QUOTE FAILED (${raw.includes("7a5ed734") ? "NotEnoughLiquidity: the pool cannot absorb this amount" : (e.shortMessage ?? e.message).split("\n")[0]})`);
    failed.push(symbolOf(token));
    // Find the largest amount that does quote, halving down.
    let a = amount / 2n;
    while (a > 0n) {
      try {
        const o = await quoteRoute(client, cfg, hops, a, blockNumber);
        console.log(`  largest halving that quotes: ${fmt(token, a)} -> ${fmt(IMD, o.at(-1))}`);
        break;
      } catch {
        a /= 2n;
      }
    }
    continue;
  }
  const floors = hopFloors(outs, cfg.HOP_MARGIN_BPS);
  const k = hops.findIndex((h) => h.tokenOut === ETH);
  const ethValue = token === ETH ? amount : k >= 0 ? outs[k] : await imdToEth(outs.at(-1));
  totalEth += ethValue;
  routedImd += outs.at(-1);
  console.log(`\n${symbolOf(token)}  in ${fmt(token, amount)}  (~${formatEther(ethValue)} ETH)`);
  hops.forEach((h, i) => {
    const pool = h.kind === 4 ? `v4 ${h.fee}/${h.tickSpacing}` : `v3 ${h.fee}`;
    console.log(`  hop ${i} ${symbolOf(h.tokenIn)}->${symbolOf(h.tokenOut)} [${pool}]  quote ${fmt(h.tokenOut, outs[i])}  floor ${fmt(h.tokenOut, floors[i])}  (raw ${floors[i]})`);
  });
  rows.push({ token: symbolOf(token), amount, imdOut: outs.at(-1), lastFloor: floors.at(-1), ethValue });
}

// INFER and IMD need no route: value a sample of each the way the keeper does.
const inferSample = await quoteV4(client, cfg, key, !inferIsCurrency0, imdFor02, blockNumber); // IMD -> INFER
const inferImd = await quoteV4(client, cfg, key, inferIsCurrency0, inferSample, blockNumber); // and back, for value
console.log(`\nIMD    in ${fmt(IMD, imdFor02)}  (~${formatEther(await imdToEth(imdFor02))} ETH)  no route`);
console.log(`INFER  in ${fmt(INFER, inferSample)}  (~${formatEther(await imdToEth(inferImd))} ETH via INFER->IMD ${fmt(IMD, inferImd)})  no route`);

if (failed.length) console.log(`\nroutes that failed to quote at the sample size: ${failed.join(", ")} (a batch holding these cannot convert at all)`);
console.log(`\nbatch of every routed token that quoted: ${formatEther(totalEth)} ETH; ${worthIt(totalEth, cfg).go ? "above" : "below"} MIN_BATCH_ETH ${cfg.MIN_BATCH_ETH}`);
const st = await poolState(client, json.poolManager, key, blockNumber);
console.log(`INFER/IMD pool: sqrtPriceX96 ${st.sqrtP}, liquidity ${st.liquidity}`);
const split = await estimateSplit(client, cfg, { key, inferIsCurrency0, freeInfer: 0n, freeImd: 0n, routedImd, blockNumber, state: st });
if (!split) console.log("balancing swap: none");
else {
  const outTok = split.inferToImd ? IMD : INFER;
  const inTok = split.inferToImd ? INFER : IMD;
  console.log(`balancing swap (fresh vault, all ${fmt(IMD, routedImd)} routed IMD): ${symbolOf(inTok)}->${symbolOf(outTok)} in ${fmt(inTok, split.swapAmount)} of excess ${fmt(inTok, split.excess)}`);
  console.log(`  pass-1 quote ${fmt(outTok, split.amountOut)}  minSplitOut ${fmt(outTok, applyMargin(split.amountOut, cfg.SPLIT_MARGIN_BPS))}  (raw ${applyMargin(split.amountOut, cfg.SPLIT_MARGIN_BPS)})`);
}
// A dust contribution of a new token (the griefing case): does its route quote at all?
const dust = await quoteRoute(client, cfg, routes.get("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"), 1n, blockNumber);
console.log(`\ndust check: 1 unit of USDC quotes [${dust.join(", ")}] (a zero ends the route at 0; floors 0 there)`);
