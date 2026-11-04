# miyatv chat

Live chat for the **miyatv** window in miyaOS (`app/src/pages/TV`). A Cloudflare Worker routes requests;
one Durable Object per chat room (`idFromName(room)`) holds the sockets, using the WebSocket Hibernation
API so idle rooms cost nothing.

```
browser ──GET  /auth/nonce──────────────▶ Worker (index.ts)
        ──POST /auth/verify (SIWE)──────▶   ├─ verifies EIP-4361 + signature (viem; EOA, ERC-1271, ERC-6492)
        ◀─ { token (HMAC, 6h), badges } ─   └─ holder badges via mainnet RPC
        ══ WS /rooms/:room ═════════════▶ Worker ─(Origin check)─▶ ChatRoom DO (room.ts → room-core.ts)
           {t:'auth', token}                                         history (last 100), slow mode, timeouts
           {t:'send', text}                                          in DO storage; rate limits in memory
```

Viewing is read-only and needs no sign-in. Sending needs a session token from Sign-In-With-Ethereum.

## Layout

| file | what |
| --- | --- |
| `src/index.ts` | Worker router: CORS, `/health`, `/auth/nonce`, `/auth/verify`, `/rooms/:room` (WebSocket upgrade → DO) |
| `src/room.ts` | `ChatRoom` Durable Object: hibernation wiring (attachments, auto ping/pong) around `RoomCore` |
| `src/room-core.ts` | All room behavior, Cloudflare-free and unit-tested: auth, send, mod commands, limits, history |
| `src/auth.ts` | stateless HMAC nonce, SIWE verification, session tokens |
| `src/sanitize.ts` | message sanitizer (controls, bidi, zero-width stripped; 280 code points) |
| `src/ratelimit.ts` | token bucket |
| `src/commands.ts` | mod slash-command parser |
| `src/badges.ts` | MIYAMINI / INFER holder badges, cached 10 min per address |
| `src/protocol.ts` | wire types, shared with the client by convention (`app/src/pages/TV/chat/protocol.ts`) |

## Protocol

HTTP (CORS only for `ALLOWED_ORIGINS`):

- `GET /health` → `{ ok: true }`
- `GET /auth/nonce` → `{ nonce }` — stateless: random + timestamp + HMAC, valid 10 minutes, alphanumeric.
- `POST /auth/verify` `{ message, signature }` → `{ token, address, expiresAt, badges, mod }`, or `400/401 { error }`.
  The EIP-4361 message must have `domain` = the request Origin's host, `uri` in `ALLOWED_ORIGINS`, `chainId: 1`,
  our unexpired nonce and an `expirationTime` in the future.
- `GET /rooms/:room` (WebSocket) — room matches `^[a-z0-9][a-z0-9-]{0,47}$`; `Origin` must be in `ALLOWED_ORIGINS` (else 403).

WebSocket frames are JSON (`ping` → `pong` raw text is answered by the runtime):

| direction | frame |
| --- | --- |
| server → client | `{t:'hello', room, slowMode, viewers, history: Msg[]}` on connect |
| | `{t:'me', me:{address, badges, mod}}` after a good `auth` |
| | `{t:'msg', msg}` · `{t:'del', id}` · `{t:'slow', seconds}` · `{t:'viewers', count}` |
| | `{t:'err', code, message, retryAfter?}` — code: `auth rate slow timeout length empty forbidden bad` |
| client → server | `{t:'auth', token}` · `{t:'send', text}` · `{t:'del', id}` (mods) |

`Msg = { id, at, from (lowercase address), badges: ('mod'|'miyamini'|'infer')[], text }`. Text is plain text;
clients must render it as text only (the miyaOS client linkifies only http/https URLs).

Mod commands (sent as a normal `send`; non-mods get `forbidden`): `/del <id>`, `/timeout <0xaddr> [seconds=600]`,
`/untimeout <0xaddr>`, `/slow <1-300 | off>`.

## Limits and safety

- Messages: control chars, bidi overrides and zero-width chars stripped, line breaks → spaces, max 280 code points.
- Frames over 2 KB are refused.
- Rate limits per room: 5 messages / 10 s per address and 10 / 10 s per IP (token buckets in DO memory; they reset if
  the room hibernates, which only makes them briefly more lenient). Slow mode applies per address; mods are exempt.
- `/auth/*`: 20 requests / minute per IP, **best-effort**: in-memory per Worker isolate, not global. For a hard limit add a
  Cloudflare WAF rate-limiting rule on `chat.miyamaker.com/auth/*`.
- Nonces are stateless, so a signed sign-in can be replayed within its 10-minute window; that only re-issues a session for
  the same address that signed it.
- Session tokens are `base64url(JSON{a, exp}).base64url(HMAC-SHA256)`, 6 h. Rotating `SESSION_SECRET` signs everyone out.
- Badges (Ethereum mainnet, `balanceOf > 0`): MIYAMINI `0x375a1911c0c2982f59826c227b7830e5d5985d59` (ERC-721),
  INFER `0x53d0eA0A685220718Dc6a0a6e4617194C6F37921` (ERC-20). RPC failures mean "no badge", never a blocked chat.
- The room keeps the last 100 messages in Durable Object storage.

## Local development

```sh
cd chat
npm install
cp .dev.vars.example .dev.vars          # SESSION_SECRET for local only
npm run dev                             # wrangler dev --local on http://127.0.0.1:8787 (no Cloudflare account needed)
npm test                                # vitest: sanitize, rate limiter, SIWE, tokens, commands, RoomCore
npm run typecheck
```

Then run the app with `VITE_CHAT_URL=http://127.0.0.1:8787` (see `app/.env.example`) on port 5331 or 5173
(both are in the dev `ALLOWED_ORIGINS`).

## Deploy (not done yet — do these once)

1. `cd chat && npx wrangler login`
2. Secret: `npx wrangler secret put SESSION_SECRET` — paste 32+ random chars (`openssl rand -hex 32`).
3. Vars in `wrangler.jsonc`:
   - `ALLOWED_ORIGINS` — exact origins of the deployed app (remove the localhost entries for production, or keep them
     only in a separate `env.dev`). Add any Vercel preview origin you want chat on.
   - `MOD_ADDRESSES` — comma-separated mod wallet addresses.
   - `RPC_URL` — optional; set it as a secret (`npx wrangler secret put RPC_URL`), never in vars. Defaults to a public node.
4. Route: uncomment `routes` (`{ "pattern": "chat.miyamaker.com", "custom_domain": true }`) once `miyamaker.com` is a
   Cloudflare zone, or use the `*.workers.dev` URL.
5. `npx wrangler deploy` (the `v1` migration creates the SQLite-backed `ChatRoom` class).
6. In `app/.env.production.local` set `VITE_CHAT_URL=https://chat.miyamaker.com` and redeploy the app (`yarn deploy`). Without it the chat
   tab shows "chat offline".
