// The route table: what the factory's getRoute(token) returns, normalized and checked the way the vault checks it
// (VaultSwaps.route) so a table the vault would refuse is refused here first, with a clearer message. A route ends in
// IMD (it swaps on its own) or, for any token but ETH, in ETH: that ETH joins the batch's one ETH -> IMD swap along the
// ETH route.
import { getAddress, zeroAddress } from "viem";
import { routesAbi } from "./abi.mjs";

export const ETH = zeroAddress;
export const HOP_V3 = 3;
export const HOP_V4 = 4;
export const MAX_ROUTE_HOPS = 4;

/** One hop from the ABI tuple (viem returns an object with names) or a config/1.json entry. */
export function parseHop(h) {
  const hop = {
    kind: Number(h.kind),
    tokenIn: getAddress(h.tokenIn),
    tokenOut: getAddress(h.tokenOut),
    fee: Number(h.fee),
    tickSpacing: Number(h.tickSpacing),
  };
  if (hop.kind !== HOP_V3 && hop.kind !== HOP_V4) throw new Error(`hop kind ${hop.kind} is neither v3 (3) nor v4 (4)`);
  return hop;
}

/** The hops for `token`, checked to chain from it to IMD (or ETH). Throws on a table the vault would revert on. */
export function parseRoute(token, rawHops, imd) {
  token = getAddress(token);
  const hops = rawHops.map(parseHop);
  if (hops.length === 0) throw new Error(`no route for ${token}`);
  if (hops.length > MAX_ROUTE_HOPS) throw new Error(`route for ${token} has ${hops.length} hops (max ${MAX_ROUTE_HOPS})`);
  if (hops[0].tokenIn !== token) throw new Error(`route for ${token} starts at ${hops[0].tokenIn}`);
  const end = hops.at(-1).tokenOut;
  if (end !== getAddress(imd) && (end !== ETH || token === ETH)) {
    throw new Error(`route for ${token} ends at ${end}, not IMD${token === ETH ? "" : " or ETH"}`);
  }
  for (let i = 1; i < hops.length; i++) {
    if (hops[i].tokenIn !== hops[i - 1].tokenOut) throw new Error(`route for ${token} breaks at hop ${i}`);
  }
  for (const h of hops) {
    if (h.tokenIn === h.tokenOut) throw new Error(`route for ${token}: a hop swaps a token for itself`);
    if (h.kind === HOP_V4 && (h.fee >= 1_000_000 || h.tickSpacing <= 0)) throw new Error(`route for ${token}: bad v4 hop`);
    if (h.kind === HOP_V3 && ![100, 500, 3000, 10000].includes(h.fee)) throw new Error(`route for ${token}: bad v3 fee ${h.fee}`);
  }
  return hops;
}

/** Does this route end in ETH (and so join the batch's one ETH -> IMD swap)? */
export const endsInEth = (hops) => hops.at(-1).tokenOut === ETH;

/** The reverse of a route (IMD back to its token), as the vault runs the ETH route for ETH claims. */
export function reverseRoute(hops) {
  return [...hops].reverse().map((h) => ({ ...h, tokenIn: h.tokenOut, tokenOut: h.tokenIn }));
}

/** Read and check the route of every token that needs one (not IMD, not INFER), and the ETH route. */
export async function readRoutes(client, routesAddr, tokens, { imd, infer, blockNumber }) {
  const out = new Map();
  for (const t of [...new Set([...tokens.map((x) => getAddress(x)), ETH])]) {
    const token = getAddress(t);
    if (token === getAddress(imd) || token === getAddress(infer)) continue;
    const raw = await client.readContract({ address: routesAddr, abi: routesAbi, functionName: "getRoute", args: [token], blockNumber });
    if (raw.length === 0 && token === ETH && !tokens.some((x) => getAddress(x) === ETH)) continue; // checked when needed
    out.set(token, parseRoute(token, raw, imd));
  }
  return out;
}

/** config/1.json's `routes` array -> Map(token -> hops), for the smoke script (no factory deployed yet). */
export function routesFromConfig(json) {
  const m = new Map();
  for (const r of json.routes) m.set(getAddress(r.token), parseRoute(r.token, r.hops, json.imd));
  return m;
}
