// One swap the vault will run (a token -> ETH or IMD, or the batch's ETH -> IMD leg): sourced from 0x (primary) and
// the keeper's own zRouter route (fallback), checked, and the better of the two kept as the SwapCall.
//
// 0x is used unless it has no route, errors, times out, fails a check (lib/zeroex.mjs quoteProblem), its target is not
// allowlisted by the vault factory, or it quotes more than ZEROEX_MAX_WORSE_BPS under zRouter (default 0: the better
// of the two). zRouter is used only when its pool absorbs the amount (price impact known and <= MAX_IMPACT_BPS).
// minOut: 0x = the stricter of its minBuyAmount and the keeper's own margin under its buyAmount; zRouter = the margin
// under its quote (also the amountLimit in its calldata). Margin = HOP_MARGIN_BPS, compounded (1 + `offset`) times
// for the ETH leg when routes that feed it ran first (their ETH may come in under its quote).
import { applyMargin, quoteRoute, routeImpactBps } from "./quote.mjs";
import { zRouterCall } from "./zrouter.mjs";
import { ALLOWANCE_HOLDER, quoteProblem } from "./zeroex.mjs";

const BPS = 10_000n;
const short = (e) => {
  const raw = e?.cause?.raw ?? e?.raw ?? e?.cause?.data ?? "";
  if (typeof raw === "string" && raw.includes("7a5ed734")) return "NotEnoughLiquidity";
  return (e?.shortMessage ?? e?.message ?? String(e)).split("\n")[0].slice(0, 140);
};

/** A margin compounded `times` times: amount * (1 - m)^times. */
export function compoundMargin(amount, marginBps, times = 1) {
  let out = amount;
  for (let i = 0; i < times; i++) out = applyMargin(out, marginBps);
  return out;
}

/**
 * Pick between the 0x and zRouter candidates ({ expectedOut } or { err }). Returns the chosen one with `source`, plus
 * why, or { err } when neither works. Pure.
 */
export function pickSwap(zx, zr, maxWorseBps = 0) {
  const zxOk = zx && !zx.err;
  const zrOk = zr && !zr.err;
  if (!zxOk && !zrOk) return { err: `no usable swap: 0x ${zx?.err ?? "not asked"}; zRouter ${zr?.err ?? "no fallback route"}` };
  if (zxOk && !zrOk) return { ...zx, source: "0x", why: zr ? `zRouter unusable (${zr.err})` : "no zRouter fallback route" };
  if (!zxOk) return { ...zr, source: "zRouter", why: `0x unusable (${zx?.err ?? "not asked"})` };
  // Both: 0x unless it is more than maxWorseBps under zRouter.
  if (zx.expectedOut * BPS < zr.expectedOut * (BPS - BigInt(maxWorseBps))) {
    const bps = Number(((zr.expectedOut - zx.expectedOut) * BPS) / zr.expectedOut);
    return { ...zr, source: "zRouter", why: `0x quotes ${bps} bps under zRouter (> ZEROEX_MAX_WORSE_BPS ${maxWorseBps})` };
  }
  return { ...zx, source: "0x", why: zx.expectedOut >= zr.expectedOut ? "0x at or above zRouter" : "0x within ZEROEX_MAX_WORSE_BPS of zRouter" };
}

/**
 * Both candidates for one swap at `blockNumber`, and the pick. `hop` = the zRouter fallback hop (or null); `zx` = the
 * 0x client (lib/zeroex.mjs); `settlers` = 0x's current Settlers; `targets` = { zeroEx, zRouter } allowed by the
 * factory's isSwapTarget (both true when not read); `offset` = extra margin compoundings (the ETH leg).
 */
export async function sourceSwap(client, cfg, { zx, vault, tokenIn, tokenOut, amountIn, hop, blockNumber, deadline, settlers, targets = { zeroEx: true, zRouter: true }, offset = 0, only = null }) {
  const margin = cfg.HOP_MARGIN_BPS;
  const times = 1 + offset;

  let zr = null;
  if (hop && only !== "0x") {
    if (!targets.zRouter) zr = { err: "zRouter is not an allowed swap target (factory.isSwapTarget)" };
    else {
      try {
        const out = (await quoteRoute(client, cfg, [hop], amountIn, blockNumber)).at(-1);
        if (out === 0n) zr = { err: "quotes 0" };
        else {
          const impactBps = await routeImpactBps(client, cfg, [hop], amountIn, out, blockNumber);
          if (impactBps == null) zr = { err: "price impact unknown (the 1/1000 probe is 0 or quotes 0)", expectedOut: out };
          else if (impactBps > cfg.MAX_IMPACT_BPS) zr = { err: `price impact ${impactBps} bps > MAX_IMPACT_BPS ${cfg.MAX_IMPACT_BPS}`, expectedOut: out, impactBps };
          else {
            const minOut = compoundMargin(out, margin, times);
            if (minOut === 0n) zr = { err: "minimum out rounds to 0" };
            else zr = { expectedOut: out, minOut, impactBps, ...zRouterCall(hop, { to: vault, amountIn, minOut, deadline }), pool: `${hop.kind === 4 ? "v4" : "v3"} ${hop.fee}${hop.kind === 4 ? `/${hop.tickSpacing}` : ""}` };
          }
        }
      } catch (e) {
        zr = { err: `quote failed: ${short(e)}` };
      }
    }
  }

  let zxC = null;
  if (only !== "zRouter") {
    if (!zx?.enabled) zxC = { err: zx?.why ?? "0x not configured" };
    else if (!targets.zeroEx) zxC = { err: "0x AllowanceHolder is not an allowed swap target (factory.isSwapTarget)" };
    else {
      try {
        const slippageBps = Math.min(10_000, margin * times);
        const { quote, at } = await zx.quote({ sellToken: tokenIn, buyToken: tokenOut, sellAmount: amountIn, taker: vault, slippageBps });
        const problem = quoteProblem(quote, { sellToken: tokenIn, buyToken: tokenOut, sellAmount: amountIn, taker: vault }, settlers);
        if (problem) zxC = { err: problem, refused: true };
        else {
          const expectedOut = BigInt(quote.buyAmount);
          const own = compoundMargin(expectedOut, margin, times);
          const minBuy = BigInt(quote.minBuyAmount);
          const minOut = own > minBuy ? own : minBuy;
          zxC = { expectedOut, minOut, minBuyAmount: minBuy, target: ALLOWANCE_HOLDER, data: quote.transaction.data, value: BigInt(quote.transaction.value || "0"), quotedAt: at };
        }
      } catch (e) {
        zxC = { err: e.noRoute ? `no route (${short(e)})` : e.timeout ? short(e) : `error: ${short(e)}` };
      }
    }
  }

  const chosen = pickSwap(zxC, zr, cfg.ZEROEX_MAX_WORSE_BPS ?? 0);
  return { chosen, zx: zxC, zr };
}
