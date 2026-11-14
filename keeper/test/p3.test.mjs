// Smaller fixes (audit item 6): no blind conversions (impact unknown, quote 0), discovery that cannot stop the tick,
// a smaller and configurable getLogs chunk, durable state writes, a hardened systemd unit.
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress } from "viem";
import { quoteBatch, readBatch } from "../lib/plan.mjs";
import { discoverVaults, tick, vaultsToKeep } from "../lib/keeper.mjs";
import { applyEnv } from "../lib/config.mjs";
import { writeJson } from "../lib/guards.mjs";
import { pendingStore } from "../lib/outcome.mjs";
import base0 from "../config.example.mjs";
import { ETH, IMD, IMDUSD, USDC, VAULT, cfg as base, fakeChain, fakeCtx } from "./fake.mjs";

const E = 10n ** 18n;
const cfg = { ...base, MAX_REFERENCE_DEVIATION_BPS: 9999 };

test("impact unknown (an amount too small for the 1/1000 probe) is skipped and says so, not passed", async () => {
  const c = fakeChain({ tokens: [ETH, USDC], amounts: { [ETH]: E, [USDC]: 999n } });
  const ctx = fakeCtx();
  const q = await quoteBatch(c, cfg, ctx, await readBatch(c, ctx, 100n));
  const u = q.items.find((x) => x.token === USDC);
  assert.match(u.skip, /price impact unknown/);
  assert.equal(q.included.length, 1);
});

test("a zRouter fallback that quotes 0 is not used (0x off): skipped, never converted for 0 IMD", async () => {
  const c = fakeChain({ tokens: [ETH, IMDUSD], amounts: { [ETH]: E, [IMDUSD]: 400n * E } });
  c.state.rates[`${IMDUSD}>${IMD}`] = [0n, 1n];
  const ctx = fakeCtx();
  const q = await quoteBatch(c, cfg, ctx, await readBatch(c, ctx, 100n));
  assert.match(q.items.find((x) => x.token === IMDUSD).skip, /zRouter quotes 0/);
  assert.deepEqual(q.included.map((x) => x.token), [ETH]);
});

const FACTORY = getAddress("0x0000000000000000000000000000000000FAC701");
const V2 = getAddress("0x00000000000000000000000000000000000Fa019");

test("discovery reads getLogs in chunks of at most 9,999 blocks by default; LOG_CHUNK from the env", async () => {
  const c = fakeChain({ blockNumber: 25_000n, deployed: [{ vault: V2, block: 12_345n }] });
  const found = await discoverVaults(c, { ...base, VAULTS: [VAULT], FACTORY, DISCOVER_FROM_BLOCK: 0 }, {});
  assert.deepEqual(found, [VAULT, V2]);
  assert.deepEqual(c.state.logRanges, [[0n, 9_998n], [9_999n, 19_997n], [19_998n, 25_000n]]);
  assert.equal(applyEnv(base0, {}).LOG_CHUNK, 9_999);
  assert.equal(applyEnv(base0, { LOG_CHUNK: "2000" }).LOG_CHUNK, 2000);
  assert.throws(() => applyEnv(base0, { LOG_CHUNK: "0" }), /LOG_CHUNK/);
});

test("discovery failing (getLogs refused) keeps the fixed VAULTS and what was found; the tick still runs and settles", async () => {
  const c = fakeChain({ blockNumber: 25_000n, getLogsError: "query exceeds max block range 1000" });
  const lines = [];
  const cache = { found: [V2] };
  const vaults = await vaultsToKeep(c, { ...base, VAULTS: [VAULT], FACTORY, DISCOVER_FROM_BLOCK: 0 }, cache, (l) => lines.push(l));
  assert.deepEqual(vaults, [VAULT, V2]);
  assert.match(lines[0], /vault discovery failed \(query exceeds max block range 1000\); keeping the 2 vault\(s\)/);
  // ...and a tx in flight from before still settles in that tick.
  const tcfg = { ...base, STATE_DIR: mkdtempSync(join(tmpdir(), "vk-")) };
  pendingStore(tcfg).set({ hash: "0xfeed", from: VAULT, nonce: 0n, vault: VAULT, deadline: 10n ** 12n, closedBatchesBefore: 0n, worstWei: 1n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n });
  c.state.receipts["0xfeed"] = { status: "success", gasUsed: 1n, effectiveGasPrice: 1n, blockNumber: 99n };
  const out = [];
  await tick({ client: c, cfg: tcfg, account: null, sender: null, execute: false, vaults, log: (l) => out.push(l) });
  assert.match(out.join("\n"), /0xfeed mined in block 99/);
  assert.equal(pendingStore(tcfg).get(), null);
});

test("writeJson: temp file fsynced before the rename, the directory fsynced after it", () => {
  const dir = mkdtempSync(join(tmpdir(), "vk-"));
  const file = join(dir, "pending.json");
  const ops = [];
  const fds = new Map();
  const spy = {
    ...fs,
    openSync: (p, flags, mode) => {
      const fd = fs.openSync(p, flags, mode);
      fds.set(fd, p);
      ops.push(`open ${p === dir ? "dir" : p.endsWith(".tmp") ? "tmp" : p}`);
      return fd;
    },
    fsyncSync: (fd) => {
      ops.push(`fsync ${fds.get(fd) === dir ? "dir" : "tmp"}`);
      return fs.fsyncSync(fd);
    },
    renameSync: (a, b) => {
      ops.push("rename");
      return fs.renameSync(a, b);
    },
  };
  writeJson(file, { a: 1n }, spy);
  assert.deepEqual(ops, ["open tmp", "fsync tmp", "rename", "open dir", "fsync dir"]);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { a: "1" });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("keeper.service is hardened (and the README says to verify it on the host)", () => {
  const unit = readFileSync(new URL("../keeper.service", import.meta.url), "utf8");
  for (const line of [
    "UMask=0077", "ProtectHome=tmpfs", "ProtectKernelTunables=yes",
    "RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX", "SystemCallFilter=@system-service", "NoNewPrivileges=true",
    "ProtectSystem=strict",
  ]) assert.match(unit, new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), line);
  // A user unit can't drop capabilities (it fails 218/CAPABILITIES), so these stay out on purpose, as the unit says.
  for (const opt of ["CapabilityBoundingSet", "ProtectKernelModules", "ProtectKernelLogs", "ProtectClock"]) {
    assert.doesNotMatch(unit, new RegExp(`^${opt}=`, "m"), `${opt} must stay out of a user unit`);
  }
  // One name everywhere: the unit (imd-vault-keeper.service), its folder, its .env, its state/ and its key folder.
  assert.match(unit, /^WorkingDirectory=%h\/imd-vault-keeper$/m);
  assert.match(unit, /^EnvironmentFile=%h\/imd-vault-keeper\/\.env$/m);
  assert.match(unit, /^BindReadOnlyPaths=%h\/imd-vault-keeper$/m);
  // "-": optional, so the unit starts report-only before the key file exists.
  assert.match(unit, /^BindReadOnlyPaths=-%h\/\.config\/imd-vault-keeper\/keeper\.key$/m);
  assert.match(unit, /^BindPaths=%h\/imd-vault-keeper\/state$/m);
  assert.match(unit, /^ReadWritePaths=%h\/imd-vault-keeper\/state$/m);
  const paths = [...unit.matchAll(/%h\/(?:\.config\/)?([\w.-]+)/g)].map((m) => m[1]);
  assert.ok(paths.length >= 6);
  for (const p of paths) assert.equal(p, "imd-vault-keeper", `every path in the unit uses imd-vault-keeper (found ${p})`);
  assert.doesNotMatch(unit, /^ProtectHome=read-only/m);
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /systemd-analyze --user security imd-vault-keeper/);
});
