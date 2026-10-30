//! A PNG decoder and encoder over node:zlib, for the readers' images (no
//! dependencies). The decoder expands what the Rust `png` crate expands with
//! `normalize_to_color8`: the palette to RGB, `tRNS` to alpha and 16-bit
//! samples to 8-bit. It reads greyscale, RGB, palette and alpha images, 1 to
//! 16 bits per sample, interlaced or not.

import { deflateSync, inflateSync } from 'node:zlib'

/** An RGBA image: `width` x `height` pixels, four bytes each, rows top to
 * bottom. The pixels are the same in a plain byte array and in a clamped
 * one; a clamped array holds a write inside 0-255. */
export interface Image<D extends Uint8Array | Uint8ClampedArray = Uint8Array | Uint8ClampedArray> {
  width: number
  height: number
  data: D
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/** The image's header: its size, the bits per sample and how it is stored. */
interface Header {
  width: number
  height: number
  depth: number
  colorType: number
  interlace: number
}

/** The Adam7 passes: the rows and columns each pass covers. */
const PASSES: readonly { x0: number; y0: number; dx: number; dy: number }[] = [
  { x0: 0, y0: 0, dx: 8, dy: 8 },
  { x0: 4, y0: 0, dx: 8, dy: 8 },
  { x0: 0, y0: 4, dx: 4, dy: 8 },
  { x0: 2, y0: 0, dx: 4, dy: 4 },
  { x0: 0, y0: 2, dx: 2, dy: 4 },
  { x0: 1, y0: 0, dx: 2, dy: 2 },
  { x0: 0, y0: 1, dx: 1, dy: 2 },
]

/** How many channels a colour type has before `tRNS` expands it. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/** Decodes a PNG into RGBA at its own size. */
export function decodePng(bytes: Uint8Array): Image<Uint8Array> {
  return decode(bytes, (n) => new Uint8Array(n)) as Image<Uint8Array>
}

/** Decodes a PNG into RGBA at its own size, with the pixels in a clamped
 * array: a write past 255 or below 0 is held at the ends of the scale. */
export function decodePngClamped(bytes: Uint8Array): Image<Uint8ClampedArray> {
  return decode(bytes, (n) => new Uint8ClampedArray(n)) as Image<Uint8ClampedArray>
}

/** The same pixels in a plain byte array: the same memory, no copy. */
export function asBytes(img: Image<Uint8ClampedArray>): Image<Uint8Array> {
  const data = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
  return { width: img.width, height: img.height, data }
}

/** Decodes a PNG into RGBA at its own size, into the array `alloc` makes. */
function decode(bytes: Uint8Array, alloc: (n: number) => Uint8Array | Uint8ClampedArray): Image {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file')
  let pos = 8
  let header: Header | null = null
  let palette: Buffer | null = null
  let trns: Buffer | null = null
  const idat: Buffer[] = []
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const body = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colorType: body[9],
        interlace: body[12],
      }
    } else if (type === 'PLTE') palette = Buffer.from(body)
    else if (type === 'tRNS') trns = Buffer.from(body)
    else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (header === null) throw new Error('PNG without a header')
  const h = header
  const channels = CHANNELS[h.colorType]
  if (channels === undefined) throw new Error(`unsupported PNG colour type ${h.colorType}`)
  if (![1, 2, 4, 8, 16].includes(h.depth)) throw new Error(`unsupported PNG depth ${h.depth}`)
  if (h.colorType === 3 && palette === null) throw new Error('palette PNG without a palette')
  const raw = inflateSync(Buffer.concat(idat))
  // A palette image keeps its indices; the others keep their samples in 16-bit space.
  const indexed = h.colorType === 3
  const samples =
    h.interlace === 1
      ? deinterlace(raw, h, channels, indexed)
      : scanlines(raw, h, channels, { x0: 0, y0: 0, dx: 1, dy: 1 }, indexed)
  return toRgba(samples, h, channels, palette, trns, alloc)
}

/** The rows of one image: the samples of each pixel, in 16-bit space. */
type Samples = number[][]

/** The samples of an image's pixels, row by row. */
function scanlines(raw: Buffer, h: Header, channels: number, pass: { x0: number; y0: number; dx: number; dy: number }, indexed: boolean): Samples {
  const width = Math.ceil((h.width - pass.x0) / pass.dx)
  const height = Math.ceil((h.height - pass.y0) / pass.dy)
  const bps = h.depth // bits per sample
  const stride = Math.ceil((width * channels * bps) / 8)
  const filterUnit = Math.max(1, Math.ceil((channels * bps) / 8))
  const out: Samples = []
  let pos = 0
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[pos]
    pos += 1
    const line = Buffer.from(raw.subarray(pos, pos + stride))
    pos += stride
    unfilter(filter, line, prev, filterUnit)
    const row: number[] = []
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        row.push(sample(line, x * channels + c, bps, indexed))
      }
    }
    out.push(row)
    prev = new Uint8Array(line)
  }
  return out
}

/** The samples of an interlaced image, in the image's own order. */
function deinterlace(raw: Buffer, h: Header, channels: number, indexed: boolean): Samples {
  const out: Samples = []
  for (let y = 0; y < h.height; y++) out.push(new Array<number>(h.width * channels).fill(0))
  let pos = 0
  for (const pass of PASSES) {
    const width = Math.ceil((h.width - pass.x0) / pass.dx)
    const height = Math.ceil((h.height - pass.y0) / pass.dy)
    if (width <= 0 || height <= 0) continue
    const bps = h.depth
    const stride = Math.ceil((width * channels * bps) / 8)
    const filterUnit = Math.max(1, Math.ceil((channels * bps) / 8))
    let prev = new Uint8Array(stride)
    for (let y = 0; y < height; y++) {
      const filter = raw[pos]
      pos += 1
      const line = Buffer.from(raw.subarray(pos, pos + stride))
      pos += stride
      unfilter(filter, line, prev, filterUnit)
      for (let x = 0; x < width; x++) {
        const px = pass.x0 + x * pass.dx
        const py = pass.y0 + y * pass.dy
        for (let c = 0; c < channels; c++) {
          out[py][px * channels + c] = sample(line, x * channels + c, bps, indexed)
        }
      }
      prev = new Uint8Array(line)
    }
  }
  return out
}

/** The sample at index `i` of a line, in 16-bit space; a palette image keeps
 * its index instead. */
function sample(line: Buffer, i: number, bps: number, indexed: boolean): number {
  if (bps === 16) return line.readUInt16BE(i * 2)
  if (bps === 8) return indexed ? line[i] : line[i] * 257
  const perByte = 8 / bps
  const byte = line[Math.floor(i / perByte)]
  const shift = 8 - bps * ((i % perByte) + 1)
  const value = (byte >> shift) & ((1 << bps) - 1)
  if (indexed) return value
  // A sample below 8 bits is scaled to the full range, as the PNG spec says.
  return Math.round((value * 255 * 257) / ((1 << bps) - 1))
}

/** Undoes a line's filter in place. */
function unfilter(filter: number, line: Buffer, prev: Uint8Array, unit: number): void {
  const len = line.length
  for (let i = 0; i < len; i++) {
    const a = i >= unit ? line[i - unit] : 0
    const b = prev[i] ?? 0
    const c = i >= unit ? (prev[i - unit] ?? 0) : 0
    let v = line[i]
    if (filter === 1) v += a
    else if (filter === 2) v += b
    else if (filter === 3) v += (a + b) >> 1
    else if (filter === 4) {
      const p = a + b - c
      const pa = Math.abs(p - a)
      const pb = Math.abs(p - b)
      const pc = Math.abs(p - c)
      v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
    }
    line[i] = v & 255
  }
}

/** The RGBA pixels of a decoded image. */
function toRgba(samples: Samples, h: Header, channels: number, palette: Buffer | null, trns: Buffer | null, alloc: (n: number) => Uint8Array | Uint8ClampedArray): Image {
  const data = alloc(h.width * h.height * 4)
  const transparent = trns === null ? null : trns
  for (let y = 0; y < h.height; y++) {
    const row = samples[y]
    for (let x = 0; x < h.width; x++) {
      const i = (y * h.width + x) * 4
      const at = x * channels
      if (h.colorType === 3) {
        const index = row[at]
        data[i] = palette === null ? 0 : palette[index * 3]
        data[i + 1] = palette === null ? 0 : palette[index * 3 + 1]
        data[i + 2] = palette === null ? 0 : palette[index * 3 + 2]
        data[i + 3] = transparent === null || index >= transparent.length ? 255 : transparent[index]
      } else if (h.colorType === 0 || h.colorType === 4) {
        const grey = row[at] >> 8
        data[i] = grey
        data[i + 1] = grey
        data[i + 2] = grey
        data[i + 3] = h.colorType === 4 ? row[at + 1] >> 8 : alphaOf(trns, [row[at]])
      } else {
        data[i] = row[at] >> 8
        data[i + 1] = row[at + 1] >> 8
        data[i + 2] = row[at + 2] >> 8
        data[i + 3] = h.colorType === 6 ? row[at + 3] >> 8 : alphaOf(trns, [row[at], row[at + 1], row[at + 2]])
      }
    }
  }
  return { width: h.width, height: h.height, data }
}

/** The alpha of a pixel whose samples match the `tRNS` colour: 0 when they do, 255 otherwise. */
function alphaOf(trns: Buffer | null, samples: number[]): number {
  if (trns === null || trns.length < samples.length * 2) return 255
  for (let i = 0; i < samples.length; i++) {
    if (samples[i] !== trns.readUInt16BE(i * 2)) return 255
  }
  return 0
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

/** The CRC of a chunk's type and body. */
function crc32(body: Buffer): number {
  let c = 0xffffffff
  for (const x of body) c = (CRC_TABLE[(c ^ x) & 255] ^ (c >>> 8)) >>> 0
  return (c ^ 0xffffffff) >>> 0
}

/** A chunk with its length and CRC. */
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0)
  return Buffer.concat([head, body, crc])
}

/** Writes an image as an 8-bit PNG: RGBA (`colorType` 6) or greyscale (0). */
export function encodePng(img: Image, gray = false): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(img.width, 0)
  ihdr.writeUInt32BE(img.height, 4)
  ihdr[8] = 8
  ihdr[9] = gray ? 0 : 6
  const channels = gray ? 1 : 4
  const stride = img.width * channels
  // every row with the Up filter (its difference from the row above): flat areas become runs of zeros
  const raw = Buffer.alloc((stride + 1) * img.height)
  for (let y = 0; y < img.height; y++) {
    const o = y * (stride + 1)
    raw[o] = 2
    for (let x = 0; x < stride; x++) {
      const at = y * img.width * 4 + x
      const now = gray ? img.data[(y * img.width + x) * 4] : img.data[at]
      const before = y === 0 ? 0 : gray ? img.data[((y - 1) * img.width + x) * 4] : img.data[at - img.width * 4]
      raw[o + 1 + x] = (now - before) & 255
    }
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}
