// Shared by the allowlist scripts: the mainnet RPC and small helpers. Run with node (type stripping), from app/.
//
// Every read goes through the KEYED mainnet RPC, never a public node, and there is no fallback: if it fails, the
// script stops and says so. The URL comes from, in order: RPC_URL_1 (shell, as the Worker secret is named), then
// app/.env.production.local or app/.env.local (RPC_URL_1, VITE_RPC_URL_1, or VITE_ALCHEMY_KEY made into an Alchemy
// URL). RPC_URL may point a script at a local fork (anvil on localhost, itself forked from the keyed RPC), and only
// there. The URL is never printed: only its host is.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { PublicClient } from 'viem'
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

export const APP = fileURLToPath(new URL('../../', import.meta.url))

function fromEnvFiles(): string | undefined {
  for (const name of ['.env.production.local', '.env.local']) {
    const path = `${APP}${name}`
    if (!existsSync(path)) continue
    const vars: Record<string, string> = {}
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line)
      if (m) vars[m[1] as string] = (m[2] as string).trim()
    }
    if (vars.RPC_URL_1) return vars.RPC_URL_1
    if (vars.VITE_RPC_URL_1) return vars.VITE_RPC_URL_1
    if (vars.VITE_ALCHEMY_KEY) return `https://eth-mainnet.g.alchemy.com/v2/${vars.VITE_ALCHEMY_KEY}`
  }
  return undefined
}

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i

export function rpcUrl(): string {
  if (process.env.RPC_URL) {
    if (!LOOPBACK.test(process.env.RPC_URL)) {
      throw new Error('RPC_URL is only for a local fork (http://127.0.0.1:…). Use the keyed RPC: RPC_URL_1 or app/.env.production.local.')
    }
    return process.env.RPC_URL
  }
  const url = process.env.RPC_URL_1 || fromEnvFiles()
  if (!url) {
    throw new Error('No keyed RPC: set RPC_URL_1, or VITE_RPC_URL_1 / VITE_ALCHEMY_KEY in app/.env.production.local. Public nodes are not used.')
  }
  return url
}

/** "eth-mainnet.g.alchemy.com" for the logs: never the key. */
export const rpcHost = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return 'rpc'
  }
}

export function client(url = rpcUrl()): PublicClient {
  return createPublicClient({
    chain: mainnet,
    transport: http(url, { batch: false, retryCount: 6, retryDelay: 400, timeout: 60_000 }),
  }) as PublicClient
}

/** --name value / --flag pairs. */
export function args(argv = process.argv.slice(2)) {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] as string
    if (!a.startsWith('--')) continue
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[a.slice(2)] = 'true'
    else {
      out[a.slice(2)] = next
      i += 1
    }
  }
  return out
}

export const short = (e: unknown) =>
  String((e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? e)
    .split('\n')[0]
    ?.slice(0, 200)

/** A block number, 'latest', 'safe' or 'finalized' → a block number. */
export async function pinBlock(c: PublicClient, which: string | undefined): Promise<{ number: bigint; timestamp: bigint }> {
  const tag = which || 'finalized'
  const b = /^\d+$/.test(tag)
    ? await c.getBlock({ blockNumber: BigInt(tag) })
    : await c.getBlock({ blockTag: tag as 'latest' | 'safe' | 'finalized' })
  return { number: b.number as bigint, timestamp: b.timestamp }
}
