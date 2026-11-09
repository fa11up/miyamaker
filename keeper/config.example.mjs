// Copy to config.mjs (gitignored) and edit. NO KEYS OR KEYED URLS IN THIS FILE: the signing key comes from
// KEEPER_PRIVATE_KEY or KEEPER_KEY_FILE, and a keyed RPC URL belongs in the environment (PRIVATE_RPC_URL,
// READ_RPC_URLS). Every number below can also be set from the environment under the same name.
//
// Without config.mjs the keeper runs on this file as is (report-only mode needs nothing else).
export default {
  CHAIN_ID: 1,

  // --- what to watch ---
  // Vaults to keep. Start with a fixed list; FACTORY (below) can add every vault the factory has deployed.
  VAULTS: [],
  // The UniAlignmentVaultFactory. When set with DISCOVER_FROM_BLOCK, its VaultDeployed events add vaults (each is
  // checked with registry.isVault before it is used). Leave null to watch VAULTS only.
  FACTORY: null,
  DISCOVER_FROM_BLOCK: null,

  // --- reads and sends ---
  // Reads (quotes, simulations, receipts): the first that answers, failing over. publicnode supports eth_simulateV1.
  READ_RPC_URLS: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"],
  // Signed transactions go ONLY here, never a public mempool (with this unset the keeper refuses to send at all).
  // MEV Blocker (CoW / Beaver Build / others), keyless; its endpoints:
  //   https://rpc.mevblocker.io/noreverts    private; a tx that would revert is never included (a failed conversion
  //                                          costs no gas). The keeper's default.
  //   https://rpc.mevblocker.io/fast         private, faster inclusion; reverting txs may land (and pay gas)
  //   https://rpc.mevblocker.io/fullprivacy  no backrun auction, the tx goes only to builders; slowest
  // MEV Blocker may hold a tx and never include it: it then dies at ConvertParams.deadline and the keeper replaces it
  // at the same nonce (lib/outcome.mjs). Comma-separated list in the env: tried in order.
  PRIVATE_RPC_URL: "https://rpc.mevblocker.io/noreverts",

  // --- swaps: 0x first, zRouter as the fallback (lib/swaps.mjs) ---
  // 0x Swap API v2 (AllowanceHolder) needs ZEROEX_API_KEY in the environment (never in this file). Without it the keeper
  // runs on zRouter alone and says so. A 0x quote is good for ~30 s: plan, simulate and send within QUOTE_MAX_AGE_SECONDS
  // of fetching it, else it is quoted again.
  QUOTE_MAX_AGE_SECONDS: 25,
  ZEROEX_TIMEOUT_MS: 5000,
  // zRouter is used instead of 0x when 0x quotes more than this under it (0 = always the better of the two).
  ZEROEX_MAX_WORSE_BPS: 0,
  // The zRouter fallback, one hop per token (kind 4 = v4 fee/tickSpacing, 3 = v3 fee). Its last token is also what the
  // token is swapped to (ETH joins the batch's one ETH -> IMD leg). null = the default table in lib/zrouter.mjs:
  //   ETH -> IMD v4 10000/200; imdUSD -> IMD v4 3000/10; USDC, WBTC -> ETH v4 500/10; cbBTC -> ETH v3 3000.
  FALLBACK_ROUTES: null,

  // --- contracts (mainnet, checked on chain 2026-11-08: lib/quote.mjs verifyQuoters re-checks at startup) ---
  V4_QUOTER: "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203", // its poolManager() must be POOL_MANAGER
  V3_QUOTER: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e", // QuoterV2; factory() must be the v3 factory, WETH9() WETH
  POOL_MANAGER: "0x000000000004444c5dc75cB358380D2e3dE08A90",
  V3_FACTORY: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",

  // --- when to convert ---
  MIN_BATCH_ETH: 0.1, // the batch must be worth at least this, valued in ETH from live quotes
  MAX_GAS_SHARE_BPS: 100, // and the tx's expected cost below this share of the batch value (100 = 1%)
  MAX_GAS_GWEI: 30, // and the network's gas price below this (base fee + tip)

  // --- price protection ---
  HOP_MARGIN_BPS: 50, // minOut = expected * (1 - margin) (the ETH leg, fed by swaps: (1 - margin)^2); 0x: the stricter
  //                      of that and its own minBuyAmount (asked with slippageBps = the same margin)
  SPLIT_MARGIN_BPS: 100, // minSplitOut = the balancing swap's simulated output * (1 - this)
  DEADLINE_SECONDS: 60, // ConvertParams.deadline = latest block time + this; short: 0x quotes are short-lived, and an
  //                       unmined tx is dead after it (then replaced at the same nonce)
  MAX_IMPACT_BPS: 300, // a zRouter fallback whose pool would move more than this is not used (impact = how much worse
  //                      than a 1/1000-size probe through the same pool)
  // Reference checks (lib/reference.mjs): the market. Floors only protect against slippage from the LIVE quote, not
  // against a pool that is far off market (2026-11-08: imdUSD/IMD sits at IMD = 4.17 imdUSD, market ~2.47, its only
  // liquidity out of range). So every swap is compared with a price that does not come from its own quote:
  //   USD_TOKENS (address -> decimals): 1 USD each, in ETH at Chainlink ETH/USD;
  //   BTC_TOKENS (address -> decimals): in ETH at Chainlink BTC/ETH (or BTC/USD / ETH/USD if BTC/ETH fails its checks);
  //   a swap to IMD (imdUSD): that ETH in IMD at the IMD/ETH v4 pool's spot (IMD in USD = spot x Chainlink ETH/USD);
  //   the ETH leg: its IMD per ETH vs the IMD/ETH pool's spot at the planning block, at most this far EITHER way.
  // A token whose swap pays more than MAX_REFERENCE_DEVIATION_BPS under its reference, that has no reference, or whose
  // reference cannot be read (stale, wrong decimals, call failed), is left pending; the rest converts.
  MAX_REFERENCE_DEVIATION_BPS: 300,
  USD_TOKENS: {
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": 6, // USDC
    "0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25": 18, // imdUSD (treated as 1 USD)
  },
  BTC_TOKENS: {
    "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599": 8, // WBTC
    "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf": 8, // cbBTC
  },
  // Chainlink feeds, checked on chain 2026-11-08 (description and decimals are re-checked on every read; maxAge is
  // against the block's timestamp; BTC/ETH's heartbeat is 24 h, the other two 1 h).
  CHAINLINK: {
    ETH_USD: { address: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", description: "ETH / USD", decimals: 8, maxAge: 3600 },
    BTC_ETH: { address: "0xdeb288F737066589598e9214E782fa5A8eD689e8", description: "BTC / ETH", decimals: 18, maxAge: 86400 },
    BTC_USD: { address: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c", description: "BTC / USD", decimals: 8, maxAge: 3600 },
  },
  // IMD's market price: the hookless IMD/ETH v4 pool (ETH = currency0).
  IMD_ETH_POOL: { fee: 10000, tickSpacing: 200 },
  // Optional, off by default (no debt is collateralized, so the market is the reference): with USE_IMD_FEED the ETH
  // leg must also be at most MAX_FEED_DEVIATION_BPS under our IMD price feed (latestValue(): ETH per IMD; isStale()),
  // and a stale feed (isStale(), or older than IMD_FEED_MAX_AGE_SECONDS when set) stops the leg that tick.
  USE_IMD_FEED: false,
  IMD_PRICE_FEED: "0x070e0603737242B01aBC1D223f7C92D63E86EC97",
  MAX_FEED_DEVIATION_BPS: 300,
  IMD_FEED_MAX_AGE_SECONDS: null,
  // With two or more READ_RPC_URLS, the IMD/ETH spot is also read on the second one at the same block; the two must
  // agree within this (same block, same state: they should be identical). One RPC configured: no cross-check.
  CROSS_RPC_MAX_BPS: 0,
  // The simulated balancing-swap output must not be under the off-chain pass-1 quote by more than this (0 = not under it).
  SPLIT_CHECK_TOLERANCE_BPS: 0,
  MAX_REQUOTES: 2, // after a BadParams (should not happen any more: the vault takes any subset at exact amounts): re-read
  //                  and re-quote at most this often

  // --- guard rails (lib/guards.mjs, lib/outcome.mjs) ---
  MIN_ETH: 0.02, // the keeper wallet must hold at least this after paying for the tx's gas limit
  MAX_ETH_PER_DAY: 0.05, // gas spent per UTC day (an unconfirmed tx counts at its worst-case cost)
  TIP_GWEI: 0.3, // priority fee; maxFeePerGas = 2 * base fee + tip
  GAS_MARGIN_BPS: 2500, // gas limit = estimate + 25%
  TX_WAIT_SECONDS: 180, // wait this long for a receipt inside one tick; then the tx is "unknown" until resolved
  STATE_DIR: "./state", // pending.json (the unknown-outcome record), spend.json (ledger), STOP (kill switch)

  INTERVAL_SECONDS: 300,
  LOG_CHUNK: 9999, // vault discovery reads VaultDeployed logs in chunks of this many blocks (many RPCs cap at 10,000)
};
