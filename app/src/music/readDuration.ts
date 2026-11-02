/** Reads an audio file's duration (seconds) with a detached Audio element, before anything is uploaded. */
export function readAudioDuration(file: Blob, timeoutMs = 15_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const el = new Audio()
    el.preload = 'metadata'
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = (fn: () => void) => {
      clearTimeout(timer)
      el.removeAttribute('src')
      el.load()
      URL.revokeObjectURL(url)
      fn()
    }

    timer = setTimeout(() => done(() => reject(new Error('Timed out reading the audio file.'))), timeoutMs)
    el.addEventListener('loadedmetadata', () => {
      const d = el.duration
      if (Number.isFinite(d) && d > 0) done(() => resolve(d))
      else done(() => reject(new Error('Could not read the track length.')))
    })
    el.addEventListener('error', () =>
      done(() => reject(new Error('This browser cannot decode the file. Is it a valid audio file?')))
    )
    el.src = url
  })
}
