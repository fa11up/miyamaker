// Sends: private RPC only, failover on provider errors, refused txs not retried, keys never in messages.
import test from "node:test";
import assert from "node:assert/strict";
import { keccak256 } from "viem";
import { privateSender } from "../lib/rpc.mjs";

const PROTECT = "https://rpc.flashbots.net/fast";
const KEYED = "https://eth.example/v1/secretkey0123456789";
const signed = "0x02f86b0180843b9aca00847735940082520894000000000000000000000000000000000000000180c0";
const answer = (map) => async (url) => {
  const r = map[url]();
  return { status: 200, text: async () => JSON.stringify(r) };
};

test("no PRIVATE_RPC_URL: refuses, never falls back to a public node", async () => {
  const s = privateSender({ PRIVATE_RPC_URL: [] });
  assert.equal(s.configured, false);
  await assert.rejects(s.sendRaw(signed), /refusing to send/);
});

test("provider failure moves on; the log names hosts only", async () => {
  const logs = [];
  const s = privateSender({ PRIVATE_RPC_URL: [KEYED, PROTECT] }, {
    log: (l) => logs.push(l),
    fetchImpl: answer({ [KEYED]: () => ({ error: { message: `rate limited at ${KEYED}` } }), [PROTECT]: () => ({ result: "0x" }) }),
  });
  assert.equal(await s.sendRaw(signed), keccak256(signed));
  assert.match(logs[0], /eth\.example failed .* sent via rpc\.flashbots\.net/);
  assert.ok(!logs.join("").includes("secretkey"));
});

test("refused (nonce too low) is thrown at once; already known is a success", async () => {
  let asked = 0;
  const s = privateSender({ PRIVATE_RPC_URL: [PROTECT, KEYED] }, {
    fetchImpl: answer({ [PROTECT]: () => (asked++, { error: { message: "nonce too low" } }), [KEYED]: () => assert.fail("asked") }),
  });
  await assert.rejects(s.sendRaw(signed), /nonce too low/);
  assert.equal(asked, 1);
  const k = privateSender({ PRIVATE_RPC_URL: [PROTECT] }, { fetchImpl: answer({ [PROTECT]: () => ({ error: { message: "already known" } }) }) });
  assert.equal(await k.sendRaw(signed), keccak256(signed));
});

test("every RPC fails: the error carries no key", async () => {
  const s = privateSender({ PRIVATE_RPC_URL: [KEYED] }, { fetchImpl: answer({ [KEYED]: () => ({ error: { message: `502 from ${KEYED}` } }) }) });
  await assert.rejects(s.sendRaw(signed), (e) => !e.message.includes("secretkey") && /eth\.example/.test(e.message));
});
