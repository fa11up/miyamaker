// The zRouter fallback: when 0x has no route, fails, times out, or quotes worse than this, the keeper builds the swap
// itself as zRouter calldata along a small route table in its own config (FALLBACK_ROUTES; the vault has no route
// table any more), quoted with the Uniswap V4Quoter / QuoterV2 at the planning block (lib/quote.mjs).
//
// zRouter 0x000000000000FB114709235f1ccBFfb925F600e4 (contracts/src/vaults/uni/IVaultConfig.sol): with exactOut =
// false, amountLimit is the minimum out, the swap pays `to` (the vault), pulls a non-ETH tokenIn from the caller (the
// vault approves it for exactly the amount), and for ETH in takes msg.value (swapAmount 0 = all of msg.value).
// One hop per token: every route the vault needs is a single pool (2026-11-08).
import { encodeFunctionData, getAddress, parseAbi, zeroAddress } from "viem";

export const ETH = zeroAddress;
export const ZROUTER = getAddress("0x000000000000FB114709235f1ccBFfb925F600e4");
export const HOP_V3 = 3;
export const HOP_V4 = 4;

export const zRouterAbi = parseAbi([
  "function swapV4(address to, bool exactOut, uint24 swapFee, int24 tickSpace, address tokenIn, address tokenOut, uint256 swapAmount, uint256 amountLimit, uint256 deadline) payable returns (uint256 amountIn, uint256 amountOut)",
  "function swapV3(address to, bool exactOut, uint24 swapFee, address tokenIn, address tokenOut, uint256 swapAmount, uint256 amountLimit, uint256 deadline) payable returns (uint256 amountIn, uint256 amountOut)",
]);

const IMD = "0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7";
/**
 * The default fallback table (the vault's old route table, contracts/script/config/1.json before 2026-11-08):
 * token -> its one hop. USDC/WBTC/cbBTC end in ETH (they join the batch's ETH leg), imdUSD in IMD, ETH -> IMD is the leg.
 */
export const DEFAULT_FALLBACK_ROUTES = {
  [ETH]: { kind: 4, tokenOut: IMD, fee: 10000, tickSpacing: 200 },
  "0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25": { kind: 4, tokenOut: IMD, fee: 3000, tickSpacing: 10 }, // imdUSD: the pool the Safe re-opened at market on 2026-11-09 (3000/60 is stranded)
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": { kind: 4, tokenOut: ETH, fee: 500, tickSpacing: 10 }, // USDC
  "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599": { kind: 4, tokenOut: ETH, fee: 500, tickSpacing: 10 }, // WBTC
  "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf": { kind: 3, tokenOut: ETH, fee: 3000, tickSpacing: 0 }, // cbBTC (v3: v4 is thin)
};

/** One hop, checked: v4 (fee < 100%, tickSpacing > 0) or v3 (a standard fee tier); ends in ETH or IMD. */
export function parseHop(tokenIn, h, imd = IMD) {
  const hop = { kind: Number(h.kind), tokenIn: getAddress(tokenIn), tokenOut: getAddress(h.tokenOut), fee: Number(h.fee), tickSpacing: Number(h.tickSpacing ?? 0) };
  if (hop.kind !== HOP_V3 && hop.kind !== HOP_V4) throw new Error(`hop kind ${hop.kind} is neither v3 (3) nor v4 (4)`);
  if (hop.tokenIn === hop.tokenOut) throw new Error(`fallback route for ${tokenIn} swaps a token for itself`);
  if (hop.tokenOut !== ETH && hop.tokenOut !== getAddress(imd)) throw new Error(`fallback route for ${tokenIn} ends at ${hop.tokenOut}, not ETH or IMD`);
  if (hop.tokenIn === ETH && hop.tokenOut !== getAddress(imd)) throw new Error("the ETH fallback route must end in IMD");
  if (hop.kind === HOP_V4 && (hop.fee >= 1_000_000 || hop.tickSpacing <= 0)) throw new Error(`fallback route for ${tokenIn}: bad v4 hop`);
  if (hop.kind === HOP_V3 && ![100, 500, 3000, 10000].includes(hop.fee)) throw new Error(`fallback route for ${tokenIn}: bad v3 fee ${hop.fee}`);
  return hop;
}

/** cfg.FALLBACK_ROUTES (or the default) -> Map(token -> hop), every hop checked. */
export function fallbackRoutes(cfg, imd = IMD) {
  const table = cfg.FALLBACK_ROUTES ?? DEFAULT_FALLBACK_ROUTES;
  return new Map(Object.entries(table).map(([t, h]) => [getAddress(t), parseHop(t, h, imd)]));
}

/**
 * zRouter calldata for one hop: pays `to` (the vault) at least `minOut`, by `deadline`. ETH in: swapAmount 0 (all of
 * msg.value, so the ETH leg swaps exactly what the vault sends) and value = amountIn.
 */
export function zRouterCall(hop, { to, amountIn, minOut, deadline }) {
  if (!(minOut > 0n)) throw new Error("zRouter call needs a non-zero minimum out");
  const ethIn = hop.tokenIn === ETH;
  const swapAmount = ethIn ? 0n : amountIn;
  const data =
    hop.kind === HOP_V4
      ? encodeFunctionData({ abi: zRouterAbi, functionName: "swapV4", args: [to, false, hop.fee, hop.tickSpacing, hop.tokenIn, hop.tokenOut, swapAmount, minOut, deadline] })
      : encodeFunctionData({ abi: zRouterAbi, functionName: "swapV3", args: [to, false, hop.fee, hop.tokenIn, hop.tokenOut, swapAmount, minOut, deadline] });
  return { target: ZROUTER, data, value: ethIn ? amountIn : 0n };
}
