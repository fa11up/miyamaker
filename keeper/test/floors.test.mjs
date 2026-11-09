// minOut: the keeper's margin, 0x's own minimum, the ETH leg's compounded margin; the simulation probe at minOut 1;
// the simulation checked against the floors.
import test from "node:test";
import assert from "node:assert/strict";
import { applyMargin } from "../lib/quote.mjs";
import { compoundMargin } from "../lib/swaps.mjs";
import { EMPTY_SWAP, buildParams, checkSim } from "../lib/plan.mjs";
import { ALLOWANCE_HOLDER } from "../lib/zeroex.mjs";
import { ZROUTER } from "../lib/zrouter.mjs";

const IMD = "0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7";
const IMDUSD = "0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const ETH = "0x0000000000000000000000000000000000000000";

test("applyMargin rounds down; compoundMargin applies it n times (the ETH leg fed by swaps: twice)", () => {
  assert.equal(applyMargin(10_000n, 50), 9_950n);
  assert.equal(applyMargin(199n, 50), 198n);
  assert.equal(compoundMargin(10_000n, 50, 1), 9_950n);
  assert.equal(compoundMargin(10_000n, 50, 2), (9_950n * 9_950n) / 10_000n);
  assert.equal(compoundMargin(10_000n, 0, 2), 10_000n);
});

const quoted = () => ({
  imd: IMD,
  included: [
    { token: ETH, kind: "eth", amount: 10n },
    { token: IMDUSD, kind: "swap", amount: 5n, tokenOut: IMD, toEth: false, swap: { source: "0x", target: ALLOWANCE_HOLDER, data: "0xab", expectedOut: 2_000_000n, minOut: 1_990_000n } },
    { token: USDC, kind: "swap", amount: 7n, tokenOut: ETH, toEth: true, swap: { source: "zRouter", target: ZROUTER, data: "0xcd", expectedOut: 1_000n, minOut: 995n } },
  ],
  leg: { swap: { source: "zRouter", target: ZROUTER, data: "0xef", expectedOut: 20_000n, minOut: 19_800n } },
});

test("buildParams: one SwapCall per token (empty for ETH), the leg, exact amounts; floor1 = every minOut 1 (never 0)", () => {
  const p = buildParams(quoted(), 7n, 99n);
  assert.deepEqual(p.tokens, [ETH, IMDUSD, USDC]);
  assert.deepEqual(p.amounts, [10n, 5n, 7n]);
  assert.deepEqual(p.swaps[0], EMPTY_SWAP);
  assert.deepEqual(p.swaps[1], { target: ALLOWANCE_HOLDER, tokenOut: IMD, data: "0xab", minOut: 1_990_000n });
  assert.deepEqual(p.swaps[2], { target: ZROUTER, tokenOut: ETH, data: "0xcd", minOut: 995n });
  assert.deepEqual(p.ethLeg, { target: ZROUTER, tokenOut: IMD, data: "0xef", minOut: 19_800n });
  assert.equal(p.minSplitOut, 7n);
  const probe = buildParams(quoted(), 1n, 99n, { floor1: true });
  assert.deepEqual([...probe.swaps.slice(1).map((s) => s.minOut), probe.ethLeg.minOut], [1n, 1n, 1n]);
  assert.equal(probe.swaps[1].data, "0xab", "the swap's own calldata is unchanged in the probe");
});

test("buildParams refuses a swap without a minimum, and ETH without a leg", () => {
  const q = quoted();
  q.included[1].swap.minOut = 0n;
  assert.throws(() => buildParams(q, 1n, 1n), /non-zero minOut/);
  const r = quoted();
  r.leg = null;
  assert.throws(() => buildParams(r, 1n, 1n), /no ETH leg/);
});

test("checkSim: a simulated output under minOut, or > 2 x margin under the quote, refuses; within it passes", () => {
  const q = quoted();
  assert.deepEqual(checkSim(q, { converted: [{ token: IMDUSD, imdValue: 1_995_000n }], leg: { imdOut: 19_950n } }, 50).refuse, []);
  const under = checkSim(q, { converted: [{ token: IMDUSD, imdValue: 1_980_000n }], leg: { imdOut: 19_950n } }, 50).refuse;
  assert.equal(under.length, 1);
  assert.match(under[0], /under its minOut 1990000/);
  q.included[1].swap.minOut = 1n;
  const far = checkSim(q, { converted: [{ token: IMDUSD, imdValue: 1_700_000n }], leg: { imdOut: 15_000n } }, 50).refuse;
  assert.equal(far.length, 2);
  assert.match(far[0], /1500 bps under the quote/);
  assert.match(far[1], /^ETH leg \(zRouter\): simulated 15000 is under its minOut/);
});
