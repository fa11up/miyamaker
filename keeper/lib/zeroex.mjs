// 0x Swap API v2, AllowanceHolder flow: the keeper's primary source of swap calldata for the vault.
//
// The vault runs whatever `transaction.data` says against `transaction.to`, approving that same address for exactly
// the amount in, so every quote is checked against what was asked before it is used (the same rules as the app's
// src/pages/Swap/quoteGuard.ts, re-written here so the keeper box needs nothing from app/):
//   - transaction.to is 0x AllowanceHolder (the only 0x address the vault factory allowlists), and so is any spender in
//     `issues.allowance` / `allowanceTarget`;
//   - sellToken / buyToken / sellAmount are the request's; transaction.value is the amount for an ETH sell, else 0;
//   - the calldata decodes as AllowanceHolder.exec(operator, token, amount, target = operator, Settler.execute(...)):
//     token/amount = the sell token (0x0 for ETH) and the exact amount; Settler's recipient is the vault; its buyToken
//     the requested one; its minAmountOut = the quote's minBuyAmount (> 0);
//   - the Settler it calls is the one 0x's on-chain registry names now (Deployer.ownerOf(2), or prev(2)).
// `issues.allowance` (the vault has not approved AllowanceHolder: it approves inside the call) and `issues.balance`
// are expected for taker = vault and are not errors. A quote is good for ~30 s: the keeper plans, simulates and sends
// within QUOTE_MAX_AGE_SECONDS of fetching it (lib/keeper.mjs), else it quotes again.
import { decodeAbiParameters, decodeFunctionData, getAddress, parseAbi, zeroAddress } from "viem";

export const ZEROEX_URL = "https://api.0x.org/swap/allowance-holder/quote";
export const ALLOWANCE_HOLDER = getAddress("0x0000000000001fF3684f28c67538d4D072C22734");
/** 0x v2's native-token placeholder. */
export const NATIVE = getAddress("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
export const SETTLER_DEPLOYER = getAddress("0x00000000000004533Fe15556B1E086BB1A72cEae");
export const SETTLER_FEATURE = 2n;
export const SETTLER_EXECUTE = "0x1fff991f"; // execute((address,address,uint256),bytes[],bytes32)

export const allowanceHolderAbi = parseAbi([
  "function exec(address operator, address token, uint256 amount, address target, bytes data) payable returns (bytes result)",
]);
export const settlerDeployerAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function prev(uint128 feature) view returns (address)",
]);
const settlerExecuteParams = [
  {
    name: "slippage",
    type: "tuple",
    components: [
      { name: "recipient", type: "address" },
      { name: "buyToken", type: "address" },
      { name: "minAmountOut", type: "uint256" },
    ],
  },
  { name: "actions", type: "bytes[]" },
  { name: "zid", type: "bytes32" },
];

const eq = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
/** The keeper's ETH (address(0)) as 0x names it. */
export const toZx = (token) => (getAddress(token) === zeroAddress ? NATIVE : getAddress(token));

/** AllowanceHolder.exec -> Settler.execute, decoded; undefined when the calldata is anything else. */
export function decodeSwapCall(data) {
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]*$/.test(data)) return undefined;
  try {
    const outer = decodeFunctionData({ abi: allowanceHolderAbi, data });
    const [operator, token, amount, target, inner] = outer.args;
    if (!eq(operator, target)) return undefined;
    if (inner.slice(0, 10).toLowerCase() !== SETTLER_EXECUTE) return undefined;
    const [slippage] = decodeAbiParameters(settlerExecuteParams, `0x${inner.slice(10)}`);
    return { settler: getAddress(target), token: getAddress(token), amount, recipient: getAddress(slippage.recipient), buyToken: getAddress(slippage.buyToken), minAmountOut: slippage.minAmountOut };
  } catch {
    return undefined;
  }
}

/** 0x's Settler registry at `blockNumber`: the current taker-submitted Settler and the one before. Never throws. */
export async function readSettlers(client, blockNumber) {
  const r = (functionName, args) =>
    client.readContract({ address: SETTLER_DEPLOYER, abi: settlerDeployerAbi, functionName, args, blockNumber }).then(
      (v) => getAddress(v),
      () => undefined,
    );
  const [now, prev] = await Promise.all([r("ownerOf", [SETTLER_FEATURE]), r("prev", [SETTLER_FEATURE])]);
  return [now, prev].filter((a) => a && a !== zeroAddress);
}

/**
 * Why this 0x quote must not be used, or undefined. `req` = { sellToken, buyToken (keeper addresses: ETH = 0x0),
 * sellAmount, taker (the vault) }; `settlers` from readSettlers (empty = the registry could not be read: refused).
 */
export function quoteProblem(q, req, settlers) {
  if (!q || typeof q !== "object") return "no quote";
  if (q.liquidityAvailable === false) return "no route (liquidityAvailable false)";
  const sell = toZx(req.sellToken);
  const buy = toZx(req.buyToken);
  if (!eq(q.sellToken, sell)) return `sells ${q.sellToken}, asked ${sell}`;
  if (!eq(q.buyToken, buy)) return `buys ${q.buyToken}, asked ${buy}`;
  if (String(q.sellAmount) !== String(req.sellAmount)) return `sells ${q.sellAmount}, asked ${req.sellAmount}`;
  const tx = q.transaction;
  if (!tx || !eq(tx.to, ALLOWANCE_HOLDER)) return `transaction.to ${tx?.to} is not 0x AllowanceHolder ${ALLOWANCE_HOLDER}`;
  const spender = q.issues?.allowance?.spender;
  if (spender != null && !eq(spender, ALLOWANCE_HOLDER)) return `asks to approve ${spender}, not AllowanceHolder`;
  if (q.allowanceTarget && !eq(q.allowanceTarget, ALLOWANCE_HOLDER)) return `allowanceTarget ${q.allowanceTarget} is not AllowanceHolder`;
  let value;
  try {
    value = BigInt(tx.value || "0");
  } catch {
    return "transaction.value unreadable";
  }
  const native = sell === NATIVE;
  if (value !== (native ? BigInt(req.sellAmount) : 0n)) return `transaction.value ${value} for a ${native ? "native" : "token"} sell of ${req.sellAmount}`;
  const call = decodeSwapCall(tx.data);
  if (!call) return "calldata is not AllowanceHolder.exec -> Settler.execute";
  if (!eq(call.token, native ? zeroAddress : sell) || call.amount !== BigInt(req.sellAmount)) return `calldata would take ${call.amount} of ${call.token}`;
  if (!eq(call.recipient, req.taker)) return `calldata pays ${call.recipient}, not the vault ${req.taker}`;
  if (!eq(call.buyToken, buy)) return `calldata buys ${call.buyToken}`;
  let buyAmount;
  let minBuy;
  try {
    buyAmount = BigInt(q.buyAmount);
    minBuy = BigInt(q.minBuyAmount);
  } catch {
    return "buyAmount / minBuyAmount unreadable";
  }
  if (!(buyAmount > 0n)) return "buyAmount is 0";
  if (call.minAmountOut !== minBuy) return `calldata minimum ${call.minAmountOut} is not minBuyAmount ${minBuy}`;
  if (!(minBuy > 0n) || minBuy > buyAmount) return `minBuyAmount ${minBuy} out of range (buyAmount ${buyAmount})`;
  if (!settlers?.length) return "0x Settler registry unreadable: Settler not verified";
  if (!settlers.some((s) => eq(s, call.settler))) return `Settler ${call.settler} is not the registry's current one`;
  return undefined;
}

/**
 * A 0x client: `quote({ sellToken, buyToken, sellAmount, taker, slippageBps })` -> { quote, at } or throws an Error
 * with `.noRoute` (no liquidity / 404-ish) or `.timeout`. Disabled (`enabled` false) without ZEROEX_API_KEY. The key
 * goes only into the header and never into a log line.
 */
export function zeroExClient(cfg, { fetchImpl = fetch, apiKey = process.env.ZEROEX_API_KEY, now = Date.now } = {}) {
  const url = cfg.ZEROEX_URL ?? ZEROEX_URL;
  const timeout = cfg.ZEROEX_TIMEOUT_MS ?? 5000;
  return {
    enabled: Boolean(apiKey),
    why: apiKey ? null : "ZEROEX_API_KEY not set: 0x skipped, zRouter only",
    async quote({ sellToken, buyToken, sellAmount, taker, slippageBps }) {
      if (!apiKey) throw Object.assign(new Error("ZEROEX_API_KEY not set"), { disabled: true });
      const qs = new URLSearchParams({
        chainId: String(cfg.CHAIN_ID ?? 1),
        sellToken: toZx(sellToken),
        buyToken: toZx(buyToken),
        sellAmount: String(sellAmount),
        taker: getAddress(taker),
      });
      if (slippageBps != null) qs.set("slippageBps", String(slippageBps));
      let res;
      try {
        res = await fetchImpl(`${url}?${qs}`, {
          headers: { "0x-api-key": apiKey, "0x-version": "v2", accept: "application/json" },
          signal: AbortSignal.timeout(timeout),
        });
      } catch (e) {
        const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
        throw Object.assign(new Error(timedOut ? `0x timed out after ${timeout} ms` : `0x request failed: ${String(e?.message ?? e).slice(0, 120)}`), { timeout: timedOut });
      }
      const text = await res.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`0x HTTP ${res.status}: unreadable reply`);
      }
      if (!res.ok) {
        const name = String(body?.name ?? body?.code ?? "");
        const noRoute = res.status === 404 || /NO_ROUTE|INSUFFICIENT_LIQUIDITY|TOKEN_NOT_SUPPORTED/i.test(name);
        // 401/403: never echo anything about the key.
        const msg = res.status === 401 || res.status === 403 ? "0x refused the API key" : `0x HTTP ${res.status} ${name}`.trim();
        throw Object.assign(new Error(msg), { noRoute });
      }
      if (body?.liquidityAvailable === false) throw Object.assign(new Error("0x: no route (liquidityAvailable false)"), { noRoute: true });
      return { quote: body, at: now() };
    },
  };
}
