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
  // An interlaced image is scattered over the passes, so its samples are
  // gathered first; the others are read row by row straight into the pixels.
  if (h.interlace === 1) {
    const samples = deinterlace(raw, h, channels)
    return toRgba(samples, h, channels, palette, trns, alloc)
  }
  return toRgbaRows(raw, h, channels, palette, trns, alloc)
}

/** The samples of an image's pixels, row by row, in 16-bit space. */
type Samples = Uint16Array

/** The RGBA pixels of an image whose rows are read one after the other: the
 * row is unfiltered and written into the pixels as it comes, so the
 * samples never all sit in memory at once. */
function toRgbaRows(
  raw: Buffer,
  h: Header,
  channels: number,
  palette: Buffer | null,
  trns: Buffer | null,
  alloc: (n: number) => Uint8Array | Uint8ClampedArray,
): Image {
  const data = alloc(h.width * h.height * 4)
  const stride = Math.ceil((h.width * channels * h.depth) / 8)
  const filterUnit = Math.max(1, Math.ceil((channels * h.depth) / 8))
  // Two rows of the unfiltered bytes: one holds the row before, the other
  // the row being read, and they trade places after every row.
  let prev = new Uint8Array(stride)
  let cur = new Uint8Array(stride)
  let pos = 0
  for (let y = 0; y < h.height; y++) {
    const filter = raw[pos]
    pos += 1
    const line = raw.subarray(pos, pos + stride)
    pos += stride
    unfilter(filter, line, cur, prev, filterUnit)
    row(cur, h, channels, palette, trns, data, y * h.width * 4)
    const swap = prev
    prev = cur
    cur = swap
  }
  return { width: h.width, height: h.height, data }
}

/** The 16-bit sample at byte `i` of a row, big-endian. */
function be16(line: Uint8Array, i: number): number {
  return ((line[i] as number) << 8) | (line[i + 1] as number)
}

/** The RGBA pixels of one unfiltered row of an image, written at `at`. */
function row(
  line: Uint8Array,
  h: Header,
  channels: number,
  palette: Buffer | null,
  trns: Buffer | null,
  data: Uint8Array | Uint8ClampedArray,
  at: number,
): void {
  const w = h.width
  if (h.depth === 8) {
    switch (h.colorType) {
      case 0: {
        const key = trns !== null && trns.length >= 2 ? trns.readUInt16BE(0) : -1
        for (let x = 0; x < w; x++) {
          const v = line[x]
          const o = at + x * 4
          data[o] = v
          data[o + 1] = v
          data[o + 2] = v
          data[o + 3] = key === v * 257 ? 0 : 255
        }
        return
      }
      case 2: {
        const key =
          trns !== null && trns.length >= 6
            ? [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)]
            : null
        for (let x = 0; x < w; x++) {
          const r = line[x * 3]
          const g = line[x * 3 + 1]
          const b = line[x * 3 + 2]
          const o = at + x * 4
          data[o] = r
          data[o + 1] = g
          data[o + 2] = b
          data[o + 3] = key !== null && key[0] === r * 257 && key[1] === g * 257 && key[2] === b * 257 ? 0 : 255
        }
        return
      }
      case 3: {
        for (let x = 0; x < w; x++) {
          const index = line[x]
          const o = at + x * 4
          data[o] = palette === null ? 0 : palette[index * 3]
          data[o + 1] = palette === null ? 0 : palette[index * 3 + 1]
          data[o + 2] = palette === null ? 0 : palette[index * 3 + 2]
          data[o + 3] = trns === null || index >= trns.length ? 255 : trns[index]
        }
        return
      }
      case 4: {
        for (let x = 0; x < w; x++) {
          const v = line[x * 2]
          const o = at + x * 4
          data[o] = v
          data[o + 1] = v
          data[o + 2] = v
          data[o + 3] = line[x * 2 + 1]
        }
        return
      }
      default: {
        for (let x = 0; x < w; x++) {
          const o = at + x * 4
          data[o] = line[x * 4]
          data[o + 1] = line[x * 4 + 1]
          data[o + 2] = line[x * 4 + 2]
          data[o + 3] = line[x * 4 + 3]
        }
        return
      }
    }
  }
  if (h.depth === 16) {
    switch (h.colorType) {
      case 0: {
        const key = trns !== null && trns.length >= 2 ? trns.readUInt16BE(0) : -1
        for (let x = 0; x < w; x++) {
          const v = be16(line, x * 2)
          const o = at + x * 4
          data[o] = v >> 8
          data[o + 1] = v >> 8
          data[o + 2] = v >> 8
          data[o + 3] = key === v ? 0 : 255
        }
        return
      }
      case 2: {
        const key =
          trns !== null && trns.length >= 6
            ? [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)]
            : null
        for (let x = 0; x < w; x++) {
          const r = be16(line, x * 6)
          const g = be16(line, x * 6 + 2)
          const b = be16(line, x * 6 + 4)
          const o = at + x * 4
          data[o] = r >> 8
          data[o + 1] = g >> 8
          data[o + 2] = b >> 8
          data[o + 3] = key !== null && key[0] === r && key[1] === g && key[2] === b ? 0 : 255
        }
        return
      }
      case 3: {
        for (let x = 0; x < w; x++) {
          const index = be16(line, x * 2)
          const o = at + x * 4
          data[o] = palette === null ? 0 : palette[index * 3]
          data[o + 1] = palette === null ? 0 : palette[index * 3 + 1]
          data[o + 2] = palette === null ? 0 : palette[index * 3 + 2]
          data[o + 3] = trns === null || index >= trns.length ? 255 : trns[index]
        }
        return
      }
      case 4: {
        for (let x = 0; x < w; x++) {
          const v = be16(line, x * 4)
          const o = at + x * 4
          data[o] = v >> 8
          data[o + 1] = v >> 8
          data[o + 2] = v >> 8
          data[o + 3] = be16(line, x * 4 + 2) >> 8
        }
        return
      }
      default: {
        for (let x = 0; x < w; x++) {
          const o = at + x * 4
          data[o] = be16(line, x * 8) >> 8
          data[o + 1] = be16(line, x * 8 + 2) >> 8
          data[o + 2] = be16(line, x * 8 + 4) >> 8
          data[o + 3] = be16(line, x * 8 + 6) >> 8
        }
        return
      }
    }
  }
  // Fewer than eight bits per sample: the samples sit packed in the row's
  // bytes and are scaled to the full range.
  const bps = h.depth
  const perByte = 8 / bps
  const max = (1 << bps) - 1
  for (let x = 0; x < w; x++) {
    const o = at + x * 4
    const sample = (c: number): number => {
      const i = x * channels + c
      const byte = line[Math.floor(i / perByte)]
      const shift = 8 - bps * ((i % perByte) + 1)
      return (byte >> shift) & max
    }
    if (h.colorType === 3) {
      const index = sample(0)
      data[o] = palette === null ? 0 : palette[index * 3]
      data[o + 1] = palette === null ? 0 : palette[index * 3 + 1]
      data[o + 2] = palette === null ? 0 : palette[index * 3 + 2]
      data[o + 3] = trns === null || index >= trns.length ? 255 : trns[index]
      continue
    }
    const scaled = (c: number): number => (sample(c) * 255) / max
    if (h.colorType === 0) {
      const v = scaled(0)
      data[o] = v
      data[o + 1] = v
      data[o + 2] = v
      data[o + 3] = trns !== null && trns.length >= 2 && trns.readUInt16BE(0) === v * 257 ? 0 : 255
    } else if (h.colorType === 2) {
      const r = scaled(0)
      const g = scaled(1)
      const b = scaled(2)
      data[o] = r
      data[o + 1] = g
      data[o + 2] = b
      data[o + 3] =
        trns !== null &&
        trns.length >= 6 &&
        trns.readUInt16BE(0) === r * 257 &&
        trns.readUInt16BE(2) === g * 257 &&
        trns.readUInt16BE(4) === b * 257
          ? 0
          : 255
    } else if (h.colorType === 4) {
      const v = scaled(0)
      data[o] = v
      data[o + 1] = v
      data[o + 2] = v
      data[o + 3] = scaled(1)
    } else {
      data[o] = scaled(0)
      data[o + 1] = scaled(1)
      data[o + 2] = scaled(2)
      data[o + 3] = scaled(3)
    }
  }
}

/** The samples of an interlaced image, in the image's own order. */
function deinterlace(raw: Buffer, h: Header, channels: number): Samples {
  const indexed = h.colorType === 3
  const out = new Uint16Array(h.width * h.height * channels)
  let pos = 0
  for (const pass of PASSES) {
    const width = Math.ceil((h.width - pass.x0) / pass.dx)
    const height = Math.ceil((h.height - pass.y0) / pass.dy)
    if (width <= 0 || height <= 0) continue
    const bps = h.depth
    const stride = Math.ceil((width * channels * bps) / 8)
    const filterUnit = Math.max(1, Math.ceil((channels * bps) / 8))
    let prev = new Uint8Array(stride)
    let cur = new Uint8Array(stride)
    for (let y = 0; y < height; y++) {
      const filter = raw[pos]
      pos += 1
      const line = raw.subarray(pos, pos + stride)
      pos += stride
      unfilter(filter, line, cur, prev, filterUnit)
      for (let x = 0; x < width; x++) {
        const px = pass.x0 + x * pass.dx
        const py = pass.y0 + y * pass.dy
        for (let c = 0; c < channels; c++) {
          out[(py * h.width + px) * channels + c] = sample(cur, x * channels + c, bps, indexed)
        }
      }
      const swap = prev
      prev = cur
      cur = swap
    }
  }
  return out
}

/** The sample at index `i` of a line, in 16-bit space; a palette image keeps
 * its index instead. */
function sample(line: Uint8Array, i: number, bps: number, indexed: boolean): number {
  if (bps === 16) return be16(line, i * 2)
  if (bps === 8) return indexed ? (line[i] as number) : (line[i] as number) * 257
  const perByte = 8 / bps
  const byte = line[Math.floor(i / perByte)]
  const shift = 8 - bps * ((i % perByte) + 1)
  const value = (byte >> shift) & ((1 << bps) - 1)
  if (indexed) return value
  // A sample below 8 bits is scaled to the full range, as the PNG spec says.
  return Math.round((value * 255 * 257) / ((1 << bps) - 1))
}

/** Undoes a line's filter: the filtered bytes of `line` become the
 * unfiltered bytes of `cur`, which holds the row before in `prev`. */
function unfilter(filter: number, line: Uint8Array, cur: Uint8Array, prev: Uint8Array, unit: number): void {
  const len = line.length
  const head = Math.min(unit, len)
  switch (filter) {
    case 0:
      cur.set(line)
      return
    case 1:
      for (let i = 0; i < head; i++) cur[i] = line[i] as number
      for (let i = head; i < len; i++) cur[i] = ((line[i] as number) + (cur[i - unit] as number)) & 255
      return
    case 2:
      for (let i = 0; i < len; i++) cur[i] = ((line[i] as number) + (prev[i] as number)) & 255
      return
    case 3:
      for (let i = 0; i < head; i++) cur[i] = ((line[i] as number) + ((prev[i] as number) >> 1)) & 255
      for (let i = head; i < len; i++) {
        const a = cur[i - unit] as number
        cur[i] = ((line[i] as number) + ((a + (prev[i] as number)) >> 1)) & 255
      }
      return
    default:
      // Paeth: the predictor is the left, the above or the upper left byte,
      // whichever is closest to the left plus the above minus the upper
      // left. The distances are the differences of that sum to each of the
      // three, so they are the differences of the bytes to each other.
      for (let i = 0; i < head; i++) cur[i] = ((line[i] as number) + (prev[i] as number)) & 255
      for (let i = head; i < len; i++) {
        const a = cur[i - unit] as number
        const b = prev[i] as number
        const c = prev[i - unit] as number
        const da = a - c
        const db = b - c
        const pa = db < 0 ? -db : db
        const pb = da < 0 ? -da : da
        const sum = da + db
        const pc = sum < 0 ? -sum : sum
        cur[i] = ((line[i] as number) + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
      }
  }
}

/** The RGBA pixels of a decoded image. */
function toRgba(samples: Samples, h: Header, channels: number, palette: Buffer | null, trns: Buffer | null, alloc: (n: number) => Uint8Array | Uint8ClampedArray): Image {
  const data = alloc(h.width * h.height * 4)
  const transparent = trns === null ? null : trns
  for (let y = 0; y < h.height; y++) {
    const base = y * h.width * channels
    for (let x = 0; x < h.width; x++) {
      const i = (y * h.width + x) * 4
      const at = base + x * channels
      if (h.colorType === 3) {
        const index = samples[at]
        data[i] = palette === null ? 0 : palette[index * 3]
        data[i + 1] = palette === null ? 0 : palette[index * 3 + 1]
        data[i + 2] = palette === null ? 0 : palette[index * 3 + 2]
        data[i + 3] = transparent === null || index >= transparent.length ? 255 : transparent[index]
      } else if (h.colorType === 0 || h.colorType === 4) {
        const grey = samples[at] >> 8
        data[i] = grey
        data[i + 1] = grey
        data[i + 2] = grey
        data[i + 3] = h.colorType === 4 ? samples[at + 1] >> 8 : alphaOf(trns, [samples[at]])
      } else {
        data[i] = samples[at] >> 8
        data[i + 1] = samples[at + 1] >> 8
        data[i + 2] = samples[at + 2] >> 8
        data[i + 3] = h.colorType === 6 ? samples[at + 3] >> 8 : alphaOf(trns, [samples[at], samples[at + 1], samples[at + 2]])
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
