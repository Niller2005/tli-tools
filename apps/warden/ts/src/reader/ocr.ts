//! Text from a region of the frame through an OCR engine. The game text is
//! English, so the engine reads in English; on Linux the `tesseract` program
//! does the reading, one process per region. The engine is injectable, so
//! tests can read without the program.

import { Rect, Rgba } from './mod'
import { encodePng } from '@tli/png'
import { parseTsv, runTesseract, tesseractFound, TESSERACT_ARGS, type TextLine } from '@tli/ocr'

/** One line of text and its box in frame pixels. */
export interface Line {
  text: string
  rect: Rect
}

/** The OCR engine the reader reads through. */
export interface OcrEngine {
  /** The language tag the engine reads in; null when it has none. */
  language(): string | null
  /** The lines of each image with their boxes, in its pixels; none for a
   * missing image or a failed read. Several images are read at once. */
  recognizeAll(imgs: (Rgba | null)[]): Promise<TextLine[][]>
}

/** The engine the reader reads through, when another one was set. */
let engine: OcrEngine | null = null

/** The engine the reader reads through. */
export function ocrEngine(): OcrEngine {
  return engine ?? tesseractEngine
}

/** The engine the reader reads through: the tesseract program, or another
 * one for the tests. */
export function setOcrEngine(next: OcrEngine | null): void {
  engine = next
  // Another engine reads the same pixels another way.
  cache.clear()
}

/** The language tag the engine reads in ("en"); null when no OCR language
 * is installed. */
export function language(): string | null {
  return ocrEngine().language()
}

/** Why the game can't be read: the `tesseract` program is missing. None when
 * it is there. */
export function problem(): string | null {
  return language() === null
    ? 'tesseract is not installed, so nothing can be read (Arch: pacman -S tesseract tesseract-data-eng).'
    : null
}

/** The lines of text inside `rect`, read from the crop upscaled by `scale`
 * (small game text reads better at 2-3x). Empty when the region is empty
 * or OCR is not available. */
export function ocr(img: Rgba, rect: Rect, scale: number): Promise<Line[]> {
  return ocrAll([img], [[rect, scale]]).then((lines) => lines[0])
}

/** The lines of each `(rect, scale)` region as `ocr` reads them in the image
 * of the same index, in order, with the regions read at the same time.
 *
 * A region whose pixels are the same as the last time it was read is not
 * read again: the program reads the same text from the same pixels, and
 * starting it costs more than the whole read of the board. */
export async function ocrAll(imgs: Rgba[], regions: [Rect, number][]): Promise<Line[][]> {
  const keys: string[] = []
  const hashes: number[] = []
  const inputs: (Rgba | null)[] = []
  const known: (Line[] | null)[] = []
  for (let i = 0; i < regions.length; i++) {
    const [rect, scale] = regions[i]
    const img = imgs[i]
    const hash = cropHash(img, rect)
    const key = cacheKey(img, rect, scale)
    const hit = cache.get(key)
    keys.push(key)
    hashes.push(hash)
    if (hit !== undefined && hit.hash === hash) {
      known.push(hit.lines)
      inputs.push(null)
      continue
    }
    known.push(null)
    inputs.push(prepare(img, rect, scale))
  }
  const read = await ocrEngine().recognizeAll(inputs)
  const out: Line[][] = []
  for (let i = 0; i < regions.length; i++) {
    const [rect, scale] = regions[i]
    const lines = known[i] ?? mapLines(read[i] ?? [], rect, scale)
    if (known[i] === null) {
      cache.set(keys[i] as string, { hash: hashes[i] as number, lines })
      // The oldest region goes when the table is full.
      if (cache.size > CACHE_SIZE) {
        const oldest = cache.keys().next()
        if (!oldest.done) cache.delete(oldest.value)
      }
    }
    out.push(lines)
  }
  return out
}

/** The lines of the OCR of an image, in the frame's pixels. */
function mapLines(lines: TextLine[], rect: Rect, scale: number): Line[] {
  return lines.map((l) => {
    const [x, y, lw, lh] = l.rect
    return {
      text: l.text,
      rect: new Rect(
        rect.x + Math.round(x / scale),
        rect.y + Math.round(y / scale),
        Math.round(lw / scale),
        Math.round(lh / scale)
      ),
    }
  })
}

/** A region read before: the hash of its pixels and the lines it gave. */
interface Read {
  hash: number
  lines: Line[]
}

/** The regions read before, by where they are and how big: the same pixels
 * in the same place read the same, so the program is not run over them
 * again. The oldest entries go when the table is full. */
const cache = new Map<string, Read>()

/** How many regions are kept: the board's own regions and the cards read
 * again, over a few screens. */
const CACHE_SIZE = 96

/** The key of a region: where it is in the frame and how big, and the scale
 * it is read at. The pixels themselves are checked by their hash. */
function cacheKey(img: Rgba, rect: Rect, scale: number): string {
  const x0 = Math.min(Math.max(rect.x, 0), img.w)
  const y0 = Math.min(Math.max(rect.y, 0), img.h)
  const x1 = Math.min(Math.max(rect.x + rect.w, x0), img.w)
  const y1 = Math.min(Math.max(rect.y + rect.h, y0), img.h)
  return `${x0},${y0},${x1},${y1}@${scale}`
}

/** The hash of the pixels of `rect` in `img`: the same pixels give the same
 * hash, and different ones almost never do. */
function cropHash(img: Rgba, rect: Rect): number {
  const x0 = Math.min(Math.max(rect.x, 0), img.w)
  const y0 = Math.min(Math.max(rect.y, 0), img.h)
  const x1 = Math.min(Math.max(rect.x + rect.w, x0), img.w)
  const y1 = Math.min(Math.max(rect.y + rect.h, y0), img.h)
  let hash = 0x811c9dc5
  for (let y = y0; y < y1; y++) {
    const from = (y * img.w + x0) * 4
    const to = (y * img.w + x1) * 4
    for (let i = from; i < to; i++) {
      hash = Math.imul(hash ^ (img.data[i] as number), 0x01000193)
    }
  }
  return hash >>> 0
}

/** The OCR input for `rect`: the crop upscaled by `scale` with its contrast
 * stretched. Null when the region is empty. */
function prepare(img: Rgba, rect: Rect, scale: number): Rgba | null {
  const crop = img.crop(rect)
  if (crop.w === 0 || crop.h === 0) return null
  const w = Math.max(1, Math.round(crop.w * scale))
  const h = Math.max(1, Math.round(crop.h * scale))
  return stretch(crop.resize(w, h))
}

/** Stretches the contrast so the 1st to 99th percentile of luma spans 0-255:
 * faded-in buttons and text under the red target-pick tint read better. */
function stretch(img: Rgba): Rgba {
  const hist = new Array<number>(256).fill(0)
  for (let i = 0; i < img.data.length; i += 4) hist[luma(img.data, i)] += 1
  const n = img.w * img.h
  const percentile = (q: number): number | undefined => {
    let acc = 0
    for (let v = 0; v < 256; v++) {
      acc += hist[v]
      if (acc * 100 >= n * q) return v
    }
    return undefined
  }
  const lo = percentile(1) ?? 0
  const hi = percentile(99) ?? 255
  if (hi - lo < 8.0) return new Rgba(img.w, img.h, img.data.slice())
  const k = 255.0 / (hi - lo)
  const table = new Array<number>(256)
  for (let v = 0; v < 256; v++) table[v] = Math.min(Math.max(Math.trunc((v - lo) * k), 0), 255)
  const data = img.data.slice()
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) data[i + c] = table[data[i + c]]
  }
  return new Rgba(img.w, img.h, data)
}

/** The luma of a pixel. */
function luma(data: Uint8Array, i: number): number {
  return ((data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8) & 255
}

// ---------- The tesseract engine ----------

/** The `tesseract` program (English data), one process per region. */
export const tesseractEngine: OcrEngine = {
  language(): string | null {
    return tesseractFound() ? 'en' : null
  },
  async recognizeAll(imgs: (Rgba | null)[]): Promise<TextLine[][]> {
    return Promise.all(imgs.map((img) => (img === null ? Promise.resolve([]) : recognize(img))))
  },
}

/** Radius of the neighbourhood a letter is measured against, in the OCR input's pixels. */
const AROUND = 16

/** Dark text on white from the game's light text: each pixel's brightness above its neighbourhood's, so thin
 * light letters stand out whatever art or glow is behind them (tesseract reads the raw grey badly there). */
function localContrast(img: Rgba): Uint8Array {
  const w = img.w
  const h = img.h
  const grey = new Uint8Array(w * h)
  for (let i = 0; i < grey.length; i++) grey[i] = luma(img.data, i * 4)
  // Summed-area table: the mean of any box in four reads.
  const sum = new Uint32Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += grey[y * w + x]
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row
    }
  }
  const above = new Uint8Array(w * h)
  const hist = new Array<number>(256).fill(0)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(y - AROUND, 0)
    const y1 = Math.min(y + AROUND + 1, h)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(x - AROUND, 0)
      const x1 = Math.min(x + AROUND + 1, w)
      const total = sum[y1 * (w + 1) + x1] + sum[y0 * (w + 1) + x0] - sum[y0 * (w + 1) + x1] - sum[y1 * (w + 1) + x0]
      const mean = Math.floor(total / ((x1 - x0) * (y1 - y0)))
      const a = Math.min(Math.max(grey[y * w + x] - mean, 0), 255)
      above[y * w + x] = a
      hist[a] += 1
    }
  }
  // The brightest letters (the 99.8th percentile) become black, the rest in proportion: a faint caption keeps its
  // strokes and a bright one doesn't saturate into blobs.
  let acc = 0
  let top = 255
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc * 1000 >= w * h * 998) {
      top = v
      break
    }
  }
  top = Math.max(top, 24)
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = Math.min(Math.max(255 - (above[i] * 255) / top, 0), 255)
  return out
}

/** The greyscale PNG of an image's local contrast, as tesseract reads it. */
function encode(img: Rgba): Buffer {
  const grey = localContrast(img)
  const flat = new Rgba(img.w, img.h, new Uint8Array(img.w * img.h * 4))
  for (let i = 0; i < grey.length; i++) {
    flat.data[i * 4] = grey[i]
    flat.data[i * 4 + 1] = grey[i]
    flat.data[i * 4 + 2] = grey[i]
    flat.data[i * 4 + 3] = 255
  }
  return encodePng(flat, true)
}

/** The lines of an image, read by tesseract. */
async function recognize(img: Rgba): Promise<TextLine[]> {
  let stdout: string
  try {
    const run = await runTesseract(encode(img), [...TESSERACT_ARGS, 'tsv'])
    if (!run.ok) throw new Error('tesseract failed')
    stdout = run.out
  } catch {
    return []
  }
  return parseTsv(stdout)
}
