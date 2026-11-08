# miyamaker vault keeper (v2)

**Status: NOT deployed.** Built and tested against mainnet reads and a local anvil fork only. No vault v2 exists on
mainnet yet; nothing here has been installed on the keeper box, and no mainnet transaction has been sent.

The keeper converts each alignment vault's open batch into INFER/IMD liquidity by calling the keeper-only
`UniAlignmentVault.convertAndAddLiquidity(ConvertParams)` (spec: `contracts/docs/IMD-INFER-VAULT.md`, "Keeper").
It runs in **report-only mode** unless you start it with `--execute`.

## What one tick does

1. **Resolves any tx in flight** (`lib/outcome.mjs`). While one is unresolved, nothing else is sent from the key.
2. For each vault, at **one pinned block**:
   - reads `openBatchTokens()` (the order the call must use), `pendingByToken`, `closedBatches`,
     `registry.conversionKeeper`, and each token's route from the vault's route table (`routes().getRoute`);
     routes are checked the way the vault checks them (`lib/routes.mjs`);
   - **quotes every hop**: v4 hops with the V4Quoter `0x52f0…1203`, v3 hops with QuoterV2 `0x61fF…B21e`. Both
     addresses are checked on chain at startup (`poolManager()`, `factory()`, `WETH9()`). The ETH route is quoted on
     the pending ETH minus the keeper reward, as the vault does;
   - **values the batch in ETH**: ETH at face value, a route that passes through ETH at that hop's quote, anything
     else (imdUSD, IMD, INFER via the INFER/IMD pool) by quoting its IMD back to ETH along the reversed ETH route;
   - skips if the batch is worth less than `MIN_BATCH_ETH` (0.1);
   - **floors per hop**: `floor_k = quote_k * (1 - HOP_MARGIN_BPS)^(k+1)`. The margin compounds, so a second hop
     still has its own allowance when the first slipped within its own;
   - **simulates** the exact call with `eth_simulateV1` (no hop floors, `minSplitOut = 1`) and reads the vault's own
     events: `SplitSwap` gives the balancing swap's total output, `TokenConverted` each route's real IMD out;
   - sets `minSplitOut = SplitSwap.amountOut * (1 - SPLIT_MARGIN_BPS)`, and caps each route's last floor at its
     simulated output minus the route's margin (routes share the ETH -> IMD pool and run one after another, so
     independent quotes overstate the later ones);
   - runs the final `eth_call` with the real params from the keeper address, and `estimateGas`;
   - **gas-adjusted decision**: gas price (base fee + tip) under `MAX_GAS_GWEI`, and expected cost under
     `MAX_GAS_SHARE_BPS` of the batch's ETH value (100 = 1%);
   - with `--execute`: kill switch, gas ceiling, ETH floor and daily spend checked again, then the tx is signed,
     **recorded in `state/pending.json`**, and sent **only to `PRIVATE_RPC_URL`**.
3. A `BadParams` revert (a contribution in a new token landed between the read and the call) makes it re-read
   `openBatchTokens` and re-quote, at most `MAX_REQUOTES` times; then it gives up until the next tick.

### How `minSplitOut` is derived

`minSplitOut` floors the **total** output of the vault's balancing swaps in `_balanceAndAdd` (up to three passes of
swap-then-add, all in the first pass's direction). Pass 1's size is exactly derivable off chain (`_splitAmount` on
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
npm run smoke                  # read-only mainnet: quote every route in contracts/script/config/1.json, print floors
npm run fork-e2e               # local anvil fork: deploy registry/factory/vault from contracts/out, convert twice
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
