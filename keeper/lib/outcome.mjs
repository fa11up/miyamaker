// What happens between "sent" and "confirmed" (imd-keeper's unknown-outcome rule, made persistent and nonce-aware).
//
// A signed convertAndAddLiquidity is written to state/pending.json BEFORE it is handed to the private RPC, so a crash
// or timeout never loses it. While that record stands, the keeper sends nothing else from this key. Each tick resolves
// it against the chain, in this order:
//   mined     a receipt with status 1: done; the ledger books its actual cost.
//   reverted  a receipt with status 0: done (not retried blindly; the next tick re-reads the batch from scratch).
//   replaced  no receipt, but the account's nonce has moved past ours: another tx took the nonce (an operator's
//             manual tx, or a copy with other fees). Ours can never land. The vault's closedBatches says whether the
//             batch was converted anyway.
//   expired   no receipt, nonce not used, and the chain is past ConvertParams.deadline: if it ever lands it reverts
//             with Expired, so it is dead. The record STAYS on disk, marked expired, until a replacement is signed and
//             sent: that send REUSES its nonce with fees at least 12.5% over the expired record's own, which replaces
//             it in any mempool still holding it. Across restarts and ticks with nothing to convert, nothing is lost.
//   pending   none of the above: wait. Nothing new is sent.
import { join } from "node:path";
import { rmSync } from "node:fs";
import { readJson, stateDir, writeJson } from "./guards.mjs";

export const BUMP_NUM = 1125n; // +12.5%: above the 10% most mempools require to replace
export const BUMP_DEN = 1000n;

export function pendingStore(cfg) {
  const file = join(stateDir(cfg), "pending.json");
  return {
    file,
    get() {
      const r = readJson(file);
      if (!r) return null;
      for (const k of ["nonce", "deadline", "closedBatchesBefore", "worstWei", "maxFeePerGas", "maxPriorityFeePerGas"]) {
        if (r[k] !== undefined) r[k] = BigInt(r[k]);
      }
      return r;
    },
    set(rec) {
      writeJson(file, rec);
    },
    clear() {
      rmSync(file, { force: true });
    },
  };
}

/**
 * Resolve a pending record. `chain` provides: nonce(address) -> latest nonce (bigint), receipt(hash) -> receipt|null,
 * timestamp() -> latest block time (bigint), closedBatches(vault) -> bigint.
 */
export async function resolvePending(rec, chain) {
  // Nonce first, then the receipt: if the nonce moved and the receipt is missing, look once more (a lagging node).
  const nonce = await chain.nonce(rec.from);
  let rc = await chain.receipt(rec.hash);
  if (!rc && nonce > rec.nonce) rc = await chain.receipt(rec.hash);
  if (rc) {
    const costWei = BigInt(rc.gasUsed) * BigInt(rc.effectiveGasPrice ?? 0n);
    return { state: rc.status === "success" || rc.status === 1 || rc.status === "0x1" ? "mined" : "reverted", costWei, block: rc.blockNumber };
  }
  if (nonce > rec.nonce) {
    const closed = await chain.closedBatches(rec.vault);
    return { state: "replaced", batchConverted: closed > rec.closedBatchesBefore };
  }
  const now = await chain.timestamp();
  if (now > rec.deadline) {
    return {
      state: "expired",
      reuse: {
        nonce: rec.nonce,
        minMaxFeePerGas: (rec.maxFeePerGas * BUMP_NUM) / BUMP_DEN + 1n,
        minMaxPriorityFeePerGas: (rec.maxPriorityFeePerGas * BUMP_NUM) / BUMP_DEN + 1n,
      },
    };
  }
  return { state: "pending", secondsToDeadline: rec.deadline - now };
}

/** A viem client as the `chain` resolvePending needs. */
export function chainOf(client, vaultAbi) {
  return {
    nonce: async (a) => BigInt(await client.getTransactionCount({ address: a, blockTag: "latest" })),
    receipt: async (h) => {
      try {
        return await client.getTransactionReceipt({ hash: h });
      } catch (e) {
        if (/not found|could not be found/i.test(e.shortMessage ?? e.message ?? "")) return null;
        throw e;
      }
    },
    timestamp: async () => (await client.getBlock({ blockTag: "latest" })).timestamp,
    closedBatches: (v) => client.readContract({ address: v, abi: vaultAbi, functionName: "closedBatches" }),
  };
}
