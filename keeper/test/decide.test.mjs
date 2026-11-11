// The threshold and the gas-adjusted decision.
import test from "node:test";
import assert from "node:assert/strict";
import { parseEther, parseGwei } from "viem";
import { gasOk, worthIt } from "../lib/decide.mjs";
import { cfg } from "./fake.mjs";

test("MIN_BATCH_ETH: 0.1 ETH converts, a wei less waits", () => {
  assert.equal(worthIt(parseEther("0.1"), cfg).go, true);
  const w = worthIt(parseEther("0.1") - 1n, cfg);
  assert.equal(w.go, false);
  assert.match(w.why, /below MIN_BATCH_ETH 0.1/);
});

test("gas share: cost must be below MAX_GAS_SHARE_BPS of the batch", () => {
  // 900k gas at 1 gwei + 0.3 tip = 0.00117 ETH; 1% of 0.117 ETH is exactly that: passes; of 0.1169 it fails.
  const base = { gas: 900_000n, baseFeeWei: parseGwei("1"), tipWei: parseGwei("0.3") };
  const at = gasOk({ ...base, batchEthWei: parseEther("0.117") }, cfg);
  assert.equal(at.go, true);
  assert.equal(at.cost, parseEther("0.00117"));
  assert.equal(at.shareBps, 100);
  const over = gasOk({ ...base, batchEthWei: parseEther("0.1169") }, cfg);
  assert.equal(over.go, false);
  assert.match(over.why, /above MAX_GAS_SHARE_BPS 100/);
});

test("gas ceiling: base fee + tip above MAX_GAS_GWEI waits whatever the batch", () => {
  const g = gasOk({ gas: 21_000n, baseFeeWei: parseGwei("29.8"), tipWei: parseGwei("0.3"), batchEthWei: parseEther("100") }, cfg);
  assert.equal(g.go, false);
  assert.match(g.why, /above MAX_GAS_GWEI 30/);
  assert.equal(gasOk({ gas: 21_000n, baseFeeWei: parseGwei("29.7"), tipWei: parseGwei("0.3"), batchEthWei: parseEther("100") }, cfg).go, true);
});

test("a larger share setting admits a smaller batch", () => {
  const g = gasOk({ gas: 900_000n, baseFeeWei: parseGwei("1"), tipWei: parseGwei("0.3"), batchEthWei: parseEther("0.06") }, { ...cfg, MAX_GAS_SHARE_BPS: 200 });
  assert.equal(g.go, true);
});
