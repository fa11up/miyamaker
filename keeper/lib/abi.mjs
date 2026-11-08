// The ABI fragments the keeper uses, written out here so the keeper box needs nothing from contracts/.
// test/abi.test.mjs checks every fragment against contracts/abi/*.json when that folder is present.
import { parseAbi } from "viem";

export const ROUTE_HOP = "(uint8 kind, address tokenIn, address tokenOut, uint24 fee, int24 tickSpacing)";
const POOL_KEY = "(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)";
const CONVERT_PARAMS =
  "(address[] tokens, uint256[] amounts, uint256[][] minOuts, uint256[] ethLegMinOuts, uint256 minSplitOut, uint256 deadline)";

export const vaultAbi = parseAbi([
  "function openBatchTokens() view returns (address[])",
  "function pendingByToken(address) view returns (uint256)",
  "function closedBatches() view returns (uint256)",
  "function registry() view returns (address)",
  "function routes() view returns (address)",
  "function infer() view returns (address)",
  "function imd() view returns (address)",
  "function poolManager() view returns (address)",
  `function alignmentPoolKey() view returns (${POOL_KEY})`,
  "function feeStats(address token) view returns (uint256 accPerShare, uint256 distributed, uint256 claimed, uint256 protocolFees)",
  "function CONVERSION_REWARD() view returns (uint256)",
  "function MAX_CONVERSION_REWARD_BPS() view returns (uint256)",
  `function convertAndAddLiquidity(${CONVERT_PARAMS} p) returns (uint256 sharesIssued)`,
  "event TokenConverted(uint256 indexed batchId, address indexed token, uint256 amountIn, uint256 imdValue)",
  "event EthLegSwapped(uint256 indexed batchId, uint256 ethIn, uint256 imdOut)",
  "event SplitSwap(bool inferToImd, uint256 amountIn, uint256 amountOut)",
  "event BatchConverted(uint256 indexed batchId, uint256 sharesIssued, uint256 inferAdded, uint256 imdAdded, uint256 callerReward)",
  "error BadParams()",
  "error Expired()",
  "error NothingPending()",
  "error NotKeeper()",
  "error NoRoute(address token)",
  "error BadRoute(address token)",
  "error InsufficientOutput()",
  "error InsufficientLiquidity()",
  "error ZeroFloor()",
  "error PoolNotInitialized()",
  "error Insolvent(address token)",
  "error Reentrancy()",
]);

export const routesAbi = parseAbi([
  `function getRoute(address token) view returns (${ROUTE_HOP}[])`,
  "function hasRoute(address token) view returns (bool)",
  "function minContribution(address token) view returns (uint256)",
  "function routedTokens() view returns (address[])",
  "function registry() view returns (address)",
  "event VaultDeployed(address indexed vault, uint256 indexed alignmentTargetId)",
]);

export const registryAbi = parseAbi([
  "function conversionKeeper() view returns (address)",
  "function isVault(address) view returns (bool)",
]);

export const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export const poolManagerAbi = parseAbi(["function extsload(bytes32 slot) view returns (bytes32)"]);

// Uniswap v4 V4Quoter and v3 QuoterV2. Both are non-view (they revert internally to return); eth_call runs them fine.
export const v4QuoterAbi = parseAbi([
  "function poolManager() view returns (address)",
  `function quoteExactInputSingle((${POOL_KEY} poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)`,
]);

export const v3QuoterAbi = parseAbi([
  "function factory() view returns (address)",
  "function WETH9() view returns (address)",
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);
