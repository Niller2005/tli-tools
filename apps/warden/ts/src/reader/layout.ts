//! Turns a game frame of any width into the 1918 x 1078 reference frame the
//! reader's regions are measured on.

import { readFileSync } from 'node:fs'
import { decodePngRaw, Rect, REF_H, REF_W, Rgba } from './mod'

/** Where a zone of the game's screen keeps to along one axis: the frame's
 * start (left or top), centre or end (right or bottom). */
type Anchor = 'start' | 'centre' | 'end'

/** The anchor's coordinate on an axis `len` long. */
function anchorAt(a: Anchor, len: number): number {
  if (a === 'start') return 0
  if (a === 'centre') return len / 2
  return len
}

/** A zone of the reference frame and the anchors it scales about. */
interface Zone {
  rect: Rect
  x: Anchor
  y: Anchor
  /** How far the point the zone scales about sits from its anchors, in
   * reference px: at scale u the zone's content moves by (1 - u) times it. */
  at: [number, number]
}

function zone(x: number, y: number, w: number, h: number, ax: Anchor, ay: Anchor): Zone {
  return { rect: new Rect(x, y, w, h), x: ax, y: ay, at: [0, 0] }
}

/** The zones of the reference frame that keep to an edge of the game's
 * window; everything else (the board and its cell numbers, Select a
 * Destination/Objective, the Go to Cell and Consume/End cards, the pick
 * cards and their names) keeps to the centre. At interface scale u every
 * zone shrinks by u about its anchor; a window wider than 16:9 moves each
 * zone with its horizontal anchor. A later zone wins where two overlap.
 *
 * Horizontally measured on a 1716 x 720 (21:9) clip at u = 1 against 16:9
 * frames of the same screens: the board (rec1-t087), the Select a Torture
 * Instrument cards (rec1-t031, x 250-1670) and the Warden's Treasure cards
 * (rec1-t085). Vertically measured on a 1920 x 1084 run at u = 0.645 against
 * the same screens.
 *
 * - The top left (left, top): the Tartarus Prison bar, the objective panel
 *   and the Torture Instrument icons. It stops at x 400 above the
 *   instrument cards' tops (y 180) and below at x 260, where the second
 *   icon's crop ends (the first instrument card's left 10 px, art only, go
 *   with it).
 * - The top right (right, top): Speed-up, the back arrow, View Prison
 *   Status, the Chromatic Prisoner heading and the vault slots (from x 1680,
 *   right of the instrument cards' names). The vault zone covers the right
 *   part of the fourth Warden's Treasure card, which the reader does not
 *   read, and the right end of the Prison Incident popup title region.
 * - The bottom right (right, centre): Quick Action and the Consume target
 *   pick's Cancel.
 * - The top centre (centre, top): the days counter.
 * - The bottom centre (centre, bottom): Confirm.
 * - The Torture Instrument icons (left, top, about a point 3.6 px left of
 *   and 7.3 px above the corner): at u = 0.645 the icons sit 2 reference px left
 *   and 4 above where the top-left corner puts them (f_053, f_093, f_209
 *   against rec1-t087: the first icon scores 0.85 here against 0.57 at the
 *   corner, the second 0.83 against 0.47).
 */
function zones(): Zone[] {
  return [
    zone(0, 0, 400, 260, 'start', 'start'),
    zone(0, 260, 260, 230, 'start', 'start'),
    zone(1540, 0, 378, 200, 'end', 'start'),
    zone(1680, 200, 238, 520, 'end', 'start'),
    zone(1600, 720, 318, 358, 'end', 'centre'),
    zone(800, 0, 320, 60, 'centre', 'start'),
    zone(700, 915, 518, 163, 'centre', 'end'),
    { ...zone(70, 340, 190, 100, 'start', 'start'), at: [-3.6, -7.3] },
  ]
}

/** The zones the title layout adds over [`ZONES`], the first two kept to the
 * top centre, while the board's top rows under them keep to the centre: a strip
 * over the panels reader's TITLE and RIOT regions (y 70-175) with the pick
 * titles and the riot title, and one over its INCIDENT region with the
 * Prison Incident popup's title (the popup's title, at the smallest
 * setting, sits at y 149 of 1084 where centre-anchoring would put it above the
 * frame: f_049, Sewer Ratway). A third, kept to the bottom centre as
 * Confirm is, covers the panels reader's REROLLS region: "Remaining attempts
 * N" over the instrument pick's Re-roll button (x 693-892, y 893-915 on
 * reroll-2000x837). In the board layout that strip keeps to the centre,
 * where the destination cards' text reaches down to y 906 (rec3-t058).
 */
function titleZones(): Zone[] {
  return [
    zone(400, 70, 1140, 105, 'centre', 'start'),
    zone(1100, 190, 700, 70, 'centre', 'start'),
    zone(640, 880, 320, 45, 'centre', 'end'),
  ]
}

/** The layout a reference point was read from: the board layout, or the
 * title layout with [`TITLE_ZONES`] over it. */
export type Layout = 'board' | 'title'

/** f32 rounding: the reader's arithmetic is single precision. */
const f = Math.fround

/** The frame pixel that reference pixel `p` is read from in `layout` on a
 * `w` x `h` frame at interface scale `u`, as [`layOut`] and
 * [`layOutTitle`] sample it, and the frame px per reference px there. The
 * zone is the last one painted over `p`. */
export function framePoint(p: [number, number], layout: Layout, w: number, h: number, u: number): [[number, number], number] {
  if (u === 1.0 && is16x9(w, h)) {
    const sx = f(w / REF_W)
    const sy = f(h / REF_H)
    return [
      [f(f(f(p[0] + 0.5) * sx) - 0.5), f(f(f(p[1] + 0.5) * sy) - 0.5)],
      sy,
    ]
  }
  const full = zone(0, 0, REF_W, REF_H, 'centre', 'centre')
  const inside = (z: Zone): boolean =>
    z.rect.x <= Math.floor(p[0]) &&
    z.rect.x + z.rect.w > Math.floor(p[0]) &&
    z.rect.y <= Math.floor(p[1]) &&
    z.rect.y + z.rect.h > Math.floor(p[1])
  const titled = layout === 'title' ? [...titleZones()].reverse().find(inside) : undefined
  const z = titled ?? [...zones()].reverse().find(inside) ?? full
  const k = f(h / REF_H)
  return [
    [source(p[0], REF_W, z.x, z.at[0], u, k, w), source(p[1], REF_H, z.y, z.at[1], u, k, h)],
    f(k * u),
  ]
}

/** The source coordinate reference pixel `i` samples on one axis; see [`taps`]. */
function source(i: number, len: number, a: Anchor, off: number, u: number, k: number, src: number): number {
  const atRef = f(anchorAt(a, len) + off)
  const atSrc = f(anchorAt(a, f(src / k)) + off)
  return f(f(f(atSrc + f(f(i + 0.5 - atRef) * u)) * k) - 0.5)
}

/** Whether a `w` x `h` frame is 16:9 within 1%. */
export function is16x9(w: number, h: number): boolean {
  return Math.abs(w * 9 - h * 16) * 100 <= h * 16
}

/** One axis of a zone: per reference pixel of the zone's span, the two
 * source pixels it samples and the second's weight in 256ths; null outside
 * the source. */
type Taps = ({ c0: number; c1: number; w: number } | null)[]

/** The taps of reference pixels `span` on an axis `len` long, the zone's
 * anchor `a` moved by `off` reference px, sampled from a source axis `src`
 * px long at `k` source px per reference px and scale `u`. */
function taps(span: number[], len: number, a: Anchor, off: number, u: number, k: number, src: number): Taps {
  return span.map((i) => {
    const c = source(i, len, a, off, u, k, src)
    if (!(c > -1.0 && c < src)) return null
    const clamped = f(Math.min(Math.max(c, 0), src - 1))
    const c0 = Math.trunc(clamped)
    return { c0, c1: Math.min(c0 + 1, src - 1), w: Math.round(f(f(clamped - c0) * 256)) }
  })
}

/** Paints zone `z` of `out`, a reference-size image, from `frame` at
 * interface scale `u`. */
function paint(out: Uint8Array, frame: Rgba, u: number, z: Zone): void {
  const k = f(frame.h / REF_H)
  const r = z.rect
  const x0 = r.x
  const x1 = r.x + r.w
  const y0 = r.y
  const y1 = r.y + r.h
  const cols = taps(
    Array.from({ length: x1 - x0 }, (_, i) => x0 + i),
    REF_W,
    z.x,
    z.at[0],
    u,
    k,
    frame.w
  ).map((c) => (c === null ? null : { c0: c.c0 * 4, c1: c.c1 * 4, w: c.w }))
  const rows = taps(
    Array.from({ length: y1 - y0 }, (_, i) => y0 + i),
    REF_H,
    z.y,
    z.at[1],
    u,
    k,
    frame.h
  )
  const rowLen = frame.w * 4
  for (let y = y0; y < y1; y++) {
    const at = (y * REF_W + x0) * 4
    const row = rows[y - y0]
    if (row === null || row === undefined) {
      for (let i = 0; i < (x1 - x0) * 4; i++) out[at + i] = i % 4 === 3 ? 255 : 0
      continue
    }
    const top = frame.data.subarray(row.c0 * rowLen, row.c0 * rowLen + rowLen)
    const bot = frame.data.subarray(row.c1 * rowLen, row.c1 * rowLen + rowLen)
    for (let x = x0; x < x1; x++) {
      const c = cols[x - x0]
      const p = at + (x - x0) * 4
      if (c === null || c === undefined) {
        out[p] = 0
        out[p + 1] = 0
        out[p + 2] = 0
        out[p + 3] = 255
        continue
      }
      for (let i = 0; i < 4; i++) {
        const t = top[c.c0 + i] * (256 - c.w) + top[c.c1 + i] * c.w
        const b = bot[c.c0 + i] * (256 - c.w) + bot[c.c1 + i] * c.w
        out[p + i] = (Math.floor((t * (256 - row.w) + b * row.w + (1 << 15)) / 65536) >> 0) & 255
      }
    }
  }
}

/** `img` resized to `w` x `h`: exactly the pixels `Rgba::resize` gives, the
 * same bilinear taps and the same f32 rounding, but with the per-pixel
 * arithmetic kept off `Math.round`'s double path (the channel sums are
 * non-negative f32 values below 512, where `(z + 0.5) | 0` rounds the same)
 * and the column taps in flat arrays instead of per-pixel object loads.
 * Every read pays for one or more of these: the layout of a native capture
 * here, the OCR crops in `prepare`. */
export function resample(img: Rgba, w: number, h: number): Rgba {
  if (w === img.w && h === img.h) return new Rgba(img.w, img.h, img.data.slice())
  const d = img.data
  const out = new Uint8Array(w * h * 4)
  const sx = f(img.w / w)
  const sy = f(img.h / h)
  // Each output column's two source byte offsets in a row and the weight of
  // the second pixel, worked out once.
  const ca = new Int32Array(w)
  const cb = new Int32Array(w)
  const ct = new Float32Array(w)
  const cu = new Float32Array(w)
  for (let x = 0; x < w; x++) {
    const fx = f(Math.min(Math.max(f(f((x + 0.5) * sx) - 0.5), 0), img.w - 1))
    const x0 = Math.trunc(fx)
    ca[x] = x0 * 4
    cb[x] = Math.min(x0 + 1, img.w - 1) * 4
    const t = f(fx - x0)
    ct[x] = t
    cu[x] = f(1 - t)
  }
  const rowLen = img.w * 4
  for (let y = 0; y < h; y++) {
    const fy = f(Math.min(Math.max(f(f((y + 0.5) * sy) - 0.5), 0), img.h - 1))
    const y0 = Math.trunc(fy)
    const top = y0 * rowLen
    const bot = Math.min(y0 + 1, img.h - 1) * rowLen
    const ty = f(fy - y0)
    const uy = f(1 - ty)
    let o = y * w * 4
    for (let x = 0; x < w; x++) {
      const a = ca[x]
      const b = cb[x]
      const t = ct[x]
      const u = cu[x]
      const t0 = f(f(d[top + a] * u) + f(d[top + b] * t))
      const b0 = f(f(d[bot + a] * u) + f(d[bot + b] * t))
      out[o] = clamp(f(f(t0 * uy) + f(b0 * ty)))
      const t1 = f(f(d[top + a + 1] * u) + f(d[top + b + 1] * t))
      const b1 = f(f(d[bot + a + 1] * u) + f(d[bot + b + 1] * t))
      out[o + 1] = clamp(f(f(t1 * uy) + f(b1 * ty)))
      const t2 = f(f(d[top + a + 2] * u) + f(d[top + b + 2] * t))
      const b2 = f(f(d[bot + a + 2] * u) + f(d[bot + b + 2] * t))
      out[o + 2] = clamp(f(f(t2 * uy) + f(b2 * ty)))
      const t3 = f(f(d[top + a + 3] * u) + f(d[top + b + 3] * t))
      const b3 = f(f(d[bot + a + 3] * u) + f(d[bot + b + 3] * t))
      out[o + 3] = clamp(f(f(t3 * uy) + f(b3 * ty)))
      o += 4
    }
  }
  return new Rgba(w, h, out)
}

/** A non-negative f32 channel sum rounded and clamped to a byte, as
 * `Math.min(255, Math.max(0, Math.round(z)))` on it. */
function clamp(z: number): number {
  const r = (z + 0.5) | 0
  return r > 255 ? 255 : r
}

/** `frame` at the reference size in the board layout at interface scale `u`
 * (see [`uiScale`]). A 16:9 frame (within 1%) at u = 1 is resized. Any
 * other frame is laid out by [`ZONES`]: a reference pixel (x, y) in a zone
 * anchored at (ax, ay) on the reference frame and at (ax', ay') on the
 * frame scaled to the reference height takes the pixel at
 * (ax' + (x - ax) u, ay' + (y - ay) u) there, sampled bilinearly from
 * `frame` itself; pixels outside every zone keep to the centre. Pixels past
 * the frame's edges are black. */
export function layOut(frame: Rgba, u: number): Rgba {
  if (u === 1.0 && is16x9(frame.w, frame.h)) return resample(frame, REF_W, REF_H)
  const data = new Uint8Array(REF_W * REF_H * 4)
  paint(data, frame, u, zone(0, 0, REF_W, REF_H, 'centre', 'centre'))
  for (const z of zones()) paint(data, frame, u, z)
  return new Rgba(REF_W, REF_H, data)
}

/** The title layout of `frame` at interface scale `u`: `board`, its board
 * layout, with the [`TITLE_ZONES`] laid out over it. */
export function layOutTitle(frame: Rgba, u: number, board: Rgba): Rgba {
  const title = new Rgba(board.w, board.h, board.data.slice())
  for (const z of titleZones()) paint(title.data, frame, u, z)
  return title
}

/** `frame` in the board layout and, when it differs (u != 1), the title
 * layout, with the interface scale they were laid out at: measured on the
 * frame (see [`uiScale`], searching near `hint` first), else `hint`, else 1. */
export function layOutScaled(frame: Rgba, hint: number | null): [Rgba, Rgba | null, number] {
  const u = uiScale(frame, hint) ?? hint ?? 1.0
  const board = layOut(frame, u)
  const title = u !== 1.0 ? layOutTitle(frame, u, board) : null
  return [board, title, u]
}

/** Where `assets/s16-back-arrow.png` was cut from the reference frame
 * rec1-t087: the back arrow at the top right with a few px of background. */
function arrowAt(): Rect {
  return new Rect(1812, 15, 68, 43)
}

/** Where `assets/s16-gate.png` was cut from rec1-t087: the Tartarus Prison
 * gate icon at the top left with a few px of background. */
function gateAt(): Rect {
  return new Rect(54, 8, 68, 60)
}

/** The lowest normalised cross-correlation that counts as either mark: true
 * matches score 0.54 and up unless a popup dims the gate icon to 0.3 or
 * less; misses score up to 0.31 (a run1414 frame whose right side is
 * shifted against its left). */
const MIN_SCORE = 0.45

/** How far the two marks may disagree in y, in frame px. */
const MAX_DY = 3.0

/** How far a mark may sit from where the scale puts it, in frame px. */
const SLACK_X = 12.0
const SLACK_Y = 8.0

/** A template's grey levels, row by row. */
function grey(png: Uint8Array, at: Rect): Float32Array {
  const img = decodePngRaw(png)
  if (img.w !== at.w || img.h !== at.h) throw new Error('mark template size')
  const out = new Float32Array(img.w * img.h)
  for (let i = 0; i < out.length; i++) out[i] = luma(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2])
  return out
}

let arrowTemplate: Float32Array | null = null
let gateTemplate: Float32Array | null = null

/** The back arrow's template, read from the asset the first time it is used. */
function arrow(): Float32Array {
  if (arrowTemplate === null) {
    arrowTemplate = grey(readFileSync(new URL('../../../assets/s16-back-arrow.png', import.meta.url)), arrowAt())
  }
  return arrowTemplate
}

/** The gate icon's template, read from the asset the first time it is used. */
function gate(): Float32Array {
  if (gateTemplate === null) {
    gateTemplate = grey(readFileSync(new URL('../../../assets/s16-gate.png', import.meta.url)), gateAt())
  }
  return gateTemplate
}

/** The luma of a colour. */
function luma(r: number, g: number, b: number): number {
  return f(f(0.299 * r) + f(f(0.587 * g) + f(0.114 * b)))
}

/** The grey levels of a frame's top rows. */
interface Strip {
  w: number
  h: number
  grey: Float32Array
}

/** A mark's template and where the reference frame has it. */
interface Mark {
  t: Float32Array
  at: Rect
  /** Whether the mark keeps to the right edge (else the left). */
  right: boolean
}

/** A mark found on the strip: its correlation and its box's top-left corner. */
interface Found {
  score: number
  x: number
  y: number
}

/** The source columns a template samples at `x`, and the weight of the
 * second pixel of each: the same for every row of the template. */
function xTaps(strip: Strip, m: Mark, s: number, x: number, step: number): { xi: Int32Array; tx: Float32Array } {
  const tw = m.at.w
  const n = Math.ceil(tw / step)
  const xi = new Int32Array(n)
  const tx = new Float32Array(n)
  for (let k = 0; k < n; k++) {
    const i = k * step
    const clamped = f(Math.min(Math.max(f(f(x + f(f(i + 0.5) * s)) - 0.5), 0), strip.w - 1.001))
    xi[k] = Math.trunc(clamped)
    tx[k] = f(clamped - Math.floor(clamped))
  }
  return { xi, tx }
}

/** The correlation of every `step`th template pixel with the strip sampled
 * there, the template scaled by `s` with its top-left at the row `y` and the
 * columns `taps` gives. */
function nccAt(strip: Strip, m: Mark, s: number, y: number, step: number, taps: { xi: Int32Array; tx: Float32Array }): number {
  const tw = m.at.w
  const th = m.at.h
  // A coordinate's pixel and the weight of the next one, clamped to `len`.
  const axis = (v: number, len: number): [number, number] => {
    const clamped = f(Math.min(Math.max(v, 0), len - 1.001))
    return [Math.trunc(clamped), f(clamped - Math.floor(clamped))]
  }
  let n = 0
  let sp = 0
  let spp = 0
  let st = 0
  let stt = 0
  let spt = 0
  for (let j = 0; j < th; j += step) {
    const [yi, ty] = axis(f(f(y + f(f(j + 0.5) * s)) - 0.5), strip.h)
    for (let k = 0; k < taps.xi.length; k++) {
      const xi = taps.xi[k] as number
      const tx = taps.tx[k] as number
      const top = f(strip.grey[yi * strip.w + xi] + f(f(strip.grey[yi * strip.w + xi + 1] - strip.grey[yi * strip.w + xi]) * tx))
      const bot = f(strip.grey[(yi + 1) * strip.w + xi] + f(f(strip.grey[(yi + 1) * strip.w + xi + 1] - strip.grey[(yi + 1) * strip.w + xi]) * ty))
      const p = f(top + f(f(bot - top) * ty))
      const t = m.t[j * tw + k * step]
      n += 1
      sp += p
      spp += p * p
      st += t
      stt += t * t
      spt += p * t
    }
  }
  const vp = spp - (sp * sp) / n
  const vt = stt - (st * st) / n
  if (vp > 1e-6) return f((spt - (sp * st) / n) / Math.sqrt(vp * vt))
  return 0.0
}

/** Where `m` sits at scale `s` (frame px per reference px) with no shift. */
function predicted(strip: Strip, m: Mark, s: number): [number, number] {
  const x = m.right ? f(strip.w - f(f(REF_W - m.at.x) * s)) : f(m.at.x * s)
  return [x, f(m.at.y * s)]
}

/** The best match of `m` at scale `s` within (rx, ry) of (x0, y0), in
 * shifts of `d` px, sampling every `step`th template pixel. */
function locate(strip: Strip, m: Mark, s: number, x0: number, y0: number, rx: number, ry: number, d: number, step: number): Found {
  let best: Found = { score: -Infinity, x: x0, y: y0 }
  const nx = Math.round(rx / d)
  const ny = Math.round(ry / d)
  // The columns the template samples are the same for every row it is
  // tried at, so they are worked out once.
  const taps: { xi: Int32Array; tx: Float32Array }[] = []
  for (let ix = -nx; ix <= nx; ix++) taps.push(xTaps(strip, m, s, f(x0 + f(ix * d)), step))
  for (let iy = -ny; iy <= ny; iy++) {
    const y = f(y0 + f(iy * d))
    for (let ix = -nx; ix <= nx; ix++) {
      const x = f(x0 + f(ix * d))
      const score = nccAt(strip, m, s, y, step, taps[ix + nx] as { xi: Int32Array; tx: Float32Array })
      if (score > best.score) best = { score, x, y }
    }
  }
  return best
}

/** `m` located to a quarter px around `found`. */
function sharpen(strip: Strip, m: Mark, s: number, found: Found, r: number): Found {
  const coarse = locate(strip, m, s, found.x, found.y, r, r, 0.5, 1)
  return locate(strip, m, s, coarse.x, coarse.y, 0.25, 0.25, 0.25, 1)
}

/** The game's interface scale on `frame`, a frame of any size: 1.0 at the
 * slider setting the reference frame was measured at, about 0.645 at the
 * smallest setting. None when the back arrow or the gate icon is not
 * found, or the two disagree in y.
 *
 * At scale u every UI element and the board shrink by u about an anchor:
 * the board and the pick cards about the screen centre, the top bar, the
 * gate icon and the objective panel about the top-left corner, Speed-up,
 * the back arrow and the vault about the top-right corner, Confirm about
 * the bottom centre. With the frame scaled to height 1078 and width W', a
 * capture shifted by s puts the back arrow's box at
 * x = W' - (1918 - x_arrow) * u + s and the gate icon's at
 * x = x_gate * u + s, both at y = y_ref * u, their sizes times u. Each
 * mark is found by normalised cross-correlation (so the marks dimmed under
 * the pick screens still match) within 12 px x and 8 px y of where a
 * coarse u in 0.5..=1.3 (by 0.02) puts it; u then comes from the gap between the two,
 * which the shift leaves unchanged, and the marks are found again at that
 * u twice over. A u within 0.025 of 1 gives exactly 1.0.
 *
 * With a `hint` (the last u measured) the coarse u is searched within
 * [`HINT_SPAN`] of it first, by 0.01; the full search runs when either mark
 * scores below [`MIN_SCORE`] there.
 *
 * Measured on the 16:9 frames of trainingdata/s16 and a 21:9 run (u = 1)
 * and on a 1920 x 1084 run at the smallest setting (u about 0.645). */
export function uiScale(frame: Rgba, hint: number | null): number | null {
  const near = hint === null ? null : Array.from({ length: 7 }, (_, n) => f(hint + f(f(HINT_SPAN / 3.0) * (n - 3))))
  const measured = near === null ? null : measure(frame, near)
  const m = measured !== null && Math.min(measured[1].score, measured[2].score) >= MIN_SCORE ? measured : measure(frame, coarseScales())
  const [u, a, g] = m
  const ok = Math.min(a.score, g.score) >= MIN_SCORE
  const k = f(frame.h / REF_H)
  // The y shift each mark was found at.
  const dya = f(a.y - f(f(arrowAt().y * u) * k))
  const dyg = f(g.y - f(f(gateAt().y * u) * k))
  if (!(ok && Math.abs(dya - dyg) <= MAX_DY)) return null
  return Math.abs(f(u - 1.0)) <= 0.025 ? 1.0 : u
}

/** How far from the hint [`uiScale`] searches first. */
const HINT_SPAN = 0.03

/** The coarse scales the full search runs over. */
function coarseScales(): number[] {
  return Array.from({ length: 41 }, (_, n) => f(0.5 + f(0.02 * n)))
}

/** The scale the two marks' gap gives on `frame`, starting from the best of
 * the coarse scales `us`, and the two marks found at it: the back arrow,
 * then the gate icon. */
function measure(frame: Rgba, us: number[]): [number, Found, Found] {
  const k = f(frame.h / REF_H)
  const h = Math.min(
    frame.h,
    Math.trunc(f(f(Math.max(gateAt().y + gateAt().h, arrowAt().y + arrowAt().h) * 1.3 * k) + SLACK_Y + 4.0))
  )
  const grey = new Float32Array(frame.w * h)
  for (let i = 0; i < grey.length; i++) {
    grey[i] = luma(frame.data[i * 4], frame.data[i * 4 + 1], frame.data[i * 4 + 2])
  }
  const strip: Strip = { w: frame.w, h, grey }
  const marks: Mark[] = [
    { t: arrow(), at: arrowAt(), right: true },
    { t: gate(), at: gateAt(), right: false },
  ]
  // Coarse: every other template pixel, shifts by 2 px.
  let coarse: [number, number, Found[], Found[]] = [-Infinity, 1.0, [], []]
  for (const u of us) {
    const found = marks.map((m) => locate(strip, m, f(u * k), ...predicted(strip, m, f(u * k)), SLACK_X, SLACK_Y, 2.0, 2))
    const score = found[0].score + found[1].score
    if (score > coarse[0]) coarse = [score, u, found, []]
  }
  let u = coarse[1]
  let found = coarse[2]
  // The gap between the two boxes' left edges, in frame px, gives u.
  const span = f(f(REF_W - arrowAt().x + gateAt().x) * k)
  let r = 2.0
  for (let i = 0; i < 3; i++) {
    const s = f(u * k)
    found = marks.map((m, j) => sharpen(strip, m, s, found[j], r))
    const next = f(f(frame.w - f(found[0].x - found[1].x)) / span)
    // Carry each mark's shift over to the new scale.
    for (let j = 0; j < marks.length; j++) {
      const m = marks[j]
      const old = predicted(strip, m, s)
      const nextp = predicted(strip, m, f(next * k))
      found[j] = { score: found[j].score, x: f(found[j].x + f(nextp[0] - old[0])), y: f(found[j].y + f(nextp[1] - old[1])) }
    }
    u = next
    r = 1.0
  }
  const s = f(u * k)
  found = marks.map((m, j) => sharpen(strip, m, s, found[j], 0.5))
  return [u, found[0], found[1]]
}
