# miyaOS app

Vite + React frontend for miyamaker (`yarn`, `yarn dev`, `yarn build`). Copy `.env.example` to
`.env.local` and fill in what you need; everything is optional for local browsing.

## Trade window and the 0x API key

The Trade window (formerly "miya swaps", at `/trade`; old `/swap` links redirect) has two tabs.
**NFTs** trades NFTs through the zero-fee MiyaPool pools (`contracts/src/pools`) of the `MiyaPoolFactory`
set by `VITE_MIYA_POOL_FACTORY_<chainId>` or `contracts/deployments/<chainId>.json`; on a chain without one it
says the pools are not there yet. **Tokens** quotes and routes trades through the
[0x Swap API v2](https://docs.0x.org/evm/0x-swap-api/guides/swap-tokens-with-0x-swap-api)
(AllowanceHolder flow). **The 0x key never reaches the browser.** The frontend only calls the
same-origin path `/api/0x/swap/allowance-holder/{price,quote}`, and a server-side proxy
(`api/_lib/zeroex.ts`) adds the key:

- allows only same-origin `GET` on those two paths, only `chainId` 1 (Ethereum) and 4663 (Robinhood Chain)
- accepts only `chainId, sellToken, buyToken, sellAmount, slippageBps, taker`; unknown or duplicated
  params are refused (not forwarded); `sellAmount` must be a positive integer, `slippageBps` 10-300,
  `taker` is required for quotes
- injects `0x-api-key` and `0x-version: v2`
- sets the fee itself (the page cannot): 0.1% (`swapFeeBps=10`) to the imdUSD Treasury
  `0x6Ac8fF96Fb8DCF5d79A8eF1E59D9AC23f2BD27Bc`, taken in the bought token, on Ethereum only, and
  never when either side is imdUSD. Robinhood Chain carries no fee until a Treasury exists there
  (`FEE_TREASURY` in `api/_lib/zeroex.ts`)
- returns 0x's status and body (or `503 SWAP_NOT_CONFIGURED` when the key is missing or refused)

The only secret is `ZEROX_API_KEY`. Do not prefix it with `VITE_`: Vite would then bake it into
the public bundle. Proxy rules are unit-tested: `yarn test`.

**Local dev:** put `ZEROX_API_KEY=...` in `app/.env.local` (gitignored) or export it in your shell,
then `yarn dev`. A Vite dev middleware (`vite.config.ts`) runs the same proxy code.

### NFTs: every market a collection trades on (OpenSea key)

Open a collection in Trade → NFTs (search by name, paste an address, tap one of your NFTs' collections, or a pool)
and it lists every venue: **MiyaPool** (our pools, 0% fees, on-chain), **OpenSea** (floor, best offer, sales this
week, the cheapest listings), **Blur** and **Magic Eden** (links only: no public price API). Each NFT has its own
page too (`/trade/nfts/collection/<chainId>/<address>/<tokenId>`): its OpenSea listing and best offer, whether a
MiyaPool holds it, and links to it everywhere. OpenSea listings can be **bought in-app** and offers **accepted
in-app** after a review that shows the price, the OpenSea fee and creator earnings; the order comes from OpenSea's
fulfillment API and is checked in the page before the wallet opens (Seaport 1.6/1.5 address only, this chain, this
NFT, goods to the wallet, fixed price; `planFill` in `src/pages/Swap/nft/markets.ts`) and simulated. OpenSea serves
Ethereum and Robinhood Chain; Sepolia has only MiyaPool (OpenSea closed its testnets).

The OpenSea key stays server-side, same as 0x: the page calls `/api/opensea?op=...` and `api/_lib/opensea.ts` adds
`X-API-KEY`. It allows only its listed ops and params (same-origin, rate-limited, fills POST with a body the proxy
rebuilds, so the page cannot pick a recipient). **Get a free key** on
[docs.opensea.io/reference/api-keys](https://docs.opensea.io/reference/api-keys): opensea.io → Settings →
Developer → Create key (needs a verified email), or for a quick test the instant key
(`curl -X POST https://api.opensea.io/api/v2/auth/keys`, free tier, expires after 7 days, low limits). Put it in
`app/.env.local` as `OPENSEA_API_KEY=...` (no `VITE_` prefix) or as a Worker secret. Without it the
venue cards still show with working links and a quiet "prices need an API key" note.

**Cloudflare:** `app/` deploys as a Worker with static assets (`app/wrangler.jsonc`). Put the `VITE_` values in
`app/.env.production.local` (they are read at build time), set the keys with `npx wrangler secret put ZEROX_API_KEY`
and `npx wrangler secret put OPENSEA_API_KEY`, then run `yarn deploy`. `app/api/worker.ts` serves both proxies and
redirects `miyamaker.com` to `www.miyamaker.com`.

## miyakeys's community gallery (nuroctane.xyz)

miyakeys reads and shares builds through this site's Worker (`/api/miyakeys/gallery`, `app/api/_lib/miyakeys.ts`),
which forwards to `https://www.nuroctane.xyz/api/modkeys/gallery`. Every request to nuroctane.xyz is a fresh one from
Cloudflare: no visitor cookie, address or user agent. Builds are checked both ways (`embed/miyakeys/js/core/validBuild.js`).

- **Reads** are kept for 45 seconds per Cloudflare data centre, so nuroctane.xyz sees at most about one read per data
  centre per 45 seconds; at most 500 builds (the newest) are passed on.
- **Shares** are limited three ways: a burst limit per visitor per Worker isolate; 10 an hour per visitor (an IPv4
  address or an IPv6 /48); and 100 an hour for the whole site. The hourly counts are in D1 (the `shared_state` table
  from `migrations/0003_hardening.sql`, already applied): one row for the site and at most 1024 rows for visitors (a
  hash of the visitor picks the row, no address is stored), overwritten each hour, so the table does not grow. A build
  nuroctane.xyz turns down (4xx other than 429) gives the site's share back. If D1 cannot count, sharing is refused,
  never let through; with no `DB` binding at all the hourly caps are off and the Worker logs a warning. An upstream
  429 is shown as "busy, try again in a minute", for reads and shares alike.
- **For nuroctane.xyz: telling visitors apart.** Set a secret (32+ random characters) and every share carries
  `x-miyakeys-client: <32 hex>`, HMAC-SHA256 of the visitor's address (IPv6 by /64) under that secret. The same
  visitor always sends the same value; it cannot be turned back into an address. Throttle or block on it. Unset, the
  header is not sent; a secret under 32 characters is ignored (logged as a warning) and the header is not sent either.

  ```bash
  npx wrangler secret put MIYAKEYS_CLIENT_SECRET
  ```

The share route accepts `Origin: null` because miyakeys runs in a sandboxed frame; any site's sandboxed frame sends the
same, so the limits above, not the Origin check, are what hold sharing back.

`package.json` pins `jspdf`'s `@babel/runtime` to 7.29.13 (`resolutions`): 7.29.14 was locked hours after it was
published. Drop the pin once a later release has been out a while.
