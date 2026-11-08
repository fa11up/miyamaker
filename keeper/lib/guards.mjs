// The guard rails every send passes (as in imd-keeper/lib/tx.mjs): kill switch, gas ceiling, ETH floor, daily spend.
import * as nodeFs from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { formatEther, formatGwei, parseEther, parseGwei } from "viem";

export const stateDir = (cfg) => resolve(new URL("..", import.meta.url).pathname, cfg.STATE_DIR ?? "./state");

/**
 * Durable, atomic write: the temp file is written and fsynced, renamed over the target, then the directory is fsynced
 * so the rename itself survives a power cut. A crash at any point leaves either the old record or the new one, whole.
 * Files are created mode 600. `fs` is injectable for tests.
 */
export function writeJson(file, obj, fs = nodeFs) {
  const dir = dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  const dfd = fs.openSync(dir, "r");
  try {
    fs.fsyncSync(dfd);
  } catch (e) {
    // Some platforms refuse fsync on a directory handle (EINVAL/EISDIR/EPERM); the rename is still atomic there.
    if (!["EINVAL", "EISDIR", "EPERM", "ENOTSUP", "EBADF"].includes(e.code)) throw e;
  } finally {
    fs.closeSync(dfd);
  }
}
export const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);

/** KEEPER_STOP=1 in the environment, or a file named STOP in the state dir, stops every send (reads go on). */
export function killSwitch(cfg, env = process.env) {
  if (env.KEEPER_STOP && env.KEEPER_STOP !== "0") return "kill switch: KEEPER_STOP is set";
  if (existsSync(join(stateDir(cfg), "STOP"))) return "kill switch: state/STOP exists";
  return null;
}

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/**
 * Gas spent per UTC day, keyed by tx hash so recording is idempotent: a tx is booked at its worst-case cost when
 * sent (it may yet land) and re-booked at its actual cost once its receipt is read.
 */
export function ledger(cfg) {
  const file = join(stateDir(cfg), "spend.json");
  const load = (now) => {
    const s = readJson(file);
    return s && s.day === today(now) ? s : { day: today(now), txs: {} };
  };
  return {
    spentToday(now = Date.now()) {
      return Object.values(load(now).txs).reduce((a, w) => a + BigInt(w), 0n);
    },
    book(hash, wei, now = Date.now()) {
      const s = load(now);
      s.txs[hash] = wei.toString();
      writeJson(file, s);
    },
  };
}

/** Everything that must hold before a send; returns a reason to skip, or null. */
export function preSendCheck({ cfg, balance, gasLimit, maxFeePerGas, gasPrice, spentToday }, env = process.env) {
  const stop = killSwitch(cfg, env);
  if (stop) return stop;
  if (gasPrice > parseGwei(String(cfg.MAX_GAS_GWEI))) return `gas ${formatGwei(gasPrice)} gwei above MAX_GAS_GWEI ${cfg.MAX_GAS_GWEI}`;
  const worst = gasLimit * maxFeePerGas;
  if (balance < worst + parseEther(String(cfg.MIN_ETH))) {
    return `keeper holds ${formatEther(balance)} ETH: below MIN_ETH ${cfg.MIN_ETH} after a worst-case ${formatEther(worst)} ETH tx; top it up`;
  }
  if (spentToday + worst > parseEther(String(cfg.MAX_ETH_PER_DAY))) {
    return `spent ${formatEther(spentToday)} ETH today; another ${formatEther(worst)} would pass MAX_ETH_PER_DAY ${cfg.MAX_ETH_PER_DAY}`;
  }
  return null;
}
