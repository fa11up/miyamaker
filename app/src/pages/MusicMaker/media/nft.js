/** Read-only wallet listing. No signatures, no transfers. */

export const COLLECTIONS = [
  {
    id: 'ravepigs',
    name: 'Ravepigs',
    contract: '0xc99718df2d6286b7dc87c0cc71d46a20b0086f4c',
  },
]

const AUDIO_EXT = /\.(wav|mp3|m4a|aac|ogg|flac|aiff|aif|mp4|webm|mov|m4v)(\?|#|$)/i
const RPC = 'https://ethereum.publicnode.com'

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
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
  })
  const body = await res.json()
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

function walkLinks(node, path, found) {
  if (typeof node === 'string') {
    if (AUDIO_EXT.test(node)) found.push({ name: path || fileName(node), url: node })
    return
  }
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((item, i) => walkLinks(item, `${path}/${i + 1}`, found))
    return
  }
  for (const [key, value] of Object.entries(node)) walkLinks(value, path ? `${path}/${key}` : key, found)
}

function fileName(url) {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop()
    return decodeURIComponent(last || 'media')
  } catch {
    return 'media'
  }
}

function pushLink(list, name, url) {
  if (!url || typeof url !== 'string' || url.startsWith('data:')) return
  if (list.some((item) => item.url === url)) return
  list.push({ name: name || fileName(url), url })
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
    walkLinks(meta, '', nested)
    nested.forEach((link) => pushLink(links, link.name, link.url))
  }
  return links
}

async function pageTokens(address, type) {
  const items = []
  let params = ''
  for (let i = 0; i < 3; i++) {
    const url = `https://eth.blockscout.com/api/v2/addresses/${address}/nft?type=${encodeURIComponent(type)}${params}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Wallet listing failed (${res.status})`)
    const data = await res.json()
    items.push(...(data.items || []))
    const next = data.next_page_params
    if (!next) break
    params = '&' + new URLSearchParams(Object.fromEntries(Object.entries(next).map(([k, v]) => [k, String(v)]))).toString()
  }
  return items
}

export async function loadWalletPacks(address) {
  if (!isAddress(address)) throw new Error('Paste a 0x address, or use the wallet button')
  const [erc721, erc1155] = await Promise.all([pageTokens(address, 'ERC-721'), pageTokens(address, 'ERC-1155')])
  const groups = new Map()
  let fetched = 0
  for (const item of [...erc721, ...erc1155]) {
    const contract = item.token?.address_hash || ''
    if (!contract) continue
    const key = contract.toLowerCase()
    const known = COLLECTIONS.find((c) => c.contract.toLowerCase() === key)
    let links = linksFromItem(item)
    if (!links.length && known && fetched < 8) {
      fetched += 1
      try {
        const uri = await tokenUri(contract, item.id)
        if (uri) {
          const metaRes = await fetch(uri)
          if (metaRes.ok) {
            const meta = await metaRes.json()
            links = linksFromItem({ ...item, metadata: meta, animation_url: meta.animation_url })
          }
        }
      } catch {
        /* the token stays in the pack with no file */
      }
    }
    if (!links.length && !known) continue
    if (!groups.has(key)) {
      groups.set(key, {
        id: key,
        name: known?.name || item.token?.name || 'Collection',
        contract,
        known: !!known,
        tokens: [],
      })
    }
    if (links.length) {
      groups.get(key).tokens.push({
        id: String(item.id),
        name: item.metadata?.name || `#${item.id}`,
        links,
      })
    }
  }
  const packs = [...groups.values()]
  const held = new Set(packs.map((pack) => pack.contract.toLowerCase()))
  const locked = COLLECTIONS.filter((c) => !held.has(c.contract.toLowerCase())).map((c) => ({
    id: c.id,
    name: c.name,
    contract: c.contract,
  }))
  return { packs, locked }
}
