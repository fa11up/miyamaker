// Batch valuation in ETH, per token and in total, from the (fake) live quotes; the ETH leg; the keeper reward rule.
import test from "node:test";
import assert from "node:assert/strict";
import { conversionReward, quoteBatch, readBatch } from "../lib/plan.mjs";
import { CBBTC, ETH, IMD, IMDUSD, INFER, USDC, cfg, fakeChain, fakeCtx } from "./fake.mjs";

const E = 10n ** 18n;

test("reward: 0.0012 ETH, capped at 1% of the batch's ETH, 0 without ETH", () => {
  assert.equal(conversionReward(E, 1_200_000_000_000_000n, 100n), 1_200_000_000_000_000n);
  assert.equal(conversionReward(5n * 10n ** 16n, 1_200_000_000_000_000n, 100n), 5n * 10n ** 14n);
  assert.equal(conversionReward(0n, 1_200_000_000_000_000n, 100n), 0n);
});

test("every kind of token valued in ETH; all ETH meets in one leg, its IMD shared by ETH in", async () => {
  const c = fakeChain({
    tokens: [ETH, USDC, CBBTC, IMDUSD, IMD, INFER],
    amounts: { [ETH]: E / 10n, [USDC]: 300_000_000n, [CBBTC]: 1_000_000n, [IMDUSD]: 400n * E, [IMD]: 86n * E, [INFER]: 3700n * 86n * E },
  });
  const ctx = fakeCtx();
  const batch = await readBatch(c, ctx, 100n);
  // The fake's imdUSD pool is off market (1 imdUSD = 0.25 IMD vs ~0.38 at the reference): reference check off here
  // (test/skip.test.mjs covers it).
  const q = await quoteBatch(c, { ...cfg, MAX_REFERENCE_DEVIATION_BPS: 9999 }, ctx, batch);
  const by = Object.fromEntries(q.items.map((x) => [x.token, x]));
  assert.equal(q.included.length, 6);
  assert.equal(q.reward, E / 10n / 100n, "1% of 0.1 ETH < 0.0012");
  assert.equal(by[ETH].ethIn, E / 10n - q.reward);
  assert.equal(by[ETH].ethValue, E / 10n, "ETH is valued at its full pending amount");
  assert.equal(by[USDC].ethIn, 135_000_000_000_000_000n, "route to ETH: its ETH out joins the leg");
  assert.equal(by[CBBTC].ethIn, 33n * 10n ** 15n, "v3 hop quoted against WETH");
  const legIn = by[ETH].ethIn + by[USDC].ethIn + by[CBBTC].ethIn;
  assert.equal(q.leg.ethIn, legIn);
  assert.equal(q.leg.outs.at(-1), legIn * 850n, "one quote for all of it");
  assert.equal(q.leg.offset, 1, "the leg's floors carry the feeding routes' slippage");
  assert.equal(by[USDC].imdOut, (legIn * 850n * by[USDC].ethIn) / legIn);
  assert.equal(by[IMDUSD].imdOut, 100n * E);
  assert.equal(by[IMDUSD].ethValue, (100n * E) / 860n, "no ETH hop: IMD out valued back through the reversed ETH route");
  assert.equal(by[IMD].ethValue, (86n * E) / 860n);
  assert.equal(by[INFER].inferImdValue, 86n * E);
  assert.equal(by[INFER].ethValue, (86n * E) / 860n, "INFER -> IMD in the alignment pool, then to ETH");
  assert.deepEqual(by[IMD].floors, []);
  assert.equal(q.batchEth, q.items.reduce((s, x) => s + x.ethValue, 0n));
  assert.equal(q.routedImd, q.leg.outs.at(-1) - (q.leg.outs.at(-1) - by[ETH].imdOut - by[USDC].imdOut - by[CBBTC].imdOut) + by[IMDUSD].imdOut);
});

test("a token with no route is an error, not a silent zero", async () => {
  const other = "0x0000000000000000000000000000000000000Bad";
  const c = fakeChain({ tokens: [ETH, other], amounts: { [ETH]: E, [other]: 5n } });
  const ctx = fakeCtx();
  const batch = await readBatch(c, ctx, 100n);
  await assert.rejects(quoteBatch(c, cfg, ctx, batch), /no route/);
});
