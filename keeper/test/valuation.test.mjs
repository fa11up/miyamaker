// Batch valuation in ETH, per token and in total; the ETH leg; the keeper reward rule.
import test from "node:test";
import assert from "node:assert/strict";
import { conversionReward, quoteBatch, readBatch } from "../lib/plan.mjs";
import { CBBTC, ETH, IMD, IMDUSD, INFER, USDC, cfg, fakeChain, fakeCtx, fakeZeroEx } from "./fake.mjs";

const E = 10n ** 18n;
/** a ~ b within 1 part in 10^9 (the IMD/ETH spot is a square root). */
const near = (a, b, msg) => assert.ok((a > b ? a - b : b - a) * 1_000_000_000n <= b, `${msg}: ${a} vs ${b}`);

test("reward: 0.0012 ETH, capped at 1% of the batch's ETH, 0 without ETH", () => {
  assert.equal(conversionReward(E, 1_200_000_000_000_000n, 100n), 1_200_000_000_000_000n);
  assert.equal(conversionReward(5n * 10n ** 16n, 1_200_000_000_000_000n, 100n), 5n * 10n ** 14n);
  assert.equal(conversionReward(0n, 1_200_000_000_000_000n, 100n), 0n);
});

for (const withZx of [false, true]) {
  test(`every kind of token valued in ETH; all ETH meets in one leg, its IMD shared by ETH in (${withZx ? "0x on" : "zRouter only"})`, async () => {
    const c = fakeChain({
      tokens: [ETH, USDC, CBBTC, IMDUSD, IMD, INFER],
      amounts: { [ETH]: E / 10n, [USDC]: 300_000_000n, [CBBTC]: 1_000_000n, [IMDUSD]: 400n * E, [IMD]: 86n * E, [INFER]: 3700n * 86n * E },
    });
    const ctx = fakeCtx();
    const batch = await readBatch(c, ctx, 100n);
    // The fake's imdUSD pool is off market (1 imdUSD = 0.25 IMD vs ~0.38 at the reference): reference check off here
    // (test/reference.test.mjs covers it).
    const q = await quoteBatch(c, { ...cfg, MAX_REFERENCE_DEVIATION_BPS: 9999 }, ctx, batch, { zx: withZx ? fakeZeroEx(c) : null });
    const by = Object.fromEntries(q.items.map((x) => [x.token, x]));
    assert.equal(q.included.length, 6, q.items.map((x) => x.skip).join("; "));
    assert.equal(q.reward, E / 10n / 100n, "1% of 0.1 ETH < 0.0012");
    assert.equal(by[ETH].ethIn, E / 10n - q.reward);
    assert.equal(by[ETH].ethValue, E / 10n, "ETH is valued at its full pending amount");
    assert.equal(by[USDC].ethIn, 135_000_000_000_000_000n, "swap to ETH: its ETH out joins the leg");
    assert.equal(by[CBBTC].ethIn, 33n * 10n ** 15n, "cbBTC to ETH (zRouter v3 against WETH, or 0x)");
    assert.equal(by[USDC].swap.source, withZx ? "0x" : "zRouter");
    const legIn = by[ETH].ethIn + by[USDC].ethIn + by[CBBTC].ethIn;
    assert.equal(q.leg.ethIn, legIn);
    assert.equal(q.leg.swap.expectedOut, legIn * 850n, "one quote for all of it");
    assert.equal(q.leg.swap.source, "zRouter", "a leg fed by swaps sells all of msg.value: zRouter, even with 0x on");
    assert.equal(q.leg.swap.minOut, (((legIn * 850n) * 9950n) / 10_000n * 9950n) / 10_000n, "fed by swaps: the margin twice");
    assert.equal(by[USDC].imdOut, (legIn * 850n * by[USDC].ethIn) / legIn);
    assert.equal(by[IMDUSD].imdOut, 100n * E);
    assert.equal(by[IMDUSD].tokenOut, IMD);
    near(by[IMDUSD].ethValue, (100n * E) / 850n, "a swap to IMD: valued at the IMD/ETH spot");
    near(by[IMD].ethValue, (86n * E) / 850n, "IMD at the spot");
    assert.equal(by[INFER].inferImdValue, 86n * E);
    near(by[INFER].ethValue, (86n * E) / 850n, "INFER -> IMD in the alignment pool, then at the spot");
    assert.equal(q.batchEth, q.items.reduce((s, x) => s + x.ethValue, 0n));
    assert.equal(q.routedImd, by[ETH].imdOut + by[USDC].imdOut + by[CBBTC].imdOut + by[IMDUSD].imdOut);
  });
}

test("a token with no reference price (and no route) is skipped, not converted blind; the rest converts", async () => {
  const other = "0x0000000000000000000000000000000000000Bad";
  const c = fakeChain({ tokens: [ETH, other], amounts: { [ETH]: E, [other]: 5n } });
  const ctx = fakeCtx();
  const q = await quoteBatch(c, cfg, ctx, await readBatch(c, ctx, 100n));
  assert.match(q.items.find((x) => x.token === other).skip, /no reference price/);
  assert.deepEqual(q.included.map((x) => x.token), [ETH]);
});
