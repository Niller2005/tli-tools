//! The held Torture Instruments, read from the icons in the instrument panel
//! at the top left of the board. Each slot's crop is matched against the
//! game's 31 instrument icons (assets/s16-instruments.bin, built by
//! `cargo run --release --example s16_instruments -- <NoAtlas dir>`).

import { readFileSync } from 'node:fs'
import { lumaStats } from './panels'
import { Rect, type Rgba } from './mod'
import { data, type Tool } from '@/engine/data'

/** Slot centres at 1918x1078, in pick order; the game shows at most 2 icons. */
const SLOTS: [number, number][] = [
  [122, 391],
  [211, 391],
]
/** The icon is drawn at 89x89 px around the slot centre. */
const ICON_PX = 89
/** Side of the grid both the icons and the frame crops are averaged down to. */
export const GRID = 45
/** Luma std over the 44x44 box below which a slot is empty: 4.4 measured on
 * an empty slot, >= 20 on filled ones. */
const EMPTY_SPREAD = 12.0
/** Least score of a named icon: the right icon scores 0.73-0.96. */
const MIN_SCORE = 0.6
/** Least lead over the runner-up: the best wrong icon scores <= 0.39. */
const MIN_LEAD = 0.25

const MAGIC = 'S16INS01'

/** The instrument icons in data order, each GRID x GRID RGBA. */
export class Icons {
  constructor(readonly icons: Uint8Array[]) {}

  /** The icons as the binary the reader reads them from. */
  toBytes(): Uint8Array {
    const out = new Uint8Array(10 + this.icons.length * GRID * GRID * 4)
    for (let i = 0; i < MAGIC.length; i++) out[i] = MAGIC.charCodeAt(i)
    out[8] = GRID
    out[9] = this.icons.length
    let at = 10
    for (const icon of this.icons) {
      out.set(icon, at)
      at += icon.length
    }
    return out
  }

  /** The icons read from the binary the Rust build wrote. */
  static fromBytes(bytes: Uint8Array): Icons {
    if (bytes.length < 10 || new TextDecoder().decode(bytes.subarray(0, 8)) !== MAGIC) {
      throw new Error('not an S16INS01 file')
    }
    const side = bytes[8]
    const count = bytes[9]
    if (side !== GRID) throw new Error(`grid side ${side}, expected ${GRID}`)
    if (count !== data().toolIds.length) throw new Error(`${count} icons, expected ${data().toolIds.length}`)
    const size = GRID * GRID * 4
    if (bytes.length !== 10 + count * size) throw new Error(`${bytes.length} bytes, expected ${10 + count * size}`)
    const icons: Uint8Array[] = []
    for (let i = 0; i < count; i++) icons.push(bytes.slice(10 + i * size, 10 + (i + 1) * size))
    return new Icons(icons)
  }
}

let cachedIcons: Icons | null = null

/** The icons exported from the game and kept with the reader. */
export function embeddedIcons(): Icons {
  if (cachedIcons === null) {
    cachedIcons = Icons.fromBytes(readFileSync(new URL('../../../assets/s16-instruments.bin', import.meta.url)))
  }
  return cachedIcons
}

/** Area-averages a w x h RGBA image to side x side: an exact box filter with
 * fractional pixel coverage, colour weighted by alpha, then un-premultiplied. */
export function boxDownscale(src: Uint8Array, w: number, h: number, side: number): Uint8Array {
  // Per output index, the source pixels it covers with their coverage.
  const spans = (n: number): [number, number][][] => {
    const s = n / side
    const out: [number, number][][] = []
    for (let i = 0; i < side; i++) {
      const a = i * s
      const b = (i + 1) * s
      const row: [number, number][] = []
      const end = Math.min(Math.ceil(b), n)
      for (let p = Math.floor(a); p < end; p++) {
        row.push([p, Math.min(b, p + 1) - Math.max(a, p)])
      }
      out.push(row)
    }
    return out
  }
  const xs = spans(w)
  const ys = spans(h)
  const out = new Uint8Array(side * side * 4)
  let at = 0
  for (const yspan of ys) {
    for (const xspan of xs) {
      const acc = [0, 0, 0]
      let alpha = 0
      let area = 0
      for (const [y, cy] of yspan) {
        for (const [x, cx] of xspan) {
          const i = (y * w + x) * 4
          const c = cx * cy
          const a = src[i + 3] / 255
          for (let k = 0; k < 3; k++) acc[k] += c * a * src[i + k]
          alpha += c * a
          area += c
        }
      }
      for (const v of acc) {
        out[at++] = alpha > 0 ? Math.min(Math.max(Math.round(v / alpha), 0), 255) : 0
      }
      out[at++] = Math.min(Math.max(Math.round((alpha / area) * 255), 0), 255)
    }
  }
  return out
}

/** What one panel slot shows. */
type Slot = { kind: 'empty' } | { kind: 'named'; tool: Tool } | { kind: 'unsure' }

/** Pearson correlation between the icon's opaque pixels and the same pixels
 * of the crop, over their RGB values taken together. */
function score(icon: Uint8Array, crop: Uint8Array): number {
  const a: number[] = []
  const b: number[] = []
  for (let i = 0; i < icon.length; i += 4) {
    if (icon[i + 3] >= 128) {
      a.push(icon[i], icon[i + 1], icon[i + 2])
      b.push(crop[i], crop[i + 1], crop[i + 2])
    }
  }
  if (a.length === 0) return 0.0
  const standardize = (v: number[]): void => {
    const n = v.length
    const mean = v.reduce((x, y) => x + y, 0) / n
    let acc = 0
    for (const x of v) acc += (x - mean) * (x - mean)
    const std = Math.max(Math.sqrt(acc / n), 1e-9)
    for (let i = 0; i < v.length; i++) v[i] = (v[i] - mean) / std
  }
  standardize(a)
  standardize(b)
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum / a.length
}

/** The best and runner-up icon scores of a slot, as (data index, score). */
function ranked(img: Rgba, at: [number, number]): [[number, number], [number, number]] {
  const half = Math.trunc(ICON_PX / 2)
  const crop = img.crop(new Rect(at[0] - half, at[1] - half, ICON_PX, ICON_PX))
  const small = boxDownscale(crop.data, crop.w, crop.h, GRID)
  const s = embeddedIcons().icons.map((icon, index): [number, number] => [index, score(icon, small)])
  s.sort((x, y) => y[1] - x[1])
  return [s[0], s[1]]
}

/** What the slot shows. */
function slot(img: Rgba, at: [number, number]): Slot {
  if (lumaStats(img, at, 22)[1] < EMPTY_SPREAD) return { kind: 'empty' }
  const [best, second] = ranked(img, at)
  if (best[1] >= MIN_SCORE && best[1] - second[1] >= MIN_LEAD) {
    return { kind: 'named', tool: data().toolIds[best[0]] }
  }
  return { kind: 'unsure' }
}

/** The instruments the panel icons name, in pick order; null when an icon
 * does not match one instrument clearly. */
export function readHeld(img: Rgba): Tool[] | null {
  const first = slot(img, SLOTS[0])
  const second = slot(img, SLOTS[1])
  if (first.kind === 'empty') return []
  if (first.kind === 'named' && second.kind === 'empty') return [first.tool]
  if (first.kind === 'named' && second.kind === 'named') return [first.tool, second.tool]
  return null
}
