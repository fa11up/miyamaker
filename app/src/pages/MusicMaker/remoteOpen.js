let job = null
const listeners = new Set()

export function queueRemoteOpen(next) {
  job = next
  listeners.forEach((fn) => fn(next))
}

export function takeRemoteOpen() {
  const current = job
  job = null
  return current
}

export function subscribeRemoteOpen(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
