// Display only: symbols and decimals of the spec's tokens (docs/IMD-INFER-VAULT.md, read from chain 2026-11-08).
import { formatUnits, getAddress } from "viem";

export const KNOWN = {
  "0x0000000000000000000000000000000000000000": ["ETH", 18],
  "0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7": ["IMD", 18],
  "0x53d0eA0A685220718Dc6a0a6e4617194C6F37921": ["INFER", 18],
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": ["USDC", 6],
  "0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25": ["imdUSD", 18],
  "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf": ["cbBTC", 8],
  "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599": ["WBTC", 8],
};

export const symbolOf = (t) => KNOWN[getAddress(t)]?.[0] ?? `${t.slice(0, 8)}…`;

/** `amount` of `token` for a log line; unknown tokens print raw units. */
export function fmt(token, amount, digits = 6) {
  const k = KNOWN[getAddress(token)];
  if (!k) return `${amount} units`;
  const s = formatUnits(amount, k[1]);
  const [i, f = ""] = s.split(".");
  return `${i}${f ? `.${f.slice(0, digits)}` : ""} ${k[0]}`;
}
