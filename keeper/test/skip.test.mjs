// A token whose route can't absorb its pending amount is left out (it stays pending in the vault) and the rest
// converts: a quote that fails, a price impact over MAX_IMPACT_BPS, or an ETH leg too big for its pool.
import test from "node:test";
import assert from "node:assert/strict";
import { quoteBatch, readBatch } from "../lib/plan.mjs";
import { planVault } from "../lib/keeper.mjs";
import { CBBTC, ETH, IMD, IMDUSD, USDC, WETH, cfg as base, fakeChain, fakeCtx } from "./fake.mjs";

// The fake's default imdUSD pool is off market; these tests are about the other rules (the reference check has its own).
const cfg = { ...base, MAX_REFERENCE_DEVIATION_BPS: 9999 };

const E = 10n ** 18n;
const many = () => ({
  tokens: [ETH, USDC, CBBTC, IMDUSD],
  amounts: { [ETH]: E / 2n, [USDC]: 300_000_000n, [CBBTC]: 1_000_000n, [IMDUSD]: 400n * E },
});

test("reference check, mainnet numbers of 2026-11-08: imdUSD (pool stuck at IMD = 4.17 imdUSD) skipped, the rest converts", async () => {
  // 1 ETH = 907 IMD (IMD/ETH), 1 ETH = 2,228 USDC (ETH/USDC), 1 imdUSD = 0.2398 IMD in the imdUSD/IMD pool. At 1 USD,
  // imdUSD should buy 907 / 2228 = 0.407 IMD: the pool pays 41% under (69% over market for IMD).
  const c = fakeChain({ ...many() });
  Object.assign(c.state.rates, {
    [`${ETH}>${IMD}`]: [907n, 1n],
    [`${IMD}>${ETH}`]: [1n, 916n],
    [`${ETH}>${USDC}`]: [2228n, 10n ** 12n],
    [`${USDC}>${ETH}`]: [10n ** 12n, 2229n],
    [`${IMDUSD}>${IMD}`]: [2398n, 10_000n],
  });
  const plan = await planVault(c, base, fakeCtx());
  assert.equal(plan.action, "convert", plan.why);
  assert.deepEqual(plan.params.tokens, [ETH, USDC, CBBTC], "imdUSD left pending; USDC (at market) and the rest convert");
  const by = Object.fromEntries(plan.quoted.items.map((x) => [x.token, x]));
  assert.ok(by[IMDUSD].refDeviationBps > 4000 && by[IMDUSD].refDeviationBps < 4200, `${by[IMDUSD].refDeviationBps}`);
  assert.match(by[IMDUSD].skip, /under the market reference/);
  assert.ok(by[USDC].refDeviationBps <= 10, `USDC at market: ${by[USDC].refDeviationBps}`);
  assert.equal(by[CBBTC].refDeviationBps, null, "no independent reference for BTC: its ETH hop is its market");
  // With imdUSD's pool back at market (1 imdUSD = 0.405 IMD), it converts.
  c.state.rates[`${IMDUSD}>${IMD}`] = [405n, 1000n];
  const ok = await planVault(c, base, fakeCtx());
  assert.deepEqual(ok.params.tokens, [ETH, USDC, CBBTC, IMDUSD]);
});

test("a route whose quote fails is skipped; the others convert", async () => {
  const c = fakeChain({ ...many(), fail: { [`${CBBTC}>${WETH}`]: true } });
  const plan = await planVault(c, cfg, fakeCtx());
  assert.equal(plan.action, "convert", plan.why);
  assert.deepEqual(plan.params.tokens, [ETH, USDC, IMDUSD]);
  const cb = plan.quoted.items.find((x) => x.token === CBBTC);
  assert.match(cb.skip, /quote failed: NotEnoughLiquidity/);
  assert.equal(cb.ethValue, 0n, "a skipped token is not counted in the batch value");
});

test("a thin route (impact over MAX_IMPACT_BPS) is skipped; under the limit it converts", async () => {
  // imdUSD/IMD with depth = 10x the amount: ~9% impact.
  const thin = fakeChain({ ...many(), depth: { [`${IMDUSD}>${IMD}`]: 4000n * E } });
  const ctx = fakeCtx();
  let q = await quoteBatch(thin, cfg, ctx, await readBatch(thin, ctx, 100n));
  const x = q.items.find((i) => i.token === IMDUSD);
  assert.ok(x.impactBps > 800 && x.impactBps < 1000, `${x.impactBps}`);
  assert.match(x.skip, /price impact/);
  assert.equal(q.included.length, 3);
  q = await quoteBatch(thin, { ...cfg, MAX_IMPACT_BPS: 1000 }, ctx, await readBatch(thin, ctx, 100n));
  assert.equal(q.included.length, 4);
});

test("an ETH leg too big for its pool drops its largest input until it fits", async () => {
  // ETH -> IMD depth 2 ETH: the 0.5 ETH + 0.135 + 0.033 leg moves it ~25%; without the ETH, ~8%; then ~1.6%.
  const c = fakeChain({ ...many(), depth: { [`${ETH}>${IMD}`]: 2n * E } });
  const ctx = fakeCtx();
  const q = await quoteBatch(c, cfg, ctx, await readBatch(c, ctx, 100n));
  const by = Object.fromEntries(q.items.map((i) => [i.token, i]));
  assert.match(by[ETH].skip, /ETH leg/);
  assert.match(by[USDC].skip, /ETH leg/);
  assert.equal(by[CBBTC].skip, null);
  assert.equal(q.leg.ethIn, by[CBBTC].ethIn);
  assert.ok(q.leg.impactBps <= cfg.MAX_IMPACT_BPS);
  assert.equal(q.reward, 0n, "no ETH converted, no keeper reward");
});

test("everything skipped: wait, nothing sent", async () => {
  const c = fakeChain({ tokens: [IMDUSD], amounts: { [IMDUSD]: 400n * E }, fail: { [`${IMDUSD}>${IMD}`]: true } });
  const plan = await planVault(c, cfg, fakeCtx());
  assert.equal(plan.action, "wait");
  assert.match(plan.why, /skipped/);
});
