# miyamaker

miyaOS and the miyamaker launchpad contracts: create, upload, launch, mint, manage and trade NFTs from one app, on Ethereum and Robinhood Chain.

Private until the audit and launch.

## Layout

| Path | What |
| --- | --- |
| `app/` | miyaOS frontend (Vite + React), imported from [miyamaker/miyaOS](https://github.com/miyamaker/miyaOS) `main` @ `527d825` |
| `contracts/` | Foundry project: ERC721 / ERC1155 factories, Uniswap V4 alignment vaults and registries, trimmed from [Zodomo/ms2fun-contracts](https://github.com/Zodomo/ms2fun-contracts) @ `ebb1190` |

## Contracts

```bash
git submodule update --init --recursive
cd contracts
forge build
forge test                         # full via_ir build, ~5 min cold
FOUNDRY_PROFILE=lite forge test    # faster local iteration
```

Kept from ms2fun: `factories/erc721` (1/1 auctions), `factories/erc1155` (editions), `vaults/uni`, the master / component / alignment / vault / global-message registries, treasury, price validator and password-tier gating. Dropped: ERC404, ZAMM and Cypher vaults and liquidity modules, promotion, featured queue, frontend registry. Registries are owned by our multisig, not a DAO.

Planned additions: an ERC721 fixed-price drop instance and zero-fee NFT pools (NFTX v2 style). See the master plan.

## App

```bash
cd app
yarn
yarn dev
```

## Credits

Contracts derive from ms2fun-contracts by Zodomo, used with permission. The app derives from miyaOS (AGPL-3.0, see `app/LICENSE`).
