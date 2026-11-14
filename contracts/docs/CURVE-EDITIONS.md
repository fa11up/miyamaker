# Design: bonding-curve editions (mint, burn, trade)

Status: contracts built (2026-11-14), not audited or deployed. Mainnet only. See "As built" below for where the code
differs from the proposal.

## Idea

An ERC-1155 edition (music first, any media after) can be launched as a **curve edition**: the next copy's price rises
with supply along a curve, every copy can be **burned** back to the edition's reserve at any time, and copies trade on
public markets (OpenSea) like any ERC-1155. The pattern is EulerBeats' (read from its verified contracts:
`getPrintPrice`, `getBurnPrice`; Genesis 90% reserve / 8% original holder / 2% project, Enigma 84% burn), without the
generative part.

## Agreed

| | Decision |
|---|---|
| Spread | 10% of the mint price by default: the burn pays back 90% of the top copy's price |
| Spread split | 6% of price to the **master holder**, 3% to the **vault** (becomes INFER/IMD liquidity), 1% to the **protocol** |
| Currency | One per edition, from the payment allowlist (ETH, IMD, INFER, USDC, imdUSD, cbBTC, WBTC); the reserve is held in it |
| Markets | Copies and the master are plain ERC-1155 tokens: listable and tradable anywhere |

## Pieces

- **Copies**: token id per edition, supply `s`. Mint the next copy at `P(s+1)`; burn one at `burnPrice(s) = r * P(s)`,
  with `r = 1 - spread` (0.90 by default).
- **Master**: one extra token per curve edition (supply exactly 1), minted to the artist at creation. Whoever holds it
  earns the master share (6% of every mint price). Transferable, so an edition's income stream can be bought and sold.
  ERC-2981 royalties on secondary sales of the copies point at the current master holder.
- **Reserve**: per edition, in the edition's currency, inside the collection contract. No owner, vault, factory or
  registry function can move it. Only `burn` pays out of it.

## Curves (integer maths, fixed at creation)

Two shapes, chosen at launch, both computed exactly so the same inputs always give the same price:

- **Exponential**: `P(n) = P1 * (1 + g)^(n - 1)`, `g` in basis points per copy (via `rpow` in 1e18 fixed point).
- **Linear**: `P(n) = P1 + k * (n - 1)`.

Limits, checked at creation: `maxSupply` 1 to 10,000; `g` up to 500 bps (5% per copy); the creation reverts if
`P(maxSupply)` overflows or exceeds a cap per currency (e.g. 1,000 ETH-equivalent configured per token in the registry);
spread between 5% and 30%.

## Flows

**Mint** `mint(editionId, qty, maxCost)` (proposal name `mintCurve`):
1. Cost = `sum P(s+1 .. s+qty)`; revert if over `maxCost` (front-running guard).
2. Take payment in the edition's currency (ETH `msg.value` exact; ERC-20 `transferFrom` with a balance-delta check).
3. Per copy: `reserve += r * P(i)`; master share `0.06 * P(i)` credited to the **current master holder** (pull);
   vault share `0.03 * P(i)` sent with `vault.receiveContribution(currency, …, this)`; protocol `0.01 * P(i)` booked for the
   treasury (pull). Rounding dust goes to the reserve, never out of it.
4. Mint `qty` copies; `s += qty`.

**Burn** `burn(editionId, qty, minPayout, minSupply)` (proposal name `burnCurve`):
1. Revert if `s < minSupply` or the payout is under `minPayout` (front-running guard).
2. Payout = `sum r * P(s .. s-qty+1)` (the top copies come off the curve, highest first).
3. `reserve -= payout`; burn `qty` from the caller; `s -= qty`; pay the caller.

**Claims**: master holders call `claimMasterEarnings(currency)` (or `claimMasterEarningsTo`); the protocol cut is pushed to the
treasury at each mint (parked and retried if it refuses); vault fees follow the
vault's own claim modes.

## Solvency invariant

For every edition: `reserve == sum_{i=1..s} r * P(i)` (plus rounding dust, which only ever adds). Each mint adds exactly
`r * P(s+1)` and each burn removes exactly `r * P(s)` for the top copy, so the reserve can always pay every copy back down
to zero. Fuzzed (test/factories/curve) over random mints, burns of up to 50 and master transfers, on both curve
shapes, in ETH and in a 6-decimal token, up to 2,000 copies.

## Alignment rule

The registry's `minAlignmentBps` (10%) applies to what the protocol earns from a sale. For a curve edition that is the
spread, not the price (the reserve is the buyer's money held for the burn). The vault gets 30% of the spread, above the
minimum. The protocol fee is 1% of price, as for other sales.

## Markets

- The burn price is a floor: nobody sells below what the reserve pays, and anyone can buy under it and burn at a
  profit, which pulls market prices back up.
- The next mint price is a soft ceiling: above it, buyers mint instead.
- Market prices settle between the two; traders arbitrage both sides. A mint-then-burn round trip loses the spread, so
  flash loops never profit.

## Contracts

- (Proposal; built instead as separate contracts, see "As built".) `ERC1155Instance`: a new edition type `CURVE` beside `OPEN`, `LIMITED_FIXED` and `LIMITED_DYNAMIC`, with the per-edition
  reserve, master token id, curve parameters, `mintCurve`, `burnCurve`, `claimMasterEarnings`, ERC-2981 to the master holder.
- A pure `CurveMath` library (both shapes, sums, limits) so pricing is testable on its own.
- `ERC1155Factory`: accepts curve parameters at `addEdition`; validates limits against the registry.
- Registry: price cap per currency for curve validation.

## App

- **Launch**: "Curve edition" option: currency, shape, start price, growth, max supply, spread (default 10%), with a
  live chart of mint and burn prices and the 6/3/1 split.
- **Edition page**: chart with the current supply marked, Mint (next price, quantity, max cost) and Burn (payout,
  minimum), the master holder and their earnings, OpenSea links for copies and the master.
- **Manage**: master earnings per currency with Claim; reserve shown read-only.

## Test plan

- `CurveMath`: exact prices and sums, both shapes, limits, overflow refusals.
- Edition: mint and burn per currency decimals; slippage guards; master transfer mid-way (earnings go to whoever held
  it at each mint); royalties to the master holder; burning to zero empties the reserve exactly.
- Invariant fuzz: the solvency invariant under random mints, burns, transfers, master sales.
- Fork tests with the real vault routes for the 3% share; `/audit-suite`; independent review.

## Risks

- **Regulatory**: redeemable tokens sold for speculation can raise securities questions in some places; worth a legal
  read before launch.
- **Exponential growth**: limited by the caps above; the chart makes the late prices visible to buyers.
- **Thin currencies**: an edition priced in a thin token is still solvent (the reserve is in that token), but its
  market may be illiquid.
- **Front-running**: covered by `maxCost`, `minPayout` and `minSupply`.

## As built (2026-11-14)

`src/factories/curve/`: `CurveMath`, `CurveEdition` (the collection), `CurveEditionFactory`. Tests:
`test/factories/curve/CurveEdition.t.sol` (maths, limits, splits, guards, master transfer, royalties, ERC-20, a
solvency fuzz) and `test/fork/CurveEditionFork.t.sol` (live registry, vault, treasury and IMD).

Where it differs from the proposal, and why:

- **Separate contracts, not a fourth type in `ERC1155Instance`.** That contract is 19.9 KB of the 24 KB limit; the
  reserve, burn, master and claims do not fit. Existing 1155 collections and their factory are untouched. The registry
  owner (the Safe) lists the new factory once with `registry.setFactory(factory, true)`.
- **The price cap per currency lives in the factory** (`priceCap`, set by its owner, the Safe), not the registry, which
  is deployed and has no such field. A currency without a cap can't be used; caps apply to editions added after a change.
- **Token ids:** copies of edition `e` are id `e << 1`, its master `(e << 1) | 1`.
- **Split:** protocol = `protocolFeeBps` of each copy's price (snapshotted at launch, 1% today); vault = 30% of the
  spread; master = the rest of the spread. An edition is refused unless the master keeps a share
  (`protocol + 0.3 x spread < spread`). At a 10% spread: 90 / 6 / 3 / 1, as agreed.
- **Vault share under the vault's minimum is parked**, not lost: the shared `PaymentLib` carries it with the next mint
  or `flushPendingVaultCut` (anyone, optional top-up), as for the other collections. Contributions are booked to the
  collection; its owner claims the vault fees (`claimVaultFees`).
- **At most 50 copies per mint or burn** (about 300k gas at the top of a curve). `royaltyBps` is chosen per edition, at
  most 10%, paid on copies (not the master) by marketplaces that honour ERC-2981 to the current master holder.
- **ETH mints** send up to `maxCost` and get the difference back, so a mint or burn landing first doesn't fail them.
  `maxCost` must stay close to a fresh quote: a loose one lets someone mint just ahead and burn just after (the app
  always sends the quote plus a small tolerance).
- **A currency the registry drops takes no new mints**; burns and claims keep working.
- **Effective limits:** an exponential curve whose top copy overflows is refused as invalid (at 5% growth that is around
  1,900 copies, whatever the start price). Price caps are at most 2^128.
- **Master earnings stay with the address that held the master at each mint.** A holder that can't call
  `claimMasterEarnings` (an escrow, a vault) can't collect them; `claimMasterEarningsTo` pays a holder's earnings
  elsewhere.
- **Only the vault may send ETH directly** to a collection (its fee payouts); anything else would be stuck.
- **Exponential prices** come from solady `rpow` in 1e18 fixed point, which rounds at each step (a few wei from the
  exact power). A copy's price is always computed the same way, so its mint and its burn always agree.
