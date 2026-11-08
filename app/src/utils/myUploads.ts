/**
 * What a wallet has stored through MiyaOS, read back from Irys. Every upload is tagged application-id: MiyaOS and
 * signed by the wallet that paid, so the wallet's address finds them. A folder's files are signed by a throwaway key
 * (see fundAndUploadFolder), so a folder is found by the small record the wallet signs once its files are stored.
 */
export type UploadKind = 'image' | 'audio' | 'folder'

export type Upload = {
  id: string
  kind: UploadKind
  name?: string
  mime?: string
  /** Milliseconds. */
  at?: number
  files?: number
}

export type FolderFile = { id: string; path: string; kind?: 'image' | 'audio'; mime?: string }

type Tag = { name: string; value: string }
type Node = { id: string; timestamp?: number; tags?: Tag[] }

const TX_ID = /^[A-Za-z0-9_-]{43,44}$/
const QUERY = `query($owners:[String!],$after:String){transactions(owners:$owners,tags:[{name:"application-id",values:["MiyaOS"]}],limit:100,order:DESC,after:$after){pageInfo{hasNextPage endCursor}edges{node{id timestamp tags{name value}}}}}`
const MAX_PAGES = 5

/** Files a folder should not carry: the system's own, which nobody meant to store forever. */
export const isJunkFile = (path: string) => {
  const name = path.split('/').pop() || ''
  return !name || name.startsWith('.') || name === 'Thumbs.db' || name === 'desktop.ini'
}

/** A path inside the folder, so a piece reads as ar://folder/1 and not ar://folder/my-art/1. */
export const pathInFolder = (relative: string) => relative.split('/').slice(1).join('/') || relative

export function parseUpload(node: Node): Upload | undefined {
  const tag = (name: string) => node.tags?.find((t) => t.name.toLowerCase() === name.toLowerCase())?.value
  const base = { name: tag('File-Name'), at: node.timestamp }
  if (tag('miya-kind') === 'folder') {
    const id = tag('Folder-Manifest')
    if (!id || !TX_ID.test(id)) return undefined
    const files = Number(tag('File-Count'))
    return { ...base, id, kind: 'folder', name: tag('Folder-Name'), files: files > 0 ? files : undefined }
  }
  const mime = tag('Content-Type')?.toLowerCase()
  if (!TX_ID.test(node.id)) return undefined
  if (mime?.startsWith('image/')) return { ...base, id: node.id, kind: 'image', mime }
  if (mime?.startsWith('audio/')) return { ...base, id: node.id, kind: 'audio', mime }
  return undefined
}

const AUDIO_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
}
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif|svg)$/i

/** The files in a folder's manifest. Their kinds come from the file name, as the manifest records nothing else. */
export function parseManifest(manifest: unknown): FolderFile[] {
  const paths = (manifest as { paths?: Record<string, { id?: unknown }> })?.paths
  if (!paths || typeof paths !== 'object') return []
  return Object.entries(paths).flatMap(([path, entry]) => {
    const id = entry?.id
    if (typeof id !== 'string' || !TX_ID.test(id)) return []
    const mime = AUDIO_TYPES[path.split('.').pop()?.toLowerCase() || '']
    return [{ id, path, mime, kind: mime ? ('audio' as const) : IMAGE_FILE.test(path) ? ('image' as const) : undefined }]
  })
}

/**
 * Newest first. `node` is the Irys node, whose /graphql serves this from the browser. Only the newest MAX_PAGES pages
 * are read: `partial` says there were more, so the list must not read as everything the wallet stored.
 */
export async function fetchUploads(node: string, wallet: string): Promise<{ uploads: Upload[]; partial: boolean }> {
  const found: Upload[] = []
  let after: string | undefined
  let partial = false
  for (let page = 0; page < MAX_PAGES; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(`${node.replace(/\/$/, '')}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { owners: [wallet], after } }),
    })
    if (!res.ok) throw new Error(`Irys answered ${res.status}.`)
    // eslint-disable-next-line no-await-in-loop
    const json = await res.json()
    const list = json?.data?.transactions
    if (!list) throw new Error('Irys could not list your uploads.')
    for (const edge of list.edges || []) {
      const upload = parseUpload(edge.node)
      if (upload) found.push(upload)
    }
    if (!list.pageInfo?.hasNextPage) break
    if (page === MAX_PAGES - 1) partial = true
    after = list.pageInfo.endCursor
  }
  return { uploads: found, partial }
}
