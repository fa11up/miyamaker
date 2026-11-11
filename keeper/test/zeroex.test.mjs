// 0x first, zRouter as the fallback: the 0x client (headers, query), every check on a 0x quote, the choice between the
// two, the ETH leg (0x only when its ETH is exact; a pushed pool or stale quote caught against the spot), a quote that
// outlived QUOTE_MAX_AGE_SECONDS, and a 0x call that fails its simulation (re-planned with zRouter only).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { quoteBatch, readBatch } from "../lib/plan.mjs";
import { planVault, quoteExpired, sendConvert, tick } from "../lib/keeper.mjs";
import { pickSwap } from "../lib/swaps.mjs";
import { ALLOWANCE_HOLDER, NATIVE, quoteProblem, zeroExClient } from "../lib/zeroex.mjs";
import { ZROUTER } from "../lib/zrouter.mjs";
import { CBBTC, ETH, IMD, SETTLER, USDC, VAULT, cfg as base, fakeChain, fakeCtx, fakeZeroEx, sqrtFor, zxBody } from "./fake.mjs";

const E = 10n ** 18n;
const pair = (o = {}) => fakeChain({ tokens: [ETH, USDC], amounts: { [ETH]: E, [USDC]: 300_000_000n }, ...o });
const quote = async (c, cfg = base, zx = fakeZeroEx(c)) => {
  const ctx = fakeCtx();
  const q = await quoteBatch(c, cfg, ctx, await readBatch(c, ctx, 100n), { zx });
  return { q, by: Object.fromEntries(q.items.map((x) => [x.token, x])) };
};

test("client: Swap API v2 AllowanceHolder quote, key in the 0x-api-key header only, taker = the vault, ETH as 0xEeee", async () => {
  const seen = [];
  const zx = zeroExClient(base, {
    apiKey: "sekret",
    fetchImpl: async (url, init) => {
      seen.push({ url, headers: init.headers });
      return { ok: true, status: 200, text: async () => JSON.stringify(zxBody({ sellToken: NATIVE, buyToken: IMD, sellAmount: 5n, taker: VAULT, buyAmount: 4000n })) };
    },
  });
  assert.equal(zx.enabled, true);
  const { quote: q, at } = await zx.quote({ sellToken: ETH, buyToken: IMD, sellAmount: 5n, taker: VAULT, slippageBps: 50 });
  assert.equal(q.buyAmount, "4000");
  assert.equal(typeof at, "number");
  const u = new URL(seen[0].url);
  assert.equal(`${u.origin}${u.pathname}`, "https://api.0x.org/swap/allowance-holder/quote");
  assert.deepEqual(Object.fromEntries(u.searchParams), { chainId: "1", sellToken: NATIVE, buyToken: IMD, sellAmount: "5", taker: VAULT, slippageBps: "50" });
  assert.equal(seen[0].headers["0x-api-key"], "sekret");
  assert.equal(seen[0].headers["0x-version"], "v2");
  assert.ok(!seen[0].url.includes("sekret"));
  const off = zeroExClient(base, { apiKey: "" });
  assert.equal(off.enabled, false);
  assert.match(off.why, /ZEROEX_API_KEY not set: 0x skipped/);
});

test("client: 401 never echoes the key; no route, 5xx and a timeout are errors the fallback handles", async () => {
  const c = pair();
  for (const [mode, re, noRoute] of [["unauthorized", /^0x refused the API key$/, false], ["noRoute", /no route/, true], ["error", /HTTP 500/, false], ["timeout", /timed out/, false]]) {
    c.state.zxAll = mode;
    const err = await fakeZeroEx(c).quote({ sellToken: USDC, buyToken: ETH, sellAmount: 1n, taker: VAULT }).catch((e) => e);
    assert.match(err.message, re, mode);
    assert.equal(Boolean(err.noRoute), noRoute, mode);
    assert.ok(!err.message.includes("test-key"));
  }
});

test("quoteProblem: a good quote passes; every field that would make the vault run something else is refused", () => {
  const req = { sellToken: USDC, buyToken: ETH, sellAmount: 1000n, taker: VAULT };
  const good = zxBody({ sellToken: USDC, buyToken: NATIVE, sellAmount: 1000n, taker: VAULT, buyAmount: 500n });
  assert.equal(quoteProblem(good, req, [SETTLER]), undefined);
  const bad = (patch, re, settlers = [SETTLER]) => assert.match(quoteProblem({ ...good, ...patch }, req, settlers), re);
  bad({ transaction: { ...good.transaction, to: "0x000000000000000000000000000000000000dEaD" } }, /is not 0x AllowanceHolder/);
  bad({ sellAmount: "999" }, /sells 999, asked 1000/);
  bad({ buyToken: IMD }, /buys/);
  bad({ issues: { allowance: { spender: "0x000000000000000000000000000000000000dEaD" } } }, /asks to approve/);
  bad({ transaction: { ...good.transaction, value: "1" } }, /transaction.value 1/);
  bad({ minBuyAmount: "1" }, /calldata minimum .* is not minBuyAmount 1/);
  bad({ liquidityAvailable: false }, /no route/);
  bad({}, /Settler registry unreadable/, []);
  bad({}, /is not the registry's current one/, ["0x000000000000000000000000000000000000bAd0"]);
  const other = zxBody({ sellToken: USDC, buyToken: NATIVE, sellAmount: 1000n, taker: VAULT, buyAmount: 500n, recipient: "0x000000000000000000000000000000000000bEEF" });
  assert.match(quoteProblem(other, req, [SETTLER]), /pays 0x000000000000000000000000000000000000bEEF, not the vault/);
  // A native sell (the ETH leg): value must be the amount.
  const leg = zxBody({ sellToken: NATIVE, buyToken: IMD, sellAmount: 7n, taker: VAULT, buyAmount: 9n });
  assert.equal(quoteProblem(leg, { sellToken: ETH, buyToken: IMD, sellAmount: 7n, taker: VAULT }, [SETTLER]), undefined);
  assert.equal(leg.transaction.value, "7");
  // allowance / balance issues for taker = vault are expected, not errors.
  assert.equal(quoteProblem({ ...good, issues: { allowance: { actual: "0", spender: ALLOWANCE_HOLDER }, balance: { token: USDC, actual: "0", expected: "1000" } } }, req, [SETTLER]), undefined);
});

test("pickSwap: the better of the two; 0x within ZEROEX_MAX_WORSE_BPS of zRouter still wins; one side missing", () => {
  assert.equal(pickSwap({ expectedOut: 1000n }, { expectedOut: 999n }).source, "0x");
  assert.equal(pickSwap({ expectedOut: 990n }, { expectedOut: 1000n }).source, "zRouter");
  assert.match(pickSwap({ expectedOut: 990n }, { expectedOut: 1000n }).why, /0x quotes 100 bps under zRouter/);
  assert.equal(pickSwap({ expectedOut: 990n }, { expectedOut: 1000n }, 100).source, "0x");
  assert.equal(pickSwap({ err: "no route" }, { expectedOut: 1n }).source, "zRouter");
  assert.equal(pickSwap({ expectedOut: 1n }, { err: "impact" }).source, "0x");
  assert.match(pickSwap({ err: "a" }, { err: "b" }).err, /no usable swap: 0x a; zRouter b/);
});

test("good 0x quote: USDC goes through AllowanceHolder; minOut = the stricter of minBuyAmount and the keeper's margin", async () => {
  const c = pair();
  c.state.zx[`${USDC}>${ETH}`] = [1001n, 1000n]; // 0x 10 bps better than the pool
  const { q, by } = await quote(c);
  const s = by[USDC].swap;
  assert.equal(s.source, "0x");
  assert.equal(s.target, ALLOWANCE_HOLDER);
  assert.equal(s.expectedOut, (135_000_000_000_000_000n * 1001n) / 1000n);
  assert.equal(s.minOut, (s.expectedOut * 9950n) / 10_000n, "minBuyAmount at the same margin: equal");
  assert.equal(c.state.zxCalls[0].taker, VAULT);
  assert.equal(c.state.zxCalls[0].buyToken, NATIVE, "USDC is sold for ETH (it joins the leg)");
  c.state.zxSlippageBps = 10; // 0x's minimum tighter than the keeper's margin: its minBuyAmount is the floor
  const tight = (await quote(c)).by[USDC].swap;
  assert.equal(tight.minOut, tight.minBuyAmount);
  assert.equal(tight.minOut, (tight.expectedOut * 9990n) / 10_000n);
  c.state.zxSlippageBps = 300; // looser: the keeper's own margin
  const loose = (await quote(c)).by[USDC].swap;
  assert.equal(loose.minOut, (loose.expectedOut * 9950n) / 10_000n);
  assert.ok(q.leg, "the leg still converts");
});

for (const [mode, re] of [
  ["wrongTo", /is not 0x AllowanceHolder/],
  ["badSettler", /is not the registry's current one/],
  ["otherRecipient", /not the vault/],
  ["noRoute", /no route/],
  ["error", /HTTP 500/],
  ["timeout", /timed out/],
]) {
  test(`0x ${mode}: USDC falls back to zRouter (its v4 pool), and says why`, async () => {
    const c = pair();
    c.state.zx[`${USDC}>${ETH}`] = mode;
    const { by } = await quote(c);
    assert.equal(by[USDC].swap.source, "zRouter");
    assert.equal(by[USDC].swap.target, ZROUTER);
    assert.match(by[USDC].candidates.zx.err, re);
    assert.match(by[USDC].swap.why, /0x unusable/);
  });
}

test("0x worse than zRouter by more than ZEROEX_MAX_WORSE_BPS: zRouter; within it: 0x", async () => {
  const c = pair();
  c.state.zx[`${USDC}>${ETH}`] = [995n, 1000n]; // 50 bps worse
  assert.equal((await quote(c)).by[USDC].swap.source, "zRouter");
  assert.match((await quote(c)).by[USDC].swap.why, /0x quotes 50 bps under zRouter/);
  assert.equal((await quote(c, { ...base, ZEROEX_MAX_WORSE_BPS: 60 })).by[USDC].swap.source, "0x");
});

test("a target the factory does not allow is never used (isSwapTarget false)", async () => {
  const c = pair();
  c.state.targets[ALLOWANCE_HOLDER] = false;
  const { by } = await quote(c);
  assert.equal(by[USDC].swap.source, "zRouter");
  assert.match(by[USDC].candidates.zx.err, /not an allowed swap target/);
  c.state.targets[ALLOWANCE_HOLDER] = true;
  c.state.targets[ZROUTER] = false;
  const r = await quote(c);
  assert.equal(r.by[USDC].swap.source, "0x");
  assert.match(r.q.items.find((x) => x.token === ETH).skip, /ETH leg .* zRouter is not an allowed swap target/, "the fed leg needs zRouter");
});

test("0x off (no ZEROEX_API_KEY): every swap is zRouter and the plan says 0x was skipped", async () => {
  const c = pair();
  const { q, by } = await quote(c, base, zeroExClient(base, { apiKey: "" }));
  assert.equal(by[USDC].swap.source, "zRouter");
  assert.match(q.zeroEx, /ZEROEX_API_KEY not set/);
  assert.equal(c.state.zxCalls.length, 0);
});

test("the ETH leg goes through 0x only when its ETH is exact (pending ETH alone); fed by swaps it is zRouter (sells all of msg.value)", async () => {
  const alone = fakeChain({ tokens: [ETH], amounts: { [ETH]: E } });
  alone.state.zx[`${ETH}>${IMD}`] = [1002n, 1000n];
  const a = await quote(alone);
  assert.equal(a.q.leg.swap.source, "0x");
  assert.equal(a.q.leg.ethIn, E - 1_200_000_000_000_000n);
  assert.equal(alone.state.zxCalls[0].sellAmount, String(E - 1_200_000_000_000_000n), "0x asked for exactly what the vault will send");
  assert.equal(a.q.leg.swap.value, E - 1_200_000_000_000_000n);
  const fed = pair();
  fed.state.zx[`${ETH}>${IMD}`] = [1002n, 1000n];
  const f = await quote(fed);
  assert.equal(f.q.leg.swap.source, "zRouter");
  assert.ok(!fed.state.zxCalls.some((x) => x.sellToken === NATIVE), "0x not asked for a fed leg");
});

test("ETH leg vs a pushed pool / a stale 0x quote: the leg's IMD per ETH more than MAX_REFERENCE_DEVIATION_BPS from the spot waits", async () => {
  const c = fakeChain({ tokens: [ETH, IMD], amounts: { [ETH]: E, [IMD]: 10n * E } });
  c.state.zx[`${ETH}>${IMD}`] = [1001n, 1000n];
  assert.ok((await quote(c)).q.leg, "at the spot: converts");
  c.state.imdEthSqrtP = sqrtFor(780); // the pool pushed: spot 780 IMD per ETH, 0x still quotes ~851
  const r = await quote(c);
  assert.equal(r.q.leg, null);
  assert.match(r.by[ETH].skip, /0x pays \d+ bps OVER the IMD\/ETH pool's spot .* pushed or the quote is stale/);
  assert.equal(r.by[IMD].skip, undefined, "IMD itself still converts");
  c.state.imdEthSqrtP = sqrtFor(950); // the other way: the quote far under the spot
  const u = await quote(c);
  assert.match(u.by[ETH].skip, /0x pays \d+ bps under the IMD\/ETH pool's spot/);
});

test("reference deviation applies to 0x quotes too: a 0x quote 10% under Chainlink falls back to a zRouter at market", async () => {
  const c = pair();
  c.state.zx[`${USDC}>${ETH}`] = [900n, 1000n];
  const { by } = await quote(c);
  assert.equal(by[USDC].swap.source, "zRouter", "the better quote wins first");
  c.state.rates[`${USDC}>${ETH}`] = [40n * 10n ** 7n, 1n]; // the pool 11% under too
  const both = await quote(c);
  assert.match(both.by[USDC].skip, /bps under the reference \(1 USD at Chainlink ETH\/USD/);
});

const account = privateKeyToAccount(`0x${"22".repeat(32)}`); // a throwaway test key, never funded anywhere
const sending = () => {
  const s = { configured: true, hosts: ["rpc.mevblocker.io"], sent: [] };
  s.sendRaw = async (signed) => {
    s.sent.push(signed);
  };
  return s;
};

test("expired 0x quote: older than QUOTE_MAX_AGE_SECONDS at send time is re-quoted, never sent stale", async () => {
  assert.equal(quoteExpired({ quoted: { quotedAt: 0 } }, base, 25_000), false);
  assert.equal(quoteExpired({ quoted: { quotedAt: 0 } }, base, 25_001), true);
  assert.equal(quoteExpired({ quoted: { quotedAt: null } }, base, 1e12), false, "zRouter only: no 0x expiry");
  const cfg = { ...base, STATE_DIR: mkdtempSync(join(tmpdir(), "vk-zx-")), TX_WAIT_SECONDS: 0 };
  const c = fakeChain({ keeper: account.address, tokens: [ETH], amounts: { [ETH]: E } });
  c.state.zx[`${ETH}>${IMD}`] = [1002n, 1000n];
  let t = 0; // the 0x client's clock: the first quote is fetched at 0, later ones at 90 s
  const zx = fakeZeroEx(c, { now: () => (t++ === 0 ? 0 : 90_000) });
  const sender = sending();
  const lines = [];
  const res = await tick({ client: c, cfg, account, sender, execute: true, vaults: [VAULT], contexts: new Map([[VAULT, fakeCtx()]]), zx, log: (l) => lines.push(l), now: () => 100_000 });
  assert.match(lines.join("\n"), /0x quote older than QUOTE_MAX_AGE_SECONDS 25: re-quoting/);
  assert.equal(c.state.zxCalls.length, 2, "quoted again");
  assert.equal(sender.sent.length, 1, lines.join("\n"));
  assert.equal(res[0].plan.quoted.quotedAt, 90_000);
  // sendConvert itself refuses a stale plan.
  const plan = await planVault(c, cfg, fakeCtx(), { from: account.address, zx: fakeZeroEx(c, { now: () => 0 }) });
  const r = await sendConvert({ client: c, cfg, account, sender, ctx: fakeCtx(), plan, now: () => 60_000 });
  assert.match(r.skipped, /0x quote older than QUOTE_MAX_AGE_SECONDS/);
});

test("a call with 0x calldata that reverts in simulation is re-planned once with zRouter only", async () => {
  const c = fakeChain({ tokens: [ETH, USDC], amounts: { [ETH]: E, [USDC]: 300_000_000n } });
  c.state.zx[`${USDC}>${ETH}`] = [1001n, 1000n];
  c.state.revert0x = true;
  const plan = await planVault(c, base, fakeCtx(), { zx: fakeZeroEx(c) });
  assert.equal(plan.action, "convert", plan.why);
  assert.match(plan.attempts[0].error, /with 0x calldata: re-planned with zRouter only/);
  assert.ok([...plan.params.swaps.filter((s) => s.data !== "0x"), plan.params.ethLeg].every((s) => getAddress(s.target) === ZROUTER));
});

test("cbBTC through 0x or the zRouter v3 fallback: both sell for ETH", async () => {
  const c = fakeChain({ tokens: [CBBTC], amounts: { [CBBTC]: 10_000_000n } });
  c.state.zx[`${CBBTC}>${ETH}`] = "noRoute";
  const { by } = await quote(c);
  assert.equal(by[CBBTC].swap.source, "zRouter");
  assert.equal(by[CBBTC].swap.pool, "v3 3000");
  assert.equal(by[CBBTC].tokenOut, ETH);
});
