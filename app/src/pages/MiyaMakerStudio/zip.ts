/** A stored zip (no compression) plus a reader for stored and deflate entries. */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i += 1) c = (CRC_TABLE[(c ^ (data[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function concat(parts: Uint8Array[]): Uint8Array {
  let length = 0
  for (const part of parts) length += part.length
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export type ZipEntry = { name: string; data: Uint8Array }

/** Writes a zip other tools can open. Names are UTF-8. Bytes are stored, not deflated. */
export function zipStore(files: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = encoder.encode(file.name.replace(/\\/g, '/'))
    const crc = crc32(file.data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true)
    local.setUint16(8, 0, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, file.data.length, true)
    local.setUint32(22, file.data.length, true)
    local.setUint16(26, name.length, true)
    const localBytes = new Uint8Array(local.buffer)
    parts.push(localBytes, name, file.data)
    const head = new DataView(new ArrayBuffer(46))
    head.setUint32(0, 0x02014b50, true)
    head.setUint16(4, 20, true)
    head.setUint16(6, 20, true)
    head.setUint16(8, 0x0800, true)
    head.setUint16(10, 0, true)
    head.setUint32(16, crc, true)
    head.setUint32(20, file.data.length, true)
    head.setUint32(24, file.data.length, true)
    head.setUint16(28, name.length, true)
    head.setUint32(42, offset, true)
    central.push(new Uint8Array(head.buffer), name)
    offset += localBytes.length + name.length + file.data.length
  }
  const directory = concat(central)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, directory.length, true)
  end.setUint32(16, offset, true)
  return concat([...parts, directory, new Uint8Array(end.buffer)])
}

function findEocd(buf: Uint8Array): number {
  const min = Math.max(0, buf.length - 22 - 65535)
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) return i
  }
  throw new Error('That file is not a zip.')
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([Uint8Array.from(data)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Reads stored and deflate entries. Skips directories and `__MACOSX` junk. */
export async function unzip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const eocd = findEocd(bytes)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint16(eocd + 10, true)
  const dirOffset = view.getUint32(eocd + 16, true)
  const decoder = new TextDecoder()
  const out: ZipEntry[] = []
  let cursor = dirOffset
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('The zip directory is damaged.')
    const flags = view.getUint16(cursor + 8, true)
    const method = view.getUint16(cursor + 10, true)
    const compSize = view.getUint32(cursor + 20, true)
    const nameLen = view.getUint16(cursor + 28, true)
    const extraLen = view.getUint16(cursor + 30, true)
    const commentLen = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen))
    cursor += 46 + nameLen + extraLen + commentLen
    if (!name || name.endsWith('/') || name.startsWith('__MACOSX/') || name.split('/').includes('__MACOSX')) continue
    if (flags & 0x0008) throw new Error('This zip stores sizes after the data. Open the layers folder instead.')
    if (method !== 0 && method !== 8) throw new Error(`Cannot read compression method ${method}. Open the layers folder instead.`)
    const localName = view.getUint16(localOffset + 26, true)
    const localExtra = view.getUint16(localOffset + 28, true)
    const start = localOffset + 30 + localName + localExtra
    const compressed = bytes.subarray(start, start + compSize)
    const data = method === 0 ? compressed : await inflate(compressed)
    out.push({ name, data })
  }
  return out
}
