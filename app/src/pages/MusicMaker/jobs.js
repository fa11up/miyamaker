// One rule for async work that can land late.
// Work that rewrites the kit or its stored samples (song and kit loads, undo, a sample landing on a pad)
// runs through `exclusive`, one job at a time, so two of them never interleave their reads and writes.
// Work that can simply be dropped when it is stale (a save repointing the session, a recording, an import
// aimed at a pad) captures `songId()` when it starts and checks it before it writes into the session.
// Nothing here imports the rest of the app, so every module can use it.

let tail = Promise.resolve()
let pending = 0
let song = 0
let latestLoad = 0

/** Run `fn` after every earlier exclusive job has settled. Never call it from inside an exclusive job. */
export function exclusive(fn) {
  pending += 1
  const run = tail.then(() => fn())
  const settled = run.then(
    () => {
      pending -= 1
    },
    () => {
      pending -= 1
    },
  )
  tail = settled
  return run
}

/** An exclusive job is running or queued. */
export function jobsBusy() {
  return pending > 0
}

/** Resolves once every job queued so far has settled. */
export function jobsIdle() {
  return tail
}

/** Which song (and kit) the session holds. Changes on a song load, a kit swap, or a new session. */
export function songId() {
  return song
}

export function bumpSong() {
  song += 1
  return song
}

/** True while nothing has replaced the song since `id` was taken. */
export function sameSong(id) {
  return id === song
}

/** A ticket for a song load, taken when the user asks for it. A newer ticket supersedes it. */
export function loadTicket() {
  latestLoad += 1
  return latestLoad
}

export function loadCurrent(ticket) {
  return ticket === latestLoad
}

/** Thrown by a write aimed at a song that is no longer open. Callers keep the data elsewhere or drop it. */
export class SongChanged extends Error {
  constructor(message = 'The song changed before that landed') {
    super(message)
    this.name = 'SongChanged'
  }
}
