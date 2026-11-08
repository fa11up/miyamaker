// Config: config.mjs if present (gitignored), else config.example.mjs; then the environment, which wins.
import { existsSync } from "node:fs";
import { getAddress } from "viem";

const NUMBERS = [
  "CHAIN_ID", "MIN_BATCH_ETH", "MAX_GAS_SHARE_BPS", "MAX_GAS_GWEI", "HOP_MARGIN_BPS", "SPLIT_MARGIN_BPS",
  "DEADLINE_SECONDS", "MAX_REQUOTES", "MAX_IMPACT_BPS", "MAX_REFERENCE_DEVIATION_BPS", "MIN_ETH", "MAX_ETH_PER_DAY", "TIP_GWEI", "GAS_MARGIN_BPS", "TX_WAIT_SECONDS",
  "INTERVAL_SECONDS", "DISCOVER_FROM_BLOCK",
];
const LISTS = ["VAULTS", "READ_RPC_URLS", "PRIVATE_RPC_URL"];
const STRINGS = ["FACTORY", "V4_QUOTER", "V3_QUOTER", "POOL_MANAGER", "V3_FACTORY", "WETH", "STATE_DIR"];

const list = (v) => (Array.isArray(v) ? v : v == null ? [] : String(v).split(",")).map((s) => String(s).trim()).filter(Boolean);

export function applyEnv(base, env = process.env) {
  const cfg = { ...base };
  for (const k of NUMBERS) if (env[k] !== undefined && env[k] !== "") cfg[k] = Number(env[k]);
  for (const k of LISTS) if (env[k] !== undefined && env[k] !== "") cfg[k] = env[k];
  for (const k of STRINGS) if (env[k] !== undefined && env[k] !== "") cfg[k] = env[k];
  for (const k of LISTS) cfg[k] = list(cfg[k]);
  cfg.MAX_IMPACT_BPS ??= 300; // a config.mjs written before the setting existed
  cfg.MAX_REFERENCE_DEVIATION_BPS ??= 300;
  cfg.USD_TOKENS = Object.fromEntries(Object.entries(cfg.USD_TOKENS ?? {}).map(([a, d]) => [getAddress(a), Number(d)]));
  cfg.VAULTS = cfg.VAULTS.map((a) => getAddress(a));
  for (const k of NUMBERS) {
    if (cfg[k] != null && !Number.isFinite(cfg[k])) throw new Error(`config ${k} is not a number`);
  }
  for (const k of ["HOP_MARGIN_BPS", "SPLIT_MARGIN_BPS", "MAX_GAS_SHARE_BPS", "MAX_IMPACT_BPS", "MAX_REFERENCE_DEVIATION_BPS"]) {
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
