// A fake viem client: just enough chain for the keeper's reads, quotes and simulations, all in memory.
import { encodeAbiParameters, encodeEventTopics, getAddress, zeroAddress } from "viem";
import { vaultAbi } from "../lib/abi.mjs";

export const ETH = zeroAddress;
export const IMD = getAddress("0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7");
export const INFER = getAddress("0x53d0eA0A685220718Dc6a0a6e4617194C6F37921");
export const USDC = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
export const IMDUSD = getAddress("0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25");
export const CBBTC = getAddress("0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf");
export const WETH = getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
export const VAULT = getAddress("0x00000000000000000000000000000000000Fa017");
export const ROUTES = getAddress("0x0000000000000000000000000000000000000F4C");
export const REGISTRY = getAddress("0x0000000000000000000000000000000000000e91");
export const KEEPER = getAddress("0x000000000000000000000000000000000000Cafe");
export const PM = getAddress("0x000000000004444c5dc75cB358380D2e3dE08A90");
export const HOOK = getAddress("0x784FF9a3ac5d88A30bfff6F7f2a270161FBE6000");
export const ALIGN_KEY = { currency0: INFER, currency1: IMD, fee: 12500, tickSpacing: 60, hooks: HOOK };

const hop = (kind, tokenIn, tokenOut, fee, tickSpacing) => ({ kind, tokenIn, tokenOut, fee, tickSpacing });
export const ROUTE_TABLE = {
  [ETH]: [hop(4, ETH, IMD, 10000, 200)],
  [IMDUSD]: [hop(4, IMDUSD, IMD, 3000, 60)],
  [USDC]: [hop(4, USDC, ETH, 500, 10), hop(4, ETH, IMD, 10000, 200)],
  [CBBTC]: [hop(3, CBBTC, ETH, 3000, 0), hop(4, ETH, IMD, 10000, 200)],
};

export const cfg = {
  CHAIN_ID: 1, V4_QUOTER: getAddress("0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203"), V3_QUOTER: getAddress("0x61fFE014bA17989E743c5F6cB21bF9697530B21e"),
  POOL_MANAGER: PM, V3_FACTORY: getAddress("0x1F98431c8aD98523631AE4a59f267346ea31F984"), WETH,
  MIN_BATCH_ETH: 0.1, MAX_GAS_SHARE_BPS: 100, MAX_GAS_GWEI: 30, HOP_MARGIN_BPS: 50, SPLIT_MARGIN_BPS: 100,
  DEADLINE_SECONDS: 120, MAX_REQUOTES: 2, MIN_ETH: 0.02, MAX_ETH_PER_DAY: 0.05, TIP_GWEI: 0.3, GAS_MARGIN_BPS: 2500,
  TX_WAIT_SECONDS: 0, VAULTS: [], READ_RPC_URLS: ["http://fake"], PRIVATE_RPC_URL: [],
};

/**
 * Rates are "out per 1e18 in" per (tokenIn, tokenOut): price only, no impact. e.g. 1 ETH = 850 IMD, 1 USDC (1e6) =
 * 0.00045 ETH. `state.tokens` / `state.amounts` is the open batch; hooks let a test change it mid-plan.
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
      [`${WETH}>${CBBTC}`]: [1n, 1n],
      [`${CBBTC}>${WETH}`]: [33n * 10n ** 9n, 1n], // 1e8 -> 33 ETH
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
    calls: [],
    ...over,
  };
  const rate = (a, b, amt) => {
    const r = state.rates[`${a}>${b}`];
    if (!r) throw new Error(`no fake pool ${a}>${b}`);
    return (amt * r[0]) / r[1];
  };
  const ok = (p) => p.tokens.length === state.tokens.length && p.tokens.every((t, i) => getAddress(t) === state.tokens[i]);
  const SPLIT_OUT = 1_000_000n * 10n ** 18n;
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
      const r = state.receipts[hash];
      if (!r) throw new Error(`Transaction receipt with hash "${hash}" could not be found.`);
      return r;
    },
    async readContract({ address, functionName, args }) {
      state.calls.push(functionName);
      switch (functionName) {
        case "openBatchTokens": return [...state.tokens];
        case "pendingByToken": return state.amounts[getAddress(args[0])] ?? 0n;
        case "closedBatches": return state.closedBatches;
        case "conversionKeeper": return state.keeper;
        case "infer": return INFER;
        case "imd": return IMD;
        case "routes": return ROUTES;
        case "registry": return REGISTRY;
        case "poolManager": return PM;
        case "alignmentPoolKey": return ALIGN_KEY;
        case "CONVERSION_REWARD": return 1_200_000_000_000_000n;
        case "MAX_CONVERSION_REWARD_BPS": return 100n;
        case "getRoute": return ROUTE_TABLE[getAddress(args[0])] ?? [];
        case "balanceOf": return getAddress(address) === INFER ? state.vaultInfer : state.vaultImd;
        case "feeStats": return [0n, 0n, 0n, 0n];
        case "extsload": {
          // first call slot0, then liquidity: tell them apart by the slot's low byte parity is fragile; use a counter
          state._ext = (state._ext ?? 0) + 1;
          const v = state._ext % 2 === 1 ? state.sqrtP : state.liquidity;
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
      const { args } = decodeFunctionData({ abi: vaultAbi, data: params[0].blockStateCalls[0].calls[0].data });
      if (!ok(args[0])) return [{ calls: [{ status: "0x0", logs: [], gasUsed: "0x0", error: { message: "execution reverted", data: "0x019af637" } }] }];
      const topics = encodeEventTopics({ abi: vaultAbi, eventName: "SplitSwap" });
      const data = encodeAbiParameters([{ type: "bool" }, { type: "uint256" }, { type: "uint256" }], [false, 400n * 10n ** 18n, SPLIT_OUT]);
      return [{ calls: [{ status: "0x1", gasUsed: "0xc3500", logs: [{ address: VAULT, topics, data }] }] }];
    },
    async simulateContract({ args }) {
      state.calls.push("simulateContract");
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
  };
  return client;
}

/** The ctx vaultContext would build for the fake vault. */
export const fakeCtx = () => ({
  vault: VAULT, infer: INFER, imd: IMD, routes: ROUTES, registry: REGISTRY, poolManager: PM, key: ALIGN_KEY,
  inferIsCurrency0: true, reward: 1_200_000_000_000_000n, rewardBps: 100n,
});
