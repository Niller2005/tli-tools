// The PNG decoder's pixels: the same as the reference decoder's, whatever
// the colour type and the bit depth.

import { describe, expect, test } from 'bun:test'
import { deflateSync } from 'node:zlib'
import { decodePng, encodePng, type Image } from '../src/index'

/** The chunks of a PNG file, in order. */
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'ascii')
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  let crc = 0xffffffff
  for (const byte of Buffer.concat([head.subarray(4), body])) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0)
  return Buffer.concat([head, body, tail])
}

/** A PNG file of the given colour type and bit depth, from its rows of
 * bytes (already packed for the depths below eight). */
function png(width: number, height: number, colorType: number, depth: number, rows: Buffer[], extra: Buffer[] = []): Uint8Array {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = depth
  ihdr[9] = colorType
  const raw = Buffer.concat(rows.map((r) => Buffer.concat([Buffer.from([0]), r])))
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    ...extra,
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** The reference decoder: the samples of every pixel are read into a nested
 * array first, as the decoder did before it read the rows one by one. */
function reference(bytes: Uint8Array): Image {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = 8
  let width = 0
  let height = 0
  let depth = 0
  let colorType = 0
  let palette: Buffer | null = null
  let trns: Buffer | null = null
  const idat: Buffer[] = []
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const body = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      depth = body[8]
      colorType = body[9]
    } else if (type === 'PLTE') palette = Buffer.from(body)
    else if (type === 'tRNS') trns = Buffer.from(body)
    else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
  const ch = channels[colorType] as number
  const raw = require('node:zlib').inflateSync(Buffer.concat(idat)) as Buffer
  const rows: number[][] = []
  let p = 0
  let prev = new Uint8Array(0)
  const stride = Math.ceil((width * ch * depth) / 8)
  for (let y = 0; y < height; y++) {
    const filter = raw[p]
    p += 1
    const line = Buffer.from(raw.subarray(p, p + stride))
    p += stride
    const out = new Uint8Array(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0
      const b = prev[i] ?? 0
      const c = i >= ch ? (prev[i - ch] ?? 0) : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const pp = a + b - c
        const pa = Math.abs(pp - a)
        const pb = Math.abs(pp - b)
        const pc = Math.abs(pp - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      out[i] = v & 255
    }
    const row: number[] = []
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < ch; c++) row.push(sample(out, x * ch + c, depth, colorType === 3))
    }
    rows.push(row)
    prev = out
  }
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const row = rows[y] as number[]
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const at = x * ch
      if (colorType === 3) {
        const index = row[at] as number
        data[i] = palette === null ? 0 : (palette as Buffer)[index * 3]
        data[i + 1] = palette === null ? 0 : (palette as Buffer)[index * 3 + 1]
        data[i + 2] = palette === null ? 0 : (palette as Buffer)[index * 3 + 2]
        data[i + 3] = trns === null || index >= (trns as Buffer).length ? 255 : (trns as Buffer)[index]
      } else if (colorType === 0 || colorType === 4) {
        const grey = (row[at] as number) >> 8
        data[i] = grey
        data[i + 1] = grey
        data[i + 2] = grey
        data[i + 3] = colorType === 4 ? ((row[at + 1] as number) >> 8) : alphaOf(trns, [row[at] as number])
      } else {
        data[i] = (row[at] as number) >> 8
        data[i + 1] = (row[at + 1] as number) >> 8
        data[i + 2] = (row[at + 2] as number) >> 8
        data[i + 3] = colorType === 6 ? ((row[at + 3] as number) >> 8) : alphaOf(trns, [row[at] as number, row[at + 1] as number, row[at + 2] as number])
      }
    }
  }
  return { width, height, data }
}

/** The reference decoder's sample at index `i` of a line. */
function sample(line: Uint8Array, i: number, bps: number, indexed: boolean): number {
  if (bps === 16) return ((line[i * 2] as number) << 8) | (line[i * 2 + 1] as number)
  if (bps === 8) return indexed ? (line[i] as number) : (line[i] as number) * 257
  const perByte = 8 / bps
  const byte = line[Math.floor(i / perByte)] as number
  const shift = 8 - bps * ((i % perByte) + 1)
  const value = (byte >> shift) & ((1 << bps) - 1)
  if (indexed) return value
  return Math.round((value * 255 * 257) / ((1 << bps) - 1))
}

/** The reference decoder's alpha of a pixel whose samples match the `tRNS`
 * colour. */
function alphaOf(trns: Buffer | null, samples: number[]): number {
  if (trns === null || trns.length < samples.length * 2) return 255
  for (let i = 0; i < samples.length; i++) {
    if (samples[i] !== trns.readUInt16BE(i * 2)) return 255
  }
  return 0
}

describe('the PNG decoder', () => {
  test('reads an RGBA image', () => {
    const bytes = png(
      2,
      2,
      6,
      8,
      [
        Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
        Buffer.from([9, 10, 11, 12, 13, 14, 15, 16]),
      ],
    )
    const img = decodePng(bytes)
    expect(img.width).toBe(2)
    expect(img.height).toBe(2)
    expect([...img.data]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
  })

  test('reads an RGB image', () => {
    const bytes = png(2, 1, 2, 8, [Buffer.from([10, 20, 30, 40, 50, 60])])
    expect([...decodePng(bytes).data]).toEqual([10, 20, 30, 255, 40, 50, 60, 255])
  })

  test('reads a greyscale image', () => {
    const bytes = png(3, 1, 0, 8, [Buffer.from([0, 128, 255])])
    expect([...decodePng(bytes).data]).toEqual([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255])
  })

  test('reads a palette image', () => {
    const palette = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255])
    const bytes = png(2, 1, 3, 8, [Buffer.from([0, 2])], [chunk('PLTE', palette)])
    expect([...decodePng(bytes).data]).toEqual([255, 0, 0, 255, 0, 0, 255, 255])
  })

  test('reads the same pixels as the reference decoder', () => {
    const cases: { colorType: number; depth: number; width: number; height: number; rows: Buffer[]; extra: Buffer[] }[] = [
      { colorType: 6, depth: 8, width: 3, height: 2, rows: [Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), Buffer.from([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24])], extra: [] },
      { colorType: 2, depth: 8, width: 3, height: 2, rows: [Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9]), Buffer.from([10, 11, 12, 13, 14, 15, 16, 17, 18])], extra: [] },
      { colorType: 0, depth: 8, width: 3, height: 1, rows: [Buffer.from([0, 90, 255])], extra: [] },
      { colorType: 4, depth: 8, width: 2, height: 1, rows: [Buffer.from([10, 20, 30, 40])], extra: [] },
      { colorType: 6, depth: 16, width: 2, height: 1, rows: [Buffer.from([0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8])], extra: [] },
      { colorType: 2, depth: 16, width: 2, height: 1, rows: [Buffer.from([0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6])], extra: [] },
      { colorType: 0, depth: 16, width: 2, height: 1, rows: [Buffer.from([0, 9, 1, 0])], extra: [] },
      { colorType: 0, depth: 4, width: 2, height: 1, rows: [Buffer.from([0x12])], extra: [] },
      { colorType: 2, depth: 2, width: 2, height: 1, rows: [Buffer.from([0b00011011, 0b11100100])], extra: [] },
      { colorType: 3, depth: 4, width: 2, height: 1, rows: [Buffer.from([0x12])], extra: [chunk('PLTE', Buffer.from([1, 2, 3, 4, 5, 6]))] },
    ]
    for (const c of cases) {
      const bytes = png(c.width, c.height, c.colorType, c.depth, c.rows, c.extra)
      const mine = decodePng(bytes)
      const theirs = reference(bytes)
      expect([...mine.data]).toEqual([...theirs.data])
    }
  })

  test('reads the same pixels as the reference decoder with a tRNS chunk', () => {
    const trns = Buffer.from([0x00, 0x02, 0x00, 0x04])
    const bytes = png(2, 1, 2, 8, [Buffer.from([2, 4, 6, 8, 10, 12])], [chunk('tRNS', trns)])
    const mine = decodePng(bytes)
    const theirs = reference(bytes)
    expect([...mine.data]).toEqual([...theirs.data])
  })

  test('round-trips through the encoder', () => {
    const width = 5
    const height = 4
    const data = new Uint8Array(width * height * 4)
    for (let i = 0; i < data.length; i++) data[i] = (i * 37) % 256
    const bytes = encodePng({ width, height, data })
    const img = decodePng(bytes)
    expect([...img.data]).toEqual([...data])
  })
})
