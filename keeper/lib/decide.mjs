// When to convert: pure, so the rule is tested without a chain.
import { formatEther, formatGwei, parseEther, parseGwei } from "viem";

/** Is the batch worth converting at all (before spending RPC calls on simulation)? */
export function worthIt(batchEthWei, cfg) {
  const min = parseEther(String(cfg.MIN_BATCH_ETH));
  if (batchEthWei < min) return { go: false, why: `batch worth ${formatEther(batchEthWei)} ETH, below MIN_BATCH_ETH ${cfg.MIN_BATCH_ETH}` };
  return { go: true };
}

/**
 * Gas-adjusted: the gas price is under MAX_GAS_GWEI, and the tx's expected cost (gas estimate with margin times
 * base fee + tip) is under MAX_GAS_SHARE_BPS of the batch's ETH value.
 */
export function gasOk({ batchEthWei, gas, baseFeeWei, tipWei }, cfg) {
  const price = baseFeeWei + tipWei;
  const ceiling = parseGwei(String(cfg.MAX_GAS_GWEI));
  const cost = gas * price;
  const out = { price, cost, shareBps: batchEthWei === 0n ? Infinity : Number((cost * 1_000_000n) / batchEthWei) / 100 };
  if (price > ceiling) return { ...out, go: false, why: `gas ${formatGwei(price)} gwei above MAX_GAS_GWEI ${cfg.MAX_GAS_GWEI}` };
  if (cost * 10_000n > batchEthWei * BigInt(cfg.MAX_GAS_SHARE_BPS)) {
    return { ...out, go: false, why: `gas ${formatEther(cost)} ETH is ${out.shareBps} bps of the batch, above MAX_GAS_SHARE_BPS ${cfg.MAX_GAS_SHARE_BPS}` };
  }
  return { ...out, go: true };
}
