// One tx in flight per key: a receipt poll that throws, or any throw after the record is written, must not let a
// second vault send in the same tick (audit item 1); an expired record stays on disk until its replacement is sent, so
// the fee bump survives restarts and skipped ticks (audit item 3).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { pendingStore } from "../lib/outcome.mjs";
import { bumpOf, planVault, sendConvert, settlePending, tick } from "../lib/keeper.mjs";
import { ETH, USDC, VAULT, cfg as base, fakeChain, fakeCtx } from "./fake.mjs";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`); // a throwaway test key, never funded anywhere
const VAULT2 = getAddress("0x00000000000000000000000000000000000Fa018");
const fresh = (o = {}) => ({ ...base, STATE_DIR: mkdtempSync(join(tmpdir(), "vk-")), ...o });
const chainFor = () => fakeChain({ keeper: account.address, amounts: { [ETH]: 10n ** 18n, [USDC]: 300_000_000n } });
const counting = () => {
  const s = { configured: true, hosts: ["protect.example"], sent: [] };
  s.sendRaw = async (signed) => {
    s.sent.push(signed);
  };
  return s;
};

test("two vaults; the first's receipt lookups throw (RPC 429): only one tx is sent, pending.json keeps it", async () => {
  const cfg = fresh({ TX_WAIT_SECONDS: 0.05, RECEIPT_POLL_MS: 5 });
  const c = chainFor();
  c.state.receiptErrors = 1000;
  const sender = counting();
  const lines = [];
  const res = await tick({ client: c, cfg, account, sender, execute: true, vaults: [VAULT, VAULT2], log: (l) => lines.push(l) });
  assert.equal(sender.sent.length, 1, lines.join("\n"));
  assert.equal(pendingStore(cfg).get().vault, VAULT);
  assert.match(res[0].send.unknown, /no receipt within .*429/);
  assert.match(lines.join("\n"), /still in flight/);
});

test("any throw after the record is written (here: the log line after sendRaw) still blocks the next vault", async () => {
  const cfg = fresh();
  const c = chainFor();
  const sender = counting();
  const lines = [];
  const log = (l) => {
    if (String(l).startsWith("sent ")) throw new Error("log sink failed");
    lines.push(l);
  };
  await tick({ client: c, cfg, account, sender, execute: true, vaults: [VAULT, VAULT2], log });
  assert.equal(sender.sent.length, 1, lines.join("\n"));
  assert.equal(pendingStore(cfg).get().vault, VAULT);
});

test("sendConvert refuses while a record is in flight, and never overwrites it", async () => {
  const cfg = fresh();
  const c = chainFor();
  const plan = await planVault(c, cfg, fakeCtx(), { from: account.address });
  const store = pendingStore(cfg);
  store.set({ hash: "0xabc", from: account.address, nonce: 0n, vault: VAULT, deadline: 10n ** 12n, closedBatchesBefore: 0n, worstWei: 1n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n });
  const sender = counting();
  const r = await sendConvert({ client: c, cfg, account, sender, ctx: fakeCtx(), plan, log: () => {} });
  assert.match(r.skipped, /still in flight/);
  assert.equal(sender.sent.length, 0);
  assert.equal(store.get().hash, "0xabc");
});

test("expired: the record stays on disk (marked) across ticks with nothing to send and a restart; the replacement reuses its nonce at fees bumped from it", async () => {
  const cfg = fresh();
  const c = chainFor();
  const plan = await planVault(c, cfg, fakeCtx(), { from: account.address });
  const timeout = { configured: true, hosts: ["p"], sendRaw: async () => { throw new Error("The operation was aborted due to timeout"); } };
  const first = await sendConvert({ client: c, cfg, account, sender: timeout, ctx: fakeCtx(), plan, log: () => {} });
  assert.match(first.unknown, /unknown/);
  const old = pendingStore(cfg).get();

  // Past its deadline, and nothing pending this tick: no send happens, the expired record stays.
  c.state.timestamp = plan.params.deadline + 1n;
  const tokens = c.state.tokens;
  c.state.tokens = [];
  await tick({ client: c, cfg, account, sender: counting(), execute: true, vaults: [VAULT], log: () => {} });
  await tick({ client: c, cfg, account, sender: counting(), execute: true, vaults: [VAULT], log: () => {} });
  const kept = pendingStore(cfg).get(); // a fresh store object: what a restarted process reads
  assert.equal(kept.hash, old.hash);
  assert.equal(kept.expired, true);

  // A replacement refused outright (underpriced) puts the expired record back: the bump is not lost.
  c.state.tokens = tokens;
  const plan2 = await planVault(c, cfg, fakeCtx(), { from: account.address });
  const refused = { configured: true, hosts: ["p"], sendRaw: async () => { throw new Error("replacement transaction underpriced"); } };
  const r1 = await sendConvert({ client: c, cfg, account, sender: refused, ctx: fakeCtx(), plan: plan2, log: () => {} });
  assert.match(r1.failed, /underpriced/);
  assert.equal(pendingStore(cfg).get().hash, old.hash);
  assert.equal(pendingStore(cfg).get().expired, true);

  // Sent: same nonce, fees at least 12.5% over the expired record's own; only now is the record replaced.
  const ok = counting();
  const lines = [];
  await tick({ client: c, cfg, account, sender: ok, execute: true, vaults: [VAULT], log: (l) => lines.push(l) });
  assert.equal(ok.sent.length, 1, lines.join("\n"));
  const now = pendingStore(cfg).get();
  const want = bumpOf(old);
  assert.equal(now.nonce, old.nonce);
  assert.equal(now.replaces, old.hash);
  assert.ok(!now.expired);
  assert.ok(now.maxFeePerGas >= want.minMaxFeePerGas, `${now.maxFeePerGas} >= ${want.minMaxFeePerGas}`);
  assert.ok(now.maxPriorityFeePerGas >= want.minMaxPriorityFeePerGas);
  assert.match(lines.join("\n"), /replaces expired/);
});

test("expired record whose nonce got used meanwhile: settled as replaced, not reused", async () => {
  const cfg = fresh();
  const c = chainFor();
  const store = pendingStore(cfg);
  store.set({ hash: "0xdead", from: account.address, nonce: 0n, vault: VAULT, deadline: 1n, closedBatchesBefore: 0n, worstWei: 1n, maxFeePerGas: 100n, maxPriorityFeePerGas: 10n, expired: true });
  c.state.nonce = 1n;
  const s = await settlePending(c, cfg);
  assert.match(s.line, /replaced/);
  assert.equal(store.get(), null);
});
