import type { Tape } from '../../../api/_lib/publicaccess'
import { PUBLIC_ACCESS_PATH, reviewMessage, submitMessage } from '../../../api/_lib/publicaccess'

export type PublicAccessList = { tapes: Tape[]; pending: Tape[]; admins: string[] }
type Sign = (message: string) => Promise<string>

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${PUBLIC_ACCESS_PATH}${path}`, init).catch(() => {
    throw new Error('Could not reach public access. Check your connection and try again.')
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(json.error || `Public access answered ${res.status}.`)
  return json
}

const post = <T>(path: string, body: unknown) =>
  call<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const fetchTapes = () => call<PublicAccessList>('')

export async function submitTape(videoId: string, wallet: string, sign: Sign) {
  const at = Date.now()
  const signature = await sign(submitMessage({ videoId, wallet, at }))
  return post<{ tape: Tape }>('/submit', { videoId, wallet, at, signature })
}

export async function reviewTape(videoId: string, decision: 'approve' | 'remove', wallet: string, sign: Sign) {
  const at = Date.now()
  const signature = await sign(reviewMessage({ videoId, decision, wallet, at }))
  return post<{ ok: boolean }>('/review', { videoId, decision, wallet, at, signature })
}
