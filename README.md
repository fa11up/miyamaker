# miyamaker

miyaOS is a desktop that runs in the browser. The programs on it create, upload, launch, mint, manage, and trade NFTs, and they play and make music. The contracts behind the launches live in this same repository. The desk runs on Ethereum mainnet, Sepolia, and Robinhood Chain.

Private until the audit and launch.

## The desktop

Open the site and you get a wallpaper, a grid of icons, a taskbar, and windows. Double-click an icon, or pick a program from the Start menu. A window can move, resize, minimize, and come to the front. Several stay open at once. The address in the location bar opens that program’s window: `/music` is MiyaMusicMaker, `/trade` is Trade, and the rest follow the paths below.

On a phone, narrower than 768px, a normal window fills the screen. Display and Manager stay a card over the desktop. miyaTV, the radio, and Mint draw their own frames.

The Start menu groups the programs:

| Group | Programs |
| --- | --- |
| Collect | Mint, Auction, Trade |
| Create | Launch, Manager, Infinite Upload, Drop Music, MiyaMusicMaker |
| Entertainment | miyaTV, miya radio, miyanet |
| System | My Files, Display |

A wallet connects through the usual browser wallets, and through a passkey or a social login for someone who does not have one yet. Launch follows the wallet’s chain when that chain is one of the three above, and Ethereum otherwise. Sepolia is offered in development builds.

## Programs

| Program | Path | What it does |
| --- | --- | --- |
| Mint | `/mint` | Browse collections and mint. Music editions show up here with the rest. |
| Trade | `/trade` | Swap tokens, and trade NFTs: a collection, one item, a pool, or a sweep. `/swap` still opens this window. |
| miyanet | `/about` | The portal: the webring, search, and Build. |
| Launch | `/launch` | Release a collection. Three kinds: an ERC-721 fixed-price drop, an ERC-721 auction, or an ERC-1155 edition. |
| Manager | `/manage` | The collections you released. Edit what the contract still allows, and add another edition to an ERC-1155. |
| Auction | `/auction` | Bid on 1/1 auctions. |
| Infinite Upload | `/upload` | Put a file on permanent storage. A running upload asks before the window closes. Storage is paid in ETH. |
| My Files | `/files` | The NFTs in the connected wallet, grouped by collection. |
| Display | `/display` | Desktop picture, the pet, and the screen saver. |
| miyaTV | `/tv` | A television: channels, a guide, and chat. On a phone turned sideways it can take the whole screen. |
| miya radio | `/radio` | A player for stations and for music that has been released. A minted bounce can land here. |
| Drop Music | `/drop-music` | Release a track as an edition: the audio, the cover, the price, the split, and the curve. |
| MiyaMusicMaker | `/music` | The sampler, tracker, and song arranger. The playing guide is [its README](app/src/pages/MusicMaker/README.md). |

### Editions and the bonding curve

An ERC-1155 edition asks for a curve before it goes out. Launch, Drop Music, Manager’s add-edition form, and the mint dialog inside MiyaMusicMaker all use the same picker.

Gentle is the default: each copy costs 1% more than the one before it. Steady is 2.5%. Steep is 5%. Custom is a percent you type, up to 100%. Flat keeps one price, which is how an open edition stays open. A rising curve needs a supply above zero. The contract stores a rising curve as `LIMITED_DYNAMIC` with `priceIncreaseRate` in basis points. There is no way to change the curve after the edition is released. An ERC-721 drop stays one price. An auction stays a bid.

The chart draws the rise for the copies you set, and at most 240 of them, and it says so when the edition keeps rising past that window.

## MiyaMusicMaker

MiyaMusicMaker is a drum machine, a keyboard, a tracker, and a song arranger in one window. A starter kit is already loaded. Pattern `00` is a short demo. Click the window once, so the browser will make sound, then press Play.

Sixty-four pads sit in banks A through D. The Sequence page and the Tracker page edit the same pattern. The arranger chains those patterns into a song. The bar under the playing cell shows how far that loop has gone. A cell that is waiting for the current loop to finish is the only one that blinks.

Songs save as `.m1ya`. Kits save as `.k1t`. From the site, or from a local checkout, you can publish a song, a kit, or a bounce to Arweave, and mint it as an edition. Publishing is public and permanent, and storage is paid in real ETH on Ethereum mainnet. The full map of the instrument, including MIDI controllers, the phone layout, and the tracker keys, is [app/src/pages/MusicMaker/README.md](app/src/pages/MusicMaker/README.md).

## Layout

| Path | What |
| --- | --- |
| `app/` | miyaOS frontend (Vite + React 18) |
| `app/src/pages/` | One folder per program |
| `app/src/pages/MusicMaker/` | The sampler. Its guide is [the MusicMaker README](app/src/pages/MusicMaker/README.md). |
| `app/src/pages/OperatingSystem/` | The desktop, the wallpaper, and the window layer |
| `app/src/desktop/` | Icons, My Files, Display, the pet, and the screen saver |
| `app/src/miyamints/` | Launch, manage, and the edition math the windows share |
| `contracts/` | Foundry project: ERC-721 and ERC-1155 factories, Uniswap v4 alignment vaults, and the registries |

## Run the desk

```bash
cd app
yarn
yarn dev
```

Yarn is the package manager (`app/yarn.lock`). Node 18 or newer is enough. The dev server prints a local URL. Open it, then open MiyaMusicMaker from the desktop or go straight to `/music`.

```bash
cd app
yarn test
```

That runs the Node test suite, including the music engine, playback, and the edition curve.

Chrome, Edge, Brave, Arc, and Opera can see a USB MIDI controller on Mac, Windows, Linux, and ChromeOS. The page has to be on localhost or https. Safari and Firefox still play MiyaMusicMaker from the computer keyboard.

## Contracts

```bash
git submodule update --init --recursive
cd contracts
forge build
forge test                         # full via_ir build, ~5 min cold
FOUNDRY_PROFILE=lite forge test    # faster local iteration
```

Kept from ms2fun: `factories/erc721` (1/1 auctions), `factories/erc1155` (editions), `vaults/uni`, the master / component / alignment / vault / global-message registries, treasury, price validator and password-tier gating. Dropped: ERC404, ZAMM and Cypher vaults and liquidity modules, promotion, featured queue, frontend registry. Registries are owned by our multisig, not a DAO.

An edition’s price model is already on the ERC-1155: unlimited (flat, supply 0), limited and flat, or limited and dynamic. Dynamic price is `basePrice * ((10000 + rate) / 10000) ^ minted`, with the rate in basis points, computed on chain by integer exponentiation. The desk’s chart and copy prices step that same rise and truncate to wei after each copy, which stays close to the chain and is not always the same wei.

## Credits

Contracts derive from ms2fun-contracts by Zodomo, used with permission. The app derives from miyaOS (AGPL-3.0, see `app/LICENSE`).
