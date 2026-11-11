// The balancing swap's direction, its rate floor and the batch's liquidity floor (swarm audit 4884eb75, findings 1 and
// 5): read from the vault's own simulation (SplitSwap: direction, in, out over every pass; BatchConverted: liquidity),
// each minus its margin; the probe re-simulates the other way when the vault answers SplitDirection; without
// eth_simulateV1, pass 1 off chain and a lower bound of its add.
import test from "node:test";
import assert from "node:assert/strict";
import { planVault } from "../lib/keeper.mjs";
import { splitRate } from "../lib/plan.mjs";
import { estimateLiquidity } from "../lib/split.mjs";
import { applyEnv } from "../lib/config.mjs";
import base0 from "../config.example.mjs";
import { ETH, USDC, cfg as base, fakeChain, fakeCtx } from "./fake.mjs";

const E = 10n ** 18n;
const Q96 = 1n << 96n;
const pair = () => ({ amounts: { [ETH]: E, [USDC]: 300_000_000n } });
const cfg = { ...base, LIQUIDITY_MARGIN_BPS: 200 };

test("from the simulation: the direction it ran, its rate minus SPLIT_MARGIN_BPS, its liquidity minus LIQUIDITY_MARGIN_BPS", async () => {
  const c = fakeChain({ ...pair(), simLiquidity: 5_000n * E });
  const plan = await planVault(c, cfg, fakeCtx());
  assert.equal(plan.action, "convert", plan.why);
  const p = plan.params;
  assert.equal(p.splitInferToImd, false, "IMD -> INFER, as simulated");
  const rate = splitRate(400n * E, 100_000_000n * E);
  assert.equal(p.minSplitRate, (rate * 9_900n) / 10_000n);
  assert.equal(p.minLiquidity, (5_000n * E * 9_800n) / 10_000n);
  assert.equal(plan.split.source, "simulation");
});

test("the vault runs the other way than pass 1 off chain says: the probe re-simulates in its direction and sends that", async () => {
  const c = fakeChain({ ...pair(), simDir: true });
  const plan = await planVault(c, cfg, fakeCtx());
  // The off-chain cross-check compares directions too, so this batch is refused, but only after the probe flipped.
  assert.deepEqual(c.state.simProbes.slice(0, 2), [false, true]);
  assert.equal(plan.action, "refused");
  assert.match(plan.why, /simulated INFER->IMD .* vs off-chain pass 1 IMD->INFER/);
});

test("a simulation without BatchConverted cannot size the liquidity floor: refused, nothing sent", async () => {
  const c = fakeChain({ ...pair(), noBatchLog: true });
  const plan = await planVault(c, cfg, fakeCtx());
  assert.equal(plan.action, "refused");
  assert.match(plan.why, /no BatchConverted/);
});

test("without eth_simulateV1: pass 1's direction and rate, and a liquidity floor under what the add makes", async () => {
  const c = fakeChain({ ...pair(), simulateV1: false, simLiquidity: 10n ** 40n });
  const plan = await planVault(c, cfg, fakeCtx());
  assert.equal(plan.action, "convert", plan.why);
  const s = plan.split;
  assert.equal(s.source, "offchain-pass1");
  assert.equal(plan.params.splitInferToImd, s.offchain.inferToImd);
  assert.equal(plan.params.minSplitRate, (splitRate(s.offchain.swapAmount, s.offchain.amountOut) * 9_900n) / 10_000n);
  assert.ok(plan.params.minLiquidity > 0n);
  assert.equal(plan.params.minLiquidity, (s.liquidity * 9_800n) / 10_000n);
});

test("estimateLiquidity is a lower bound of the full-range add, and shrinks when the swap moves the price against it", () => {
  // 1:1 price, 1,000 of each: getLiquidityForAmounts gives a hair above 1,000e18 (the range edges); the bound is 1,000e18.
  const l = estimateLiquidity({ amtInfer: 1_000n * E, amtImd: 1_000n * E, sqrtP: Q96, liquidity: 10n ** 24n, inferIsCurrency0: true, fee: 12500 });
  assert.equal(l, 1_000n * E);
  // All IMD, a pass-1 split IMD -> INFER of ~half: the result is positive and below the no-swap ideal.
  const split = { swapAmount: 500n * E, amountOut: 490n * E, zeroForOne: false };
  const m = estimateLiquidity({ amtInfer: 0n, amtImd: 1_000n * E, sqrtP: Q96, liquidity: 10n ** 24n, inferIsCurrency0: true, fee: 12500, split });
  assert.ok(m > 480n * E && m < 500n * E, String(m));
  assert.equal(estimateLiquidity({ amtInfer: 0n, amtImd: E, sqrtP: Q96, liquidity: 10n ** 24n, inferIsCurrency0: true, fee: 12500 }), 0n);
});

test("config: LIQUIDITY_MARGIN_BPS defaults to SPLIT + 2 x HOP, from the env, and must be in [0, 10000)", () => {
  const { LIQUIDITY_MARGIN_BPS: _drop, ...noLiq } = base0;
  assert.equal(applyEnv(noLiq, {}).LIQUIDITY_MARGIN_BPS, noLiq.SPLIT_MARGIN_BPS + 2 * noLiq.HOP_MARGIN_BPS);
  assert.equal(applyEnv(base0, { LIQUIDITY_MARGIN_BPS: "300" }).LIQUIDITY_MARGIN_BPS, 300);
  assert.throws(() => applyEnv(base0, { LIQUIDITY_MARGIN_BPS: "10000" }), /LIQUIDITY_MARGIN_BPS/);
});
