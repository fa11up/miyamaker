// Floors that trust one RPC (audit item 4): the simulation may lower a floor only a little (2 x HOP_MARGIN_BPS);
// further than that, or a simulated balancing swap under the off-chain pass-1 quote, and nothing is sent this tick.
// With a second read RPC, the ETH leg's quote must agree on both.
import test from "node:test";
import assert from "node:assert/strict";
import { capFloorsToSim, quoteBatch, readBatch } from "../lib/plan.mjs";
import { planVault } from "../lib/keeper.mjs";
import { ETH, IMD, IMDUSD, USDC, cfg as base, fakeChain, fakeCtx } from "./fake.mjs";

const E = 10n ** 18n;
const pair = () => ({ amounts: { [ETH]: E, [USDC]: 300_000_000n } });

test("capFloorsToSim: a simulated output more than 2 x HOP_MARGIN_BPS under the quote refuses instead of lowering the floor", () => {
  const quoted = {
    included: [{ token: IMDUSD, kind: "route", outs: [2_000_000n], floors: [1_990_000n] }],
    leg: { outs: [20_000n], floors: [19_800n], offset: 1 },
  };
  const near = capFloorsToSim(quoted, { converted: [{ token: IMDUSD, imdValue: 1_985_000n }], leg: { imdOut: 19_900n } }, 50);
  assert.deepEqual(near.refuse, [], "75 bps and 50 bps under: within 100, capped");
  assert.ok(near.included[0].floors[0] < 1_990_000n);
  const far = capFloorsToSim(quoted, { converted: [{ token: IMDUSD, imdValue: 1_900_000n }], leg: { imdOut: 15_000n } }, 50);
  assert.equal(far.refuse.length, 2);
  assert.match(far.refuse[0], /route .* 500 bps under the quote 2000000 \(> 2 x HOP_MARGIN_BPS = 100\)/);
  assert.match(far.refuse[1], /ETH leg: simulated 15000 is 2500 bps under/);
  assert.deepEqual(far.included[0].floors, [1_990_000n], "floors not lowered");
});

test("planVault: the simulated ETH leg 30% under its quote: refused, nothing to send", async () => {
  const c = fakeChain({ ...pair(), simLegOut: 600n * E }); // quote ~ 1.13 ETH * 850 = ~961 IMD
  const plan = await planVault(c, base, fakeCtx());
  assert.equal(plan.action, "refused");
  assert.match(plan.why, /REFUSED, nothing sent this tick: the simulation is far under the quotes: ETH leg/);
  assert.equal(plan.params, undefined);
});

test("planVault: the simulated ETH leg slightly under its quote (within 2x margin): floor capped, converts", async () => {
  const c = fakeChain(pair());
  const q = await planVault(c, base, fakeCtx());
  const legOut = q.quoted.leg.outs.at(-1);
  c.state.simLegOut = (legOut * 9930n) / 10_000n; // 70 bps under
  const plan = await planVault(c, base, fakeCtx());
  assert.equal(plan.action, "convert", plan.why);
  assert.ok(plan.params.ethLegMinOuts.at(-1) < q.params.ethLegMinOuts.at(-1));
});

test("planVault: the simulated balancing swap under the off-chain pass-1 quote: refused (it used to be logged only)", async () => {
  const c = fakeChain({ ...pair(), simSplitOut: 1000n });
  const plan = await planVault(c, base, fakeCtx());
  assert.equal(plan.action, "refused");
  assert.match(plan.why, /balancing swap: simulated IMD->INFER out 1000 vs off-chain pass 1 IMD->INFER out \d+/);
});

test("second read RPC: the ETH leg converts only when both RPCs quote it the same; one RPC configured keeps working", async () => {
  const ctx = fakeCtx();
  const c = fakeChain(pair());
  const batch = await readBatch(c, ctx, 100n);
  const same = await quoteBatch(c, base, ctx, batch, { crossClient: fakeChain(pair()) });
  assert.ok(same.leg, same.items.map((x) => x.skip).join("; "));
  assert.equal(same.leg.crossRpc.bps, 0);
  const liar = fakeChain(pair());
  liar.state.rates[`${ETH}>${IMD}`] = [900n, 1n];
  const off = await quoteBatch(c, base, ctx, batch, { crossClient: liar });
  assert.equal(off.leg, null);
  assert.match(off.items.find((x) => x.token === ETH).skip, /the two read RPCs disagree on the leg's quote by \d+ bps/);
  const tolerant = await quoteBatch(c, { ...base, CROSS_RPC_MAX_BPS: 600 }, ctx, batch, { crossClient: liar });
  assert.ok(tolerant.leg);
  const down = fakeChain(pair());
  down.state.failRead.quoteExactInputSingle = true;
  const dead = await quoteBatch(c, base, ctx, batch, { crossClient: down });
  assert.match(dead.items.find((x) => x.token === ETH).skip, /second read RPC could not quote the leg \(fail closed\)/);
  const one = await quoteBatch(c, base, ctx, batch);
  assert.ok(one.leg);
  assert.equal(one.leg.crossRpc, null);
});
