# miyaOS app

Vite + React frontend for miyamaker (`yarn`, `yarn dev`, `yarn build`). Copy `.env.example` to
`.env.local` and fill in what you need; everything is optional for local browsing.

## Swap window and the 0x API key

The Swap window ("miya swaps") quotes and routes trades through the
[0x Swap API v2](https://docs.0x.org/evm/0x-swap-api/guides/swap-tokens-with-0x-swap-api)
(AllowanceHolder flow). **The 0x key never reaches the browser.** The frontend only calls the
same-origin path `/api/0x/swap/allowance-holder/{price,quote}`, and a server-side proxy
(`api/_lib/zeroex.ts`) adds the key:

- allows only `GET` on those two paths, only `chainId` 1 (Ethereum) and 4663 (Robinhood Chain)
- forwards only `chainId, sellToken, buyToken, sellAmount, taker, slippageBps` (validated)
- injects `0x-api-key` and `0x-version: v2`, plus the optional integrator fee
- returns 0x's status and body unchanged (or `503 SWAP_NOT_CONFIGURED` when no key is set)

| Variable | Where | Purpose |
| --- | --- | --- |
| `ZEROX_API_KEY` | server only | 0x API key (required for swaps) |
| `SWAP_FEE_BPS` | server only | optional integrator fee in bps (1-1000) |
| `SWAP_FEE_RECIPIENT` | server only | address that receives the fee; required with `SWAP_FEE_BPS` |

Do not prefix these with `VITE_`: Vite would then bake them into the public bundle.

**Local dev:** put `ZEROX_API_KEY=...` in `app/.env.local` (gitignored) or export it in your shell,
then `yarn dev`. A Vite dev middleware (`vite.config.ts`) runs the same proxy code.

**Vercel:** set the project's Root Directory to `app` (framework preset: Vite), then add
`ZEROX_API_KEY` (and optionally `SWAP_FEE_BPS` / `SWAP_FEE_RECIPIENT`) under
Project Settings -> Environment Variables for Production/Preview, and redeploy. The functions in
`app/api/0x/swap/allowance-holder/{price,quote}.ts` serve the proxy.
