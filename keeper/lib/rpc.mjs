// Reads and sends go to different places (as in imd-keeper). Reads: READ_RPC_URLS with failover. A signed
// transaction goes ONLY to PRIVATE_RPC_URL (Flashbots Protect or similar), never to a public mempool: with none
// configured, sendRaw refuses. Logs and errors name hosts only, since a keyed URL carries its key in the path.
import { createPublicClient, fallback, http, keccak256 } from "viem";
import { mainnet } from "viem/chains";

export const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return "?";
  }
};

export function readClient(cfg) {
  const urls = cfg.READ_RPC_URLS;
  if (!urls.length) throw new Error("READ_RPC_URLS is empty");
  const transports = urls.map((u) => http(u, { timeout: 20_000, retryCount: 1 }));
  return createPublicClient({
    chain: { ...mainnet, id: cfg.CHAIN_ID ?? 1 },
    transport: transports.length === 1 ? transports[0] : fallback(transports),
  });
}

// A signed transaction can go to a second RPC safely (same hash, same nonce: at most one copy is mined). So the next is
// asked when one fails as a provider (rate limit, 5xx, timeout), not when the transaction itself is refused.
const REFUSED = /nonce too low|nonce has already been used|insufficient funds|underpriced|intrinsic gas|exceeds block gas limit|invalid sender|max fee per gas less than/i;
const KNOWN = /already known|known transaction|alreadyknown|already imported|already in (the )?(mempool|pool)/i;

async function rpc(url, method, params, fetchImpl) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
  }
  if (body.error) throw new Error(String(body.error.message ?? JSON.stringify(body.error)));
  return body.result;
}

/** Send a signed raw transaction through the private RPCs; returns its hash. Never touches a read RPC. */
export function privateSender(cfg, { fetchImpl = fetch, log = console.log } = {}) {
  const urls = cfg.PRIVATE_RPC_URL;
  const scrub = (msg) => urls.reduce((m, u) => m.split(u).join(hostOf(u)), String(msg));
  return {
    configured: urls.length > 0,
    hosts: urls.map(hostOf),
    async sendRaw(signed) {
      if (!urls.length) throw new Error("PRIVATE_RPC_URL is not set: refusing to send (no public mempool fallback)");
      const hash = keccak256(signed);
      let last;
      for (const [i, url] of urls.entries()) {
        try {
          await rpc(url, "eth_sendRawTransaction", [signed], fetchImpl);
          if (i > 0) log(`send: ${hostOf(urls[0])} failed (${scrub(last?.message).slice(0, 100)}); sent via ${hostOf(url)}`);
          return hash;
        } catch (e) {
          const msg = scrub(e.message);
          if (KNOWN.test(msg)) return hash;
          if (REFUSED.test(msg)) throw new Error(msg);
          last = new Error(msg);
        }
      }
      throw last;
    },
  };
}

/** eth_simulateV1 of one call; returns { status, logs, gasUsed, returnData, error } or null when the node lacks it. */
export async function simulateV1(client, { from, to, data, value = 0n }, blockNumber) {
  try {
    const res = await client.request({
      method: "eth_simulateV1",
      params: [
        {
          blockStateCalls: [{ calls: [{ from, to, data, value: `0x${value.toString(16)}` }] }],
          validation: false,
        },
        blockNumber === undefined ? "latest" : `0x${blockNumber.toString(16)}`,
      ],
    });
    const c = res?.[0]?.calls?.[0];
    if (!c) return null;
    return {
      ok: c.status === "0x1",
      logs: c.logs ?? [],
      gasUsed: BigInt(c.gasUsed ?? 0),
      returnData: c.returnData,
      error: c.error ? { message: c.error.message, data: c.error.data } : null,
    };
  } catch (e) {
    if (/method not found|not supported|does not exist|unknown method|not available/i.test(e.message ?? "")) return null;
    throw e;
  }
}
