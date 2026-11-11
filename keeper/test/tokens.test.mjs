// The keeper's token table (lib/tokens.mjs) is the deploy config's allowlist (contracts/script/config/1.json
// `paymentTokens`) plus ETH, and every ERC-20 the vault can receive has what the keeper needs to convert it: a
// reference price (USD_TOKENS / BTC_TOKENS) and a zRouter fallback route, unless it is IMD or INFER (no swap).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { getAddress, zeroAddress } from "viem";
import { KNOWN } from "../lib/tokens.mjs";
import { DEFAULT_FALLBACK_ROUTES } from "../lib/zrouter.mjs";
import example from "../config.example.mjs";

const CONFIG = new URL("../../contracts/script/config/1.json", import.meta.url);

test("lib/tokens.mjs = config/1.json paymentTokens + ETH; each has a reference and a fallback route (IMD, INFER need none)", { skip: !existsSync(CONFIG) }, () => {
  const json = JSON.parse(readFileSync(CONFIG, "utf8"));
  assert.ok(Array.isArray(json.paymentTokens) && json.paymentTokens.length > 0, "config/1.json has no paymentTokens");
  const pay = json.paymentTokens.map((a) => getAddress(a)).sort();
  const mine = Object.keys(KNOWN).map((a) => getAddress(a)).filter((a) => a !== zeroAddress).sort();
  assert.deepEqual(mine, pay);
  const noSwap = new Set([getAddress(json.imd), getAddress(json.alignmentToken)]);
  const refs = new Set([...Object.keys(example.USD_TOKENS), ...Object.keys(example.BTC_TOKENS)].map((a) => getAddress(a)));
  const routes = new Set(Object.keys(DEFAULT_FALLBACK_ROUTES).map((a) => getAddress(a)));
  for (const t of pay.filter((a) => !noSwap.has(a))) {
    assert.ok(refs.has(t), `${KNOWN[t]?.[0] ?? t}: no reference price in config.example.mjs`);
    assert.ok(routes.has(t), `${KNOWN[t]?.[0] ?? t}: no zRouter fallback route`);
  }
  assert.ok(routes.has(zeroAddress), "the ETH leg has a fallback route");
});
