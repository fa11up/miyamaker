/**
 * Splits chat text into plain-text and link segments. Only http(s) URLs become links; everything
 * else (javascript:, data:, mailto:, bare domains) stays text. The caller renders segments as React
 * text nodes and <a rel="noopener noreferrer nofollow">, never as HTML.
 * No imports, so `node --test` can load it (tests/miyatv.test.mts).
 */
export type Segment = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string }

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi
// Punctuation that usually ends a sentence rather than a URL.
const TRAILING = /[.,!?;:)\]}'"]$/

const count = (s: string, ch: string) => s.split(ch).length - 1

/** Drop sentence punctuation after a URL, but keep a ')' the URL itself opened (wikipedia-style). */
function trimTrailing(url: string): string {
  let out = url
  while (TRAILING.test(out)) {
    if (out.endsWith(')') && count(out, '(') >= count(out, ')')) break
    out = out.slice(0, -1)
  }

  return out
}

export function safeHref(raw: string): string | undefined {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (url.username || url.password) return undefined
    return url.href
  } catch {
    return undefined
  }
}

export function linkify(input: string): Segment[] {
  const out: Segment[] = []
  let last = 0
  const push = (text: string) => {
    if (!text) return
    const prev = out[out.length - 1]
    if (prev && prev.kind === 'text') prev.text += text
    else out.push({ kind: 'text', text })
  }

  Array.from(input.matchAll(URL_RE)).forEach((match) => {
    const start = match.index ?? 0
    const raw = trimTrailing(match[0])
    push(input.slice(last, start))
    const href = safeHref(raw)
    if (href) out.push({ kind: 'link', text: raw, href })
    else push(raw)
    last = start + raw.length
  })

  push(input.slice(last))
  return out
}

/** 0x1234…abcd */
export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}
