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
  // Signed transactions go ONLY here (e.g. Flashbots Protect, https://rpc.flashbots.net/fast). Never a public node:
  // with this unset the keeper refuses to send at all. Comma-separated list in the env: tried in order.
  PRIVATE_RPC_URL: null,

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
  HOP_MARGIN_BPS: 50, // floor per hop = quote * (1 - margin)^(hop index + 1): each hop may slip this much on its own
  SPLIT_MARGIN_BPS: 100, // minSplitOut = the balancing swap's simulated output * (1 - this)
  DEADLINE_SECONDS: 120, // ConvertParams.deadline = latest block time + this; an unmined tx is dead after it
  MAX_REQUOTES: 2, // after a BadParams (a new token joined the batch mid-flight): re-read and re-quote at most this often

  // --- guard rails (lib/guards.mjs, lib/outcome.mjs) ---
  MIN_ETH: 0.02, // the keeper wallet must hold at least this after paying for the tx's gas limit
  MAX_ETH_PER_DAY: 0.05, // gas spent per UTC day (an unconfirmed tx counts at its worst-case cost)
  TIP_GWEI: 0.3, // priority fee; maxFeePerGas = 2 * base fee + tip
  GAS_MARGIN_BPS: 2500, // gas limit = estimate + 25%
  TX_WAIT_SECONDS: 180, // wait this long for a receipt inside one tick; then the tx is "unknown" until resolved
  STATE_DIR: "./state", // pending.json (the unknown-outcome record), spend.json (ledger), STOP (kill switch)

  INTERVAL_SECONDS: 300,
};
