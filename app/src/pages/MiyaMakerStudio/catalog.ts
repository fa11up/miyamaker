/** Direct children listed on one koolskull.com autoindex page. */

const ROOT = '/miyamaker/layers'
const SKIP = new Set(['__MACOSX'])

export type IndexEntry = { kind: 'dir' | 'file'; name: string; path: string }

/** `dirPath` is the folder under `layers`. Empty at the root. Parent links are left out. */
export function parseLayerIndex(html: string, dirPath = ''): IndexEntry[] {
  const prefix = dirPath ? `${dirPath}/` : ''
  const out: IndexEntry[] = []
  const seen = new Set<string>()
  for (const match of html.matchAll(/href="([^"]+)"/gi)) {
    const raw = match[1]
    if (!raw || raw.startsWith('?') || raw.startsWith('#') || raw.includes('/_autoindex/')) continue
    let decoded: string
    try {
      decoded = decodeURIComponent(raw.split('?')[0] ?? '')
    } catch {
      continue
    }
    if (!decoded.startsWith(`${ROOT}/`)) continue
    const relative = decoded.slice(ROOT.length + 1)
    if (!relative || relative.includes('..')) continue
    if (dirPath && !relative.startsWith(prefix)) continue
    const rest = dirPath ? relative.slice(prefix.length) : relative
    const directory = rest.endsWith('/')
    const name = directory ? rest.slice(0, -1) : rest
    if (!name || name.includes('/') || name.startsWith('.') || SKIP.has(name) || seen.has(name)) continue
    if (!directory && !/\.(png|jpe?g|webp)$/i.test(name)) continue
    seen.add(name)
    const path = dirPath ? `${dirPath}/${name}` : name
    out.push({ kind: directory ? 'dir' : 'file', name, path })
  }
  return out
}
