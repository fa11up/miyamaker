# miyamaker vault keeper (v2)

**Status: NOT deployed.** Built and tested against mainnet reads and a local anvil fork only. No vault v2 exists on
mainnet yet; nothing here has been installed on the keeper box, and no mainnet transaction has been sent.

The keeper converts each alignment vault's pending contributions into INFER/IMD liquidity by calling the keeper-only
`UniAlignmentVault.convertAndAddLiquidity(ConvertParams)` (spec: `contracts/docs/IMD-INFER-VAULT.md`, "Vault" and
"Keeper"). It runs in **report-only mode** unless you start it with `--execute`.

The vault takes **any subset** of the pending tokens at **exact amounts** (`tokens`, `amounts`). It has **no route
table**: for each token the keeper hands it a `SwapCall { target, tokenOut, data, minOut }` (aggregator calldata), and
for the batch's ETH one more, `ethLeg`. The vault runs each call against an **allowlisted target** (0x AllowanceHolder
`0x0000…1fF3…2C22734` or zRouter `0x0000…FB11…F600e4`, `factory.isSwapTarget`), approving exactly the amount in, and
checks its own balances: the input drops by exactly the amount, the output (ETH or IMD) rises by at least `minOut`
(never 0: `ZeroFloor`). Tokens swapped to ETH join **one ETH -> IMD swap** with the pending ETH (net of the keeper
reward), sent as value, its IMD shared by each token's ETH. So the keeper can leave a token out, a contribution landing
between its read and its call cannot break the call (it just stays pending), and the order of `tokens` changes nothing.

Swaps come from **0x** (Swap API v2, AllowanceHolder flow) first and the keeper's own **zRouter** calldata as the
fallback, and every transaction goes through **MEV Blocker** so nothing is front-run. There is **no IMD price feed in
the loop** (no debt is collateralized by the vault): every swap is checked against the **market**.

## What one tick does

1. **Resolves any tx in flight** (`lib/outcome.mjs`). While one is unresolved, nothing else is sent from the key: the
   tick re-reads `state/pending.json` after every vault (also after one that threw, e.g. a receipt poll hitting a 429),
   and `sendConvert` itself refuses while a record is in flight. Vault discovery runs in its own `try` (a failed
   `getLogs` keeps the fixed `VAULTS` and the vaults already found), so it can never stop a tx from settling.
2. For each vault, at **one pinned block** (`lib/plan.mjs`):
   - reads `openBatchTokens()`, `pendingByToken`, `closedBatches`, `registry.conversionKeeper`, and from the factory
     (`config()`) which swap targets are allowed (`isSwapTarget`);
   - **sources every swap** (`lib/swaps.mjs`): USDC, WBTC and cbBTC are sold for **ETH** (they join the leg), imdUSD for
     **IMD** (`FALLBACK_ROUTES` / `SWAP_OUTPUT`). For each:
     - **0x** (`lib/zeroex.mjs`): `GET https://api.0x.org/swap/allowance-holder/quote` with headers `0x-api-key`
       (`ZEROEX_API_KEY`, environment only, never logged) and `0x-version: v2`; `chainId=1`, `taker` = the vault,
       `sellToken`/`buyToken` (ETH = `0xEeee…EEeE`), `sellAmount` = the exact amount, `slippageBps` = the keeper's
       margin. The quote is **checked** like the app's `quoteGuard` before use: `transaction.to` and any spender are
       AllowanceHolder; tokens, amount and `value` are what was asked; the calldata decodes as
       `AllowanceHolder.exec -> Settler.execute` taking exactly the amount, paying **the vault**, buying the asked
       token, with `minAmountOut = minBuyAmount > 0`; the Settler is the one 0x's on-chain registry names now
       (`ownerOf(2)` / `prev(2)`). `issues.allowance` / `issues.balance` are expected for taker = vault (it approves
       inside the call) and are not errors. `minOut` = the stricter of `minBuyAmount` and `buyAmount * (1 - HOP_MARGIN_BPS)`;
     - **zRouter** (`lib/zrouter.mjs`): one hop from the keeper's `FALLBACK_ROUTES` (default, the old vault table:
       USDC and WBTC -> ETH v4 500/10, cbBTC -> ETH v3 0.3%, imdUSD -> IMD v4 3000/10, ETH -> IMD v4 10000/200), quoted
       with the V4Quoter `0x52f0…1203` / QuoterV2 `0x61fF…B21e` (checked on chain at startup), calldata
       `swapV4`/`swapV3(to = vault, exactOut false, …, amountLimit = minOut, deadline)`. Used only when its **price
       impact** (vs a 1/1000-size probe through the same pool) is known and at most `MAX_IMPACT_BPS` (300);
     - **the pick**: 0x, unless it has no route, errors, **times out** (`ZEROEX_TIMEOUT_MS`), fails a check, its target
       is not allowlisted, or it quotes more than `ZEROEX_MAX_WORSE_BPS` (default 0) under zRouter: then zRouter. Without
       `ZEROEX_API_KEY` every swap is zRouter (the log and `npm run smoke` say 0x was skipped);
   - **leaves a token out** (it stays pending in the vault; the rest converts) when neither source gives a usable swap,
     it has **no reference price**, or its swap pays more than `MAX_REFERENCE_DEVIATION_BPS` (300) **under the market
     reference** (`lib/reference.mjs`), or that reference cannot be read:
     - `USD_TOKENS` (USDC, imdUSD): 1 USD each, in ETH at **Chainlink ETH/USD** `0x5f4e…8419` (8 decimals, max age 1 h);
     - `BTC_TOKENS` (WBTC, cbBTC): **Chainlink BTC/ETH** `0xdeb2…89e8` (18 decimals; heartbeat 24 h). If it fails any
       check, BTC/USD `0xF403…E88c` / ETH/USD is used instead;
     - a swap to IMD (imdUSD): that ETH in IMD at the **IMD/ETH v4 pool's spot** (fee 10000, tick spacing 200,
       `IMD_ETH_POOL`, read from the PoolManager at the planning block). IMD in USD = that spot x Chainlink ETH/USD.
     Each Chainlink read re-checks `description()`, `decimals()`, a positive answer and its age. One failed reference
     skips only the tokens that need it (an `ALERT` line). This still catches the stranded imdUSD/IMD pool (2026-11-08:
     ~40-50% under the market at any size);
   - **the ETH leg**: one swap for all the ETH of the included tokens (pending ETH minus the keeper reward, plus every
     swap to ETH). The vault sends it **all of that ETH as value**, which is only known on chain when swaps feed it, so
     a fed leg must sell its whole `msg.value`: **zRouter** (`swapAmount = 0`). **0x is asked for the leg only when its
     ETH is exact** (pending ETH alone, no swaps feeding it), for exactly that amount. A fed leg's `minOut` compounds
     the margin twice (its input may come in under the feeding quotes). The leg must then be within
     `MAX_REFERENCE_DEVIATION_BPS` of the IMD/ETH pool's **spot** at the planning block, **either way**: under it, its
     largest input is left out and it is tried again (size); **over** it (a pushed pool, or a quote made against a
     different state), or unquotable, **the whole leg waits this tick** (logged loudly). With **two or more
     `READ_RPC_URLS`** the spot is read again on the second RPC at the same block and must match within
     `CROSS_RPC_MAX_BPS`. Optional, off by default: `USE_IMD_FEED=true` adds the old IMD price feed check
     (`0x070e…EC97`, fail closed when stale, `MAX_FEED_DEVIATION_BPS`);
   - **values the batch in ETH**: ETH at face value, a swap to ETH at its ETH out, IMD (and imdUSD's IMD, and INFER via
     the INFER/IMD pool) at the IMD/ETH spot; skipped tokens count 0. Waits if worth less than `MIN_BATCH_ETH` (0.1);
   - **simulates** with `eth_simulateV1` (the exact swap calldata, every `minOut` 1, never 0, `minSplitRate = 1`,
     `minLiquidity = 1`, `splitInferToImd` as pass 1 off chain says; the other way if the vault answers
     `SplitDirection`) and reads the vault's events: `SplitSwap` (the balancing swap's direction and totals),
     `BatchConverted` (the liquidity the batch adds), `TokenConverted` (each swap to IMD), `EthLegSwapped` (the leg). A simulated output under its `minOut`, or more than 2 x `HOP_MARGIN_BPS` under its quote,
     or a balancing swap under the off-chain pass-1 quote: **refused this tick** (`REFUSED`);
   - sets `splitInferToImd = SplitSwap.inferToImd`, `minSplitRate = amountOut * 1e18 / amountIn * (1 -
     SPLIT_MARGIN_BPS)` and `minLiquidity = BatchConverted.liquidity * (1 - LIQUIDITY_MARGIN_BPS)` (default 200 =
     SPLIT + 2 x HOP, so a batch whose swaps land at their own floors is not refused by this one), builds `ConvertParams` with
     `deadline = block time + DEADLINE_SECONDS` (60: short, 0x quotes are short-lived), and **simulates the exact call
     at the latest block** (`eth_simulateV1`, else `eth_call`) from the keeper, then `estimateGas`. If a call carrying
     0x calldata reverts in either simulation, the batch is **re-planned once with zRouter only**;
   - **gas-adjusted decision**: gas price under `MAX_GAS_GWEI`, expected cost under `MAX_GAS_SHARE_BPS` of the batch;
   - with `--execute`: a 0x quote older than `QUOTE_MAX_AGE_SECONDS` (25; they expire after ~30 s) is **quoted again**
     (at most `MAX_REQUOTES` times) and `sendConvert` refuses a stale one; kill switch, gas ceiling, ETH floor and daily
     spend checked again, then the tx is signed, **recorded in `state/pending.json`**, and sent **only to
     `PRIVATE_RPC_URL`**.
3. A `BadParams` revert should not happen (the call names its tokens and amounts; later arrivals stay pending). If one
   does, the keeper re-reads and re-quotes, at most `MAX_REQUOTES` times, then gives up until the next tick.

### Sending: MEV Blocker

Signed transactions go only to `PRIVATE_RPC_URL`, never a public mempool (unset = the keeper refuses to send). The
default is **MEV Blocker**, keyless:

| endpoint | |
|---|---|
| `https://rpc.mevblocker.io/noreverts` | **default.** Private; a tx that would revert is never included, so a failed conversion costs no gas |
| `https://rpc.mevblocker.io/fast` | private, faster inclusion; a reverting tx may land and pay gas |
| `https://rpc.mevblocker.io/fullprivacy` | no backrun auction, builders only; slowest |

MEV Blocker (like any private RPC) may hold a tx and **never include it**. That is the "expired" row below: past
`ConvertParams.deadline` the tx is dead (it would revert `Expired`, and `/noreverts` would not include it anyway), and
the next send reuses its nonce at bumped fees.

### How the split and liquidity floors are derived

Three `ConvertParams` fields bound the vault's balancing swaps in `_balanceAndAdd` (up to three passes of swap-then-add,
all in the first pass's direction) and the batch's add (swarm audit 4884eb75, findings 1 and 5):

- `splitInferToImd`: the direction the swaps must run. A pool move that flips them reverts `SplitDirection` (before,
  one bare-number floor in the expected output token's wei was cleared by the other token's wei).
- `minSplitRate`: output wei per 1e18 input wei over every pass. A rate, not a total, so it holds for every unit the
  vault sells, including the free INFER/IMD it held before the batch (earlier holders' leftovers and strays).
- `minLiquidity`: the liquidity units the batch adds, checked whether or not a swap runs.

Pass 1's size is exactly derivable off chain (`VaultSwaps.splitAmount` on
the free INFER/IMD balances and the pool's `sqrtPrice`/liquidity, all readable), and `lib/split.mjs` reproduces it bit
for bit. Passes 2 and 3 depend on what the first add used, so the keeper uses the **simulation** (eth_simulateV1, which
publicnode supports) as the source and the off-chain pass 1 as a cross-check (the simulated total covers every pass, so
it is never under pass 1 alone: if it is, nothing is sent that tick; `SPLIT_CHECK_TOLERANCE_BPS`, default 0) and as the
fallback on nodes without eth_simulateV1. In the fallback the rate floor is pass 1's rate (later passes run at a
slightly worse price, so the exact-call check may refuse: it fails closed) and the liquidity floor is a lower bound of
pass 1's add (`estimateLiquidity`: full range, the range edges dropped, at the price the swap leaves).

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
| `ZEROEX_API_KEY` | 0x Swap API key (header only, never logged). Unset = zRouter only |
| `PRIVATE_RPC_URL` | where signed txs go, comma-separated (default MEV Blocker `/noreverts`, above). Empty = never sends |
| `READ_RPC_URLS` | reads, with failover; the second one also cross-checks the IMD/ETH spot (`CROSS_RPC_MAX_BPS`) |
| `USE_IMD_FEED` | `true` adds the IMD price feed check on the ETH leg (default `false`) |
| `VAULTS` | vaults to keep, comma-separated; or `FACTORY` + `DISCOVER_FROM_BLOCK` to add every `VaultDeployed` the registry confirms with `isVault`, read in chunks of `LOG_CHUNK` blocks (default 9,999: many RPCs cap `eth_getLogs` at 10,000) |
| `KEEPER_STOP=1` | kill switch (or `touch state/STOP`) |

## Run

```sh
cd keeper && npm ci
npm test                       # unit tests (node:test, no network; 0x answers are mocked)
npm run smoke                  # read-only mainnet: every reference (Chainlink, the IMD/ETH spot), then a batch of every
                               # token in contracts/script/config/1.json sourced like a vault's (0x when ZEROEX_API_KEY
                               # is set, else "0x skipped"; zRouter always; one ETH leg; skip rules), minimums' worth
npm run fork-e2e               # local anvil fork: deploy libraries/registry/factory/vault from contracts/out (linked),
                               # allow the swap targets, contribute every token, convert through the keeper's own send
                               # path (zRouter calldata; 0x too when ZEROEX_API_KEY is set), then a mid-flight contribution
VAULTS=0x... node index.mjs --once   # report-only: one pass, prints the plan for each vault
```

`fork-e2e` needs `anvil` and `forge build` in `contracts/`; it sends only to the local fork, with anvil's public test
keys.

## On the keeper box (later)

1. Copy `keeper/` to `~/imd-vault-keeper`, `npm ci --omit=dev`.
2. Create a NEW hot key for this keeper (not imd-keeper's, not a governance key); store it in a mode-600 file and set
   `KEEPER_KEY_FILE` in `.env` (see `.env.example`). Fund it with gas only.
3. Have the registry owner call `setConversionKeeper(<its address>)`.
4. Set `ZEROEX_API_KEY` and `VAULTS` in `~/imd-vault-keeper/.env` (`PRIVATE_RPC_URL` defaults to MEV Blocker
   `/noreverts`).
5. Install `keeper.service` as the user unit `imd-vault-keeper`. One name everywhere: `~/imd-vault-keeper` (the app,
   `WorkingDirectory`), `~/imd-vault-keeper/.env` (`EnvironmentFile`), `~/imd-vault-keeper/state` (`BindPaths`) and
   `~/.config/imd-vault-keeper/keeper.key` (the key file; `KEEPER_KEY_FILE` must point there). Then
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
