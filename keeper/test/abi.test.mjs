// The keeper's own ABI fragments match the contracts' ABIs (when contracts/abi is present, as in this repo).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { toFunctionSelector, toEventSelector, toFunctionSignature, toEventSignature } from "viem";
import { registryAbi, routesAbi, vaultAbi } from "../lib/abi.mjs";

const dir = new URL("../../contracts/abi/", import.meta.url);
const load = (n) => JSON.parse(readFileSync(new URL(`${n}.json`, dir), "utf8"));
const sigs = (abi) =>
  new Set(abi.filter((x) => ["function", "event", "error"].includes(x.type)).map((x) => `${x.type}:${x.type === "event" ? toEventSelector(toEventSignature(x)) : toFunctionSelector(toFunctionSignature(x))}`));

for (const [mine, theirs] of [[vaultAbi, "UniAlignmentVault"], [routesAbi, "UniAlignmentVaultFactory"], [registryAbi, "MiyaRegistry"]]) {
  test(`${theirs}: every fragment the keeper uses exists in contracts/abi`, { skip: !existsSync(new URL(`${theirs}.json`, dir)) }, () => {
    const have = sigs(load(theirs));
    for (const x of mine) {
      const id = `${x.type}:${x.type === "event" ? toEventSelector(toEventSignature(x)) : toFunctionSelector(toFunctionSignature(x))}`;
      assert.ok(have.has(id), `${theirs} has no ${x.type} ${x.name}`);
    }
  });
}
