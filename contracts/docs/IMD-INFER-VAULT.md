# Design: multi-token sales, aligned to the INFER/IMD pool

Status: agreed decisions, ready to build (2026-11-08). Nothing here is built or deployed. Mainnet (chain 1) only.

## Decisions

| | Decision |
|---|---|
| Payment tokens | ETH, IMD, INFER, USDC, imdUSD, cbBTC, WBTC |
| Prices | The artist sets a price per token they accept (no exchange rates in the contracts) |
| Artist revenue | Collected exactly as paid, per token. No conversions |
| Protocol fee | Taken in the token paid (1%), collected per token by the treasury |
| Vault share | Taken in the token paid, sent to the vault as is; the vault turns everything into INFER/IMD liquidity |
| Auctions | One currency per auction, chosen by the artist or curator; bids, refunds and the deposit in that currency |
| Vault fee claims | Default: take as tokens (INFER + IMD). Also: take as ETH, or reinvest |
| Chains | Mainnet only for now |
| Keeper batch | Minimum 0.1 ETH of value, adjusted for gas cost |

## Tokens (mainnet, read from chain 2026-11-08)

| Token | Address | Decimals |
|---|---|---|
| ETH | native (`address(0)`) | 18 |
| IMD | `0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7` (BridgedFP: plain ERC-20, no fee, no pause) | 18 |
| INFER | `0x53d0eA0A685220718Dc6a0a6e4617194C6F37921` | 18 |
| USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | 6 |
| imdUSD | `0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25` | 18 |
| cbBTC | `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` | 8 |
| WBTC | `0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` | 8 |

The registry keeps the allowlist (`isPaymentToken(token)`), owner-managed. Collections refuse anything not on it.
USDC and WBTC have admin blocklists: a blocklisted recipient makes a transfer revert. Payouts are pull-based (the
artist withdraws), so a blocklist never blocks a sale or another person's refund.

## The pools the vault uses (v4 liquidity read 2026-11-08)

| Pool | Key | Liquidity |
|---|---|---|
| **INFER/IMD** (the alignment pool) | INFER (c0) / IMD (c1), fee 12500, spacing 60, hook `0x784F…6000` (`PoolInitializationGuard`: beforeInitialize only) | 7.62e23 |
| IMD/ETH | ETH / IMD, fee 10000, spacing 200, no hook | 9.73e21 |
| imdUSD/IMD | imdUSD / IMD, fee 3000, spacing 60, no hook | 2.73e21 |
| ETH/USDC | fee 500, spacing 10, no hook | 1.54e17 |
| ETH/WBTC | fee 500, spacing 10, no hook | 1.29e17 |
| cbBTC | v4 ETH/cbBTC is thin (3000/60: 1.28e14); v3 cbBTC/WETH 0.3% `0x15aA…7C3b` is deeper (1.04e15) | |

## Conversion routes (to IMD; INFER and IMD need none)

| Paid in | Route | Swapped by |
|---|---|---|
| IMD | none | |
| INFER | none: used as the INFER side directly | |
| imdUSD | imdUSD/IMD (v4) | zRouter |
| ETH | IMD/ETH (v4) | zRouter |
| USDC | ETH/USDC (v4) -> IMD/ETH (v4) | zRouter |
| WBTC | ETH/WBTC (v4) -> IMD/ETH (v4) | zRouter |
| cbBTC | cbBTC/WETH (v3) -> unwrap -> IMD/ETH (v4) | zRouter (v3 and v4) |
| IMD -> INFER (the split) | INFER/IMD (v4, hooked) | the vault itself, through `PoolManager.unlock` (zRouter cannot route a hooked pool) |

Routes are an owner-set table per token (registry or vault owner, a Safe). The keeper picks the route the table allows
and supplies `minOut` for every hop from a live quote, through a private mempool. No on-chain price reference exists for
these pools (v4 has no TWAP), so the keeper floors are the protection, as today.

## Sale flow (collections)

- A collection has an `acceptedTokens` list and a price per token (`priceOf[token]`), set by the owner; each must be on
  the registry allowlist. Phases (drops) and editions (1155) carry a price per token the same way.
- `mint(qty, token, maxCost)`: ETH via `msg.value`; ERC-20 via `transferFrom` of exactly `price * qty` (fee-on-transfer
  tokens are not on the allowlist; the contract still checks the balance delta and reverts if short).
- The split happens per token, as today for ETH: protocol cut -> treasury balance for that token (pull); vault share ->
  `vault.receiveContribution(token, amount, address(this))`; the rest -> the collection's balance for that token.
- `withdraw(token)` pays the owner that token's balance. `withdrawAll()` loops the accepted tokens.
- Music editions with a rising price (LIMITED_DYNAMIC): each token's price rises by the same rule.
- Auctions: `currency` fixed at creation (artist or curator chooses). The deposit, every bid, outbid refunds, the
  settle split and the unsold reclaim are all in that currency. ETH auctions keep today's behaviour exactly.
- Refunds of outbid bidders: ETH keeps `forceSafeTransferETH`; ERC-20 refunds are pull-based (credited, claimed by
  the bidder) so a blocklisted or reverting bidder can never stop a higher bid.

## Vault

### Contributions and batches

- `receiveContribution(Currency currency, uint256 amount, address benefactor)`: accepts ETH or any allowlisted token;
  books `pending[benefactor][token] += amount` and the vault's `pendingByToken[token]`.
- `convertAndAddLiquidity(ConvertParams)` (keeper only) converts one batch:
  1. Pay the keeper reward from pending ETH if any (today's rule: 0.0012 ETH, capped at 1% of the batch's ETH); if the
     batch holds no ETH, the reward is 0.
  2. Convert each pending token to IMD along its route, with the keeper's floors. Record each token's realized rate
     (IMD out per unit in). INFER is valued at the realized IMD->INFER rate of step 3.
  3. Swap the balanced part of the IMD to INFER in the INFER/IMD pool (vault-side swap), floor from the keeper.
  4. Add INFER + IMD full range (spacing 60) to the vault's single INFER/IMD position. Leftover stays for next batch.
  5. Issue shares: each benefactor's batch value in IMD = sum over tokens of `pending * realizedRate`; shares are issued
     in proportion to that value, at the batch's accumulator values (today's `_closeBatch` pattern, in IMD units).
- Shares are never redeemable for liquidity (permanent), only for fees, as today.

### Fees and claims

- The position earns INFER and IMD. Two accumulators (`accInferPerShare`, `accImdPerShare`) with per-benefactor
  checkpoints; 1% of each goes to the protocol (`withdrawProtocolFees(token)`). ETH dust keeps an ETH accumulator.
- `claimFees(ClaimMode mode, uint256 minEthOut)`, paid to the benefactor or its delegate:
  - `TOKENS` (default): send INFER and IMD.
  - `ETH`: swap the claim INFER -> IMD (vault-side) -> ETH (zRouter), check `minEthOut`, send ETH.
  - `REINVEST`: add the claim's INFER + IMD to the position and issue shares at the current share price.
- Collections: `claimVaultFees(mode, minEthOut)` (owner only) forwards whatever the vault pays to `owner()`.

## Interfaces (fixed for the build)

```solidity
enum ClaimMode { TOKENS, ETH, REINVEST }

// IAlignmentVault (v2)
function receiveContribution(Currency currency, uint256 amount, address benefactor) external payable;
function claimFees(ClaimMode mode, uint256 minEthOut) external returns (uint256 inferOut, uint256 imdOut, uint256 ethOut);
function claimable(address benefactor) external view returns (uint256 infer, uint256 imd, uint256 eth);
function pendingOf(address benefactor, address token) external view returns (uint256);

// Registry
function isPaymentToken(address token) external view returns (bool);
function setPaymentToken(address token, bool allowed) external; // onlyOwner

// Collections (drop, 1155, auction)
function acceptedTokens() external view returns (address[] memory);
function withdraw(address token) external;              // onlyOwner; address(0) = ETH
function claimVaultFees(ClaimMode mode, uint256 minEthOut) external; // onlyOwner
```

## Keeper (new service next to imd-keeper)

- Watches each vault's pending value per token; converts when the batch is worth at least 0.1 ETH and gas is under the
  ceiling (both config), converting all tokens in one call.
- Quotes every hop (v4 Quoter, v3 QuoterV2), applies a slippage margin per hop, simulates, then sends through a private
  RPC. Same guard rails as imd-keeper: kill switch, gas ceiling, ETH floor, spend ledger, unknown-outcome handling.

## App

- **Mint and bid**: a token picker with the artist's accepted tokens and their prices; approve (or permit) for ERC-20s;
  "Pay with another token" swaps into one of the accepted tokens first via 0x, when the buyer holds none of them.
- **Launch**: accepted tokens and a price per token; for auctions, one currency.
- **Manage**: balances per token with Withdraw; vault fees claimable in INFER and IMD with the three claim modes.
- **Copy**: what the vault share becomes, per-token prices, that artists collect each token as paid.

## Test plan

- Unit, per collection type and per token (ETH, 6-decimal, 8-decimal, 18-decimal): payment, split, withdraw, refunds,
  dynamic price, phases; auctions in ETH and in an ERC-20, outbid refunds (push for ETH, pull for ERC-20), settle,
  reclaim.
- Vault: each route, realized-rate share issuance across mixed batches, two-token accumulators, the three claim modes,
  reinvest share pricing, protocol cut per token, leftovers, dust.
- Invariants: no balance owed beyond what is held, per token; shares and fees per share never decrease.
- Fork tests against the real pools: every route, a mixed batch, each claim mode.
- `/audit-suite contracts`, then an independent review before mainnet.

## Risks

- **Scope**: every collection's payment code changes; the ETH-only hardening has to be redone per token.
- **Vault exposure** to IMD and INFER; two-hop conversions cost pool fees on the swapped part.
- **Thin routes**: cbBTC and small pools; the keeper sizes batches and the route table can be changed by the owner.
- **Token admin powers**: USDC/WBTC blocklists, cbBTC custody; handled by pull payouts, and the allowlist can drop a
  token for new sales (existing balances stay withdrawable).
