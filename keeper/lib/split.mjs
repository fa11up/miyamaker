// The balancing swap (IMD <-> INFER in the hooked INFER/IMD pool), reproduced off chain.
//
// The vault's balancing swaps (UniAlignmentVault._balanceAndAdd: up to three passes of swap-then-add, all in the
// first pass's direction) are bounded by three keeper fields: splitInferToImd (the direction they must run in),
// minSplitRate (their output per 1e18 in, over all passes) and minLiquidity (the liquidity the batch adds, swap or
// not). Pass 1's size is derivable off chain exactly (it is _splitAmount on the free balances and the pool state, both
// readable), but passes 2 and 3 depend on what the first add used, so the primary source is a simulation of the vault
// itself (lib/plan.mjs, eth_simulateV1, reading its SplitSwap and BatchConverted events). This file is the fallback
// when the node has no eth_simulateV1, and the cross-check otherwise: pass 1's quoted output is a lower bound of the
// total output (later passes only add output). In the fallback the rate floor is pass 1's rate (later passes run at a
// slightly worse price, so a call can revert InsufficientOutput: it fails closed) and the liquidity floor is a lower
// bound of pass 1's add (estimateLiquidity).
import { encodeAbiParameters, keccak256, toHex, hexToBigInt } from "viem";
import { erc20Abi, poolManagerAbi, vaultAbi } from "./abi.mjs";
import { quoteV4 } from "./quote.mjs";

const Q96 = 1n << 96n;
const mulDiv = (a, b, d) => (a * b) / d;

export function sqrtFloor(n) {
  if (n < 0n) throw new Error("sqrt of negative");
  if (n < 2n) return n;
  // Newton from 2^ceil(bits/2), always at or above the root, so it descends to the floor (as solady's sqrt).
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

/** VaultSwaps._balancedSwap (the vault's balancing math, a linked library), bit for bit. */
export function balancedSwap(amount, reserve, fee) {
  if (amount === 0n) return 0n;
  const f = BigInt(fee);
  const afterFee = 1_000_000n - f;
  const feeTerm = 2_000_000n - f;
  const bound = mulDiv(amount, 1_000_000n, feeTerm);
  if (reserve === 0n || reserve > 10n ** 30n || amount > 10n ** 30n) return bound;
  const root = sqrtFloor(reserve * (reserve * feeTerm * feeTerm + 4n * afterFee * 1_000_000n * amount));
  const base = reserve * feeTerm;
  const balanced = root > base ? (root - base) / (2n * afterFee) : 0n;
  return balanced < bound ? balanced : bound;
}

/** VaultSwaps.splitAmount: { inferToImd, swapAmount, excess }. */
export function splitAmount(amtInfer, amtImd, sqrtP, poolL, inferIsCurrency0, fee) {
  const [a0, a1] = inferIsCurrency0 ? [amtInfer, amtImd] : [amtImd, amtInfer];
  const a0In1 = mulDiv(mulDiv(a0, sqrtP, Q96), sqrtP, Q96);
  let zeroForOne;
  let reserve;
  let excess;
  if (a1 > a0In1) {
    excess = a1 - a0In1;
    reserve = mulDiv(poolL, sqrtP, Q96);
    zeroForOne = false;
  } else {
    const a1In0 = mulDiv(mulDiv(a1, Q96, sqrtP), Q96, sqrtP);
    excess = a0 > a1In0 ? a0 - a1In0 : 0n;
    reserve = mulDiv(poolL, Q96, sqrtP);
    zeroForOne = true;
  }
  const swapAmount = balancedSwap(excess, reserve, fee);
  return { inferToImd: zeroForOne === inferIsCurrency0, zeroForOne, swapAmount, excess };
}

export const poolId = (key) =>
  keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );

/** sqrtPriceX96 and active liquidity of a v4 pool, from PoolManager storage (StateLibrary's layout: pools at slot 6). */
export async function poolState(client, poolManager, key, blockNumber) {
  const base = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [poolId(key), 6n]));
  const liqSlot = toHex(hexToBigInt(base) + 3n, { size: 32 });
  const [s0, l] = await Promise.all([
    client.readContract({ address: poolManager, abi: poolManagerAbi, functionName: "extsload", args: [base], blockNumber }),
    client.readContract({ address: poolManager, abi: poolManagerAbi, functionName: "extsload", args: [liqSlot], blockNumber }),
  ]);
  const sqrtP = hexToBigInt(s0) & ((1n << 160n) - 1n);
  const liquidity = hexToBigInt(l) & ((1n << 128n) - 1n);
  return { sqrtP, liquidity };
}

/** INFER and IMD the vault holds beyond fees owed (UniAlignmentVault._free counts pending ones too, which are taken out first for the converted part). */
export async function freeAlignmentBalances(client, vault, { infer, imd }, blockNumber) {
  const one = async (token) => {
    const [bal, stats] = await Promise.all([
      client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [vault], blockNumber }),
      client.readContract({ address: vault, abi: vaultAbi, functionName: "feeStats", args: [token], blockNumber }),
    ]);
    const owed = stats[1] - stats[2] + stats[3];
    return bal > owed ? bal - owed : 0n;
  };
  const [freeInfer, freeImd] = await Promise.all([one(infer), one(imd)]);
  return { freeInfer, freeImd };
}

/**
 * A lower bound of the liquidity the vault's first add makes from `amtInfer` / `amtImd` (after pass 1's swap, when
 * `split` is given: its input out, its quoted output in, at the price the swap leaves, from the pool's active liquidity
 * as if no tick were crossed). Full range: L >= min(a0 * sqrtP / Q96, a1 * Q96 / sqrtP), which drops the range edges'
 * terms and so is never above what getLiquidityForAmounts gives.
 */
export function estimateLiquidity({ amtInfer, amtImd, sqrtP, liquidity, inferIsCurrency0, fee, split = null }) {
  let [a0, a1] = inferIsCurrency0 ? [amtInfer, amtImd] : [amtImd, amtInfer];
  let s = sqrtP;
  if (split && split.swapAmount > 0n) {
    const inAfterFee = (split.swapAmount * (1_000_000n - BigInt(fee))) / 1_000_000n;
    if (split.zeroForOne) {
      a0 -= split.swapAmount;
      a1 += split.amountOut;
      if (liquidity > 0n) s = (liquidity * sqrtP * Q96) / (liquidity * Q96 + inAfterFee * sqrtP);
    } else {
      a1 -= split.swapAmount;
      a0 += split.amountOut;
      if (liquidity > 0n) s = sqrtP + (inAfterFee * Q96) / liquidity;
    }
  }
  if (a0 <= 0n || a1 <= 0n || s === 0n) return 0n;
  const l0 = mulDiv(a0, s, Q96);
  const l1 = mulDiv(a1, Q96, s);
  return l0 < l1 ? l0 : l1;
}

/**
 * Pass 1 of the balancing swap after the routes deliver `routedImd`: its size (exact, given the routes' outputs) and
 * its quoted output. Returns null when no swap would happen.
 */
export async function estimateSplit(client, cfg, { key, inferIsCurrency0, freeInfer, freeImd, routedImd, blockNumber, state }) {
  const { sqrtP, liquidity } = state ?? (await poolState(client, cfg.POOL_MANAGER, key, blockNumber));
  if (sqrtP === 0n) throw new Error("INFER/IMD pool not initialized");
  const s = splitAmount(freeInfer, freeImd + routedImd, sqrtP, liquidity, inferIsCurrency0, key.fee);
  if (s.swapAmount === 0n) return null;
  const out = await quoteV4(client, cfg, key, s.zeroForOne, s.swapAmount, blockNumber);
  return { ...s, amountOut: out, sqrtP, liquidity };
}
