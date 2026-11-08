# Design: aligning to the INFER/IMD pool

Status: proposal for review (2026-11-08). Nothing here is built or deployed.

## Goal

Sales stay in ETH (buyers can pay in any token: the app swaps it to ETH first). The vault share of every sale ends up
as permanent liquidity in the existing INFER/IMD pool, instead of a new INFER/ETH pool that would have to be seeded.
Collection owners keep earning the pool's fees, and choose how to take them.

## What stays the same

- **Collections take ETH.** Drops, music editions and auctions keep their payment code (`msg.value`, refunds, bids,
  deposits). Only how they claim vault fees changes (see Claims).
- **The vault share per sale**: at least `minAlignmentBps` (10%), set by the artist at launch, up to 100%.
- **Contributions, batches, shares**: `receiveContribution` credits the collection with ETH; ETH waits until a keeper
  converts a batch; shares are issued per batch in proportion to ETH (the batch accounting in `_closeBatch` is kept).
- **Liquidity is permanent.** No function removes it, as today.
- **Protocol yield cut**: 1% of everything the position earns (`protocolYieldCutBps`), paid to the registry treasury.
- **Keeper only** for conversions (`registry.conversionKeeper`), floors from a live quote, private mempool.

## The pools (read from chain, 2026-11-08, block ~26,367,950)

| Pool | Key | Id | Liquidity | Notes |
|---|---|---|---|---|
| IMD/ETH | native ETH (c0) / IMD `0xD34a…63B7` (c1), fee 10000 (1%), spacing 200, no hook | `0xb07d…bfb3` | 9.73e21 | Same fee and spacing as the vault's zRouter route today |
| INFER/IMD | INFER `0x53d0…7921` (c0) / IMD (c1), fee 12500 (1.25%), spacing 60, hook `0x784F…6000` | `0x1f03…1e95` | 7.62e23 | Hook is the verified `PoolInitializationGuard`: only `beforeInitialize`; swaps, fees and liquidity are unaffected |

IMD is the verified `BridgedFP` (18 decimals): no transfer override, no fee, no pause; the owner can only rename it.

## Conversion (keeper, per batch)

`convertAndAddLiquidity(minImdOut, minInferOut, deadline)`:

1. Take the conversion reward from the batch ETH, as today (0.0012 ETH, capped at 1% of the batch).
2. **ETH -> IMD** through the IMD/ETH pool with zRouter `swapV4` (hookless, fee 10000/200: zRouter can route it).
   `minImdOut` from the keeper.
3. **About half the IMD -> INFER** through the INFER/IMD pool. zRouter cannot route a hooked pool (`swapV4` takes no
   hook address), so the vault swaps itself: `PoolManager.unlock` -> `swap` in `unlockCallback` (the vault already
   unlocks for liquidity adds). `minInferOut` from the keeper. The split is the balanced-swap calculation used today
   (`_balancedSwap`), applied to IMD against the INFER/IMD reserves, so the add leaves little unpaired.
4. **Add INFER + IMD liquidity**, full range for spacing 60, to the vault's single position in the INFER/IMD pool.
   Whatever is left unpaired stays in the vault and is folded into the next batch, as today.
5. Close the batch: shares issued in proportion to the batch ETH, at the batch's accumulator values.

Floors: neither pool has a manipulation-resistant reference the vault can read on chain (v4 has no built-in TWAP), so
the keeper's quote-based floors on both hops are the protection, as documented today. The vault also refuses a hop whose
execution price moves the pool more than `maxPriceDeviationBps` (500) from its price at the start of the call.

## Fees the position earns

The position earns INFER and IMD (not ETH). Accounting moves from one ETH accumulator to two token accumulators:
`accInferPerShare`, `accImdPerShare`, with per-benefactor checkpoints, the same pattern as today's `accFeePerShare`.
The protocol cut is booked per token and withdrawn per token (`withdrawProtocolFees(token)`). Any ETH dust (rejected
rewards, stray transfers) keeps today's ETH accumulator, so nothing is lost.

## Claims: three choices for each collection owner

The collection's `claimVaultFees` gains a mode. Each claim settles the collection's share of both tokens first.

1. **Take as tokens** (default): INFER and IMD are sent to the collection owner. No swap, no slippage, no keeper.
2. **Take as ETH**: the vault swaps the collection's INFER -> IMD (INFER/IMD pool) and IMD -> ETH (IMD/ETH pool)
   in the claim, with `minEthOut` from the owner's live quote (the app supplies it), and pays the owner ETH.
3. **Reinvest**: the collection's INFER and IMD are added to the position, and the collection is issued shares for
   them at the current share price. More future fees; nothing is paid out.

`claimFeesAsDelegate` and `delegateBenefactor` keep working; the mode applies to the delegate's claim the same way.

## Contract changes

| Contract | Change |
|---|---|
| `UniAlignmentVault` | Two-hop conversion; non-ETH position (INFER/IMD, hooked pool key); vault-side swap in `unlockCallback`; two token fee accumulators; three claim modes; per-token protocol cut. A new version: clones from the old factory are unaffected (none are deployed). |
| `UniAlignmentVaultFactory` | Takes the alignment pool key (both currencies, fee, spacing, hooks) and the ETH route pool, instead of one fee tier for both. |
| `IAlignmentVault` | `claimFees(mode, minEthOut)` returning amounts per token; views for claimable INFER/IMD. |
| `ERC721DropInstance`, `ERC721AuctionInstance`, `ERC1155Instance` | `claimVaultFees(mode, minEthOut)` forwarding tokens or ETH to `owner()`. |
| `UniswapVaultPriceValidator` | Not used for the INFER/IMD conversion (no on-chain reference); kept for other vaults or removed. |
| `DeployMiyamints.s.sol`, `config/1.json` | Pool keys for both pools; the INFER/ETH precondition goes; a depth check on INFER/IMD (`minPoolDepth`) instead of `minPoolEth`. |

Robinhood (4663): there is no INFER or confirmed IMD there. Either keep today's ETH-paired vault for that chain with a
real target, or don't deploy there yet. Decision needed.

## Keeper (new service, next to imd-keeper)

- Watches each vault's `totalPendingETH`; converts when a batch is worth the gas (configurable minimum).
- Quotes both hops with the v4 Quoter (ETH -> IMD, then IMD -> INFER for the computed split), applies a slippage
  margin, submits `convertAndAddLiquidity` through a private RPC (as imd-keeper does with `VAULT_RPC_URL`).
- Same guard rails as imd-keeper: kill switch, gas ceiling, ETH floor, simulate first, daily spend ledger, and the
  unknown-outcome handling (hash kept, nonce recorded, no blind resend).
- Also runs `convertFeeTokens` only if the ETH claim mode needs batching (it doesn't in this design).

## App changes

- **Pay with any token**: at mint and bid, an option to pay from another token; the app swaps it to ETH first (0x
  route already in Trade), in one signature where the wallet can batch.
- **Manage**: the three claim choices, claimable INFER and IMD, and the ETH quote for "Take as ETH".
- **Copy**: where the vault share goes ("becomes permanent INFER/IMD liquidity"), that only the vault share does, and
  that artists can raise it at launch.

## Test plan

- Unit: conversion maths (balanced split for token/token), accumulators for two tokens, each claim mode, reinvest
  share pricing, protocol cut per token, dust paths.
- Invariants: the vault never owes more INFER, IMD or ETH than it holds; shares never decrease; fees per share never
  decrease.
- Fork tests against the real IMD/ETH and INFER/IMD pools: a batch converts and adds; floors refuse a bad quote; each
  claim mode pays the right amounts; reinvest grows the position.
- The audit suite on the result (`/audit-suite contracts`), then an independent review before mainnet.

## Risks and trade-offs

- **IMD exposure**: the vault holds an IMD leg as well as INFER.
- **Two hops cost more**: 1% (IMD/ETH) + 1.25% (INFER/IMD) on the swapped part of each batch.
- **Pool depth**: conversions are limited by INFER/IMD and IMD/ETH depth; the keeper should size batches to keep
  slippage small.
- **"Take as ETH" claims** swap in the claim transaction on a public mempool; the floor protects the owner, and the app
  can route the claim through a private RPC.

## Open decisions

1. Default claim mode: tokens (proposed), ETH, or reinvest.
2. Robinhood: ETH-paired vault with which target, or no deployment yet.
3. Pay-with-any-token in the first release, or after.
4. Minimum batch size for the keeper (gas vs. how long ETH waits).
