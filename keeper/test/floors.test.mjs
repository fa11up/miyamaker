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

test("an offset carries the slippage of hops that ran before (the ETH leg after the routes that feed it)", () => {
  assert.deepEqual(hopFloors([10_000n], 50, 1), [(10_000n * 9950n * 9950n) / 10n ** 8n]);
  assert.deepEqual(hopFloors([10_000n], 50, 0), hopFloors([10_000n], 50));
});

import { capFloorsToSim } from "../lib/plan.mjs";
test("capFloorsToSim: a last floor above the simulation is lowered to it minus the margin; leg too", () => {
  const IMDUSD = "0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25";
  const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const quoted = {
    included: [
      { token: IMDUSD, kind: "route", floors: [1_990_050n] },
      { token: USDC, kind: "toEth", floors: [995n] },
      { token: "0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7", kind: "imd", floors: [] },
    ],
    leg: { floors: [19_900n], offset: 1 },
  };
  const out = capFloorsToSim(quoted, { converted: [{ token: IMDUSD, imdValue: 1_990_000n }], leg: { imdOut: 20_000n } }, 50);
  assert.deepEqual(out.included[0].floors, [(1_990_000n * 9950n) / 10n ** 4n]);
  assert.equal(out.included[1], quoted.included[1], "routes to ETH have no per-token simulated output to cap at");
  assert.deepEqual(out.leg.floors, [(20_000n * 9950n * 9950n) / 10n ** 8n]);
  const high = capFloorsToSim(quoted, { converted: [{ token: IMDUSD, imdValue: 9_000_000n }], leg: { imdOut: 90_000n } }, 50);
  assert.equal(high.included[0], quoted.included[0], "a simulation above the quote leaves the quoted floor");
  assert.equal(high.leg, quoted.leg);
});
