# Internal audit notes (for external review)

Status of the internal-audit findings as of branch `contracts/audit-fixes`. Line numbers refer to the
pre-fix tree (commit 88641a8). The regression tests below are ports of the internal PoC tests, which
demonstrated each fixed bug on 88641a8; here they assert the fixed behaviour.

| ID | Finding | Status |
|----|---------|--------|
| H1 | `UniAlignmentVault.claimFees` / `claimFeesAsDelegate` revert with `Reentrancy()` once the LP accrues native-ETH fees: `PoolManager.take(ETH)` and the zRouter token->ETH swap pay into `receive()`, which runs the `nonReentrant` contribution path. All LP yield unclaimable. | Fixed |
| H2 | Fee watermark model (`shareValueAtLastClaim`) dilutes unclaimed fees when new shares are minted (diluted part stranded forever) and resets a benefactor's watermark on re-contribution, erasing all their unclaimed fees. `ERC721DropInstance.withdraw()` is permissionless, so anyone could trigger the wipe. | Fixed |
| H3 | Conversion caller reward = `(100k + 15k*n) * tx.gasprice + 0.0012 ETH`, paid from the vault's general balance, i.e. from benefactors' fees. A builder/validator-set gas price drains the vault. | Fixed |
| M1 | `MiyaPool` RANDOM mode: once the outcome block hash is public, a depositor can steer which id a pending commit receives by depositing before reveal (contradicts MiyaPool.sol:41-42). | **Open** (needs design decision) |
| M2 | Vault swaps are sandwichable: `convertAndAddLiquidity(minOutTarget)` accepts any caller-chosen floor (e.g. 1), and the fee token->ETH swap has `minEthOut = 0` when the validator has no TWAP data. | **Open** (needs design decision: TWAP floor / keeper restriction) |
| M3 | `protocolTreasury` was never settable in production (factory owns the vault, no passthrough), locking the 1% LP-yield cut. | Fixed |
| M4 | Factory owner could repoint any vault's V4 pool key at any time; hooks were not checked. | Fixed |
| M5 | Not part of this change's brief; status not re-verified here. | Unverified |
| M6 | `ERC721AuctionInstance.settleAuction` used `_safeMint`; a contract winner whose `onERC721Received` reverts froze settlement (artist proceeds, vault cut, the line's queue). | Fixed |
| M7 | `ERC1155Instance` lacked `supportsInterface` / `uri` / `balanceOfBatch`, so `MiyaPoolFactory._detectKind` reverted for miyamaker 1155 collections. | Fixed |
| L1 | `renounceOwnership` on instances makes `owner() == address(0)`; artist share then goes to `address(0)` (Drop `withdraw()` is permissionless). | Fixed (renounce disabled) |
| L2 | `ERC721DropInstance.mintedInPhase` survived `setPhases`, applying old counts to unrelated new phases. | Fixed |
| L3 | `ERC1155Instance.claimFreeMint` ignored the edition `openTime`. | Fixed |

## What changed

**H1** — `receive()` returns early while a transient flag (`_COLLECTING_SLOT`, TSTORE/TLOAD) is set; the flag
wraps only the internal collection (`_claimVaultFees` + `_convertVaultFeesToEth`). One TLOAD keeps 2300-gas
`transfer` senders working. Test: `test/vaults/UniAlignmentVaultRealV4.t.sol` (real v4 `PoolManager`; this file
compiles as a separate solc 0.8.26 unit, see `foundry.toml`).

**H2** — MasterChef-style accounting: `accFeePerShare` (1e36 scale) + per-benefactor `feeCheckpoint` and
`settledFees`. Pending fees are settled before every share change (`_distributeSharesAndCleanup`).
`convertAndAddLiquidity` force-collects LP yield before minting new shares, so fees accrued before a join stay
with existing holders. A per-share-index checkpoint (rather than a rounded reward debt) means each payout rounds
down once, so `sum(claims) <= fees distributed` exactly. Tests: `UniAlignmentVaultFeeAccounting.t.sol` (PoC ports +
fuzz), `invariant_feesConserved` in `UniVaultInvariant.t.sol`, and the real-v4 non-dilution test.

**H3** — Reward = `min(CONVERSION_REWARD = 0.0012 ETH, 1% of the pending batch)`, carved out of the batch before
the swap/LP (no `tx.gasprice` term, never from general balance). A rejected reward is distributed to
shareholders as fees. Tests: `M04_GriefingAttackTests.t.sol`, `testFuzz_callerRewardKeepsVaultSolvent`.

**M3** — `protocolTreasury()` is now a view of `registry.treasury()` (follows `MiyaRegistry.setTreasury`). The
vault's other owner-only setters were unreachable (owner = factory, no passthrough) and were removed rather than
wired: `setAlignmentToken` (incompatible with an immutable pool key), `setStandardConversionReward` (H3),
`setMaxPriceDeviationBps`, `setDustDistributionThreshold`, `setProtocolYieldCutBps`, `setProtocolTreasury`,
`recordAccumulatedFees` (credited fees without ETH — insolvency). `depositFees` became a permissionless donation
to current shareholders (requires shares).

**M4** — `setV4PoolKey` is set-once and requires `hooks == address(0)`. The factory sets the key inside
`deployVault` (native ETH / alignment token, the factory's zRouter fee tier and tick spacing — the pool zRouter
swaps on); `setVaultPoolKey` was removed.

**M6** — Settlement self-calls `safeMintWinner` in `try`; on failure the token is minted to the instance and
`escrowedWinner[tokenId]` can pull it to any address with `claimEscrowedToken`.

**M7** — Added ERC165 `supportsInterface` (ERC165, ERC1155, ERC1155MetadataURI), `uri(id)`, `balanceOfBatch`, and
`to != address(0)` checks on transfers. Test creates a `MiyaPool` for an `ERC1155Instance` and deposits.

**Lows** — `renounceOwnership` reverts on Auction, Drop and 1155 instances; Drop per-wallet counters are keyed by
a `phasesEpoch` bumped in `setPhases` (`mintedInPhase(phaseId, minter)` view kept); `claimFreeMint` checks
`openTime`.

## Notes for the reviewer

- Fee collection is still gated by `vaultFeeCollectionInterval` (1 day) for claims, but forced on every
  conversion. Uncollected LP yield is not reflected in `getUnclaimedFees` until collected.
- Shares per ETH now differ slightly between batches (each batch pays its own ≤1% reward); the share-ordering
  invariant tolerance accounts for this.
- ETH sent to the vault by anyone other than via contributions/collection (e.g. `selfdestruct`) is unaccounted
  surplus; it is never paid out as fees.

---

# Scope: prediction markets (`src/markets/`, testnet only)

A new, separate scope, added on branch `contracts/markets`. **Not for mainnet**: see the gate list in
`src/markets/README.md` (licence, counsel sign-off, KYC vendor, imdUSD v2 live, ExitDesk funded, Swarm audit).
Nothing here shares state with the launchpad contracts above.

| Contract | Review focus |
|---|---|
| `ParimutuelMarket.sol` | stake checkpoints, cutoff by attested start, settlement and rake maths, claim/refund/sweep, creator escrow |
| `SwarmResolver.sol` | EIP-712 attestation verification, question splice, absolute-count quorum |
| `DisputeModule.sol`, `CouncilResolver.sol` | escalation state machine, bond settlement, council limits |
| `PredictionRegistry.sol`, `MarketFactory.sol` | snapshotting, template validation, slot sanitising, EIP-1167 clone, open-interest cap |
| `EligibilityGate.sol` | pass verification, revocation |
| `UsdcDoor.sol`, `ExitDesk.sol` | door deposits, 1:1 exit limits, cover rule |

Tests are in `test/markets/`: unit tests, fuzz tests, an invariant suite over random stake / lock / propose /
dispute / panel / council / claim / refund / sweep sequences, and a replay of a real production oracle signature.

## Known risks (accepted for testnet; re-assess before any mainnet use)

- **Two-wallet self-hedge against the door caps.** The ExitDesk pays 1:1 only up to each wallet's own door
  deposits, so "buy imdUSD below the peg, bet both sides, cash out at $1" is capped per wallet. Two wallets that
  bet opposite sides through the door and pool their winnings can still cash out their combined deposits at $1
  after buying below the peg. That extracts roughly (depeg − rake) on the losing wallet's door credit. The bound is
  the wallets' total door deposits (`test_arbitrage_twoWalletSelfHedgeBoundedByTotalDeposits`), and the per-wallet
  and per-market caps keep it small. Operationally, the desk only opens below $0.995, and the desk and caps are
  sized together.
- **Oracle disagreement rate leads to the void path.** Paid swarm questions have historically failed or split often
  enough that VOID is a normal outcome, not an edge case. A market voids on a VOID code, no proposal within 7 days,
  nobody counted on the winner, or council silence, and all of these refund in full. Expect a meaningful void rate
  and budget its operational cost (oracle fees, creator expectations). A wrong primary answer that nobody disputes
  stands once the dispute window closes.
- **Sybil insiders.** The deny-list holds only the creator's registered wallet and declared crew. A creator or crew
  member staking through an undeclared wallet cannot be detected on chain. The mitigations are off chain (KYC on
  creators, linkage analysis, win-rate anomaly scoring), plus the council's power to slash the creator's escrowed fee
  share and bond before they vest. Caps bound what one wallet can take.
- **The source clock depends on a second attestation.** The oracle signs one answer per attestation, so the official
  start comes from a separate start-time question. If that answer is wrong, stakes fall on the wrong side of the
  cutoff. Disputes cover the outcome only; the dispute tier does not re-attest the start time.
- **The first valid answer proposes.** Anyone may submit any valid attestation for the market's question. If the
  oracle signs two different answers, the first to land proposes, and the dispute path is the remedy.
- **Identical questions share attestations.** Two markets with the same template and slots have the same
  `questionHash`. One attestation can resolve only one of them (request ids are single-use per resolver), so the
  second market needs its own request.
- **The global open-interest cap is checked at stake time.** ExitDesk cash-outs can bring the desk's USDC below open
  interest. New stakes are then refused, but existing positions are not re-covered automatically.
- **The eligibility gate is live.** Unlike every other dependency, the gate is not snapshotted per market, so a
  compromised signer can be rotated. It can only refuse new stakes.
