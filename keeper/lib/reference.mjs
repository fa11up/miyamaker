// Independent price references: prices that do NOT come from the pools the routes swap through.
//
//   ETH/USD   Chainlink 0x5f4e…8419 (8 decimals, heartbeat 1 h)      1 USD (USDC, imdUSD) in ETH
//   BTC/ETH   Chainlink 0xdeb2…89e8 (18 decimals, heartbeat 24 h)    WBTC / cbBTC in ETH
//             fallback when it does not verify: BTC/USD 0xF403…E88c (8 decimals) / ETH/USD
//   IMD/ETH   our IMD price feed 0x070e…EC97 (latestValue(): ETH per IMD, 18 decimals; isStale())
//             the ETH -> IMD leg, and the IMD side of imdUSD's reference
//
// Every address, description and decimals was read on chain on 2026-11-08 (`npm run smoke` re-reads them), and each
// read re-checks description, decimals, a positive answer and its age against the block's timestamp. A read that fails
// any check returns { err } for the tokens that need it: those tokens are skipped (they stay pending), the rest convert.
import { getAddress, parseAbi } from "viem";

export const chainlinkAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
]);
export const imdFeedAbi = parseAbi([
  "function latestValue() view returns (uint256 value, uint64 updatedAt)",
  "function isStale() view returns (bool)",
]);

export const DEFAULT_CHAINLINK = {
  ETH_USD: { address: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", description: "ETH / USD", decimals: 8, maxAge: 3600 },
  BTC_ETH: { address: "0xdeb288F737066589598e9214E782fa5A8eD689e8", description: "BTC / ETH", decimals: 18, maxAge: 86_400 },
  BTC_USD: { address: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c", description: "BTC / USD", decimals: 8, maxAge: 3600 },
};
export const DEFAULT_IMD_PRICE_FEED = "0x070e0603737242B01aBC1D223f7C92D63E86EC97";
export const DEFAULT_BTC_TOKENS = {
  "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599": 8, // WBTC
  "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf": 8, // cbBTC
};

const E18 = 10n ** 18n;
const short = (e) => (e?.shortMessage ?? e?.message ?? String(e)).split("\n")[0].slice(0, 160);

/** One Chainlink feed at `blockNumber`, checked: description, decimals, answer > 0, age <= maxAge (vs `now`). */
export async function readChainlink(client, feed, { blockNumber, now }) {
  const address = getAddress(feed.address);
  const r = (functionName) => client.readContract({ address, abi: chainlinkAbi, functionName, blockNumber });
  const [dec, desc, round] = await Promise.all([r("decimals"), r("description"), r("latestRoundData")]);
  const name = feed.description ?? address;
  if (feed.description && desc !== feed.description) throw new Error(`Chainlink ${address} is "${desc}", expected "${feed.description}"`);
  if (Number(dec) !== feed.decimals) throw new Error(`${name} has ${dec} decimals, expected ${feed.decimals}`);
  const [, answer, , updatedAt] = round;
  if (!(answer > 0n)) throw new Error(`${name} answer ${answer} is not positive`);
  if (!(updatedAt > 0n)) throw new Error(`${name} round not complete`);
  const age = now > updatedAt ? now - updatedAt : 0n;
  if (age > BigInt(feed.maxAge)) throw new Error(`${name} stale: updated ${age}s ago, max ${feed.maxAge}s`);
  return { answer, decimals: feed.decimals, updatedAt, age, description: desc };
}

/** Our IMD price feed: ETH per IMD (1e18). Stale (isStale(), or older than maxAge when set) or 0 is an error. */
export async function readImdFeed(client, address, { blockNumber, now, maxAge }) {
  address = getAddress(address);
  const r = (functionName) => client.readContract({ address, abi: imdFeedAbi, functionName, blockNumber });
  const [[value, updatedAt], stale] = await Promise.all([r("latestValue"), r("isStale")]);
  const age = now > BigInt(updatedAt) ? now - BigInt(updatedAt) : 0n;
  if (stale) throw new Error(`IMD price feed ${address} isStale() = true (updated ${age}s ago)`);
  if (!(value > 0n)) throw new Error(`IMD price feed ${address} reads 0`);
  if (maxAge != null && age > BigInt(maxAge)) throw new Error(`IMD price feed ${address} updated ${age}s ago, max ${maxAge}s`);
  return { ethPerImd: value, updatedAt: BigInt(updatedAt), age };
}

/**
 * The references for one batch, read lazily and at most once each (a USDC-only batch never reads BTC/ETH). Every read
 * settles to { v } or { err }, so one failed read only affects the tokens that need it.
 */
export function referenceReader(client, cfg, { blockNumber, now }) {
  const cl = { ...DEFAULT_CHAINLINK, ...(cfg.CHAINLINK ?? {}) };
  const usdTokens = cfg.USD_TOKENS ?? {};
  const btcTokens = cfg.BTC_TOKENS ?? DEFAULT_BTC_TOKENS;
  const at = { blockNumber, now };
  const memo = new Map();
  const once = (k, f) => {
    if (!memo.has(k)) memo.set(k, f().then((v) => ({ v }), (e) => ({ err: short(e) })));
    return memo.get(k);
  };
  const ethUsd = () => once("ethUsd", () => readChainlink(client, cl.ETH_USD, at));
  // ETH per 1 BTC = num / den
  const btcEth = () =>
    once("btcEth", async () => {
      try {
        const r = await readChainlink(client, cl.BTC_ETH, at);
        return { num: r.answer, den: 10n ** BigInt(r.decimals), via: "Chainlink BTC/ETH" };
      } catch (e) {
        const [b, u] = await Promise.all([readChainlink(client, cl.BTC_USD, at), readChainlink(client, cl.ETH_USD, at)]);
        return {
          num: b.answer * 10n ** BigInt(u.decimals), den: u.answer * 10n ** BigInt(b.decimals),
          via: `Chainlink BTC/USD / ETH/USD (BTC/ETH did not verify: ${short(e)})`,
        };
      }
    });
  const imdFeed = () =>
    once("imdFeed", () => readImdFeed(client, cfg.IMD_PRICE_FEED ?? DEFAULT_IMD_PRICE_FEED, { ...at, maxAge: cfg.IMD_FEED_MAX_AGE_SECONDS ?? null }));

  return {
    ethUsd, btcEth, imdFeed,
    /** Does `token` have an independent reference? */
    has: (token) => usdTokens[getAddress(token)] != null || btcTokens[getAddress(token)] != null,
    /**
     * What `amount` of `token` is worth in ETH (wei) by its reference: { wei, via } | { err } | null (no reference).
     * USD tokens: 1 USD each at Chainlink ETH/USD. BTC tokens: Chainlink BTC/ETH.
     */
    async ethFor(token, amount) {
      const t = getAddress(token);
      if (usdTokens[t] != null) {
        const r = await ethUsd();
        if (r.err) return { err: r.err };
        const usd18 = (amount * E18) / 10n ** BigInt(usdTokens[t]);
        return { wei: (usd18 * 10n ** BigInt(r.v.decimals)) / r.v.answer, via: "1 USD at Chainlink ETH/USD" };
      }
      if (btcTokens[t] != null) {
        const r = await btcEth();
        if (r.err) return { err: r.err };
        return { wei: (amount * r.v.num * E18) / (10n ** BigInt(btcTokens[t]) * r.v.den), via: r.v.via };
      }
      return null;
    },
    /** IMD (wei) that `wei` of ETH buys at the IMD price feed: { imd } | { err }. */
    async imdForEth(wei) {
      const r = await imdFeed();
      if (r.err) return { err: r.err };
      return { imd: (wei * E18) / r.v.ethPerImd };
    },
  };
}

/** Startup / smoke: read every reference once at the latest block and say what it is. Never throws. */
export async function describeReferences(client, cfg) {
  const block = await client.getBlock({ blockTag: "latest" });
  const refs = referenceReader(client, cfg, { blockNumber: block.number, now: block.timestamp });
  const lines = [];
  const cl = { ...DEFAULT_CHAINLINK, ...(cfg.CHAINLINK ?? {}) };
  for (const [k, feed] of Object.entries(cl)) {
    try {
      const r = await readChainlink(client, feed, { blockNumber: block.number, now: block.timestamp });
      lines.push(`${k} ${feed.address}: "${r.description}", ${r.decimals} decimals, answer ${r.answer}, ${r.age}s old (max ${feed.maxAge}s): OK`);
    } catch (e) {
      lines.push(`${k} ${feed.address}: FAILED ${short(e)}`);
    }
  }
  const b = await refs.btcEth();
  lines.push(b.err ? `BTC in ETH: UNAVAILABLE ${b.err}` : `BTC in ETH via ${b.v.via}: 1 BTC = ${Number((b.v.num * 10_000n) / b.v.den) / 10_000} ETH`);
  const f = await refs.imdFeed();
  lines.push(f.err ? `IMD price feed: ${f.err} -> the ETH leg (and imdUSD) is skipped while it is stale` : `IMD price feed ${cfg.IMD_PRICE_FEED ?? DEFAULT_IMD_PRICE_FEED}: ${f.v.ethPerImd} wei per IMD (${Number((E18 * 100n) / f.v.ethPerImd) / 100} IMD per ETH), ${f.v.age}s old: OK`);
  return lines;
}
