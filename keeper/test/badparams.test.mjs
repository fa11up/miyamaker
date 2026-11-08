// The griefing case: a contribution in a NEW token lands between the keeper's read and its call, so the token list no
// longer matches and the vault reverts BadParams. The keeper re-reads openBatchTokens and re-quotes, a bounded number
// of times.
import test from "node:test";
import assert from "node:assert/strict";
import { planVault } from "../lib/keeper.mjs";
import { CBBTC, ETH, IMDUSD, USDC, cfg, fakeChain, fakeCtx } from "./fake.mjs";

test("one new token mid-flight: re-read, re-quote, and the second plan includes it in order", async () => {
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
  assert.equal(plan.attempts.length, 1);
  assert.equal(plan.attempts[0].error, "BadParams");
  assert.deepEqual(plan.params.tokens, [ETH, USDC, CBBTC]);
  assert.equal(plan.params.minOuts[2].length, 2, "the new token got its own floors");
});

test("caught at the final eth_call too (simulateV1 saw the old list, the latest block has the new one)", async () => {
  const c = fakeChain();
  const realReq = c.request;
  let n = 0;
  c.request = async (a) => {
    const r = await realReq(a);
    if (n++ === 0) {
      c.state.tokens.push(IMDUSD);
      c.state.amounts[IMDUSD] = 10n ** 18n;
    }
    return r;
  };
  const plan = await planVault(c, cfg, fakeCtx());
  assert.equal(plan.action, "convert", plan.why);
  assert.equal(plan.attempts.length, 1);
  assert.deepEqual(plan.params.tokens, [ETH, USDC, IMDUSD]);
});

test("a griefer adding a token every time: gives up after MAX_REQUOTES + 1 tries, until the next tick", async () => {
  const c = fakeChain();
  const extra = [CBBTC, IMDUSD, "0x0000000000000000000000000000000000000001"];
  let i = 0;
  const hooks = {
    afterQuote() {
      const t = extra[i++];
      c.state.tokens.push(t);
      c.state.amounts[t] = 10n ** 6n;
    },
  };
  const plan = await planVault(c, { ...cfg, MAX_REQUOTES: 1 }, fakeCtx(), { hooks });
  assert.equal(plan.action, "gave-up");
  assert.equal(plan.attempts.length, 2);
  assert.match(plan.why, /BadParams on 2 attempts/);
});
