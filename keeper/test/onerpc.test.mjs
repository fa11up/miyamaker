// Floors that trust one RPC: the simulation (every minOut 1) must not be under the floors or far under the quotes, nor
// the simulated balancing swap under the off-chain pass-1 quote; else nothing is sent this tick. With a second read
// RPC, the IMD/ETH spot (the ETH leg's reference) must read the same on both.
import test from "node:test";
import assert from "node:assert/strict";
import { buildParams, quoteBatch, readBatch } from "../lib/plan.mjs";
import { planVault } from "../lib/keeper.mjs";
import { ETH, USDC, cfg as base, fakeChain, fakeCtx, sqrtFor } from "./fake.mjs";

const E = 10n ** 18n;
const pair = () => ({ amounts: { [ETH]: E, [USDC]: 300_000_000n } });

test("planVault: the simulated ETH leg 30% under its quote: refused, nothing to send", async () => {
  const c = fakeChain({ ...pair(), simLegOut: 600n * E }); // quote ~ 1.13 ETH * 850 = ~961 IMD
  const plan = await planVault(c, base, fakeCtx());
  assert.equal(plan.action, "refused");
  assert.match(plan.why, /REFUSED, nothing sent this tick: the simulation is under the floors or far under the quotes: ETH leg \(zRouter\)/);
  assert.equal(plan.params, undefined);
});

test("planVault: the simulated ETH leg slightly under its quote but above its minOut: converts at the quoted floor", async () => {
  const c = fakeChain(pair());
  const q = await planVault(c, base, fakeCtx());
  assert.equal(q.action, "convert", q.why);
  const legOut = q.quoted.leg.swap.expectedOut;
  c.state.simLegOut = (legOut * 9950n) / 10_000n; // 50 bps under; minOut is (1 - 0.5%)^2 under (fed by USDC)
  const plan = await planVault(c, base, fakeCtx());
  assert.equal(plan.action, "convert", plan.why);
  assert.equal(plan.params.ethLeg.minOut, q.params.ethLeg.minOut);
});

test("planVault: the simulated balancing swap under the off-chain pass-1 quote: refused", async () => {
  const c = fakeChain({ ...pair(), simSplitOut: 1000n });
  const plan = await planVault(c, base, fakeCtx());
  assert.equal(plan.action, "refused");
  assert.match(plan.why, /balancing swap: simulated IMD->INFER out 1000 vs off-chain pass 1 IMD->INFER out \d+/);
});

test("planVault: the probe and the exact call are simulated (the exact one at latest); the probe's floors are 1, never 0", async () => {
  const c = fakeChain(pair());
  const plan = await planVault(c, base, fakeCtx());
  assert.equal(plan.action, "convert", plan.why);
  assert.ok(c.state.calls.includes("eth_simulateV1@latest"), "the exact calldata simulated at latest");
  const probe = buildParams(plan.quoted, 1n, plan.params.deadline, { floor1: true });
  assert.ok([...probe.swaps, probe.ethLeg].filter((s) => s.data !== "0x").every((s) => s.minOut === 1n));
});

test("second read RPC: the leg converts only when both RPCs read the same IMD/ETH spot; one RPC configured keeps working", async () => {
  const ctx = fakeCtx();
  const c = fakeChain(pair());
  const batch = await readBatch(c, ctx, 100n);
  const same = await quoteBatch(c, base, ctx, batch, { crossClient: fakeChain(pair()) });
  assert.ok(same.leg, same.items.map((x) => x.skip).join("; "));
  assert.equal(same.leg.crossRpc.bps, 0);
  const liar = fakeChain(pair());
  liar.state.imdEthSqrtP = sqrtFor(900);
  const off = await quoteBatch(c, base, ctx, batch, { crossClient: liar });
  assert.equal(off.leg, null);
  assert.match(off.items.find((x) => x.token === ETH).skip, /the two read RPCs disagree on the IMD\/ETH spot by \d+ bps/);
  const tolerant = await quoteBatch(c, { ...base, CROSS_RPC_MAX_BPS: 600 }, ctx, batch, { crossClient: liar });
  assert.ok(tolerant.leg);
  const down = fakeChain(pair());
  down.state.failRead.extsload = true;
  const dead = await quoteBatch(c, base, ctx, batch, { crossClient: down });
  assert.match(dead.items.find((x) => x.token === ETH).skip, /second read RPC could not read the IMD\/ETH spot \(fail closed\)/);
  const one = await quoteBatch(c, base, ctx, batch);
  assert.ok(one.leg);
  assert.equal(one.leg.crossRpc, null);
});
