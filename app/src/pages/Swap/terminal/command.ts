/**
 * The terminal's command line. No runtime imports, so `node --test` can load it (tests/terminal-command.test.mts).
 *
 *   MIYA            a collection by its ticker (or slug or name)
 *   INFER           a token by its symbol
 *   0x…             an address: a token if the list or the chain says so, else a collection
 *   BUY 3 MIYA      a collection, with the buy ticket asking for 3
 *   F1 … F5, NFT, TOKENS, POOLS, ACTIVITY, WATCH
 *   anything else   a search
 *
 * A trailing <GO> (or GO) is ignored, so the Bloomberg habit works.
 */

export type TerminalTab = 'nft' | 'tokens' | 'pools' | 'activity' | 'watch'

export const TABS: { tab: TerminalTab; key: string; label: string }[] = [
  { tab: 'nft', key: 'F1', label: 'NFT' },
  { tab: 'tokens', key: 'F2', label: 'TOKENS' },
  { tab: 'pools', key: 'F3', label: 'POOLS' },
  { tab: 'activity', key: 'F4', label: 'ACTIVITY' },
  { tab: 'watch', key: 'F5', label: 'WATCH' },
]

export type CommandCollection = { chainId: number; slug: string; name: string; address: string; ticker?: string }
export type CommandToken = { chainId: number; symbol: string; name: string; address: string }

export type Command =
  | { kind: 'none' }
  | { kind: 'tab'; tab: TerminalTab }
  | { kind: 'collection'; collection: CommandCollection; buy?: number }
  | { kind: 'token'; token: CommandToken }
  | { kind: 'address'; address: `0x${string}` }
  | { kind: 'search'; query: string }

/** Short tickers for the featured collections, by slug. Miyamaker is MIYA. */
export const COLLECTION_TICKERS: Record<string, string> = {
  miyamaker: 'MIYA',
  'miyamaker-mini': 'MINI',
  milady: 'MILADY',
  identitymd: 'IDMD',
  'remilio-babies': 'REMILIO',
  'sproto-gremlins': 'SPROTO',
  schizoposters: 'SCHIZO',
  cigawrettepacks: 'CIGS',
  quotrons404: 'QUOTRON',
  'chain-mancers': 'MANCER',
}

export const tickerOf = (c: { slug: string; name: string }) =>
  COLLECTION_TICKERS[c.slug] ?? c.name.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase()

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The input without a trailing <GO>, collapsed to single spaces. */
export function cleanInput(input: string): string {
  return input
    .replace(/<\s*go\s*>\s*$/i, '')
    .replace(/\s+go\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function findCollection(word: string, collections: readonly CommandCollection[]) {
  const w = norm(word)
  if (!w) return undefined
  return (
    collections.find((c) => norm(tickerOf(c)) === w) ||
    collections.find((c) => norm(c.slug) === w) ||
    collections.find((c) => norm(c.name) === w)
  )
}

function findToken(word: string, tokens: readonly CommandToken[]) {
  const w = word.trim().toLowerCase()
  if (!w) return undefined
  return tokens.find((t) => t.symbol.toLowerCase() === w)
}

export function parseCommand(
  input: string,
  ctx: { collections: readonly CommandCollection[]; tokens: readonly CommandToken[] }
): Command {
  const text = cleanInput(input)
  if (!text) return { kind: 'none' }
  const upper = text.toUpperCase()

  const tab = TABS.find((t) => t.key === upper || t.label === upper || (t.tab === 'nft' && upper === 'NFTS'))
  if (tab) return { kind: 'tab', tab: tab.tab }

  if (ADDRESS.test(text)) return { kind: 'address', address: text as `0x${string}` }

  const buy = /^(?:buy|sweep)\s+(?:(\d{1,3})\s+)?(.+)$/i.exec(text)
  if (buy) {
    const collection = findCollection(buy[2]!, ctx.collections)
    if (collection) {
      const n = buy[1] ? Number(buy[1]) : 1
      return { kind: 'collection', collection, buy: Math.max(1, Math.min(n, 100)) }
    }
  }

  // A token's symbol wins over a collection only when it is the exact symbol and no collection uses that ticker.
  const collection = findCollection(text, ctx.collections)
  if (collection) return { kind: 'collection', collection }
  const token = findToken(text, ctx.tokens)
  if (token) return { kind: 'token', token }

  return { kind: 'search', query: text }
}

export type Suggestion =
  | { kind: 'collection'; label: string; detail: string; collection: CommandCollection }
  | { kind: 'token'; label: string; detail: string; token: CommandToken }

/** Up to `max` matches for what is typed so far: tickers and symbols that start with it first, then names. */
export function suggest(
  input: string,
  ctx: { collections: readonly CommandCollection[]; tokens: readonly CommandToken[] },
  max = 6
): Suggestion[] {
  const text = cleanInput(input).replace(/^(?:buy|sweep)\s+(?:\d{1,3}\s+)?/i, '')
  const w = norm(text)
  if (!w || ADDRESS.test(text)) return []
  const scored: { score: number; s: Suggestion }[] = []
  for (const c of ctx.collections) {
    const t = norm(tickerOf(c))
    const n = norm(c.name)
    const score = t.startsWith(w) ? 0 : n.startsWith(w) ? 1 : n.includes(w) ? 2 : -1
    if (score >= 0)
      scored.push({ score, s: { kind: 'collection', label: tickerOf(c), detail: c.name, collection: c } })
  }
  for (const k of ctx.tokens) {
    const t = norm(k.symbol)
    const n = norm(k.name)
    const score = t.startsWith(w) ? 0 : n.startsWith(w) ? 1 : n.includes(w) ? 2 : -1
    if (score >= 0) scored.push({ score: score + 0.5, s: { kind: 'token', label: k.symbol, detail: k.name, token: k } })
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, max)
    .map((x) => x.s)
}

/** The tab a function key or Alt+digit selects, or undefined. */
export function tabForKey(e: { key: string; altKey?: boolean }): TerminalTab | undefined {
  const f = TABS.find((t) => t.key === e.key)
  if (f) return f.tab
  if (e.altKey && /^[1-5]$/.test(e.key)) return TABS[Number(e.key) - 1]!.tab
  return undefined
}
