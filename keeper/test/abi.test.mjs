// The keeper's own ABI fragments match the contracts' ABIs (when contracts/abi is present, as in this repo): every
// function, event and error by name and input types, and also each function's output types, every struct's field
// names (viem keys structs by name: ConvertParams / SwapCall fields in the wrong order or renamed would encode the
// wrong call), event `indexed` flags, and state mutability.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { factoryAbi, registryAbi, vaultAbi } from "../lib/abi.mjs";

const dir = new URL("../../contracts/abi/", import.meta.url);
const load = (n) => JSON.parse(readFileSync(new URL(`${n}.json`, dir), "utf8"));

/** Canonical type with tuples expanded: `(address,address,bytes,uint256)[]`. */
const typeOf = (p) => (p.type.startsWith("tuple") ? `(${(p.components ?? []).map(typeOf).join(",")})${p.type.slice(5)}` : p.type);
const types = (ps = []) => ps.map(typeOf).join(",");
const sig = (x) => `${x.name}(${types(x.inputs)})`;

/** Struct field names, recursively: `p.swaps.target`, ... Top-level argument names are positional and not compared. */
function fieldNames(ps = [], at = "", top = true) {
  const out = [];
  ps.forEach((p, i) => {
    const where = `${at}${top ? `#${i}` : p.name}`;
    if (!top) out.push(where);
    if (p.components) out.push(...fieldNames(p.components, `${where}.`, false));
  });
  return out;
}

/** Every mismatch between one keeper fragment and the contract's ABI, as readable lines. */
export function drift(mine, theirs) {
  const out = [];
  for (const x of mine) {
    const same = theirs.filter((c) => c.type === x.type && c.name === x.name);
    const match = same.find((c) => sig(c) === sig(x));
    if (!match) {
      out.push(`${x.type} ${sig(x)}: not on the contract (it has ${same.map(sig).join(" | ") || "none"})`);
      continue;
    }
    const a = fieldNames(x.inputs).join(",");
    const b = fieldNames(match.inputs).join(",");
    if (a !== b) out.push(`${x.type} ${sig(x)}: struct fields ${a} vs the contract's ${b}`);
    if (x.type === "function") {
      if (types(x.outputs) !== types(match.outputs)) out.push(`function ${sig(x)}: returns (${types(x.outputs)}), contract returns (${types(match.outputs)})`);
      const oa = fieldNames(x.outputs).join(",");
      const ob = fieldNames(match.outputs).join(",");
      if (oa !== ob) out.push(`function ${sig(x)}: output struct fields ${oa} vs the contract's ${ob}`);
      const view = (m) => m === "view" || m === "pure";
      const ok = x.stateMutability === match.stateMutability || (view(x.stateMutability) && view(match.stateMutability));
      if (!ok) out.push(`function ${sig(x)}: keeper says ${x.stateMutability}, contract is ${match.stateMutability}`);
    }
    if (x.type === "event") {
      const ia = (x.inputs ?? []).map((p) => Boolean(p.indexed)).join(",");
      const ib = (match.inputs ?? []).map((p) => Boolean(p.indexed)).join(",");
      if (ia !== ib) out.push(`event ${sig(x)}: indexed ${ia} vs the contract's ${ib}`);
    }
  }
  return out;
}

for (const [mine, theirs] of [[vaultAbi, "UniAlignmentVault"], [factoryAbi, "UniAlignmentVaultFactory"], [registryAbi, "MiyaRegistry"]]) {
  test(`${theirs}: every fragment the keeper uses matches contracts/abi (types, outputs, struct fields)`, { skip: !existsSync(new URL(`${theirs}.json`, dir)) }, () => {
    assert.deepEqual(drift(mine, load(theirs)), []);
  });
}

test("the drift check catches swapped struct fields and a wrong output type", () => {
  const fn = (inputs, outputs = []) => [{ type: "function", name: "f", stateMutability: "nonpayable", inputs, outputs }];
  const call = (names) => [{ name: "p", type: "tuple", components: names.map((n) => ({ name: n, type: "uint256" })) }];
  assert.deepEqual(drift(fn(call(["a", "b"])), fn(call(["a", "b"]))), []);
  assert.match(drift(fn(call(["b", "a"])), fn(call(["a", "b"])))[0], /struct fields #0.b,#0.a vs the contract's #0.a,#0.b/);
  assert.match(drift(fn([], [{ type: "uint128" }]), fn([], [{ type: "uint256" }]))[0], /returns \(uint128\), contract returns \(uint256\)/);
});
