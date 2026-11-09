# miyamaker

miyaOS and the miyamaker launchpad contracts: create, upload, launch, mint, manage and trade NFTs from one app, on Ethereum and Robinhood Chain.

Private until the audit and launch.

## Layout

| Path | What |
| --- | --- |
| `app/` | miyaOS frontend (Vite + React), imported from [miyamaker/miyaOS](https://github.com/miyamaker/miyaOS) `main` @ `527d825` |
| `app/src/pages/MusicMaker/` | The sampler. Open it from the desktop at `/music`. The guide is [its README](app/src/pages/MusicMaker/README.md). |
| `contracts/` | Foundry project: the miyamints launchpad (`MiyaRegistry`, ERC721 drop / auction and ERC1155 factories, Uniswap v4 alignment vaults, NFT pools) and prediction markets. The factories and vaults started from [Zodomo/ms2fun-contracts](https://github.com/Zodomo/ms2fun-contracts) @ `ebb1190` |

## Contracts

```bash
git submodule update --init --recursive
cd contracts
forge build                                   # solc 0.8.28 (pinned), via_ir
SKIP_FORK_TESTS=true forge test --offline     # full via_ir build, ~5 min cold; drop the env to run the mainnet fork test
FOUNDRY_PROFILE=v4real forge test             # the two tests against v4-core's real PoolManager (solc 0.8.26)
FOUNDRY_PROFILE=lite forge test               # faster local iteration
script/export-abis.sh                         # after an interface change: refresh contracts/abi/*.json for the app's drift test
```

What is in `contracts/src`:

- `registry/MiyaRegistry.sol`: one registry for the protocol. It holds the treasury and fees, the registered factories, vault factories and vaults, approved components (dynamic pricing, gating), alignment targets, the conversion keeper and every collection launched. It replaced ms2fun's master / component / alignment / vault / global-message registries and treasury. Owned by our Safe, not a DAO.
- `factories/erc721drop`: fixed-price ERC721 drops with phases, allowlists, an owner reserve and ERC-2981 royalties (at most 10%).
- `factories/erc721`: 1/1 auctions. `factories/erc1155`: editions (music drops) and `DynamicPricingModule`.
- `vaults/uni`: Uniswap v4 alignment vaults and their factory; `peripherals/UniswapVaultPriceValidator.sol`.
- `pools`: `MiyaPoolFactory` / `MiyaPool`, zero-fee NFT pools (NFTX v2 style).
- `gating/PasswordTierGatingModule.sol` (off by default), `markets/` (prediction markets, deployed separately).

Dropped from ms2fun: ERC404, ZAMM and Cypher vaults and liquidity modules, promotion, featured queue, frontend registry, the separate registries. Deploying: [`contracts/DEPLOY.md`](contracts/DEPLOY.md) (from `main` only, through `script/deploy.sh`). Nothing is deployed yet.

## App

```bash
cd app
yarn
yarn dev
```

MiyaMusicMaker is the music window. Click it once, then press Play. The playing guide is [app/src/pages/MusicMaker/README.md](app/src/pages/MusicMaker/README.md).

## Credits

Contracts derive from ms2fun-contracts by Zodomo, used with permission. The app derives from miyaOS (AGPL-3.0, see `app/LICENSE`).
