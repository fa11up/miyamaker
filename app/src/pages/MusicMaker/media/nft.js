/** Read-only wallet listing. No signatures, no transfers. */

import { fetchCapped, fetchJsonCapped } from './capped.js'

export const COLLECTIONS = [
  {
    id: 'ravepigs',
    name: 'Ravepigs',
    contract: '0xc99718df2d6286b7dc87c0cc71d46a20b0086f4c',
  },
]

const AUDIO_EXT = /\.(wav|mp3|m4a|aac|ogg|flac|aiff|aif|mp4|webm|mov|m4v)(\?|#|$)/i
const RPC = 'https://ethereum.publicnode.com'

/** Pages of 50 per token type: past this the listing says it is partial instead of reading on. */
export const MAX_PAGES = 40
/** Tokens of a known collection with no media in the listing get their metadata read, up to this many. */
export const MAX_META_READS = 48
const PAGE_BYTES = 4 * 1024 * 1024
const META_BYTES = 256 * 1024
const RPC_BYTES = 256 * 1024
const NET_MS = 15000
const MAX_LINKS = 32
const MAX_WALK = 2000
const MAX_DEPTH = 8

/** A name from a token or its metadata as plain text: a string, no control characters, at most `max`. */
export function plainName(value, max = 80) {
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) return ''
  // eslint-disable-next-line no-control-regex
  return String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max)
}

export function isAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value || '').trim())
}

export async function requestAccount() {
  const eth = typeof window !== 'undefined' ? window.ethereum : null
  if (!eth?.request) throw new Error('No wallet in this browser. Paste an address instead.')
  const accounts = await eth.request({ method: 'eth_requestAccounts' })
  const account = accounts?.[0]
  if (!isAddress(account)) throw new Error('The wallet did not return an address')
  return account
}

function hexId(id) {
  const text = String(id)
  if (/^0x[0-9a-fA-F]+$/.test(text)) return text.slice(2).padStart(64, '0').toLowerCase()
  let n = BigInt(text)
  if (n < 0n) n = 0n
  return n.toString(16).padStart(64, '0')
}

async function ethCall(to, data) {
  const body = await fetchJsonCapped(RPC, {
    limit: RPC_BYTES,
    timeoutMs: NET_MS,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
    },
  })
  if (body.error) throw new Error(body.error.message || 'rpc')
  return body.result || '0x'
}

function decodeString(result) {
  const hex = String(result || '').replace(/^0x/, '')
  if (hex.length < 128) return ''
  const len = Number(BigInt(`0x${hex.slice(64, 128)}`))
  if (!Number.isFinite(len) || len <= 0 || len > 2048) return ''
  const bytes = hex.slice(128, 128 + len * 2)
  let text = ''
  for (let i = 0; i < bytes.length; i += 2) text += String.fromCharCode(parseInt(bytes.slice(i, i + 2), 16))
  return text
}

export async function tokenUri(contract, id) {
  const data = `0x0e89341c${hexId(id)}`
  const uri = decodeString(await ethCall(contract, data))
  return uri.replace('{id}', hexId(id))
}

/** Media links anywhere in metadata. Depth, nodes visited and links found are all bounded. */
function walkLinks(node, path, found, depth = 0, budget = { left: MAX_WALK }) {
  if (found.length >= MAX_LINKS || budget.left <= 0 || depth > MAX_DEPTH) return
  budget.left -= 1
  if (typeof node === 'string') {
    if (node.length < 2048 && AUDIO_EXT.test(node)) found.push({ name: plainName(path, 80) || fileName(node), url: node })
    return
  }
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length && budget.left > 0; i++) walkLinks(node[i], `${path}/${i + 1}`, found, depth + 1, budget)
    return
  }
  for (const key of Object.keys(node)) {
    if (budget.left <= 0 || found.length >= MAX_LINKS) return
    walkLinks(node[key], path ? `${path}/${key}` : key, found, depth + 1, budget)
  }
}

function fileName(url) {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop()
    return plainName(decodeURIComponent(last || 'media'), 80) || 'media'
  } catch {
    return 'media'
  }
}

function pushLink(list, name, url) {
  if (!url || typeof url !== 'string' || url.startsWith('data:')) return
  if (url.length > 2048 || list.length >= MAX_LINKS || list.some((item) => item.url === url)) return
  list.push({ name: plainName(name, 80) || fileName(url), url })
}

export function linksFromItem(item) {
  const links = []
  pushLink(links, 'animation', item?.animation_url)
  if (AUDIO_EXT.test(item?.media_url || '')) pushLink(links, 'media', item.media_url)
  const meta = item?.metadata
  if (meta && typeof meta === 'object') {
    pushLink(links, 'animation', meta.animation_url)
    pushLink(links, 'audio', meta.audio || meta.audio_url)
    const nested = []
    try {
      walkLinks(meta, '', nested)
    } catch {
      /* metadata too odd to walk: the links found so far stay */
    }
    nested.forEach((link) => pushLink(links, link.name, link.url))
  }
  return links
}

/** An https URL for token metadata. ipfs:// goes through a public gateway. Anything else is not read. */
function metadataUrl(uri) {
  const text = String(uri || '').trim()
  if (text.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${text.slice(7).replace(/^ipfs\//, '')}`
  return /^https:\/\//i.test(text) ? text : ''
}

/**
 * Every token of one type in the wallet, page by page, until the listing ends or MAX_PAGES. `partial` is true
 * when the listing stopped early (the cap, or a page that failed after the first).
 */
export async function pageTokens(address, type, { fetchImpl = fetch, maxPages = MAX_PAGES } = {}) {
  const items = []
  let params = ''
  for (let i = 0; i < maxPages; i++) {
    const url = `https://eth.blockscout.com/api/v2/addresses/${address}/nft?type=${encodeURIComponent(type)}${params}`
    let data
    try {
      const { res, buffer } = await fetchCapped(url, { limit: PAGE_BYTES, timeoutMs: NET_MS, fetchImpl })
      if (!buffer) throw new Error(`Wallet listing failed (${res.status})`)
      data = JSON.parse(new TextDecoder().decode(buffer))
    } catch (err) {
      // Nothing read at all is an error. A later page failing leaves what was read, marked partial.
      if (!items.length && i === 0) throw err
      return { items, partial: true }
    }
    if (Array.isArray(data?.items)) items.push(...data.items.filter((item) => item && typeof item === 'object'))
    const next = data?.next_page_params
    if (!next || typeof next !== 'object') return { items, partial: false }
    params = '&' + new URLSearchParams(Object.fromEntries(Object.entries(next).map(([k, v]) => [k, String(v)]))).toString()
  }
  return { items, partial: true }
}

/** Whether the wallet holds any token of a collection, from the token balance list (one read, not paged). */
async function holdsCollection(address, contract, fetchImpl) {
  const url = `https://eth.blockscout.com/api/v2/addresses/${address}/token-balances`
  const list = await fetchJsonCapped(url, { limit: PAGE_BYTES, timeoutMs: NET_MS, fetchImpl })
  if (!Array.isArray(list)) throw new Error('token balances')
  return list.some((row) => String(row?.token?.address_hash || '').toLowerCase() === contract.toLowerCase() && String(row?.value || '0') !== '0')
}

/**
 * Packs of media in a wallet. `partial` says the list is not the whole wallet (a cap or a failed read), with
 * `notLoaded` the tokens or metadata reads that were skipped, so the screen can say "showing N, more not
 * loaded" instead of "nothing here". A known collection missing from a partial list is checked on its own:
 * `locked` only lists one the wallet surely does not hold, `unknown` one that could not be checked.
 */
export async function loadWalletPacks(address, { fetchImpl = fetch, maxPages = MAX_PAGES } = {}) {
  if (!isAddress(address)) throw new Error('Paste a 0x address, or use the wallet button')
  const [erc721, erc1155] = await Promise.all([
    pageTokens(address, 'ERC-721', { fetchImpl, maxPages }),
    pageTokens(address, 'ERC-1155', { fetchImpl, maxPages }),
  ])
  let partial = erc721.partial || erc1155.partial
  let notLoaded = 0
  const groups = new Map()
  const seen = new Set()
  let fetched = 0
  for (const item of [...erc721.items, ...erc1155.items]) {
    const contract = typeof item.token?.address_hash === 'string' ? item.token.address_hash : ''
    if (!/^0x[0-9a-fA-F]{40}$/.test(contract)) continue
    const key = contract.toLowerCase()
    seen.add(key)
    const known = COLLECTIONS.find((c) => c.contract.toLowerCase() === key)
    let links = []
    try {
      links = linksFromItem(item)
    } catch {
      links = []
    }
    if (!links.length && known) {
      if (fetched >= MAX_META_READS) {
        notLoaded += 1
      } else {
        fetched += 1
        try {
          const uri = metadataUrl(await tokenUri(contract, item.id))
          if (!uri) throw new Error('no metadata link')
          const meta = await fetchJsonCapped(uri, { limit: META_BYTES, timeoutMs: NET_MS, fetchImpl })
          if (meta && typeof meta === 'object') {
            links = linksFromItem({ ...item, metadata: meta, animation_url: meta.animation_url })
            if (!item.metadata) item.metadata = { name: meta.name }
          }
        } catch {
          notLoaded += 1
        }
      }
    }
    if (!links.length && !known) continue
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        name: known?.name || plainName(item.token?.name, 80) || 'Collection',
        contract,
        known: !!known,
        tokens: [],
      })
    }
    if (links.length) {
      const id = plainName(String(item.id ?? ''), 80)
      groups.get(key).tokens.push({
        id,
        name: plainName(item.metadata?.name, 80) || `#${id}`,
        links,
      })
    }
  }
  if (notLoaded) partial = true
  const packs = [...groups.values()]
  const locked = []
  const unknown = []
  for (const c of COLLECTIONS) {
    if (seen.has(c.contract.toLowerCase())) continue
    const entry = { id: c.id, name: c.name, contract: c.contract }
    if (!partial) {
      locked.push(entry)
      continue
    }
    try {
      if (await holdsCollection(address, c.contract, fetchImpl)) {
        packs.push({ id: c.id, name: c.name, contract: c.contract, known: true, tokens: [] })
      } else {
        locked.push(entry)
      }
    } catch {
      unknown.push(entry)
    }
  }
  const shown = packs.reduce((sum, pack) => sum + pack.tokens.length, 0)
  return { packs, locked, unknown, partial, notLoaded, shown }
}

/** What the wallet read found, in words. A partial list never reads as "nothing here". */
export function walletSummary(result, songs = 0) {
  const songNote = songs ? `, ${songs} songs` : ''
  const count = result?.shown ?? 0
  if (result?.partial) {
    return `Showing ${count} token${count === 1 ? '' : 's'} with media${songNote}. More not loaded: the wallet list was cut short. Read again to try the rest.`
  }
  if (count) return `${count} tokens with media${songNote}`
  return songs ? `${songs} songs from this wallet` : 'No audio or video in this wallet yet'
}
