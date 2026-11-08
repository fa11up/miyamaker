// Config: config.mjs if present (gitignored), else config.example.mjs; then the environment, which wins.
import { existsSync } from "node:fs";
import { getAddress } from "viem";
import { DEFAULT_BTC_TOKENS, DEFAULT_CHAINLINK, DEFAULT_IMD_PRICE_FEED } from "./reference.mjs";
import { DEFAULT_LOG_CHUNK } from "./keeper.mjs";

const NUMBERS = [
  "CHAIN_ID", "MIN_BATCH_ETH", "MAX_GAS_SHARE_BPS", "MAX_GAS_GWEI", "HOP_MARGIN_BPS", "SPLIT_MARGIN_BPS",
  "DEADLINE_SECONDS", "MAX_REQUOTES", "MAX_IMPACT_BPS", "MAX_REFERENCE_DEVIATION_BPS", "MIN_ETH", "MAX_ETH_PER_DAY", "TIP_GWEI", "GAS_MARGIN_BPS", "TX_WAIT_SECONDS",
  "INTERVAL_SECONDS", "DISCOVER_FROM_BLOCK", "LOG_CHUNK", "MAX_FEED_DEVIATION_BPS", "IMD_FEED_MAX_AGE_SECONDS",
  "CROSS_RPC_MAX_BPS", "SPLIT_CHECK_TOLERANCE_BPS", "RECEIPT_POLL_MS",
];
const LISTS = ["VAULTS", "READ_RPC_URLS", "PRIVATE_RPC_URL"];
const STRINGS = ["FACTORY", "V4_QUOTER", "V3_QUOTER", "POOL_MANAGER", "V3_FACTORY", "WETH", "STATE_DIR", "IMD_PRICE_FEED"];

const list = (v) => (Array.isArray(v) ? v : v == null ? [] : String(v).split(",")).map((s) => String(s).trim()).filter(Boolean);

export function applyEnv(base, env = process.env) {
  const cfg = { ...base };
  for (const k of NUMBERS) if (env[k] !== undefined && env[k] !== "") cfg[k] = Number(env[k]);
  for (const k of LISTS) if (env[k] !== undefined && env[k] !== "") cfg[k] = env[k];
  for (const k of STRINGS) if (env[k] !== undefined && env[k] !== "") cfg[k] = env[k];
  for (const k of LISTS) cfg[k] = list(cfg[k]);
  cfg.MAX_IMPACT_BPS ??= 300; // a config.mjs written before the setting existed
  cfg.MAX_REFERENCE_DEVIATION_BPS ??= 300;
  cfg.MAX_FEED_DEVIATION_BPS ??= 300;
  cfg.CROSS_RPC_MAX_BPS ??= 0;
  cfg.SPLIT_CHECK_TOLERANCE_BPS ??= 0;
  cfg.LOG_CHUNK ??= DEFAULT_LOG_CHUNK;
  cfg.IMD_PRICE_FEED = getAddress(cfg.IMD_PRICE_FEED ?? DEFAULT_IMD_PRICE_FEED);
  cfg.CHAINLINK = { ...DEFAULT_CHAINLINK, ...(cfg.CHAINLINK ?? {}) };
  cfg.USD_TOKENS = Object.fromEntries(Object.entries(cfg.USD_TOKENS ?? {}).map(([a, d]) => [getAddress(a), Number(d)]));
  cfg.BTC_TOKENS = Object.fromEntries(Object.entries(cfg.BTC_TOKENS ?? DEFAULT_BTC_TOKENS).map(([a, d]) => [getAddress(a), Number(d)]));
  cfg.VAULTS = cfg.VAULTS.map((a) => getAddress(a));
  for (const k of NUMBERS) {
    if (cfg[k] != null && !Number.isFinite(cfg[k])) throw new Error(`config ${k} is not a number`);
  }
  if (!(Number.isInteger(cfg.LOG_CHUNK) && cfg.LOG_CHUNK >= 1)) throw new Error("config LOG_CHUNK must be a positive integer");
  for (const k of ["HOP_MARGIN_BPS", "SPLIT_MARGIN_BPS", "MAX_GAS_SHARE_BPS", "MAX_IMPACT_BPS", "MAX_REFERENCE_DEVIATION_BPS", "MAX_FEED_DEVIATION_BPS", "CROSS_RPC_MAX_BPS", "SPLIT_CHECK_TOLERANCE_BPS"]) {
    if (!(cfg[k] >= 0 && cfg[k] < 10_000)) throw new Error(`config ${k} must be in [0, 10000)`);
  }
  return cfg;
}

export async function loadConfig(env = process.env) {
  const own = new URL("../config.mjs", import.meta.url);
  const file = existsSync(own) ? own : new URL("../config.example.mjs", import.meta.url);
  const base = (await import(file.href)).default;
  return applyEnv(base, env);
}
