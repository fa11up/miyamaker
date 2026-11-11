// Kill switch, gas ceiling, ETH floor, daily spend.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEther, parseGwei } from "viem";
import { killSwitch, ledger, preSendCheck } from "../lib/guards.mjs";
import { cfg as base } from "./fake.mjs";

const fresh = () => ({ ...base, STATE_DIR: mkdtempSync(join(tmpdir(), "vk-")) });
const ok = (cfg) => ({ cfg, balance: parseEther("1"), gasLimit: 1_000_000n, maxFeePerGas: parseGwei("2"), gasPrice: parseGwei("1"), spentToday: 0n });

test("all clear", () => {
  assert.equal(preSendCheck(ok(fresh()), {}), null);
});

test("kill switch: KEEPER_STOP or state/STOP", () => {
  const cfg = fresh();
  assert.match(preSendCheck(ok(cfg), { KEEPER_STOP: "1" }), /KEEPER_STOP/);
  assert.equal(killSwitch(cfg, { KEEPER_STOP: "0" }), null);
  writeFileSync(join(cfg.STATE_DIR, "STOP"), "");
  assert.match(preSendCheck(ok(cfg), {}), /state\/STOP/);
});

test("gas ceiling, ETH floor after the worst-case cost, daily cap", () => {
  const cfg = fresh();
  assert.match(preSendCheck({ ...ok(cfg), gasPrice: parseGwei("31") }, {}), /MAX_GAS_GWEI/);
  // worst = 1e6 * 2 gwei = 0.002 ETH; floor 0.02: 0.0219 is short, 0.022 is enough.
  assert.match(preSendCheck({ ...ok(cfg), balance: parseEther("0.0219") }, {}), /below MIN_ETH/);
  assert.equal(preSendCheck({ ...ok(cfg), balance: parseEther("0.022") }, {}), null);
  assert.match(preSendCheck({ ...ok(cfg), spentToday: parseEther("0.0481") }, {}), /MAX_ETH_PER_DAY/);
});

test("ledger: per tx hash, re-booking replaces, a new UTC day starts at zero", () => {
  const cfg = fresh();
  const l = ledger(cfg);
  const day1 = Date.parse("2026-11-08T10:00:00Z");
  l.book("0x1", 500n, day1);
  l.book("0x2", 300n, day1);
  l.book("0x1", 200n, day1); // actual cost replaces the worst case
  assert.equal(l.spentToday(day1), 500n);
  assert.equal(l.spentToday(Date.parse("2026-11-09T00:00:01Z")), 0n);
});
