// Floors per hop and the margins.
import test from "node:test";
import assert from "node:assert/strict";
import { applyMargin, hopFloors } from "../lib/quote.mjs";

test("one hop: quote minus the margin", () => {
  assert.deepEqual(hopFloors([10_000n], 50), [9_950n]);
});

test("two hops: the margin compounds, so hop 1 tolerates hop 0 slipping within its allowance", () => {
  const [f0, f1] = hopFloors([1_000_000n, 2_000_000n], 50);
  assert.equal(f0, 995_000n);
  assert.equal(f1, (2_000_000n * 9950n * 9950n) / (10_000n * 10_000n)); // 1_980_050
  // hop 0 lands exactly at its floor: hop 1's input is 0.5% short, so its fair output is 0.5% short too, and it
  // still has its own 0.5% before its floor.
  const hop1AtFloorInput = (2_000_000n * f0) / 1_000_000n;
  assert.ok(applyMargin(hop1AtFloorInput, 50) >= f1);
});

test("floors never exceed quotes; zero quotes floor at zero; margin 0 = the quote", () => {
  const outs = [123_456_789n, 987n, 0n, 1n];
  const fl = hopFloors(outs, 50);
  fl.forEach((f, i) => assert.ok(f <= outs[i]));
  assert.equal(fl[2], 0n);
  assert.equal(fl[3], 0n, "1 unit after margin rounds down to 0");
  assert.deepEqual(hopFloors(outs, 0), outs);
});

test("applyMargin rounds down", () => {
  assert.equal(applyMargin(1_000_001n, 100), 990_000n);
  assert.equal(applyMargin(0n, 100), 0n);
});

import { capFloorsToSim } from "../lib/plan.mjs";
test("capFloorsToSim: a last floor above the simulated sequential output is lowered to it minus the margin", () => {
  const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const ETH = "0x0000000000000000000000000000000000000000";
  const items = [
    { token: USDC, kind: "route", floors: [995n, 1_980_050n] },
    { token: ETH, kind: "route", floors: [9_950n] },
    { token: "0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7", kind: "imd", floors: [] },
  ];
  const out = capFloorsToSim(items, [{ token: USDC, imdValue: 1_990_000n }, { token: ETH, imdValue: 20_000n }], 50);
  assert.deepEqual(out[0].floors, [995n, (1_990_000n * 9950n * 9950n) / 10n ** 8n]);
  assert.deepEqual(out[1].floors, [9_950n], "a simulation above the quote leaves the quoted floor");
  assert.equal(out[2], items[2]);
});
