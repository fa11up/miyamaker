// Unknown outcomes: the record written before sending, each way it resolves, and that nothing else is sent meanwhile.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { pendingStore, resolvePending } from "../lib/outcome.mjs";
import { ledger } from "../lib/guards.mjs";
import { planVault, sendConvert, settlePending, tick } from "../lib/keeper.mjs";
import { VAULT, cfg as base, fakeChain, fakeCtx } from "./fake.mjs";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`); // a throwaway test key, never funded anywhere
const fresh = () => ({ ...base, STATE_DIR: mkdtempSync(join(tmpdir(), "vk-")) });
const rec = { hash: "0xaa", from: account.address, nonce: 5n, vault: VAULT, deadline: 1000n, closedBatchesBefore: 3n, worstWei: 10n, maxFeePerGas: 1000n, maxPriorityFeePerGas: 100n };
const chain = (o) => ({ nonce: async () => 5n, receipt: async () => null, timestamp: async () => 900n, closedBatches: async () => 3n, ...o });

test("mined and reverted: from the receipt, with the actual cost", async () => {
  const rc = { status: "success", gasUsed: 700_000n, effectiveGasPrice: 2n, blockNumber: 9n };
  assert.deepEqual(await resolvePending(rec, chain({ nonce: async () => 6n, receipt: async () => rc })), { state: "mined", costWei: 1_400_000n, block: 9n });
  const r = await resolvePending(rec, chain({ nonce: async () => 6n, receipt: async () => ({ ...rc, status: "reverted" }) }));
  assert.equal(r.state, "reverted");
});

test("replaced: the nonce moved on without our receipt (looked up twice for a lagging node)", async () => {
  let asked = 0;
  const r = await resolvePending(rec, chain({ nonce: async () => 6n, receipt: async () => (asked++, null), closedBatches: async () => 4n }));
  assert.equal(r.state, "replaced");
  assert.equal(r.batchConverted, true);
  assert.equal(asked, 2);
});

test("a receipt that shows up on the second look counts as mined", async () => {
  let n = 0;
  const r = await resolvePending(rec, chain({ nonce: async () => 6n, receipt: async () => (n++ ? { status: "success", gasUsed: 1n, effectiveGasPrice: 1n, blockNumber: 1n } : null) }));
  assert.equal(r.state, "mined");
});

test("pending until the deadline; then expired, and its nonce is reused at fees at least 12.5% higher", async () => {
  const p = await resolvePending(rec, chain());
  assert.deepEqual(p, { state: "pending", secondsToDeadline: 100n });
  const e = await resolvePending(rec, chain({ timestamp: async () => 1001n }));
  assert.equal(e.state, "expired");
  assert.equal(e.reuse.nonce, 5n);
  assert.ok(e.reuse.minMaxFeePerGas >= 1125n);
  assert.ok(e.reuse.minMaxPriorityFeePerGas >= 113n);
});

async function convertPlan(c, cfg) {
  const plan = await planVault(c, cfg, fakeCtx(), { from: account.address });
  assert.equal(plan.action, "convert", plan.why);
  return plan;
}

test("send: the record is on disk before the tx leaves; a timeout leaves it as unknown; the ledger counts the worst case", async () => {
  const cfg = fresh();
  const c = fakeChain({ keeper: account.address, amounts: { "0x0000000000000000000000000000000000000000": 10n ** 18n, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": 300_000_000n } });
  const plan = await convertPlan(c, cfg);
  const store = pendingStore(cfg);
  const sender = {
    configured: true,
    hosts: ["protect.example"],
    async sendRaw() {
      assert.ok(existsSync(store.file), "pending.json written before sendRaw");
      throw new Error("timeout");
    },
  };
  const r = await sendConvert({ client: c, cfg, account, sender, ctx: fakeCtx(), plan, log: () => {} });
  assert.match(r.unknown, /send outcome unknown/);
  const saved = store.get();
  assert.equal(saved.hash, r.hash);
  assert.equal(saved.nonce, 0n);
  assert.equal(saved.deadline, plan.params.deadline);
  assert.equal(ledger(cfg).spentToday(), plan.gasLimit * (plan.baseFeeWei * 2n + plan.tipWei));

  // Next tick: still no receipt, nonce unused, before the deadline -> blocked, nothing sent.
  let sent = 0;
  const lines = [];
  await tick({ client: c, cfg, account, sender: { configured: true, hosts: ["x"], sendRaw: async () => sent++ }, execute: true, vaults: [VAULT], log: (l) => lines.push(l) });
  assert.equal(sent, 0);
  assert.match(lines.join("\n"), /still pending/);
  assert.match(lines.join("\n"), /still in flight/);

  // Past the deadline: expired, and the next send reuses nonce 0 with bumped fees. The record stays on disk, marked
  // expired, until that replacement is actually sent (test/inflight.test.mjs).
  c.state.timestamp = plan.params.deadline + 1n;
  const s = await settlePending(c, cfg);
  assert.equal(s.blocked, false);
  assert.equal(s.reuse.nonce, 0n);
  assert.equal(store.get().hash, r.hash);
  assert.equal(store.get().expired, true);
});

test("send: nonce too low, our hash not mined (another tx took the nonce): resolved as replaced, cleared, costs 0", async () => {
  const cfg = fresh();
  const c = fakeChain({ keeper: account.address, amounts: { "0x0000000000000000000000000000000000000000": 10n ** 18n, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": 300_000_000n } });
  const plan = await convertPlan(c, cfg);
  const sender = { configured: true, hosts: ["p"], sendRaw: async () => { c.state.nonce = 1n; throw new Error("nonce too low"); } };
  const r = await sendConvert({ client: c, cfg, account, sender, ctx: fakeCtx(), plan, log: () => {} });
  assert.match(r.nonceTaken, /nonce too low/);
  assert.match(r.settled, /replaced/);
  assert.equal(pendingStore(cfg).get(), null);
  assert.equal(ledger(cfg).spentToday(), 0n);
});

test("send: refused outright (underpriced) clears the record and the ledger entry", async () => {
  const cfg = fresh();
  const c = fakeChain({ keeper: account.address, amounts: { "0x0000000000000000000000000000000000000000": 10n ** 18n, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": 300_000_000n } });
  const plan = await convertPlan(c, cfg);
  const sender = { configured: true, hosts: ["p"], sendRaw: async () => { throw new Error("transaction underpriced"); } };
  const r = await sendConvert({ client: c, cfg, account, sender, ctx: fakeCtx(), plan, log: () => {} });
  assert.match(r.failed, /underpriced/);
  assert.equal(pendingStore(cfg).get(), null);
  assert.equal(ledger(cfg).spentToday(), 0n);
});

test("send: mined within the wait resolves and books the actual cost", async () => {
  const cfg = { ...fresh(), TX_WAIT_SECONDS: 5 };
  const c = fakeChain({ keeper: account.address, amounts: { "0x0000000000000000000000000000000000000000": 10n ** 18n, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": 300_000_000n } });
  const sender = {
    configured: true, hosts: ["p"],
    async sendRaw(signed) {
      const { keccak256 } = await import("viem");
      c.state.receipts[keccak256(signed)] = { status: "success", gasUsed: 800_000n, effectiveGasPrice: 1_300_000_000n, blockNumber: 101n };
      c.state.nonce = 1n;
      c.state.closedBatches = 1n;
    },
  };
  const lines = [];
  const [res] = await tick({ client: c, cfg, account, sender, execute: true, vaults: [VAULT], log: (l) => lines.push(l) });
  assert.equal(res.send.receipt, "success");
  assert.equal(pendingStore(cfg).get(), null);
  assert.equal(ledger(cfg).spentToday(), 800_000n * 1_300_000_000n);
  assert.match(lines.join("\n"), /mined in block 101/);
});

test("no PRIVATE_RPC_URL: never sends, even in execute mode", async () => {
  const cfg = fresh();
  const c = fakeChain({ keeper: account.address, amounts: { "0x0000000000000000000000000000000000000000": 10n ** 18n, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": 300_000_000n } });
  const plan = await convertPlan(c, cfg);
  const r = await sendConvert({ client: c, cfg, account, sender: { configured: false }, ctx: fakeCtx(), plan });
  assert.match(r.skipped, /PRIVATE_RPC_URL/);
  assert.equal(pendingStore(cfg).get(), null);
});

test("report-only (no --execute): plans, never signs", async () => {
  const cfg = fresh();
  const c = fakeChain();
  const lines = [];
  await tick({ client: c, cfg, account: null, sender: { configured: true, sendRaw: () => assert.fail("sent") }, execute: false, vaults: [VAULT], log: (l) => lines.push(l) });
  assert.match(lines.join("\n"), /report-only: not sent/);
});
