#!/usr/bin/env node
// The miyamaker vault conversion keeper. REPORT-ONLY unless started with --execute.
//
//   node index.mjs            report every INTERVAL_SECONDS: what each vault's batch is worth, the floors, the decision
//   node index.mjs --once     one pass, then exit
//   node index.mjs --execute  also send (needs KEEPER_PRIVATE_KEY or KEEPER_KEY_FILE, and PRIVATE_RPC_URL)
//
// One process, one key, one tx in flight at a time (lib/outcome.mjs). A tick that throws is logged and the loop goes
// on: a keeper that dies on the first RPC hiccup is worse than one that reports it.
import { loadConfig } from "./lib/config.mjs";
import { crossCheckClient, hostOf, privateSender, readClient } from "./lib/rpc.mjs";
import { keeperAccount } from "./lib/signer.mjs";
import { tick, vaultsToKeep } from "./lib/keeper.mjs";
import { describeReferences } from "./lib/reference.mjs";
import { verifyQuoters } from "./lib/quote.mjs";
import { killSwitch } from "./lib/guards.mjs";

const EXECUTE = process.argv.includes("--execute");
const ONCE = process.argv.includes("--once");
const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const log = (msg) => {
  for (const line of String(msg).split("\n")) console.log(`${stamp()} | ${line}`);
};

const cfg = await loadConfig();
const client = readClient(cfg);
const sender = privateSender(cfg, { log });
const account = keeperAccount();

const crossClient = crossCheckClient(cfg);
log(`starting ${EXECUTE ? "IN EXECUTE MODE" : "in report-only mode"}; reads via ${cfg.READ_RPC_URLS.length} RPC(s); ETH leg cross-checked on ${crossClient ? hostOf(cfg.READ_RPC_URLS[1]) : "no second RPC (only one configured)"}`);
if (EXECUTE) {
  if (!account) {
    log("--execute without KEEPER_PRIVATE_KEY or KEEPER_KEY_FILE: refusing to start");
    process.exit(1);
  }
  if (!sender.configured) {
    log("--execute without PRIVATE_RPC_URL: refusing to start (the keeper never sends to a public mempool)");
    process.exit(1);
  }
  log(`keeper ${account.address}; sends via ${sender.hosts.join(", ")}`);
}
const stop = killSwitch(cfg);
if (stop) log(stop);

const chainId = await client.getChainId();
if (chainId !== cfg.CHAIN_ID) {
  log(`read RPC is chain ${chainId}, config says ${cfg.CHAIN_ID}: refusing to start`);
  process.exit(1);
}
await verifyQuoters(client, cfg);
log(`quoters checked: V4Quoter ${cfg.V4_QUOTER}, QuoterV2 ${cfg.V3_QUOTER}`);
try {
  for (const line of await describeReferences(client, cfg)) log(`reference ${line}`);
} catch (e) {
  log(`reference check at startup failed: ${(e.shortMessage ?? e.message).slice(0, 200)} (each tick re-reads them; tokens without one are skipped)`);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    log(`${signal}, stopping`);
    process.exit(0);
  });
}

const contexts = new Map();
const discovered = {};
for (;;) {
  try {
    // Discovery failing (getLogs limits, a 5xx) never stops the fixed VAULTS or the settling of a tx in flight.
    const vaults = await vaultsToKeep(client, cfg, discovered, log);
    if (!vaults.length) log("no vaults configured (VAULTS, or FACTORY + DISCOVER_FROM_BLOCK)");
    await tick({ client, cfg, account, sender, execute: EXECUTE, vaults, contexts, crossClient, log });
  } catch (e) {
    log(`tick error: ${(e.shortMessage ?? e.message).slice(0, 200)}`);
  }
  if (ONCE) break;
  await new Promise((r) => setTimeout(r, cfg.INTERVAL_SECONDS * 1000));
}
