// A fake viem client: just enough chain for the keeper's reads, quotes and simulations, all in memory. And a fake 0x
// Swap API (fakeZeroEx): real lib/zeroex.mjs client, fake fetch answering from the same rates.
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, getAddress, hexToBigInt, keccak256, toHex, zeroAddress, zeroHash } from "viem";
import { vaultAbi } from "../lib/abi.mjs";
import { DEFAULT_CHAINLINK, DEFAULT_IMD_PRICE_FEED, imdEthKey } from "../lib/reference.mjs";
import { poolId } from "../lib/split.mjs";
import { ALLOWANCE_HOLDER, NATIVE, SETTLER_EXECUTE, allowanceHolderAbi, zeroExClient } from "../lib/zeroex.mjs";
import { ZROUTER } from "../lib/zrouter.mjs";

export const ETH = zeroAddress;
export const IMD = getAddress("0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7");
export const INFER = getAddress("0x53d0eA0A685220718Dc6a0a6e4617194C6F37921");
export const USDC = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
export const IMDUSD = getAddress("0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25");
export const CBBTC = getAddress("0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf");
export const WBTC = getAddress("0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599");
export const FEED_ETH_USD = getAddress(DEFAULT_CHAINLINK.ETH_USD.address);
export const FEED_BTC_ETH = getAddress(DEFAULT_CHAINLINK.BTC_ETH.address);
export const FEED_BTC_USD = getAddress(DEFAULT_CHAINLINK.BTC_USD.address);
export const IMD_FEED = getAddress(DEFAULT_IMD_PRICE_FEED);
export const WETH = getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
export const VAULT = getAddress("0x00000000000000000000000000000000000Fa017");
export const FACTORY = getAddress("0x0000000000000000000000000000000000000F4C");
export const SETTLER = getAddress("0x00000000000000000000000000000000005e7713");
export const REGISTRY = getAddress("0x0000000000000000000000000000000000000e91");
export const KEEPER = getAddress("0x000000000000000000000000000000000000Cafe");
export const PM = getAddress("0x000000000004444c5dc75cB358380D2e3dE08A90");
export const HOOK = getAddress("0x784FF9a3ac5d88A30bfff6F7f2a270161FBE6000");
export const ALIGN_KEY = { currency0: INFER, currency1: IMD, fee: 12500, tickSpacing: 60, hooks: HOOK };

/** sqrtPriceX96 of the IMD/ETH pool for `imdPerEth` IMD per ETH (ETH is currency0). */
export const sqrtFor = (imdPerEth) => {
  const n = BigInt(imdPerEth) << 192n;
  let x = 1n << 128n;
  for (let i = 0; i < 200; i++) x = (x + n / x) >> 1n;
  return x;
};

export const cfg = {
  CHAIN_ID: 1, V4_QUOTER: getAddress("0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203"), V3_QUOTER: getAddress("0x61fFE014bA17989E743c5F6cB21bF9697530B21e"),
  POOL_MANAGER: PM, V3_FACTORY: getAddress("0x1F98431c8aD98523631AE4a59f267346ea31F984"), WETH,
  MIN_BATCH_ETH: 0.1, MAX_GAS_SHARE_BPS: 100, MAX_GAS_GWEI: 30, HOP_MARGIN_BPS: 50, SPLIT_MARGIN_BPS: 100,
  DEADLINE_SECONDS: 120, MAX_REQUOTES: 2, MAX_IMPACT_BPS: 300, MAX_REFERENCE_DEVIATION_BPS: 300,
  USD_TOKENS: { [getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48")]: 6, [getAddress("0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25")]: 18 },
  BTC_TOKENS: { [getAddress("0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf")]: 8, [getAddress("0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599")]: 8 },
  MAX_FEED_DEVIATION_BPS: 300, CROSS_RPC_MAX_BPS: 0, CROSS_RPC_RETRY_MS: 1, RECEIPT_POLL_MS: 5, MIN_ETH: 0.02, MAX_ETH_PER_DAY: 0.05, TIP_GWEI: 0.3, GAS_MARGIN_BPS: 2500,
  TX_WAIT_SECONDS: 0, VAULTS: [], READ_RPC_URLS: ["http://fake"], PRIVATE_RPC_URL: [],
  QUOTE_MAX_AGE_SECONDS: 25, ZEROEX_MAX_WORSE_BPS: 0, ZEROEX_TIMEOUT_MS: 200, USE_IMD_FEED: false,
};

/**
 * Rates are out = in * num / den per (tokenIn, tokenOut): price only, no impact, unless `state.depth[pool]` is set
 * (then out *= depth / (depth + in), like a constant-product pool of that depth), or `state.fail[pool]` (the quote
 * reverts). e.g. 1 ETH = 850 IMD, 1 USDC (1e6) = 0.00045 ETH. `state.tokens` / `state.amounts` is what is pending;
 * hooks let a test change it mid-plan. The fake vault takes any subset at amounts up to what is pending, like the vault.
 */
export function fakeChain(over = {}) {
  const state = {
    tokens: [ETH, USDC],
    amounts: { [ETH]: 10n ** 17n, [USDC]: 300_000_000n },
    closedBatches: 0n,
    keeper: KEEPER,
    // out = in * num / den
    rates: {
      [`${ETH}>${IMD}`]: [850n, 1n],
      [`${IMD}>${ETH}`]: [1n, 860n],
      [`${USDC}>${ETH}`]: [45n * 10n ** 7n, 1n], // 1 USDC (1e6 units) -> 0.00045 ETH
      [`${ETH}>${USDC}`]: [20_000n, 9n * 10n ** 12n], // 1 ETH -> 2,222.2 USDC
      [`${WETH}>${CBBTC}`]: [1n, 1n],
      [`${CBBTC}>${WETH}`]: [33n * 10n ** 9n, 1n], // 1e8 -> 3.3 ETH
      [`${IMDUSD}>${IMD}`]: [1n, 4n],
      [`${INFER}>${IMD}`]: [1n, 3700n],
      [`${IMD}>${INFER}`]: [3700n, 1n],
    },
    sqrtP: 1289596344292605895871167486n, // ~ 1 IMD = 3774 INFER, INFER is currency0
    liquidity: 761546456439979897230438n,
    vaultInfer: 0n,
    vaultImd: 0n,
    baseFee: 1_000_000_000n, // 1 gwei
    timestamp: 1_800_000_000n,
    blockNumber: 100n,
    gas: 900_000n,
    nonce: 0n,
    balance: 10n ** 18n,
    receipts: {},
    simulateV1: true,
    depth: {},
    fail: {},
    calls: [],
    // Independent references, consistent with the rates above: ETH/USD 2,222.22 (8 decimals), BTC/ETH 3.3 (18),
    // BTC/USD = their product, the IMD feed at 850 IMD per ETH (value = ETH per IMD, 1e18). `age` in seconds.
    chainlink: {
      [FEED_ETH_USD]: { description: "ETH / USD", decimals: 8, answer: 222_222_222_222n, age: 100n },
      [FEED_BTC_ETH]: { description: "BTC / ETH", decimals: 18, answer: 33n * 10n ** 17n, age: 100n },
      [FEED_BTC_USD]: { description: "BTC / USD", decimals: 8, answer: 733_333_333_333n, age: 100n },
    },
    imdFeed: { value: 10n ** 18n / 850n, age: 600n, stale: false },
    // The IMD/ETH v4 pool's spot (IMD's market price): 850 IMD per ETH, as the ETH > IMD rate.
    imdEthSqrtP: sqrtFor(850),
    targets: { [ALLOWANCE_HOLDER]: true, [ZROUTER]: true }, // factory.isSwapTarget
    settler: SETTLER, // 0x's Settler registry (ownerOf(2))
    // 0x: per pair `${sell}>${buy}` (keeper addresses), a mode ("noRoute", "error", "timeout", "wrongTo", "badSettler",
    // "otherRecipient") or a rate multiplier [num, den] vs the pool rate; zxAll applies to every pair. zxCalls counts.
    zx: {},
    zxAll: null,
    zxCalls: [],
    failRead: {}, // functionName or `${address}.${functionName}` -> true: that read throws
    receiptErrors: 0, // the next N receipt lookups throw (an RPC 429)
    ...over,
  };
  const rate = (a, b, amt) => {
    const k = `${a}>${b}`;
    const r = state.rates[k] ?? state.rates[`${a === ETH ? WETH : a}>${b === ETH ? WETH : b}`];
    if (!r) throw new Error(`no fake pool ${k}`);
    if (state.fail[k]) {
      const e = new Error("quote reverted");
      e.cause = { raw: "0x7a5ed734" };
      throw e;
    }
    const out = (amt * r[0]) / r[1];
    return state.depth[k] ? (out * state.depth[k]) / (state.depth[k] + amt) : out;
  };
  const ok = (p) => {
    if (state.rejectNext) {
      state.rejectNext = false;
      return false;
    }
    if (p.tokens.length === 0 || p.amounts.length !== p.tokens.length || p.swaps.length !== p.tokens.length) return false;
    const seen = new Set();
    return p.tokens.every((t, i) => {
      const a = getAddress(t);
      if (seen.has(a)) return false;
      seen.add(a);
      const pend = state.amounts[a] ?? 0n;
      return state.tokens.includes(a) && p.amounts[i] > 0n && p.amounts[i] <= pend;
    });
  };
  // PoolManager slots: slot0 and liquidity of the alignment pool and of the IMD/ETH pool.
  const slotsOf = (key) => {
    const base = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [poolId(key), 6n]));
    return [base.toLowerCase(), toHex(hexToBigInt(base) + 3n, { size: 32 }).toLowerCase()];
  };
  const [a0, a1] = slotsOf(ALIGN_KEY);
  const [e0, e1] = slotsOf(imdEthKey(IMD));
  const slots = () => ({ [a0]: state.sqrtP, [a1]: state.liquidity, [e0]: state.imdEthSqrtP, [e1]: 10n ** 24n });
  const SPLIT_OUT = 100_000_000n * 10n ** 18n; // above any off-chain pass-1 quote the fake pool gives (passes 2-3 add to it)
  const uses0x = (p) => [...p.swaps, p.ethLeg].some((w) => getAddress(w.target) === ALLOWANCE_HOLDER);
  const client = {
    state,
    async getBlock() {
      return { number: state.blockNumber, timestamp: state.timestamp, baseFeePerGas: state.baseFee };
    },
    async getBlockNumber() {
      return state.blockNumber;
    },
    async getChainId() {
      return 1;
    },
    async getTransactionCount() {
      return Number(state.nonce);
    },
    async getBalance() {
      return state.balance;
    },
    async getTransactionReceipt({ hash }) {
      if (state.receiptErrors > 0) {
        state.receiptErrors--;
        throw new Error("HTTP request failed. Status: 429 Too Many Requests");
      }
      const r = state.receipts[hash];
      if (!r) throw new Error(`Transaction receipt with hash "${hash}" could not be found.`);
      return r;
    },
    async readContract({ address, functionName, args }) {
      state.calls.push(functionName);
      const at = address ? getAddress(address) : null;
      if (state.failRead[functionName] || state.failRead[`${at}.${functionName}`]) throw new Error(`fake: ${functionName} failed (HTTP 503)`);
      const feed = state.chainlink[at];
      if (feed && ["decimals", "description", "latestRoundData"].includes(functionName)) {
        if (functionName === "decimals") return feed.decimals;
        if (functionName === "description") return feed.description;
        return [7n, feed.answer, state.timestamp - feed.age, state.timestamp - feed.age, 7n];
      }
      switch (functionName) {
        case "latestValue": return [state.imdFeed.value, state.timestamp - state.imdFeed.age];
        case "isStale": return state.imdFeed.stale;
        case "openBatchTokens": return [...state.tokens];
        case "pendingByToken": return state.amounts[getAddress(args[0])] ?? 0n;
        case "closedBatches": return state.closedBatches;
        case "conversionKeeper": return state.keeper;
        case "infer": return INFER;
        case "imd": return IMD;
        case "config": return FACTORY;
        case "isSwapTarget": return state.targets[getAddress(args[0])] === true;
        case "ownerOf": return state.settler;
        case "prev": return zeroAddress;
        case "registry": return REGISTRY;
        case "isVault": return (state.deployed ?? []).some((d) => getAddress(d.vault) === getAddress(args[0]) && d.isVault !== false);
        case "poolManager": return PM;
        case "alignmentPoolKey": return ALIGN_KEY;
        case "CONVERSION_REWARD": return 1_200_000_000_000_000n;
        case "MAX_CONVERSION_REWARD_BPS": return 100n;
        case "balanceOf": return getAddress(address) === INFER ? state.vaultInfer : state.vaultImd;
        case "feeStats": return [0n, 0n, 0n, 0n];
        case "extsload": {
          const v = slots()[args[0].toLowerCase()];
          if (v === undefined) throw new Error(`fake: unknown slot ${args[0]}`);
          return `0x${v.toString(16).padStart(64, "0")}`;
        }
        case "quoteExactInputSingle": {
          const p = args[0];
          if (p.poolKey) {
            const k = p.poolKey;
            const [i, o] = p.zeroForOne ? [k.currency0, k.currency1] : [k.currency1, k.currency0];
            return [rate(getAddress(i), getAddress(o), p.exactAmount), 0n];
          }
          return [rate(getAddress(p.tokenIn), getAddress(p.tokenOut), p.amountIn), 0n, 0, 0n];
        }
        default: throw new Error(`fake: no ${functionName}`);
      }
    },
    async request({ method, params }) {
      if (method !== "eth_simulateV1") throw new Error(`fake: no ${method}`);
      if (!state.simulateV1) throw new Error("the method eth_simulateV1 does not exist/is not available");
      state.calls.push("eth_simulateV1");
      const { decodeFunctionData } = await import("viem");
      const call = params[0].blockStateCalls[0].calls[0];
      const { args } = decodeFunctionData({ abi: vaultAbi, data: call.data });
      if (params[1] === "latest") state.calls.push("eth_simulateV1@latest");
      if (!ok(args[0])) return [{ calls: [{ status: "0x0", logs: [], gasUsed: "0x0", error: { message: "execution reverted", data: "0x019af637" } }] }];
      if (state.revert0x && uses0x(args[0])) return [{ calls: [{ status: "0x0", logs: [], gasUsed: "0x0", error: { message: "execution reverted", data: "0xbb2875c3" } }] }];
      const topics = encodeEventTopics({ abi: vaultAbi, eventName: "SplitSwap" });
      const data = encodeAbiParameters([{ type: "bool" }, { type: "uint256" }, { type: "uint256" }], [false, 400n * 10n ** 18n, state.simSplitOut ?? SPLIT_OUT]);
      const logs = [{ address: call.to, topics, data }];
      // state.simLegOut: an EthLegSwapped(ethIn, imdOut) event too (what the leg "really" yields in the simulation).
      if (state.simLegOut != null) {
        logs.push({
          address: call.to,
          topics: encodeEventTopics({ abi: vaultAbi, eventName: "EthLegSwapped", args: { batchId: 1n } }),
          data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [0n, state.simLegOut]),
        });
      }
      return [{ calls: [{ status: "0x1", gasUsed: "0xc3500", logs }] }];
    },
    async simulateContract({ args }) {
      state.calls.push("simulateContract");
      if (state.revert0x && uses0x(args[0])) {
        const e = new Error("reverted");
        e.cause = { data: { errorName: "InsufficientOutput" } };
        throw e;
      }
      if (!ok(args[0])) {
        const e = new Error("reverted");
        e.cause = { data: { errorName: "BadParams" } };
        throw e;
      }
      if (args[0].minSplitOut > SPLIT_OUT) {
        const e = new Error("reverted");
        e.cause = { data: { errorName: "InsufficientOutput" } };
        throw e;
      }
      return { result: 1n };
    },
    async estimateContractGas() {
      return state.gas;
    },
    async getLogs({ fromBlock, toBlock }) {
      state.logRanges = [...(state.logRanges ?? []), [fromBlock, toBlock]];
      if (state.getLogsError) throw new Error(state.getLogsError);
      return (state.deployed ?? []).filter((d) => d.block >= fromBlock && d.block <= toBlock).map((d) => ({ args: { vault: d.vault } }));
    },
  };
  return client;
}

/** The ctx vaultContext would build for the fake vault. */
export const fakeCtx = () => ({
  vault: VAULT, infer: INFER, imd: IMD, config: FACTORY, registry: REGISTRY, poolManager: PM, key: ALIGN_KEY,
  inferIsCurrency0: true, reward: 1_200_000_000_000_000n, rewardBps: 100n,
});

const settlerParams = [
  { name: "slippage", type: "tuple", components: [{ name: "recipient", type: "address" }, { name: "buyToken", type: "address" }, { name: "minAmountOut", type: "uint256" }] },
  { name: "actions", type: "bytes[]" },
  { name: "zid", type: "bytes32" },
];

/** A 0x v2 AllowanceHolder quote body, as the API returns it (addresses as 0x names them: ETH = 0xEeee...). */
export function zxBody({ sellToken, buyToken, sellAmount, taker, buyAmount, slippageBps = 50, settler = SETTLER, to = ALLOWANCE_HOLDER, recipient = taker }) {
  const minBuy = (buyAmount * (10_000n - BigInt(slippageBps))) / 10_000n;
  const native = getAddress(sellToken) === NATIVE;
  const inner = SETTLER_EXECUTE + encodeAbiParameters(settlerParams, [{ recipient, buyToken, minAmountOut: minBuy }, [], zeroHash]).slice(2);
  const data = encodeFunctionData({ abi: allowanceHolderAbi, functionName: "exec", args: [settler, native ? zeroAddress : sellToken, sellAmount, settler, inner] });
  return {
    liquidityAvailable: true, sellToken, buyToken, sellAmount: String(sellAmount), buyAmount: String(buyAmount), minBuyAmount: String(minBuy),
    transaction: { to, data, value: native ? String(sellAmount) : "0", gas: "300000", gasPrice: "1000000000" },
    issues: { allowance: native ? null : { actual: "0", spender: ALLOWANCE_HOLDER }, balance: null, simulationIncomplete: false, invalidSourcesPassed: [] },
    zid: "0xfake",
  };
}

const fromZx = (a) => (getAddress(a) === NATIVE ? ETH : getAddress(a));
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

/**
 * A fake 0x API on `chain`'s state: quotes at the pool rates (state.rates), times state.zx[pair] when it is a
 * multiplier; a mode string makes that pair fail as named. Returns the real zeroExClient over it.
 */
export function fakeZeroEx(chain, over = {}) {
  const state = chain.state;
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const q = Object.fromEntries(u.searchParams);
    state.zxCalls.push({ ...q, key: init.headers["0x-api-key"] });
    const sell = fromZx(q.sellToken);
    const buy = fromZx(q.buyToken);
    const pair = `${sell}>${buy}`;
    const mode = state.zx[pair] ?? state.zxAll;
    if (mode === "timeout") {
      const e = new Error("The operation was aborted due to timeout");
      e.name = "TimeoutError";
      throw e;
    }
    if (mode === "noRoute") return reply(200, { liquidityAvailable: false, zid: "0x" });
    if (mode === "error") return reply(500, { name: "INTERNAL_SERVER_ERROR", message: "boom" });
    if (mode === "unauthorized") return reply(401, { name: "UNAUTHORIZED" });
    const r = state.rates[pair] ?? state.rates[`${sell === ETH ? WETH : sell}>${buy === ETH ? WETH : buy}`];
    if (!r) return reply(404, { name: "NO_ROUTE" });
    let out = (BigInt(q.sellAmount) * r[0]) / r[1];
    if (Array.isArray(mode)) out = (out * mode[0]) / mode[1];
    const body = zxBody({
      sellToken: q.sellToken, buyToken: q.buyToken, sellAmount: BigInt(q.sellAmount), taker: q.taker, buyAmount: out, slippageBps: state.zxSlippageBps ?? Number(q.slippageBps ?? 50),
      ...(mode === "wrongTo" ? { to: "0x000000000000000000000000000000000000dEaD" } : {}),
      ...(mode === "badSettler" ? { settler: getAddress("0x000000000000000000000000000000000000bAd0") } : {}),
      ...(mode === "otherRecipient" ? { recipient: getAddress("0x000000000000000000000000000000000000bEEF") } : {}),
    });
    return reply(200, body);
  };
  return zeroExClient(cfg, { fetchImpl, apiKey: "test-key", now: over.now ?? Date.now, ...over });
}
