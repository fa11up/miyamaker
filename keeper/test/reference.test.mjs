// Independent references (audit item 5): USD tokens vs Chainlink ETH/USD (not the v4 ETH/USDC pool USDC itself swaps
// through), BTC tokens vs Chainlink BTC/ETH (fallback BTC/USD / ETH/USD), the ETH leg vs the IMD price feed (stale =
// no leg). A failed or unusable reference skips only the tokens that need it (audit item 6).
import test from "node:test";
import assert from "node:assert/strict";
import { quoteBatch, readBatch } from "../lib/plan.mjs";
import { planVault } from "../lib/keeper.mjs";
import { CBBTC, ETH, FEED_BTC_ETH, FEED_ETH_USD, IMD, IMDUSD, IMD_FEED, USDC, WETH, cfg as base, fakeChain, fakeCtx } from "./fake.mjs";

const E = 10n ** 18n;
// imdUSD's fake pool sits at market for these tests: 1 USD = 0.00045 ETH = 0.3825 IMD.
const market = (over = {}) => {
  const c = fakeChain({
    tokens: [ETH, USDC, CBBTC, IMDUSD, IMD],
    amounts: { [ETH]: E / 2n, [USDC]: 300_000_000n, [CBBTC]: 1_000_000n, [IMDUSD]: 400n * E, [IMD]: 50n * E },
    ...over,
  });
  c.state.rates[`${IMDUSD}>${IMD}`] = [3825n, 10_000n];
  return c;
};
const quote = async (c, cfg = base) => {
  const ctx = fakeCtx();
  const batch = await readBatch(c, ctx, 100n);
  const q = await quoteBatch(c, cfg, ctx, batch);
  return { q, by: Object.fromEntries(q.items.map((x) => [x.token, x])) };
};

test("at market, every reference passes and everything converts", async () => {
  const { q, by } = await quote(market());
  assert.equal(q.included.length, 5, q.items.map((x) => x.skip).join("; "));
  assert.ok(by[USDC].refDeviationBps <= 1);
  assert.ok(by[IMDUSD].refDeviationBps <= 1);
  assert.equal(by[CBBTC].refDeviationBps, 0);
  assert.equal(q.leg.feedDeviationBps, 0);
  assert.deepEqual(q.alerts, []);
});

test("USDC: its v4 ETH/USDC pool 10% off market in BOTH directions is caught by Chainlink ETH/USD (the old same-pool reference was not)", async () => {
  const c = market();
  c.state.rates[`${USDC}>${ETH}`] = [405n * 10n ** 6n, 1n]; // 1 USDC -> 0.000405 ETH (10% under 0.00045)
  c.state.rates[`${ETH}>${USDC}`] = [20_000n * 10n, 9n * 10n ** 12n * 9n]; // the same pool's other direction, consistent
  const { by } = await quote(c);
  assert.match(by[USDC].skip, /1000 bps under the reference \(1 USD at Chainlink ETH\/USD/);
  assert.equal(by[CBBTC].skip, null);
  assert.ok(!by[ETH].skip);
});

test("cbBTC: its route 10% under Chainlink BTC/ETH is skipped; the rest converts", async () => {
  const c = market();
  c.state.rates[`${CBBTC}>${WETH}`] = [297n * 10n ** 8n, 1n]; // 2.97 ETH per BTC vs 3.3
  const { q, by } = await quote(c);
  assert.match(by[CBBTC].skip, /1000 bps under the reference \(Chainlink BTC\/ETH/);
  assert.equal(q.included.length, 4);
});

test("BTC/ETH fails its checks (wrong decimals): BTC is priced at BTC/USD / ETH/USD instead", async () => {
  const c = market();
  c.state.chainlink[FEED_BTC_ETH].decimals = 8;
  const { by } = await quote(c);
  assert.equal(by[CBBTC].skip, null);
  assert.ok(by[CBBTC].refDeviationBps <= 1, `${by[CBBTC].refDeviationBps}`);
  c.state.rates[`${CBBTC}>${WETH}`] = [297n * 10n ** 8n, 1n];
  const again = await quote(c);
  assert.match(again.by[CBBTC].skip, /BTC\/USD \/ ETH\/USD \(BTC\/ETH did not verify: .*18/);
});

test("ETH leg 10% under the IMD price feed: the whole leg (ETH, USDC, cbBTC) waits; imdUSD and IMD convert", async () => {
  const c = market();
  c.state.rates[`${ETH}>${IMD}`] = [765n, 1n]; // 765 IMD per ETH vs the feed's 850
  const { q, by } = await quote(c);
  for (const t of [ETH, USDC, CBBTC]) assert.match(by[t].skip, /ETH leg not converted this tick: pays \d+ bps under the IMD price feed/);
  assert.equal(q.leg, null);
  assert.deepEqual(q.included.map((x) => x.token).sort(), [IMDUSD, IMD].sort());
  assert.match(q.alerts.join("\n"), /ETH leg .* NOT converted/);
});

test("IMD price feed stale (isStale): fail closed, no ETH leg this tick and no imdUSD (its reference needs the IMD price); logged loudly", async () => {
  const c = market();
  c.state.imdFeed.stale = true;
  const plan = await planVault(c, base, fakeCtx());
  const by = Object.fromEntries(plan.quoted.items.map((x) => [x.token, x]));
  for (const t of [ETH, USDC, CBBTC]) assert.match(by[t].skip, /IMD price feed unusable \(fail closed\): .*isStale\(\) = true/);
  assert.match(by[IMDUSD].skip, /reference unavailable \(IMD side\)/);
  assert.equal(by[IMD].skip, undefined);
  const { describePlan } = await import("../lib/keeper.mjs");
  assert.match(describePlan(fakeCtx(), plan), /ALERT: ETH leg .* NOT converted this tick/);
});

test("IMD feed older than IMD_FEED_MAX_AGE_SECONDS (when set) is stale too", async () => {
  const c = market();
  c.state.imdFeed.age = 7200n;
  const { by } = await quote(c, { ...base, IMD_FEED_MAX_AGE_SECONDS: 3600 });
  assert.match(by[ETH].skip, /updated 7200s ago, max 3600s/);
  const ok = await quote(c);
  assert.ok(!ok.by[ETH].skip, "no age cap by default: isStale() decides");
});

test("Chainlink ETH/USD stale: only the USD tokens wait (BTC via BTC/ETH, the leg via the IMD feed still convert)", async () => {
  const c = market();
  c.state.chainlink[FEED_ETH_USD].age = 3601n;
  const { q, by } = await quote(c);
  assert.match(by[USDC].skip, /reference unavailable: ETH \/ USD stale: updated 3601s ago, max 3600s/);
  assert.match(by[IMDUSD].skip, /reference unavailable/);
  assert.deepEqual(q.included.map((x) => x.token).sort(), [ETH, CBBTC, IMD].sort());
});

test("one failed reference read (ETH/USD latestRoundData 503) skips only the tokens that need it, not the batch", async () => {
  const c = market();
  c.state.failRead[`${FEED_ETH_USD}.latestRoundData`] = true;
  const { q, by } = await quote(c);
  assert.match(by[USDC].skip, /reference unavailable: .*503/);
  assert.match(by[IMDUSD].skip, /reference unavailable/);
  assert.deepEqual(q.included.map((x) => x.token).sort(), [ETH, CBBTC, IMD].sort());
  // The IMD feed read failing: the leg and imdUSD wait; USDC is still checked (and its ETH waits with the leg).
  const d = market();
  d.state.failRead[`${IMD_FEED}.latestValue`] = true;
  const r = await quote(d);
  assert.deepEqual(r.q.included.map((x) => x.token), [IMD]);
});

test("a feed answering with the wrong description is not trusted", async () => {
  const c = market();
  c.state.chainlink[FEED_ETH_USD].description = "EUR / USD";
  const { by } = await quote(c);
  assert.match(by[USDC].skip, /is "EUR \/ USD", expected "ETH \/ USD"/);
});
