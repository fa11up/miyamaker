// The keeper key: KEEPER_PRIVATE_KEY (0x-hex) or KEEPER_KEY_FILE (a file holding it, e.g. mode 600 outside the repo).
// Only the address is ever printed.
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";

export function keeperAccount(env = process.env) {
  let key = env.KEEPER_PRIVATE_KEY;
  if (!key && env.KEEPER_KEY_FILE) key = readFileSync(env.KEEPER_KEY_FILE, "utf8").trim();
  if (!key) return null;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("keeper key is not a 0x-prefixed 32-byte hex string");
  return privateKeyToAccount(key);
}
