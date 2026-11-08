// ConvertParams: the included tokens with their exact amounts, a floor per hop of each one's own route, and the ETH
// leg's floors.
import test from "node:test";
import assert from "node:assert/strict";
import { buildParams } from "../lib/plan.mjs";
import { CBBTC, ETH, IMD, INFER, USDC } from "./fake.mjs";

const quoted = (included, leg = { floors: [9n] }) => ({ included, leg });
const items = [
  { token: USDC, kind: "toEth", amount: 5n, floors: [1n] },
  { token: INFER, kind: "infer", amount: 6n, floors: [] },
  { token: ETH, kind: "eth", amount: 7n, floors: [] },
  { token: IMD, kind: "imd", amount: 8n, floors: [] },
  { token: CBBTC, kind: "route", amount: 9n, floors: [2n, 3n] },
];

test("tokens, exact amounts and floors line up; the leg's floors go in ethLegMinOuts", () => {
  const p = buildParams(quoted(items), 7n, 99n);
  assert.deepEqual(p.tokens, [USDC, INFER, ETH, IMD, CBBTC]);
  assert.deepEqual(p.amounts, [5n, 6n, 7n, 8n, 9n]);
  assert.deepEqual(p.minOuts, [[1n], [], [], [], [2n, 3n]]);
  assert.deepEqual(p.ethLegMinOuts, [9n]);
  assert.equal(p.minSplitOut, 7n);
  assert.equal(p.deadline, 99n);
  assert.deepEqual(buildParams(quoted(items.slice(1, 2), null), 0n, 1n).ethLegMinOuts, [], "no ETH reaches the leg");
});

test("lowercase addresses are normalized; nothing included, a duplicate, or a zero amount is an error", () => {
  assert.equal(buildParams(quoted([{ ...items[0], token: USDC.toLowerCase() }]), 0n, 1n).tokens[0], USDC);
  assert.throws(() => buildParams(quoted([]), 0n, 1n), /every token was skipped/);
  assert.throws(() => buildParams(quoted([items[0], items[0]]), 0n, 1n), /twice/);
  assert.throws(() => buildParams(quoted([{ ...items[0], amount: 0n }]), 0n, 1n), /positive/);
});
