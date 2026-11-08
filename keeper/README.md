# miyamaker vault keeper (v2)

**Status: NOT deployed.** Built and tested against mainnet reads and a local anvil fork only. No vault v2 exists on
mainnet yet; nothing here has been installed on the keeper box, and no mainnet transaction has been sent.

The keeper converts each alignment vault's pending contributions into INFER/IMD liquidity by calling the keeper-only
`UniAlignmentVault.convertAndAddLiquidity(ConvertParams)` (spec: `contracts/docs/IMD-INFER-VAULT.md`, "Vault" and
"Keeper"). It runs in **report-only mode** unless you start it with `--execute`.

The vault takes **any subset** of the pending tokens at **exact amounts** (`tokens`, `amounts`), runs each token's own
hops (routes end in IMD, or in ETH), then sends all of the batch's ETH to IMD in **one swap** along the ETH route
(`ethLegMinOuts`), sharing its output by each token's ETH. So the keeper can leave a token out, a contribution landing
between its read and its call cannot break the call (it just stays pending), and the order of `tokens` changes nothing.

## What one tick does

1. **Resolves any tx in flight** (`lib/outcome.mjs`). While one is unresolved, nothing else is sent from the key.
2. For each vault, at **one pinned block**:
   - reads `openBatchTokens()`, `pendingByToken`, `closedBatches`, `registry.conversionKeeper`, and each token's route
     plus the ETH route from the vault's route table (`routes().getRoute`); routes are checked the way the vault
     checks them (`lib/routes.mjs`);
   - **quotes every token's own hops**: v4 hops with the V4Quoter `0x52f0…1203`, v3 hops with QuoterV2 `0x61fF…B21e`.
     Both addresses are checked on chain at startup (`poolManager()`, `factory()`, `WETH9()`);
   - **leaves a token out** (it stays pending in the vault; the rest converts) when:
     - its route **fails to quote** (e.g. `NotEnoughLiquidity`);
     - its **price impact** is over `MAX_IMPACT_BPS` (300): its rate vs a 1/1000-size probe through the same pools;
     - **reference check** (tokens in `USD_TOKENS`: USDC, imdUSD): its route pays more than
       `MAX_REFERENCE_DEVIATION_BPS` (300) under 1 USD priced at market through ETH/USDC (`REFERENCE_USD_POOL`) and the
       ETH route (IMD/ETH), both at spot (probe quotes with the pool fee added back). Floors only protect against
       slippage from the live quote, not against a pool that is far off market: on 2026-11-08 the imdUSD/IMD pool sits
       at IMD = 4.17 imdUSD while the market is ~2.47 (its only liquidity is out of range), so converting imdUSD there
       would pay ~69% over market for IMD. `npm run smoke` shows it 40.9% under the reference (skipped); USDC is 7 bps.
       BTC tokens, ETH, IMD and INFER have no independent reference (their ETH hop is their market);
   - **quotes the ETH leg** once, on all the ETH of the included tokens (pending ETH minus the keeper reward, plus every
     route ending in ETH); if the leg's impact is over `MAX_IMPACT_BPS`, its largest input is left out, again, until it
     fits;
   - **values the batch in ETH**: ETH at face value, a route ending in ETH at its ETH out, anything else (imdUSD, IMD,
     INFER via the INFER/IMD pool) by quoting its IMD back to ETH along the reversed ETH route; skipped tokens count 0;
   - waits if the batch is worth less than `MIN_BATCH_ETH` (0.1);
   - **floors per hop**: `floor_k = quote_k * (1 - HOP_MARGIN_BPS)^(k+1)`, the margin compounding so a later hop still
     has its own allowance when an earlier one slipped within its own. The ETH leg's floors compound after its feeding
     routes' (it runs on their output);
   - **simulates** the exact call with `eth_simulateV1` (no hop or leg floors, `minSplitOut = 1`) and reads the vault's
     events: `SplitSwap` gives the balancing swap's total output, `TokenConverted` each route's IMD, `EthLegSwapped`
     the leg's IMD out;
   - sets `minSplitOut = SplitSwap.amountOut * (1 - SPLIT_MARGIN_BPS)`, and caps a route's (or the leg's) last floor at
     its simulated output minus its margin if the quote overstated it (a safety net: in the spec's table no two routes
     share a pool, so quotes and the simulation agree);
   - runs the final `eth_call` with the real params from the keeper address, and `estimateGas`;
   - **gas-adjusted decision**: gas price (base fee + tip) under `MAX_GAS_GWEI`, and expected cost under
     `MAX_GAS_SHARE_BPS` of the batch's ETH value (100 = 1%);
   - with `--execute`: kill switch, gas ceiling, ETH floor and daily spend checked again, then the tx is signed,
     **recorded in `state/pending.json`**, and sent **only to `PRIVATE_RPC_URL`**.
3. A `BadParams` revert should no longer happen (the call names its tokens and amounts; later arrivals stay pending).
   If one does, the keeper re-reads and re-quotes, at most `MAX_REQUOTES` times, then gives up until the next tick.

### How `minSplitOut` is derived

`minSplitOut` floors the **total** output of the vault's balancing swaps in `_balanceAndAdd` (up to three passes of
swap-then-add, all in the first pass's direction). Pass 1's size is exactly derivable off chain (`VaultSwaps.splitAmount` on
the free INFER/IMD balances and the pool's `sqrtPrice`/liquidity, all readable), and `lib/split.mjs` reproduces it bit
for bit. Passes 2 and 3 depend on what the first add used, so the keeper uses the **simulation** (eth_simulateV1, which
publicnode supports) as the source and the off-chain pass 1 as a logged cross-check and as the fallback on nodes
without eth_simulateV1. Pass 1's output is a lower bound of the total, so the fallback floor is safe (a little
looser). On the fork the off-chain pass-1 size matched the realized swap to 0.10% (5 tokens, where the routes
realized slightly less IMD than quoted) and exactly (2 tokens).

### Unknown outcomes

The signed tx is written to `state/pending.json` **before** it goes out. Each tick resolves it:

| state | meaning | what the keeper does |
|---|---|---|
| mined | receipt, status 1 | books the actual cost; done |
| reverted | receipt, status 0 | books the cost; not retried blindly (the next tick plans from scratch) |
| replaced | no receipt, nonce used by another tx | clears it; logs whether the batch was converted anyway |
| expired | no receipt, nonce unused, chain past `ConvertParams.deadline` | dead (it would revert `Expired`); the next send **reuses its nonce** with fees 12.5% higher |
| pending | none of the above | waits; sends nothing |

A send refused outright (nonce too low, insufficient funds, underpriced) clears the record; a send that errored any
other way (timeouts, 5xx everywhere) is kept as unknown, because it may have arrived.

## Config

`config.example.mjs` documents every setting; copy it to `config.mjs` (gitignored) to change them. Every setting can
also come from the environment under the same name (env wins). Secrets only in the environment:

| env | |
|---|---|
| `KEEPER_KEY_FILE` / `KEEPER_PRIVATE_KEY` | the hot key (0x hex). Only the address is ever printed |
| `PRIVATE_RPC_URL` | where signed txs go, comma-separated (e.g. Flashbots Protect). Unset = never sends |
| `READ_RPC_URLS` | reads, with failover |
| `VAULTS` | vaults to keep, comma-separated; or `FACTORY` + `DISCOVER_FROM_BLOCK` to add every `VaultDeployed` the registry confirms with `isVault` |
| `KEEPER_STOP=1` | kill switch (or `touch state/STOP`) |

## Run

```sh
cd keeper && npm ci
npm test                       # unit tests (node:test, no network)
npm run smoke                  # read-only mainnet: a batch of every token in contracts/script/config/1.json, quoted
                               # like a vault's (own hops, one ETH leg, skip rules), floors, minimums' worth
npm run fork-e2e               # local anvil fork: deploy libraries/registry/factory/vault from contracts/out (linked),
                               # convert twice (imdUSD left pending by the reference check; a mid-flight contribution)
VAULTS=0x... node index.mjs --once   # report-only: one pass, prints the plan for each vault
```

`fork-e2e` needs `anvil` and `forge build` in `contracts/`; it sends only to the local fork, with anvil's public test
keys.

## On the keeper box (later)

1. Copy `keeper/` to `~/miyamaker-vault-keeper`, `npm ci --omit=dev`.
2. Create a NEW hot key for this keeper (not imd-keeper's, not a governance key); store it in a mode-600 file and set
   `KEEPER_KEY_FILE` in `.env` (see `.env.example`). Fund it with gas only.
3. Have the registry owner call `setConversionKeeper(<its address>)`.
4. Set `PRIVATE_RPC_URL` and `VAULTS` in `.env`.
5. Install `keeper.service` as a user unit, run report-only for a few cycles, then add `--execute`.
