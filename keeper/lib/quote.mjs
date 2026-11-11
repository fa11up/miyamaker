// Uniswap quotes at one block: v4 hops with the V4Quoter, v3 hops with QuoterV2. Used for the zRouter fallback
// (lib/zrouter.mjs: zRouter takes no fee of its own; an eth_call of zRouter.swapV4 for 0.1 ETH -> IMD returned exactly
// the V4Quoter's figure, 2026-11-08) and for INFER's value in the alignment pool.
import { getAddress, zeroAddress } from "viem";
import { v3QuoterAbi, v4QuoterAbi } from "./abi.mjs";
import { ETH, HOP_V3, HOP_V4 } from "./zrouter.mjs";

const BPS = 10_000n;

/** The v4 PoolKey of a hookless route hop (or any hop with `hooks`), and the swap direction. */
export function v4Key(tokenIn, tokenOut, fee, tickSpacing, hooks = zeroAddress) {
  const a = getAddress(tokenIn);
  const b = getAddress(tokenOut);
  const [currency0, currency1] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return { key: { currency0, currency1, fee, tickSpacing, hooks }, zeroForOne: a === currency0 };
}

export async function quoteV4(client, cfg, key, zeroForOne, amountIn, blockNumber) {
  if (amountIn === 0n) return 0n;
  if (amountIn >= 1n << 128n) throw new Error("amount does not fit the quoter's uint128");
  const [out] = await client.readContract({
    address: cfg.V4_QUOTER,
    abi: v4QuoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{ poolKey: key, zeroForOne, exactAmount: amountIn, hookData: "0x" }],
    blockNumber,
  });
  return out;
}

export async function quoteV3(client, cfg, tokenIn, tokenOut, fee, amountIn, blockNumber) {
  if (amountIn === 0n) return 0n;
  const w = (t) => (getAddress(t) === ETH ? cfg.WETH : t); // zRouter wraps/unwraps for v3 hops
  const [out] = await client.readContract({
    address: cfg.V3_QUOTER,
    abi: v3QuoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{ tokenIn: w(tokenIn), tokenOut: w(tokenOut), amountIn, fee, sqrtPriceLimitX96: 0n }],
    blockNumber,
  });
  return out;
}

export async function quoteHop(client, cfg, hop, amountIn, blockNumber) {
  if (hop.kind === HOP_V4) {
    const { key, zeroForOne } = v4Key(hop.tokenIn, hop.tokenOut, hop.fee, hop.tickSpacing);
    return quoteV4(client, cfg, key, zeroForOne, amountIn, blockNumber);
  }
  if (hop.kind === HOP_V3) return quoteV3(client, cfg, hop.tokenIn, hop.tokenOut, hop.fee, amountIn, blockNumber);
  throw new Error(`unknown hop kind ${hop.kind}`);
}

/** Expected output of every hop, each hop fed the previous hop's quote. A zero ends the route at 0 (as the vault does). */
export async function quoteRoute(client, cfg, hops, amountIn, blockNumber) {
  const outs = [];
  let amount = amountIn;
  for (const hop of hops) {
    amount = amount === 0n ? 0n : await quoteHop(client, cfg, hop, amount, blockNumber);
    outs.push(amount);
  }
  return outs;
}

export const applyMargin = (amount, marginBps) => (amount * (BPS - BigInt(marginBps))) / BPS;

/**
 * Price impact of sending `amountIn` down `hops` (which quoted `out`), in bps: how much worse its rate is than a
 * 1/1000 probe's (same pools, same fees, so the difference is depth). null when the probe is too small to say.
 */
export async function routeImpactBps(client, cfg, hops, amountIn, out, blockNumber) {
  const probeIn = amountIn / 1000n;
  if (probeIn === 0n || out === 0n) return null;
  const probeOut = (await quoteRoute(client, cfg, hops, probeIn, blockNumber)).at(-1);
  if (probeOut === 0n) return null;
  // 1 - (out / amountIn) / (probeOut / probeIn)
  const ratio = (out * probeIn * BPS) / (probeOut * amountIn);
  return ratio >= BPS ? 0 : Number(BPS - ratio);
}

/** Check the quoter addresses before trusting them: each must point at the expected PoolManager / v3 factory / WETH. */
export async function verifyQuoters(client, cfg) {
  const [pm, fac, weth] = await Promise.all([
    client.readContract({ address: cfg.V4_QUOTER, abi: v4QuoterAbi, functionName: "poolManager" }),
    client.readContract({ address: cfg.V3_QUOTER, abi: v3QuoterAbi, functionName: "factory" }),
    client.readContract({ address: cfg.V3_QUOTER, abi: v3QuoterAbi, functionName: "WETH9" }),
  ]);
  const bad = [];
  if (getAddress(pm) !== getAddress(cfg.POOL_MANAGER)) bad.push(`V4Quoter.poolManager() = ${pm}`);
  if (getAddress(fac) !== getAddress(cfg.V3_FACTORY)) bad.push(`QuoterV2.factory() = ${fac}`);
  if (getAddress(weth) !== getAddress(cfg.WETH)) bad.push(`QuoterV2.WETH9() = ${weth}`);
  if (bad.length) throw new Error(`quoter check failed: ${bad.join("; ")}`);
  return { poolManager: pm, v3Factory: fac, weth };
}
