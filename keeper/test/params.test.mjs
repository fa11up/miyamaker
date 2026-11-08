// ConvertParams: tokens exactly in openBatchTokens() order, minOuts aligned with them.
import test from "node:test";
import assert from "node:assert/strict";
import { buildParams } from "../lib/plan.mjs";
import { ETH, IMD, INFER, USDC } from "./fake.mjs";

const items = [
  { token: USDC, kind: "route", floors: [1n, 2n] },
  { token: INFER, kind: "infer", floors: [] },
  { token: ETH, kind: "route", floors: [3n] },
  { token: IMD, kind: "imd", floors: [] },
];

test("order follows openBatchTokens, not the order quotes came back in", () => {
  const order = [IMD, ETH, INFER, USDC];
  const p = buildParams(order, items, 7n, 99n);
  assert.deepEqual(p.tokens, order);
  assert.deepEqual(p.minOuts, [[], [3n], [], [1n, 2n]]);
  assert.equal(p.minSplitOut, 7n);
  assert.equal(p.deadline, 99n);
});

test("lowercase addresses from a node are matched; a quote missing or extra is an error", () => {
  const p = buildParams([USDC.toLowerCase(), ETH, IMD, INFER], items, 0n, 1n);
  assert.equal(p.tokens[0], USDC);
  assert.throws(() => buildParams([USDC, ETH, IMD], items, 0n, 1n), /quoted 4 tokens, batch has 3/);
  assert.throws(() => buildParams([USDC, ETH, IMD, "0x0000000000000000000000000000000000000001"], items, 0n, 1n), /no quote/);
});
