// src/pages/MusicMaker: async work that lands late. Kit and storage rewrites (loads, undo, a sample on a
// pad) run one at a time, a newer song load supersedes an older one before it writes, storage is written
// before the session so a failed write changes nothing, stale takes and imports never land in another
// song, and a closed window is not woken by an await that finishes after it.
// Run: yarn test
import assert from 'node:assert/strict'
import { after, test } from 'node:test'

const g = globalThis as any

// The engine reads window, document and Web Audio only when it runs. Just enough of each is faked here.
function anyNode(): any {
  const store = new Map<PropertyKey, any>()
  return new Proxy(function () {}, {
    get(_, key) {
      if (key === Symbol.toPrimitive) return () => 0
      if (key === 'then') return undefined
      if (!store.has(key)) store.set(key, anyNode())
      return store.get(key)
    },
    set(_, key, value) {
      store.set(key, value)
      return true
    },
    apply: () => anyNode(),
    construct: () => anyNode(),
  })
}

const audio = { wake: null as null | (() => void), contexts: 0 }
class FakeContext {
  state = 'suspended'
  currentTime = 0
  sampleRate = 44100
  destination = anyNode()
  audioWorklet = { addModule: () => Promise.reject(new Error('no worklets in Node')) }
  constructor() {
    audio.contexts += 1
    const node = anyNode()
    return new Proxy(this, {
      get(target: any, key) {
        if (key in target) return target[key]
        return node[key]
      },
    })
  }
  resume() {
    return new Promise<void>((resolve) => {
      audio.wake = () => {
        this.state = 'running'
        resolve()
      }
    })
  }
  suspend() {
    this.state = 'suspended'
    return Promise.resolve()
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length)
    return { length, sampleRate, duration: length / sampleRate, numberOfChannels: 1, getChannelData: () => data }
  }
}

g.window = {
  AudioContext: FakeContext,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  addEventListener() {},
}
g.document = { querySelector: () => null }
g.URL.createObjectURL = () => 'blob:fake'
g.URL.revokeObjectURL = () => {}

/** IndexedDB in memory. Every request settles on a later tick, so async work really overlaps. */
function memoryIdb(opts: { failPut?: (key: string) => boolean; failGet?: (key: string) => boolean; putMs?: number } = {}) {
  const data = new Map<string, any>()
  const log: string[] = []
  const db = {
    objectStoreNames: { contains: () => true },
    close() {},
    transaction() {
      const tx: any = { error: null }
      let job: () => void = () => {}
      const req: any = {}
      let wait = 1
      tx.objectStore = () => ({
        put(value: any, key: string) {
          wait = opts.putMs ?? 1
          job = () => {
            if (opts.failPut?.(key)) {
              const err = new Error('quota')
              err.name = 'QuotaExceededError'
              throw err
            }
            data.set(key, value)
            log.push(`put ${key} ${value?.name ?? ''}`)
          }
          return req
        },
        delete(key: string) {
          job = () => {
            data.delete(key)
            log.push(`delete ${key}`)
          }
          return req
        },
        get(key: string) {
          job = () => {
            if (opts.failGet?.(key)) throw new Error('read failed')
            req.result = data.get(key)
          }
          return req
        },
        getAllKeys() {
          job = () => {
            req.result = [...data.keys()]
          }
          return req
        },
      })
      // Scheduled after the caller has queued its request, so a put can take longer than a delete.
      queueMicrotask(() => setTimeout(() => {
        try {
          job()
          req.onsuccess?.()
          tx.oncomplete?.()
        } catch (err) {
          tx.error = err
          tx.onabort?.()
        }
      }, wait))
      return tx
    },
  }
  return {
    data,
    log,
    api: {
      open() {
        const r: any = {}
        setTimeout(() => {
          r.result = db
          r.onsuccess?.()
        }, 0)
        return r
      },
    },
  }
}

const { typing } = await import('../src/pages/MusicMaker/keys.js')
const jobs = await import('../src/pages/MusicMaker/jobs.js')
const modelMod = await import('../src/pages/MusicMaker/model.js')
const history = await import('../src/pages/MusicMaker/history.js')
const song = await import('../src/pages/MusicMaker/audio/song.js')
const library: any = await import('../src/pages/MusicMaker/media/library.js')
const engine = await import('../src/pages/MusicMaker/audio/engine.js')
const { model: musicModel, audioBank, emptyPad, loadFactoryKit, rememberSample, restoreSamples, boot, save, BACKUP_KEY, BACKUP_EXTRA } = modelMod
// The sampler's state is plain JS; the tests poke at it freely, so it is typed loosely here.
const model = musicModel as unknown as { pads: any[]; buses: any[]; [key: string]: any }

// The fake context has no worklets: the engine's fallbacks warn about that, which is expected here.
const realWarn = console.warn
console.warn = (...args: any[]) => {
  if (/worklet failed/.test(String(args[0]))) return
  realWarn(...args)
}
// A failed assertion must not leave the clock or meter intervals keeping the process alive.
after(() => engine.shutdown())

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

function withIdb<T>(idb: ReturnType<typeof memoryIdb>, fn: () => Promise<T>) {
  g.indexedDB = idb.api
  return fn().finally(() => {
    delete g.indexedDB
  })
}

function songDoc(name: string, sampleName: string) {
  const pads: any[] = Array.from({ length: 64 }, (_, i) => emptyPad(i))
  pads[0].name = `${name} kick`
  return {
    type: 'm1ya',
    v: 2,
    name,
    bpm: 120,
    order: [0],
    patterns: [{ i: 0, name, bars: 1, steps: [] }],
    pads,
    samples: [{ pad: 0, name: sampleName, sr: 44100, pcm: new Float32Array([0.1, 0.2, 0.3]) }],
  }
}

test('keys typed into the maker’s own fields are not shortcuts, even seen from a window listener', () => {
  const input = { tagName: 'INPUT', type: 'text' }
  const host = { tagName: 'DIV' }
  // In the shadow root the window sees the host as target; the composed path starts at the field.
  assert.equal(typing({ target: host, composedPath: () => [input, host] }), true)
  assert.equal(typing({ target: host, key: 'Tab', composedPath: () => [{ tagName: 'INPUT', type: 'number' }, host] }), true)
  assert.equal(typing({ target: host, composedPath: () => [{ tagName: 'TEXTAREA' }, host] }), true)
  assert.equal(typing({ target: host, composedPath: () => [{ tagName: 'SPAN', isContentEditable: true }, host] }), true)
  assert.equal(typing({ target: host, composedPath: () => [{ tagName: 'BUTTON' }, host] }), false)
  // A focused slider or checkbox still lets the pads play.
  assert.equal(typing({ target: host, composedPath: () => [{ tagName: 'INPUT', type: 'range' }, host] }), false)
  assert.equal(typing({ target: input }), true, 'no composedPath falls back to target')
})

test('exclusive jobs run one at a time, in order, and a failed one does not block the next', async () => {
  const order: string[] = []
  let inside = 0
  const job = (name: string, ms: number, fail = false) => jobs.exclusive(async () => {
    inside += 1
    assert.equal(inside, 1, 'never two at once')
    order.push(`${name}+`)
    await tick(ms)
    order.push(`${name}-`)
    inside -= 1
    if (fail) throw new Error(name)
  })
  const a = job('a', 5)
  const b = job('b', 1, true)
  const c = job('c', 0)
  assert.equal(jobs.jobsBusy(), true)
  await a
  await assert.rejects(b, /b/)
  await c
  assert.deepEqual(order, ['a+', 'a-', 'b+', 'b-', 'c+', 'c-'])
  assert.equal(jobs.jobsBusy(), false)
})

test('a newer song load supersedes one in flight: the older one writes nothing, the kits never mix', async () => {
  const idb = memoryIdb()
  await withIdb(idb, async () => {
    loadFactoryKit()
    history.armHistory()
    const first = song.loadSong(songDoc('Alpha', 'alpha-sample'), 'fa')
    await tick(8) // Alpha is reading the old pads for undo
    const second = song.loadSong(songDoc('Bravo', 'bravo-sample'), 'fb')
    assert.equal(await first, false)
    assert.equal(await second, true)
    assert.equal(model.songName, 'Bravo')
    assert.equal(model.songFile, 'fb')
    assert.equal(model.pads[0].name, 'Bravo kick')
    assert.equal(model.pads[0].sampleName, 'bravo-sample')
    assert.equal(idb.data.get('pad:0').name, 'bravo-sample')
    assert.ok(!idb.log.some((line) => line.includes('alpha')), 'no storage write of the superseded load landed')
    // Two quick clicks: the ticket is taken on the click, so the later one wins even if its read is faster.
    const t1 = jobs.loadTicket()
    const t2 = jobs.loadTicket()
    assert.equal(await song.loadSong(songDoc('Charlie', 'c'), '', t2), true)
    assert.equal(await song.loadSong(songDoc('Delta', 'd'), '', t1), false)
    assert.equal(model.songName, 'Charlie')
  })
})

test('Undo pressed twice runs both steps in order; the stored sample matches the pad afterwards', async () => {
  // A slow put and a fast delete: run side by side, the first undo's put would land after the second's delete.
  const idb = memoryIdb({ putMs: 15 })
  await withIdb(idb, async () => {
    loadFactoryKit()
    history.armHistory()
    await rememberSample(5, { pcm: new Float32Array([0.5]), sr: 44100, name: 'one' })
    await tick(500) // past the glide window, so the second sample is its own step
    await rememberSample(5, { pcm: new Float32Array([0.7]), sr: 44100, name: 'two' })
    assert.equal(idb.data.get('pad:5').name, 'two')
    const a = history.undo()
    const b = history.undo()
    assert.equal(await a, true)
    assert.equal(await b, true)
    assert.equal(idb.data.has('pad:5'), false, 'the second undo deleted the key after the first restored it')
    assert.notEqual(model.pads[5].source, 'sample')
    assert.equal(await history.undo(), false)
    // Undo is not stuck in its restoring state: a new edit is recorded again.
    model.buses[0].volume = 0.12
    modelMod.touch(true)
    assert.equal(history.canUndo(), true)
    assert.equal(await history.undo(), true)
  })
})

test('a failed sample write leaves the pad, its audio, and the undo stack as they were', async () => {
  const idb = memoryIdb({ failPut: (key) => key === 'pad:3' })
  await withIdb(idb, async () => {
    loadFactoryKit()
    history.armHistory()
    const pad = JSON.stringify(model.pads[3])
    const entry = audioBank.get(3)
    await assert.rejects(rememberSample(3, { pcm: new Float32Array([0.9]), sr: 44100, name: 'nope', padPatch: { trimStart: 0.4 } }), /quota/)
    assert.equal(JSON.stringify(model.pads[3]), pad)
    assert.equal(audioBank.get(3), entry)
    assert.match(model.saveError, /Sample not saved/)
    assert.equal(history.canUndo(), false)
    model.saveError = ''
  })
})

test('a take or import aimed at a song that was replaced does not write into the new one', async () => {
  const idb = memoryIdb()
  await withIdb(idb, async () => {
    loadFactoryKit()
    const before = jobs.songId()
    await song.loadSong(songDoc('Echo', 'e'), '')
    assert.notEqual(jobs.songId(), before)
    await assert.rejects(
      rememberSample(9, { pcm: new Float32Array([0.3]), sr: 44100, name: 'late take', song: before }),
      (err: Error) => err instanceof jobs.SongChanged,
    )
    assert.equal(idb.data.has('pad:9'), false)
    assert.notEqual(model.pads[9].name, 'late take')
    // placePcm keeps it in the library instead
    const files = library.ensureLibrary().files.length
    await engine.placePcm(9, new Float32Array([0.3]), 44100, 'late import', { song: before as any })
    assert.notEqual(model.pads[9].name, 'late import')
    assert.equal(library.ensureLibrary().files.length, files + 1)
    assert.match(model.browserNote, /song changed/i)
  })
})

test('a failed song, kit, or library write adds no library entry that points at nothing', async () => {
  const idb = memoryIdb({ failPut: () => true })
  await withIdb(idb, async () => {
    loadFactoryKit()
    model.library = null
    const files = library.ensureLibrary().files.length
    await assert.rejects(song.storeSongFile('Lost', song.blankSong()), /quota/)
    await assert.rejects(song.storeKitFile('Lost', { pads: [], samples: [] }), /quota/)
    await assert.rejects(library.cachePcm('imports', 'lost', new Float32Array([0.1]), 44100), /quota/)
    assert.equal(library.ensureLibrary().files.length, files)
    model.saveError = ''
  })
})

test('restoreSamples reads every pad it can, then reports the ones it could not', async () => {
  const idb = memoryIdb({ failGet: (key) => key === 'pad:2' })
  idb.data.set('pad:1', { pcm: new Float32Array([0.4]), sr: 22050 })
  idb.data.set('pad:2', { pcm: new Float32Array([0.4]), sr: 22050 })
  await withIdb(idb, async () => {
    loadFactoryKit()
    model.pads[1].source = 'sample'
    model.pads[2].source = 'sample'
    audioBank.delete(1)
    audioBank.delete(2)
    const warn = console.warn
    console.warn = () => {}
    try {
      await assert.rejects(restoreSamples(), /1 sample could not be read/)
    } finally {
      console.warn = warn
    }
    assert.equal(audioBank.get(1)?.sr, 22050)
    assert.equal(audioBank.has(2), false)
  })
})

test('a new session clears undo, and a song switch keeps only the step back to the old song', () => withIdb(memoryIdb(), async () => {
  loadFactoryKit()
  history.armHistory()
  model.buses[0].volume = 0.2
  modelMod.touch(true)
  history.flushHistory()
  assert.equal(history.canUndo(), true)
  history.armHistory()
  assert.equal(history.canUndo(), false, 'a reopened window cannot undo into the last session')

  model.buses[0].volume = 0.33
  modelMod.touch(true)
  history.flushHistory()
  await tick(500)
  model.bpm = 101
  modelMod.touch(true)
  history.flushHistory()
  await song.loadSong(songDoc('Foxtrot', 'f'), 'ff')
  assert.equal(model.songName, 'Foxtrot')
  assert.equal(await history.undo(), true)
  assert.equal(model.songName, '')
  assert.equal(model.bpm, 101, 'back to the song as it was just before the load')
  assert.equal(await history.undo(), false, 'no further into the other song’s history')
}))

test('a second unreadable save never replaces the first backup, and extra backups stay bounded', () => {
  const map = new Map<string, string>()
  const store = {
    get length() {
      return map.size
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
  }
  g.localStorage = store
  const warn = console.warn
  console.warn = () => {}
  const realNow = Date.now
  let now = 1_000
  Date.now = () => (now += 10)
  try {
    for (let i = 0; i < 6; i++) {
      map.set('miya-music-maker-v1', `{broken ${i}`)
      boot()
    }
    assert.equal(map.get(BACKUP_KEY), '{broken 0', 'the first backup is kept')
    const extra = [...map.keys()].filter((k) => k.startsWith(`${BACKUP_KEY}-`)).sort()
    assert.equal(extra.length, BACKUP_EXTRA)
    assert.equal(map.get(extra[extra.length - 1]!), '{broken 5', 'the newest is kept too')
    map.set('miya-music-maker-v1', '{broken 5')
    boot()
    assert.equal([...map.keys()].filter((k) => k.startsWith(`${BACKUP_KEY}-`)).length, BACKUP_EXTRA, 'the same bad save is not stored twice')
    save()
    assert.equal(model.saveError, '')
  } finally {
    Date.now = realNow
    console.warn = warn
    delete g.localStorage
  }
})

test('a quick tap while the context wakes plays once and never holds a looping note', async () => {
  loadFactoryKit()
  engine.wakeEngine()
  engine.noteOn(0, 0.9, 'key:KeyQ')
  engine.noteOff('key:KeyQ')
  await tick(5)
  audio.wake?.()
  await tick(5)
  assert.deepEqual(engine.heldNotes(), [], 'the early release left nothing held')
  // A held key with no release does start once the context is up.
  engine.noteOn(0, 0.9, 'key:KeyW')
  await tick(5)
  audio.wake?.()
  await tick(5)
  assert.deepEqual(engine.heldNotes(), ['key:KeyW'])
  engine.noteOff('key:KeyW')
  engine.shutdown()
})

test('closing the window while the engine wakes does not start the clock or record', async () => {
  loadFactoryKit()
  engine.wakeEngine()
  const play = engine.togglePlay()
  engine.shutdown()
  audio.wake?.()
  await play
  assert.equal(model.playing, false)
  engine.wakeEngine()
  const rec = engine.toggleRecord()
  await tick(1)
  engine.shutdown()
  audio.wake?.()
  await rec
  assert.equal(model.recording, false)
  assert.equal(model.playing, false)
  assert.equal(model.hold, null)
})

test('a second Mic press during the permission prompt is refused, and closing then frees the stream', async () => {
  loadFactoryKit()
  engine.wakeEngine()
  let asks = 0
  let grant: (stream: any) => void = () => {}
  let stopped = 0
  const stream = { getTracks: () => [{ stop: () => (stopped += 1) }] }
  const realNavigator = Object.getOwnPropertyDescriptor(g, 'navigator')
  Object.defineProperty(g, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: () => { asks += 1; return new Promise((resolve) => { grant = resolve }) } } },
  })
  let recorders = 0
  g.MediaRecorder = class { static isTypeSupported() { return true } constructor() { recorders += 1 } }
  try {
    const first = engine.recordMic()
    assert.equal(engine.audioStartingLabel(), 'mic')
    await tick(2)
    audio.wake?.()
    await tick(2)
    await engine.recordMic()
    assert.equal(asks, 1, 'the second press did not open a second prompt')
    engine.shutdown()
    grant(stream)
    await first
    assert.equal(stopped, 1, 'the late stream was stopped')
    assert.equal(recorders, 0, 'no recorder was made for a closed window')
    assert.equal(engine.audioStartingLabel(), '')
  } finally {
    if (realNavigator) Object.defineProperty(g, 'navigator', realNavigator)
    else delete g.navigator
    delete g.MediaRecorder
  }
})
