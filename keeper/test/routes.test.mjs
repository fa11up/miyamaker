// Route parsing from the factory's getRoute (and config/1.json), checked as the vault checks it.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { decodeFunctionResult, encodeFunctionResult } from "viem";
import { routesAbi } from "../lib/abi.mjs";
import { parseRoute, reverseRoute, routesFromConfig } from "../lib/routes.mjs";
import { ETH, IMD, ROUTE_TABLE, USDC } from "./fake.mjs";

test("what the factory's getRoute returns (ABI round trip) parses to the same hops", () => {
  const raw = ROUTE_TABLE[USDC];
  const enc = encodeFunctionResult({ abi: routesAbi, functionName: "getRoute", result: raw });
  const dec = decodeFunctionResult({ abi: routesAbi, functionName: "getRoute", data: enc });
  const hops = parseRoute(USDC, dec, IMD);
  assert.equal(hops.length, 2);
  assert.deepEqual(hops[0], { kind: 4, tokenIn: USDC, tokenOut: ETH, fee: 500, tickSpacing: 10 });
  assert.equal(hops[1].tokenOut, IMD);
});

test("tables the vault would refuse are refused", () => {
  const h = (kind, a, b, fee = 500, ts = 10) => ({ kind, tokenIn: a, tokenOut: b, fee, tickSpacing: ts });
  assert.throws(() => parseRoute(USDC, [], IMD), /no route/);
  assert.throws(() => parseRoute(USDC, [h(4, ETH, IMD)], IMD), /starts at/);
  assert.throws(() => parseRoute(USDC, [h(4, USDC, ETH)], IMD), /not IMD/);
  assert.throws(() => parseRoute(USDC, [h(4, USDC, ETH), h(4, USDC, IMD)], IMD), /breaks at hop 1/);
  assert.throws(() => parseRoute(USDC, [h(5, USDC, IMD)], IMD), /neither v3/);
  assert.throws(() => parseRoute(USDC, [h(3, USDC, IMD, 2500, 0)], IMD), /bad v3 fee/);
  assert.throws(() => parseRoute(USDC, [h(4, USDC, IMD, 500, 0)], IMD), /bad v4 hop/);
  assert.throws(() => parseRoute(USDC, Array(5).fill(h(4, USDC, USDC)), IMD), /5 hops/);
});

test("reverse route: IMD back to ETH", () => {
  const r = reverseRoute(ROUTE_TABLE[USDC]);
  assert.equal(r[0].tokenIn, IMD);
  assert.equal(r[0].tokenOut, ETH);
  assert.equal(r[1].tokenOut, USDC);
});

const CONFIG = new URL("../../contracts/script/config/1.json", import.meta.url);
test("config/1.json's route table parses (every token to IMD)", { skip: !existsSync(CONFIG) }, () => {
  const m = routesFromConfig(JSON.parse(readFileSync(CONFIG, "utf8")));
  assert.equal(m.size, 5);
  for (const hops of m.values()) assert.equal(hops.at(-1).tokenOut, IMD);
});
