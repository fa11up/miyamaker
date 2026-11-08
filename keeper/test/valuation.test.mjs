// Batch valuation in ETH, per token and in total, from the (fake) live quotes; the keeper reward rule.
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

test("every kind of token valued in ETH; the ETH route gets the pending ETH minus the reward", async () => {
  const c = fakeChain({
    tokens: [ETH, USDC, CBBTC, IMDUSD, IMD, INFER],
    amounts: { [ETH]: E / 10n, [USDC]: 300_000_000n, [CBBTC]: 1_000_000n, [IMDUSD]: 400n * E, [IMD]: 86n * E, [INFER]: 3700n * 86n * E },
  });
  const ctx = fakeCtx();
  const batch = await readBatch(c, ctx, 100n);
  const q = await quoteBatch(c, cfg, ctx, batch);
  const by = Object.fromEntries(q.items.map((x) => [x.token, x]));
  assert.equal(q.reward, E / 10n / 100n, "1% of 0.1 ETH < 0.0012");
  assert.equal(by[ETH].routeIn, E / 10n - q.reward);
  assert.equal(by[ETH].ethValue, E / 10n, "ETH is valued at its full pending amount");
  assert.equal(by[ETH].outs[0], ((E / 10n - q.reward) * 850n));
  assert.equal(by[USDC].ethValue, 135_000_000_000_000_000n, "two-hop route: valued at the hop that pays ETH");
  assert.equal(by[CBBTC].ethValue, 33n * 10n ** 15n, "v3 hop quoted against WETH");
  assert.equal(by[IMDUSD].imdOut, 100n * E);
  assert.equal(by[IMDUSD].ethValue, (100n * E) / 860n, "no ETH hop: IMD out valued back through the reversed ETH route");
  assert.equal(by[IMD].ethValue, (86n * E) / 860n);
  assert.equal(by[INFER].inferImdValue, 86n * E);
  assert.equal(by[INFER].ethValue, (86n * E) / 860n, "INFER -> IMD in the alignment pool, then to ETH");
  assert.deepEqual(by[IMD].floors, []);
  const sum = q.items.reduce((s, x) => s + x.ethValue, 0n);
  assert.equal(q.batchEth, sum);
  assert.equal(q.routedImd, by[ETH].imdOut + by[USDC].imdOut + by[CBBTC].imdOut + by[IMDUSD].imdOut);
});

test("a token with no route is an error, not a silent zero", async () => {
  const other = "0x0000000000000000000000000000000000000Bad";
  const c = fakeChain({ tokens: [ETH, other], amounts: { [ETH]: E, [other]: 5n } });
  const ctx = fakeCtx();
  const batch = await readBatch(c, ctx, 100n);
  await assert.rejects(quoteBatch(c, cfg, ctx, batch), /no route/);
});
