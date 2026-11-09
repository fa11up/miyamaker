// The griefing case, before and after vault v2's subset conversion: a contribution landing between the keeper's read
// and its call (a new token, or more of a token in the call) no longer breaks the call: the keeper names the tokens
// and the exact amounts it read, and whatever lands later stays pending for the next batch.
import test from "node:test";
import assert from "node:assert/strict";
import { planVault } from "../lib/keeper.mjs";
import { CBBTC, ETH, IMDUSD, USDC, cfg, fakeChain, fakeCtx } from "./fake.mjs";

test("a new token lands mid-flight: the call is unaffected, no re-quote", async () => {
  const c = fakeChain();
  const hooks = {
    afterQuote(attempt) {
      if (attempt === 0) {
        c.state.tokens.push(CBBTC);
        c.state.amounts[CBBTC] = 1000n;
      }
    },
  };
  const plan = await planVault(c, cfg, fakeCtx(), { hooks });
  assert.equal(plan.action, "convert", plan.why);
  assert.equal(plan.attempts.length, 0);
  assert.deepEqual(plan.params.tokens, [ETH, USDC], "the new token waits for the next batch");
  assert.deepEqual(plan.params.amounts, [10n ** 17n, 300_000_000n]);
});

test("a top-up of a token in the call lands mid-flight: the amount read converts, the top-up stays pending", async () => {
  const c = fakeChain();
  const hooks = {
    afterQuote() {
      c.state.amounts[USDC] += 5_000_000n;
      c.state.tokens.push(IMDUSD);
      c.state.amounts[IMDUSD] = 10n ** 18n;
    },
  };
  const plan = await planVault(c, cfg, fakeCtx(), { hooks });
  assert.equal(plan.action, "convert", plan.why);
  assert.equal(plan.attempts.length, 0);
  assert.deepEqual(plan.params.amounts, [10n ** 17n, 300_000_000n]);
});

test("if the vault still says BadParams (keeper and vault disagree): re-read and re-quote, bounded", async () => {
  const c = fakeChain();
  c.state.rejectNext = true;
  const plan = await planVault(c, cfg, fakeCtx());
  assert.equal(plan.action, "convert", plan.why);
  assert.equal(plan.attempts.length, 1);
  assert.equal(plan.attempts[0].error, "BadParams");

  const d = fakeChain();
  const hooks = { afterQuote() { d.state.rejectNext = true; } };
  const gave = await planVault(d, { ...cfg, MAX_REQUOTES: 1 }, fakeCtx(), { hooks });
  assert.equal(gave.action, "gave-up");
  assert.equal(gave.attempts.length, 2);
  assert.match(gave.why, /re-planned 2 times \(BadParams; BadParams\)/);
});
