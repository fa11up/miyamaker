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

1. **Resolves any tx in flight** (`lib/outcome.mjs`). While one is unresolved, nothing else is sent from the key: the
   tick re-reads `state/pending.json` after every vault (also after one that threw, e.g. a receipt poll hitting a 429),
   and `sendConvert` itself refuses while a record is in flight. Vault discovery runs in its own `try` (a failed
   `getLogs` keeps the fixed `VAULTS` and the vaults already found), so it can never stop a tx from settling.
2. For each vault, at **one pinned block**:
   - reads `openBatchTokens()`, `pendingByToken`, `closedBatches`, `registry.conversionKeeper`, and each token's route
     plus the ETH route from the vault's route table (`routes().getRoute`); routes are checked the way the vault
     checks them (`lib/routes.mjs`);
   - **quotes every token's own hops**: v4 hops with the V4Quoter `0x52f0…1203`, v3 hops with QuoterV2 `0x61fF…B21e`.
     Both addresses are checked on chain at startup (`poolManager()`, `factory()`, `WETH9()`);
   - **leaves a token out** (it stays pending in the vault; the rest converts) when:
     - its route **fails to quote** (e.g. `NotEnoughLiquidity`) or **quotes 0** (it would convert for nothing);
     - its **price impact** is over `MAX_IMPACT_BPS` (300): its rate vs a 1/1000-size probe through the same pools; or
       **unknown** (an amount under 1,000 units, or a probe quoting 0): not converted blind;
     - **reference check** (`lib/reference.mjs`): its route pays more than `MAX_REFERENCE_DEVIATION_BPS` (300) under a
       price that does not come from a pool it swaps through, or that price cannot be read:
       - `USD_TOKENS` (USDC, imdUSD): 1 USD each, in ETH at **Chainlink ETH/USD** `0x5f4e…8419` (8 decimals, max age
         1 h). This replaced the v4 ETH/USDC pool, which is USDC's own route pool (a manipulated pool agreed with itself);
       - `BTC_TOKENS` (WBTC, cbBTC): **Chainlink BTC/ETH** `0xdeb2…89e8` (18 decimals, not 8; heartbeat 24 h, so max
         age 24 h). If it fails any check, BTC/USD `0xF403…E88c` (8 decimals, 1 h) / ETH/USD is used instead;
       - a route ending in IMD (imdUSD): that ETH in IMD at **our IMD price feed** (`IMD_PRICE_FEED`, below).
       Each read re-checks the feed's `description()`, `decimals()`, a positive answer and its age against the block's
       timestamp. One failed or stale reference skips only the tokens that need it (logged as an `ALERT`), not the batch.
       On 2026-11-08 the imdUSD/IMD pool sits at IMD = 4.17 imdUSD while the market is ~2.47 (its only liquidity is out
       of range): the fork run shows imdUSD 43.8% under its reference (skipped); USDC 7 bps, cbBTC 0 bps. IMD, INFER
       and ETH itself have no token reference (ETH's check is the leg's);
   - **quotes the ETH leg** once, on all the ETH of the included tokens (pending ETH minus the keeper reward, plus every
     route ending in ETH); if the leg's impact is over `MAX_IMPACT_BPS`, its largest input is left out, again, until it
     fits. Then the leg must pass, or **the whole leg waits this tick** (every token on it stays pending; logged loudly):
     - the **IMD price feed** `0x070e…EC97` (`latestValue()`: ETH per IMD, 18 decimals; `isStale()`) must be fresh,
       **fail closed**: stale (or older than `IMD_FEED_MAX_AGE_SECONDS` when set) = no leg. The leg's rate before pool
       fees must be at most `MAX_FEED_DEVIATION_BPS` (300) under the feed's. **On 2026-11-08 the feed reports
       `isStale() = true` (last update ~4 h old), so on mainnet today the keeper converts no ETH, USDC or BTC and no
       imdUSD** until it is updated (`npm run smoke` shows it);
     - with **two or more `READ_RPC_URLS`**, the leg is quoted again on the second RPC alone at the same block and the
       two must agree within `CROSS_RPC_MAX_BPS` (0: same block, same state). A second RPC that cannot answer (after one
       retry) fails closed. With one RPC configured there is no cross-check and the keeper works as before. (If the main
       client has failed over to the second URL, both answers come from one node: no worse than one RPC.)
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
     its simulated output minus its margin if the quote overstated it, **but only within 2 x `HOP_MARGIN_BPS`** of the
     quote (a safety net: in the spec's table no two routes share a pool, so quotes and the simulation agree). Further
     under than that, or a simulated balancing swap **below the off-chain pass-1 quote** (or in the other direction),
     the quote and the simulation disagree too much to trust either: the batch is **refused this tick** (`REFUSED` in
     the log) instead of lowering a floor without limit;
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
publicnode supports) as the source and the off-chain pass 1 as a cross-check (the simulated total covers every pass, so
it is never under pass 1 alone: if it is, nothing is sent that tick; `SPLIT_CHECK_TOLERANCE_BPS`, default 0) and as the
fallback on nodes without eth_simulateV1. Pass 1's output is a lower bound of the total, so the fallback floor is safe (a little
looser). On the fork the off-chain pass-1 size matched the realized swap to 0.10% (5 tokens, where the routes
realized slightly less IMD than quoted) and exactly (2 tokens).

### Unknown outcomes

The signed tx is written to `state/pending.json` **before** it goes out (written durably: temp file fsynced, renamed,
directory fsynced). Each tick resolves it:

| state | meaning | what the keeper does |
|---|---|---|
| mined | receipt, status 1 | books the actual cost; done |
| reverted | receipt, status 0 | books the cost; not retried blindly (the next tick plans from scratch) |
| replaced | no receipt, nonce used by another tx | clears it, books 0; logs whether the batch was converted anyway |
| expired | no receipt, nonce unused, chain past `ConvertParams.deadline` | dead (it would revert `Expired`). The record **stays on disk, marked `expired`**, until a replacement is signed and sent: that send **reuses its nonce** with fees at least 12.5% over the expired record's own, read from disk each time (survives restarts and ticks with nothing to convert). A replacement refused outright puts the expired record back |
| pending | none of the above | waits; sends nothing |

A send refused outright (insufficient funds, underpriced) clears the record (or restores the expired one it was
replacing). "Nonce too low" is not taken at its word: the record is kept and resolved at once against the chain (our
own tx having landed books its actual cost; another tx having taken the nonce is "replaced"; a read node that has not
caught up leaves it pending). A send that errored any other way (timeouts, 5xx everywhere) is kept as unknown, because
it may have arrived, and so is **any refusal that follows an ambiguous failure** on an earlier private RPC (a timeout
or 5xx there may have delivered the tx, making the next RPC's "nonce too low" our own tx). A receipt poll that fails
(429, 5xx) is retried until `TX_WAIT_SECONDS`, then the tx is unknown until a later tick resolves it.

## Config

`config.example.mjs` documents every setting; copy it to `config.mjs` (gitignored) to change them. Every setting can
also come from the environment under the same name (env wins). Secrets only in the environment:

| env | |
|---|---|
| `KEEPER_KEY_FILE` / `KEEPER_PRIVATE_KEY` | the hot key (0x hex). Only the address is ever printed |
| `PRIVATE_RPC_URL` | where signed txs go, comma-separated (e.g. Flashbots Protect). Unset = never sends |
| `READ_RPC_URLS` | reads, with failover; the second one also cross-checks the ETH leg's quote (`CROSS_RPC_MAX_BPS`) |
| `VAULTS` | vaults to keep, comma-separated; or `FACTORY` + `DISCOVER_FROM_BLOCK` to add every `VaultDeployed` the registry confirms with `isVault`, read in chunks of `LOG_CHUNK` blocks (default 9,999: many RPCs cap `eth_getLogs` at 10,000) |
| `KEEPER_STOP=1` | kill switch (or `touch state/STOP`) |

## Run

```sh
cd keeper && npm ci
npm test                       # unit tests (node:test, no network)
npm run smoke                  # read-only mainnet: every reference (Chainlink feeds, the IMD price feed), then a batch
                               # of every token in contracts/script/config/1.json quoted like a vault's (own hops, one
                               # ETH leg, skip rules, the second RPC's leg quote), floors, minimums' worth
npm run fork-e2e               # local anvil fork: deploy libraries/registry/factory/vault from contracts/out (linked),
                               # plan once on the real IMD feed (stale: no ETH leg), then mock a fresh feed ON THE FORK
                               # and convert twice (imdUSD left pending by the reference check; a mid-flight contribution)
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
5. Install `keeper.service` as the user unit `imd-vault-keeper` (paths inside it: the app dir, the key file, state/),
   check the hardening (below), run report-only for a few cycles, then add `--execute`.

### Hardening (`keeper.service`)

The unit runs with `UMask=0077`, `ProtectSystem=strict`, `ProtectHome=tmpfs` (an empty home) with only the app dir and
the key file bound back read-only (`BindReadOnlyPaths=`) and `state/` read-write (`BindPaths=`),
`ProtectKernelTunables/Modules/Logs=yes`, `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`,
`SystemCallFilter=@system-service` (denied calls fail with `EPERM`), `NoNewPrivileges`, no capabilities. `node` must live
outside `$HOME` (or get its own `BindReadOnlyPaths=` line). **User units may silently ignore some of these** (they need
unprivileged user namespaces), so verify on the host what actually applies:

```sh
systemd-analyze --user security imd-vault-keeper
```
