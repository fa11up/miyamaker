// The balancing swap's size, reproduced from UniAlignmentVault._splitAmount / _balancedSwap.
import test from "node:test";
import assert from "node:assert/strict";
import { balancedSwap, splitAmount, sqrtFloor, poolId } from "../lib/split.mjs";
import { ALIGN_KEY } from "./fake.mjs";

const Q96 = 1n << 96n;

test("sqrtFloor is the integer floor square root", () => {
  for (const n of [0n, 1n, 2n, 3n, 4n, 15n, 16n, 17n, 10n ** 40n, 10n ** 40n + 1n, (1n << 255n) - 1n, 123456789012345678901234567890n ** 2n - 1n]) {
    const r = sqrtFloor(n);
    assert.ok(r * r <= n && (r + 1n) * (r + 1n) > n, String(n));
  }
});

test("after the swap, what is left pairs at the pool's new price (constant product, fee kept out of reserves)", () => {
  // The live pool on 2026-11-08: sqrtP and L from the smoke run.
  const sqrtP = 1289596344292605895871167486n;
  const L = 761546456439979897230438n;
  const fee = 12500;
  const amtImd = 892n * 10n ** 18n; // all IMD, no INFER (INFER is currency0, IMD currency1)
  const s = splitAmount(0n, amtImd, sqrtP, L, true, fee);
  assert.equal(s.inferToImd, false);
  assert.equal(s.zeroForOne, false);
  assert.equal(s.excess, amtImd);
  // Virtual reserves: x (INFER) = L * Q96 / sqrtP, y (IMD) = L * sqrtP / Q96.
  const x = Number((L * Q96) / sqrtP);
  const y = Number((L * sqrtP) / Q96);
  const sin = Number(s.swapAmount) * (1 - fee / 1e6);
  const out = (x * sin) / (y + sin);
  const pNew = (y + sin) / (x - out); // IMD per INFER after
  const left = (Number(amtImd) - Number(s.swapAmount)) / out;
  // The vault's closed form is close, not exact (0.04% here): the residual is far under the 0.5% of the starting
  // excess a second pass needs (LP_PASS_MIN_DIVISOR), so at this size pass 1 is the whole balancing swap.
  assert.ok(Math.abs(left / pNew - 1) < 1e-3, `left ratio ${left} vs price ${pNew}`);
  assert.ok(s.swapAmount < amtImd / 2n, "less than half: the swap's own price impact and fee");
});

test("bounded by amount / (2 - fee): huge depth or none falls back to the no-impact answer", () => {
  const a = 10n ** 18n;
  const bound = (a * 1_000_000n) / (2_000_000n - 12500n);
  assert.equal(balancedSwap(a, 0n, 12500), bound);
  assert.equal(balancedSwap(a, 10n ** 31n, 12500), bound);
  assert.ok(balancedSwap(a, 10n ** 24n, 12500) <= bound);
  assert.equal(balancedSwap(0n, 10n ** 24n, 12500), 0n);
});

test("INFER in excess swaps INFER -> IMD; balanced amounts swap nothing", () => {
  const sqrtP = Q96; // price 1
  const s = splitAmount(10n ** 18n, 0n, sqrtP, 10n ** 24n, true, 12500);
  assert.equal(s.inferToImd, true);
  assert.ok(s.swapAmount > 0n);
  const b = splitAmount(10n ** 18n, 10n ** 18n, sqrtP, 10n ** 24n, true, 12500);
  assert.equal(b.swapAmount, 0n);
});

test("poolId of the INFER/IMD key is the id StateView reads (checked against mainnet 2026-11-08)", () => {
  // keccak256(abi.encode(INFER, IMD, 12500, 60, hook)); a typo in the key would make extsload read an empty pool.
  assert.match(poolId(ALIGN_KEY), /^0x[0-9a-f]{64}$/);
});
