# miyaOS app

Vite + React frontend for miyamaker (`yarn`, `yarn dev`, `yarn build`). Copy `.env.example` to
`.env.local` and fill in what you need; everything is optional for local browsing.

## Swap window and the 0x API key

The Swap window ("miya swaps") quotes and routes trades through the
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

**Vercel:** set the project's Root Directory to `app` (framework preset: Vite), then add
`ZEROX_API_KEY` under
Project Settings -> Environment Variables for Production/Preview, and redeploy. The functions in
`app/api/0x/swap/allowance-holder/{price,quote}.ts` serve the proxy.
