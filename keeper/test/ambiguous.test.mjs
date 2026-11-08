// A refusal after an earlier RPC failed ambiguously (timeout, 5xx: it may have delivered the tx) proves nothing:
// "nonce too low" there can be our own tx having landed. The record is kept and its real cost booked once the receipt
// shows up (audit item 2).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { privateSender } from "../lib/rpc.mjs";
import { pendingStore } from "../lib/outcome.mjs";
import { ledger } from "../lib/guards.mjs";
import { planVault, sendConvert, settlePending } from "../lib/keeper.mjs";
import { ETH, USDC, cfg as base, fakeChain, fakeCtx } from "./fake.mjs";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`); // a throwaway test key, never funded anywhere
const A = "https://a.example/rpc";
const B = "https://b.example/rpc";
const signed = "0x02f86b0180843b9aca00847735940082520894000000000000000000000000000000000000000180c0";
const fetchOf = (map) => async (url) => {
  const r = map[url]();
  if (r instanceof Error) throw r;
  return { status: r.status ?? 200, text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r)) };
};
const timeout = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

test("rpc: timeout on the first RPC, then 'nonce too low' on the second: thrown as ambiguous", async () => {
  const s = privateSender({ PRIVATE_RPC_URL: [A, B] }, { fetchImpl: fetchOf({ [A]: timeout, [B]: () => ({ error: { message: "nonce too low" } }) }) });
  await assert.rejects(s.sendRaw(signed), (e) => e.ambiguous === true && /nonce too low/.test(e.message) && /a\.example/.test(e.message));
});

test("rpc: a 5xx on the first RPC is ambiguous too; a 429 (turned away) is not", async () => {
  const five = privateSender({ PRIVATE_RPC_URL: [A, B] }, {
    fetchImpl: fetchOf({ [A]: () => ({ status: 502, body: "<html>bad gateway</html>" }), [B]: () => ({ error: { message: "insufficient funds for gas" } }) }),
  });
  await assert.rejects(five.sendRaw(signed), (e) => e.ambiguous === true);
  const limited = privateSender({ PRIVATE_RPC_URL: [A, B] }, {
    fetchImpl: fetchOf({ [A]: () => ({ status: 429, body: "Too Many Requests" }), [B]: () => ({ error: { message: "nonce too low" } }) }),
  });
  await assert.rejects(limited.sendRaw(signed), (e) => !e.ambiguous && /nonce too low/.test(e.message));
});

test("rpc: every RPC timed out: the final error is ambiguous", async () => {
  const s = privateSender({ PRIVATE_RPC_URL: [A, B] }, { fetchImpl: fetchOf({ [A]: timeout, [B]: timeout }) });
  await assert.rejects(s.sendRaw(signed), (e) => e.ambiguous === true);
});

const setup = async () => {
  const cfg = { ...base, STATE_DIR: mkdtempSync(join(tmpdir(), "vk-")) };
  const c = fakeChain({ keeper: account.address, amounts: { [ETH]: 10n ** 18n, [USDC]: 300_000_000n } });
  const plan = await planVault(c, cfg, fakeCtx(), { from: account.address });
  assert.equal(plan.action, "convert", plan.why);
  return { cfg, c, plan };
};

test("send: A times out (but delivered), B says nonce too low: the record is kept; the receipt later books the actual cost", async () => {
  const { cfg, c, plan } = await setup();
  const sender = privateSender({ PRIVATE_RPC_URL: [A, B] }, { fetchImpl: fetchOf({ [A]: timeout, [B]: () => ({ error: { message: "nonce too low" } }) }), log: () => {} });
  const r = await sendConvert({ client: c, cfg, account, sender, ctx: fakeCtx(), plan, log: () => {} });
  assert.match(r.unknown, /send outcome unknown: nonce too low/);
  const rec = pendingStore(cfg).get();
  assert.equal(rec.hash, r.hash, "record kept");
  assert.ok(ledger(cfg).spentToday() > 0n, "worst case still booked");
  // The read node catches up: our tx was mined.
  c.state.receipts[r.hash] = { status: "success", gasUsed: 700_000n, effectiveGasPrice: 2_000_000_000n, blockNumber: 101n };
  c.state.nonce = 1n;
  const s = await settlePending(c, cfg);
  assert.match(s.line, /mined in block 101/);
  assert.equal(ledger(cfg).spentToday(), 700_000n * 2_000_000_000n);
  assert.equal(pendingStore(cfg).get(), null);
});

test("send: 'nonce too low' straight away, and our own tx is the one that landed: its actual cost is booked", async () => {
  const { cfg, c, plan } = await setup();
  const sender = {
    configured: true, hosts: ["p"],
    async sendRaw(raw) {
      c.state.receipts[keccak256(raw)] = { status: "success", gasUsed: 800_000n, effectiveGasPrice: 1_500_000_000n, blockNumber: 102n };
      c.state.nonce = 1n;
      throw new Error("nonce too low");
    },
  };
  const r = await sendConvert({ client: c, cfg, account, sender, ctx: fakeCtx(), plan, log: () => {} });
  assert.match(r.settled, /mined in block 102/);
  assert.equal(ledger(cfg).spentToday(), 800_000n * 1_500_000_000n, "actual cost, not 0");
});

test("send: 'nonce too low' but the read node still shows the nonce unused (lagging): kept as pending, not cleared", async () => {
  const { cfg, c, plan } = await setup();
  const sender = { configured: true, hosts: ["p"], sendRaw: async () => { throw new Error("nonce too low"); } };
  const r = await sendConvert({ client: c, cfg, account, sender, ctx: fakeCtx(), plan, log: () => {} });
  assert.match(r.settled, /still pending/);
  assert.equal(pendingStore(cfg).get().hash, r.hash);
});
