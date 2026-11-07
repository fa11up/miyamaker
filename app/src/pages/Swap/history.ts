/** A wallet's history with one token, from Alchemy's transfer index. No imports, so `node --test` can load it. */
export type WalletMove = { id: string; side: 'in' | 'out'; amount: number; at: number; hash: string; other: string }

export const HISTORY_ROWS = 8

const NETWORKS: Record<number, string> = { 1: 'eth-mainnet', 4663: 'robinhood-mainnet' }
export const historyNetwork = (chainId: number): string | undefined => NETWORKS[chainId]

export function transferQuery(token: string, native: boolean, side: 'fromAddress' | 'toAddress', wallet: string) {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'alchemy_getAssetTransfers',
    params: [
      {
        fromBlock: '0x0',
        toBlock: 'latest',
        [side]: wallet,
        category: native ? ['external'] : ['erc20'],
        ...(native ? {} : { contractAddresses: [token] }),
        withMetadata: true,
        excludeZeroValue: true,
        maxCount: `0x${HISTORY_ROWS.toString(16)}`,
        order: 'desc',
      },
    ],
  }
}

/** Both directions' answers as one list, newest first. A transfer to yourself shows once, as sent. */
export function mergeMoves(answers: readonly unknown[], wallet: string): WalletMove[] {
  const me = wallet.toLowerCase()
  const seen = new Map<string, WalletMove>()
  for (const answer of answers) {
    const list = (answer as { result?: { transfers?: unknown } })?.result?.transfers
    if (!Array.isArray(list)) continue
    for (const t of list) {
      const from = String(t?.from ?? '').toLowerCase()
      const to = String(t?.to ?? '').toLowerCase()
      const amount = Number(t?.value)
      const at = Date.parse(t?.metadata?.blockTimestamp)
      const hash = String(t?.hash ?? '')
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash) || !Number.isFinite(amount) || !Number.isFinite(at)) continue
      if (from !== me && to !== me) continue
      const id = String(t?.uniqueId ?? `${hash}:${from}:${to}:${amount}`)
      if (seen.has(id)) continue
      const side = from === me ? 'out' : 'in'
      seen.set(id, { id, side, amount, at, hash, other: side === 'out' ? to : from })
    }
  }
  return [...seen.values()].sort((a, b) => b.at - a.at).slice(0, HISTORY_ROWS)
}

export function formatAmount(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 3 })
  return n.toPrecision(3)
}
