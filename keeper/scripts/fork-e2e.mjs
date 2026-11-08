#!/usr/bin/env node
// End to end on a LOCAL anvil fork of mainnet (never mainnet itself): deploy the registry, the vault libraries, the
// vault factory and one vault from contracts/out (run `forge build` in contracts/ first), set the spec's route table and
// contribution minimums, contribute every routed token plus IMD, then let the keeper plan and SEND
// convertAndAddLiquidity to the fork through its own send path (lib/keeper.mjs sendConvert, "private RPC" = the anvil
// URL). imdUSD's pool is off market (2026-11-08), so the keeper leaves it pending and converts the rest. Then the
// griefing case: a new token and a top-up land between the keeper's quote and its call; the call goes through.
//
//   npm run fork-e2e        FORK_URL (default https://ethereum-rpc.publicnode.com), needs anvil on PATH
// Keys: anvil's well-known public test accounts, valid only on the local fork.
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, getAddress, http, parseEther, maxUint256, parseAbi, encodePacked, keccak256, formatEther, toFunctionSelector } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import base from "../config.example.mjs";
import { applyEnv } from "../lib/config.mjs";
import { describePlan, planVault, sendConvert, settlePending } from "../lib/keeper.mjs";
import { feeless, vaultContext } from "../lib/plan.mjs";
import { quoteRoute } from "../lib/quote.mjs";
import { ETH as ETH_, routesFromConfig } from "../lib/routes.mjs";
import { imdFeedAbi } from "../lib/reference.mjs";
import { privateSender } from "../lib/rpc.mjs";

const FORK = process.env.FORK_URL ?? "https://ethereum-rpc.publicnode.com";
const PORT = 8547;
const URL_ = `http://127.0.0.1:${PORT}`;
const out = (n) => JSON.parse(readFileSync(new URL(`../../contracts/out/${n}.sol/${n}.json`, import.meta.url), "utf8"));
const json = JSON.parse(readFileSync(new URL("../../contracts/script/config/1.json", import.meta.url), "utf8"));
// anvil's default accounts 0..2 (public test keys)
const OWNER = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const KEEPER = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f2603b6b78690d");
const ALICE = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");

const ETH = "0x0000000000000000000000000000000000000000";
const IMD = getAddress(json.imd);
const INFER = getAddress(json.alignmentToken);
const USDC = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const WBTC = getAddress("0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599");
const CBBTC = getAddress("0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf");
const IMDUSD = getAddress("0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25");
const zr = parseAbi([
  "function swapV4(address to, bool exactOut, uint24 swapFee, int24 tickSpace, address tokenIn, address tokenOut, uint256 swapAmount, uint256 amountLimit, uint256 deadline) payable returns (uint256, uint256)",
  "function swapV3(address to, bool exactOut, uint24 swapFee, address tokenIn, address tokenOut, uint256 swapAmount, uint256 amountLimit, uint256 deadline) payable returns (uint256, uint256)",
]);
const erc = parseAbi(["function approve(address, uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);

const anvil = spawn("anvil", ["--fork-url", FORK, "--port", String(PORT), "--silent", "--chain-id", "1"], { stdio: "ignore" });
process.on("exit", () => anvil.kill());
const pub = createPublicClient({ chain: mainnet, transport: http(URL_, { timeout: 60_000 }) });
for (let i = 0; ; i++) {
  try {
    await pub.getBlockNumber();
    break;
  } catch {
    if (i > 60) throw new Error("anvil did not start");
    await new Promise((r) => setTimeout(r, 500));
  }
}
const wallet = (account) => createWalletClient({ account, chain: mainnet, transport: http(URL_, { timeout: 60_000 }) });
const W = { owner: wallet(OWNER), alice: wallet(ALICE) };
const wait = async (h) => {
  const rc = await pub.waitForTransactionReceipt({ hash: await h });
  if (rc.status !== "success") throw new Error(`tx ${rc.transactionHash} reverted`);
  return rc;
};
const libs = {};
/** Deploy `name`, deploying and linking the external libraries its bytecode references (forge leaves placeholders). */
async function deploy(name, args = []) {
  const a = out(name);
  let code = a.bytecode.object;
  for (const [, byName] of Object.entries(a.bytecode.linkReferences ?? {})) {
    for (const [lib, refs] of Object.entries(byName)) {
      libs[lib] ??= (await deploy(lib)).address;
      for (const { start, length } of refs) {
        const at = 2 + start * 2;
        code = code.slice(0, at) + libs[lib].slice(2).toLowerCase() + code.slice(at + length * 2);
      }
    }
  }
  const rc = await wait(W.owner.deployContract({ abi: a.abi, bytecode: code, args }));
  return { address: rc.contractAddress, abi: a.abi };
}
const write = (w, c, functionName, args = [], value) => wait(w.writeContract({ address: c.address, abi: c.abi, functionName, args, value }));

console.log(`anvil fork of ${new URL(FORK).host} at block ${await pub.getBlockNumber()}`);
const registry = await deploy("MiyaRegistry", [OWNER.address, json.treasury, 100, 1000]);
await write(W.owner, registry, "addTarget", ["INFER/IMD", [INFER, IMD]]);
await write(W.owner, registry, "setConversionKeeper", [KEEPER.address]);
for (const t of json.paymentTokens) await write(W.owner, registry, "setPaymentToken", [t, true]);
const key = { currency0: INFER, currency1: IMD, fee: json.alignmentPool.fee, tickSpacing: json.alignmentPool.tickSpacing, hooks: json.alignmentPool.hook };
const factory = await deploy("UniAlignmentVaultFactory", [registry.address, json.poolManager, json.zRouter, INFER, IMD, key]);
await write(W.owner, registry, "setVaultFactory", [factory.address, true]);
for (const r of json.routes) await write(W.owner, factory, "setRoute", [r.token, r.hops]);
for (const m of json.minContributions ?? []) await write(W.owner, factory, "setMinContribution", [m.token, BigInt(m.amount)]);
const salt = encodePacked(["address", "bytes1", "bytes11"], [factory.address, "0x00", keccak256("0x666f726b").slice(0, 24)]);
const vaultAddr = await pub.readContract({ address: factory.address, abi: factory.abi, functionName: "computeVaultAddress", args: [salt] });
await write(W.owner, factory, "deployVault", [salt, 0n]);
const vault = { address: vaultAddr, abi: out("UniAlignmentVault").abi };
console.log(`registry ${registry.address}, factory ${factory.address}, vault ${vaultAddr}; libraries ${JSON.stringify(libs)}`);

// Alice buys each token on the fork (through zRouter) and contributes it.
const T = { address: json.zRouter, abi: zr };
const dl = 2n ** 40n;
await write(W.alice, T, "swapV4", [ALICE.address, false, 500, 10, ETH, USDC, parseEther("0.3"), 0n, dl], parseEther("0.3"));
await write(W.alice, T, "swapV4", [ALICE.address, false, 10000, 200, ETH, IMD, parseEther("0.4"), 0n, dl], parseEther("0.4"));
await write(W.alice, T, "swapV3", [ALICE.address, false, 3000, ETH, CBBTC, parseEther("0.2"), 0n, dl], parseEther("0.2"));
await write(W.alice, T, "swapV4", [ALICE.address, false, 500, 10, ETH, WBTC, parseEther("0.01"), 0n, dl], parseEther("0.01"));
const bal = (t) => pub.readContract({ address: t, abi: erc, functionName: "balanceOf", args: [ALICE.address] });
const imdHeld = await bal(IMD);
await write(W.alice, { address: IMD, abi: erc }, "approve", [json.zRouter, maxUint256]);
// imdUSD: zRouter's IMD -> imdUSD swap reverts on the fork (CurrencyNotSettled; that side of the pool is thin, see
// the smoke run), so write Alice a balance straight into the token's storage (probing the balance mapping slot).
async function deal(token, who, amount) {
  const { encodeAbiParameters, toHex } = await import("viem");
  for (let i = 0n; i < 30n; i++) {
    const slot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [who, i]));
    const before = await pub.request({ method: "eth_getStorageAt", params: [token, slot, "latest"] });
    await pub.request({ method: "anvil_setStorageAt", params: [token, slot, toHex(amount, { size: 32 })] });
    if ((await pub.readContract({ address: token, abi: erc, functionName: "balanceOf", args: [who] })) === amount) return;
    await pub.request({ method: "anvil_setStorageAt", params: [token, slot, before] });
  }
  throw new Error(`no balance slot found for ${token}`);
}
await deal(IMDUSD, ALICE.address, 40n * 10n ** 18n); // ~ 0.01 ETH of imdUSD at spot
void imdHeld;
const give = async (token, amount) => {
  if (token === ETH) return write(W.alice, vault, "receiveContribution", [ETH, amount, ALICE.address], amount);
  await write(W.alice, { address: token, abi: erc }, "approve", [vaultAddr, amount]);
  return write(W.alice, vault, "receiveContribution", [token, amount, ALICE.address]);
};
await give(ETH, parseEther("0.2"));
await give(USDC, await bal(USDC));
await give(CBBTC, await bal(CBBTC));
await give(IMDUSD, await bal(IMDUSD));
await give(IMD, (await bal(IMD)) / 2n);
console.log(`batch: ${(await pub.readContract({ address: vaultAddr, abi: vault.abi, functionName: "openBatchTokens" })).length} tokens`);

// The keeper, against the fork. Its "private RPC" is the anvil node.
const cfg = applyEnv({ ...base, READ_RPC_URLS: [URL_], PRIVATE_RPC_URL: [URL_], STATE_DIR: mkdtempSync(join(tmpdir(), "vk-e2e-")), TX_WAIT_SECONDS: 30, MAX_GAS_GWEI: 1000, MAX_ETH_PER_DAY: 1 }, {});
const sender = privateSender(cfg);
const ctx = await vaultContext(pub, vaultAddr);
await wait(createWalletClient({ account: OWNER, chain: mainnet, transport: http(URL_) }).sendTransaction({ to: KEEPER.address, value: parseEther("1") }));
const keeperAccount = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f2603b6b78690d");

async function convertOnce(label, hooks) {
  const plan = await planVault(pub, cfg, ctx, { from: keeperAccount.address, hooks });
  console.log(`\n== ${label}\n${describePlan(ctx, plan)}`);
  if (plan.action !== "convert") throw new Error(`expected convert, got ${plan.action}: ${plan.why}`);
  const r = await sendConvert({ client: pub, cfg, account: keeperAccount, sender, ctx, plan, log: (l) => console.log(`  ${l}`) });
  const s = await settlePending(pub, cfg);
  console.log(`  ${s.line}`);
  if (r.receipt !== "success") throw new Error(`send: ${JSON.stringify(r, (_, v) => (typeof v === "bigint" ? `${v}` : v))}`);
  const rc = await pub.getTransactionReceipt({ hash: r.hash });
  const logs = (await import("../lib/plan.mjs")).readSimLogs(rc.logs, vaultAddr);
  console.log(`  landed: shares ${logs.batch.sharesIssued}, split out ${logs.split?.amountOut} vs floor ${plan.params.minSplitOut}, gas used ${rc.gasUsed} (estimate ${plan.gas})`);
  if (plan.split.offchain && logs.split) {
    const d = Number(plan.split.offchain.swapAmount - logs.split.amountIn) / Number(logs.split.amountIn);
    console.log(`  off-chain pass-1 split size vs realized: ${(d * 100).toFixed(4)}%`);
  }
  for (const tc of logs.converted) console.log(`  ${tc.token}: in ${tc.amountIn}, IMD value ${tc.imdValue}`);
  if (logs.leg) console.log(`  ETH leg: ${formatEther(logs.leg.ethIn)} ETH -> ${logs.leg.imdOut} IMD (floor ${plan.params.ethLegMinOuts.at(-1)})`);
  return plan;
}

const read = (functionName, args = []) => pub.readContract({ address: vaultAddr, abi: vault.abi, functionName, args });

// The IMD price feed as it is on mainnet: if it is stale, the ETH leg must not convert (fail closed). Report-only plan.
const feedStale = await pub.readContract({ address: cfg.IMD_PRICE_FEED, abi: imdFeedAbi, functionName: "isStale" });
const p0 = await planVault(pub, cfg, ctx, { from: keeperAccount.address });
console.log(`\n== with the mainnet IMD price feed as it is (isStale() = ${feedStale}), report-only\n${describePlan(ctx, p0)}`);
if (feedStale && p0.quoted?.leg) throw new Error("the ETH leg was planned on a stale IMD price feed");
// FORK ONLY: put a fresh feed at that address (latestValue = the ETH route's spot, updatedAt = now; isStale() = false),
// so the rest of the run exercises a conversion with the ETH leg. Nothing like this exists on mainnet.
{
  const ethRoute = routesFromConfig(json).get(ETH_);
  const probe = 10n ** 16n;
  const spot = feeless(ethRoute, (await quoteRoute(pub, cfg, ethRoute, probe)).at(-1)); // IMD per 0.01 ETH, before fees
  const ethPerImd = (probe * 10n ** 18n) / spot;
  const sel = toFunctionSelector("isStale()").slice(2);
  // if (selector == isStale()) return 0; else return (ethPerImd, block.timestamp)
  const code = `0x600035${"60e01c"}63${sel}14603c577f${ethPerImd.toString(16).padStart(64, "0")}6000524260205260406000f35b60206000f3`;
  await pub.request({ method: "anvil_setCode", params: [cfg.IMD_PRICE_FEED, code] });
  const [v] = await pub.readContract({ address: cfg.IMD_PRICE_FEED, abi: imdFeedAbi, functionName: "latestValue" });
  if (v !== ethPerImd) throw new Error("mock feed did not take");
  console.log(`\nFORK ONLY: mock IMD price feed at ${cfg.IMD_PRICE_FEED}: ${ethPerImd} wei per IMD (the ETH route's spot), fresh`);
}
const p1 = await convertOnce("mixed batch: ETH, USDC, cbBTC, imdUSD, IMD");
const skipped = p1.quoted.items.filter((x) => x.skip).map((x) => x.token);
console.log(`  skipped (left pending): ${skipped.join(", ") || "none"}; imdUSD still pending: ${await read("pendingOf", [ALICE.address, IMDUSD])}`);
if (!skipped.includes(IMDUSD)) console.log("  NOTE: imdUSD was converted (its pool is back near market?)");

// Minimums: 1 sat of WBTC is refused now.
try {
  await give(WBTC, 1n);
  throw new Error("a 1-sat WBTC contribution was accepted");
} catch (e) {
  if (/accepted/.test(e.message)) throw e;
  console.log("\n1 sat of WBTC refused (below the 3,000-sat minimum)");
}

// Griefing, then and now: a new batch, and while the keeper is between quote and call, a contribution in a NEW token
// (WBTC at its minimum) and an ETH top-up land. The call names its tokens and exact amounts: no BadParams, no
// re-quote; what landed later stays pending.
await give(ETH, parseEther("0.15"));
const p2 = await convertOnce("griefed batch (WBTC and an ETH top-up land mid-flight)", {
  async afterQuote(attempt) {
    if (attempt === 0) {
      await give(WBTC, 3000n);
      await give(ETH, parseEther("0.001"));
    }
  },
});
if (p2.attempts.length !== 0) throw new Error(`expected no re-quote, got ${p2.attempts.length}`);
console.log(`  pending after: WBTC ${await read("pendingByToken", [WBTC])}, ETH ${formatEther(await read("pendingByToken", [ETH]))} (the top-up), imdUSD ${await read("pendingByToken", [IMDUSD])}`);
const closed = await read("closedBatches");
const shares = await read("benefactorShares", [ALICE.address]);
console.log(`\nclosedBatches ${closed}, alice shares ${shares}, keeper ETH ${formatEther(await pub.getBalance({ address: KEEPER.address }))}`);
anvil.kill();
process.exit(0);
