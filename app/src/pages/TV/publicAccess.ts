import type { Tape } from '../../../api/_lib/publicaccess'
import { readTapeList } from './feeds'
import { NOT_SENT, PUBLIC_ACCESS_PATH, reviewMessage, submitMessage, TapeRefusal } from '../../../api/_lib/publicaccess'

export type PublicAccessList = { tapes: Tape[]; pending: Tape[]; admins: string[] }
type Sign = (message: string) => Promise<string>

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${PUBLIC_ACCESS_PATH}${path}`, init)
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (res.ok) return json
  // A crash can answer with anything: only a refusal, or "opens soon", is ours to show.
  throw json.error && (res.status < 500 || res.status === 503) ? new TapeRefusal(json.error) : new Error(NOT_SENT)
}

const post = <T>(path: string, body: unknown) =>
  call<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

/** Checked for shape: a broken answer gives empty lists, never a crash in the line-up. */
export const fetchTapes = async (): Promise<PublicAccessList> => readTapeList(await call<unknown>(''))

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
