//! The board scene of the S16 prison screen: per cell the padlock (with the
//! rarity glow of a "?" portrait behind it), the inmate
//! (beast and rarity tier), the Prison Incident "!", the jaws crown, and the
//! warden's gold arrow. Coordinates are pixels of the 1918x1078 reference
//! frame (docs/s16-screen.md). Templates and colour centroids are built from
//! labeled frames by [`buildTemplates`] and read from
//! `assets/s16-templates.bin` (the Rust build embeds them).

import { readFileSync } from 'node:fs'
import { loadPng, type Rgba } from './mod'
import { BEAST_KEYS, beastIndex, type Beast } from '@/engine/data'

/** Cell 1 is the Interrogation Room; cells 2-16 hold inmates. */
export const CELLS: readonly number[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]

/** Portrait centres of cells 1-16, clockwise from the Interrogation Room. */
const PORTRAIT: readonly [number, number][] = [
  [520, 140],
  [698, 140],
  [871, 140],
  [1045, 140],
  [1220, 140],
  [1395, 140],
  [1400, 270],
  [1405, 420],
  [1416, 560],
  [1233, 560],
  [1052, 560],
  [869, 560],
  [686, 560],
  [504, 560],
  [512, 420],
  [515, 280],
]

/** Centres of the warden's arrow for cells 1-16 (measured on the labeled
 * frames for 1, 5-8, 10, 12, 14-16; the rest follow their row). */
const ARROW: readonly [number, number][] = [
  [614, 219],
  [698, 228],
  [871, 228],
  [1045, 228],
  [1217, 228],
  [1290, 225],
  [1290, 276],
  [1293, 416],
  [1293, 470],
  [1230, 466],
  [1052, 466],
  [866, 466],
  [686, 466],
  [601, 478],
  [610, 419],
  [615, 278],
]

/** f32 rounding: the reader's arithmetic is single precision. */
const f = Math.fround

/** Where the padlock sits for cells 2-16 (index = cell - 1). */
function padlockSpot(cell: number): [number, number] {
  const [x, y] = PORTRAIT[cell - 1]
  if (cell >= 2 && cell <= 6) return [x, 195]
  if (cell === 7) return [x, y + 58]
  if (cell === 8) return [x + 2, y + 50]
  if (cell >= 9 && cell <= 14) return [x, 620]
  return [x, y + 52]
}

/** The Prison Incident "!" at the cell's bottom right: measured at cells 6,
 * 7, 9, 13 and 14. Cell 8's sits 9 px higher: its peak is at (+71.5, +24)
 * on six run frames at 1920x1080, 2560x1440 and 3440x1440, and at
 * (+77.5, +24) on trainingdata/reports/incident-cell8.png, a 1911x1072
 * frame whose layout lands the whole right column about 6 px further right.
 * The score falls off within 2 px of the peak, so the spot sits between the
 * two and the +-4 px search reaches both. */
function eventSpot(cell: number): [number, number] {
  const [x, y] = PORTRAIT[cell - 1]
  if (cell === 8) return [x + 74, y + 24]
  return [x + 71, y + 33]
}

/** The portrait centre of screen cell `cell` (1-16), where the player clicks
 * the cell. */
export function portrait(cell: number): [number, number] {
  return PORTRAIT[cell - 1]
}

// ---------- Features ----------

/** Box-averaged RGB patch of `bw` x `bh` blocks of `block` pixels centred on (cx, cy). */
function patch(img: Rgba, cx: number, cy: number, bw: number, bh: number, block: number): Float32Array {
  const x0 = cx - Math.trunc((bw * block) / 2)
  const y0 = cy - Math.trunc((bh * block) / 2)
  const out = new Float32Array(bw * bh * 3)
  let at = 0
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const s = [0, 0, 0]
      for (let dy = 0; dy < block; dy++) {
        for (let dx = 0; dx < block; dx++) {
          const p = img.rgb(x0 + bx * block + dx, y0 + by * block + dy)
          for (let c = 0; c < 3; c++) s[c] = f(s[c] + p[c])
        }
      }
      const n = block * block
      for (let c = 0; c < 3; c++) out[at++] = f(s[c] / n)
    }
  }
  return out
}

/** The mean of f32 values. */
function mean(v: Float32Array): number {
  let s = 0
  for (const x of v) s = f(s + x)
  return f(s / v.length)
}

/** Per-channel mean removal and scaling, then unit length, so a dot product
 * is a normalized cross-correlation that ignores a colour tint. */
function standardize(v: Float32Array): void {
  for (let c = 0; c < 3; c++) {
    const vals: number[] = []
    for (let i = c; i < v.length; i += 3) vals.push(v[i])
    const n = vals.length
    const m = mean(Float32Array.from(vals))
    let acc = 0
    for (const x of vals) acc = f(acc + f(f(x - m) * f(x - m)))
    const sd = f(Math.max(f(Math.sqrt(f(acc / n))), 4.0))
    for (let i = c; i < v.length; i += 3) v[i] = f(f(v[i] - m) / sd)
  }
  normalize(v)
}

/** Grey patch with the mean removed, at unit length. */
function greyPatch(v: Float32Array): Float32Array {
  const g = new Float32Array(v.length / 3)
  for (let i = 0; i < g.length; i++) {
    g[i] = f(f(f(0.299 * v[i * 3]) + f(f(0.587 * v[i * 3 + 1]) + f(0.114 * v[i * 3 + 2]))))
  }
  const m = mean(g)
  for (let i = 0; i < g.length; i++) g[i] = f(g[i] - m)
  normalize(g)
  return g
}

/** Scales a vector to unit length. */
function normalize(v: Float32Array): void {
  let acc = 0
  for (const x of v) acc = f(acc + f(x * x))
  const len = f(Math.sqrt(acc))
  if (len > 1e-6) {
    for (let i = 0; i < v.length; i++) v[i] = f(v[i] / len)
  }
}

/** The dot product of two vectors. */
function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s = f(s + f(a[i] * b[i]))
  return s
}

/** The face inside a portrait frame centred at `(x, y)`, below the jaws crown. */
function face(img: Rgba, x: number, y: number): Float32Array {
  const v = patch(img, x, y + 12, 13, 13, 4)
  standardize(v)
  return v
}

/** The faces at the spots within +-`r` px of `(x, y)`, 2 px apart. */
function facesAround(img: Rgba, x: number, y: number, r: number): Float32Array[] {
  const out: Float32Array[] = []
  for (let dy = -r; dy <= r; dy += 2) {
    for (let dx = -r; dx <= r; dx += 2) {
      out.push(face(img, x + dx, y + dy))
    }
  }
  return out
}

/** The padlock's patch. */
function padlockFeature(img: Rgba, x: number, y: number): Float32Array {
  return greyPatch(patch(img, x, y, 14, 14, 2))
}

/** The incident marker's patch. */
function eventFeature(img: Rgba, x: number, y: number): Float32Array {
  const v = patch(img, x, y, 10, 18, 2)
  standardize(v)
  return v
}

/** Best template score within +-4 px of the spot. */
function search(img: Rgba, spot: [number, number], tpl: Float32Array, feature: (img: Rgba, x: number, y: number) => Float32Array): number {
  let best = -Infinity
  for (let dy = -4; dy <= 4; dy += 2) {
    for (let dx = -4; dx <= 4; dx += 2) {
      best = Math.max(best, dot(feature(img, spot[0] + dx, spot[1] + dy), tpl))
    }
  }
  return best
}

/** Mean RGB over the given pixels. */
function meanRgb(img: Rgba, pts: number[]): [number, number, number] {
  const m = [0, 0, 0]
  let n = 0
  for (let i = 0; i < pts.length; i += 2) {
    const p = img.rgb(pts[i], pts[i + 1])
    for (let c = 0; c < 3; c++) m[c] = f(m[c] + p[c])
    n += 1
  }
  return [f(m[0] / Math.max(n, 1)), f(m[1] / Math.max(n, 1)), f(m[2] / Math.max(n, 1))]
}

/** The pixels of a side of the portrait's frame. */
function sidePts(cx: number, y0: number, y1: number, d0: number, d1: number, s: number): number[] {
  const out: number[] = []
  for (let y = y0; y < y1; y++) {
    for (let d = d0; d < d1; d++) out.push(cx + s * d, y)
  }
  return out
}

/** Glow colour relative to the local light. The rarity glow hugs the portrait
 * frame (32-42 px from the centre at the sides, 24-38 px above it, the jaws
 * crown left out); the wall 54-64 px out at the same height sees the same
 * lantern, red target tint or day-banner dimming. Their per-channel ratio
 * cancels such a tint: its chromaticity gives the hue (white, blue, purple,
 * amber, red) and its mean how much the glow stands out.
 *
 * A cell lit as a reachable destination shows pale stone that adds a
 * roughly grey light to the dark stone, but not evenly: on cell 14 of
 * jaws-orange-cell14 it adds about 27 under the ring on both sides, while
 * the wall sample catches a brown wooden bar on the left and a bluish
 * [69, 74, 79] on the right (40-50 over the far stone). Subtracting that
 * wall took the green out of an orange glow and read it as red. A lit cell
 * is measured against the dark far stone plus a grey offset instead: the
 * wall's least channel lift, capped per segment by the segment's least
 * channel excess (an orange or red glow adds almost no blue, a blue glow
 * almost no red). */
function tierFeature(img: Rgba, cell: number, lantern: boolean): [Float32Array, Float32Array[]] {
  const [cx, cy] = portrait(cell)
  const wall = medianRgb(img, sidePts(cx, cy - 20, cy + 40, 54, 64, -1).concat(sidePts(cx, cy - 20, cy + 40, 54, 64, 1)))
  const top = (x0: number): number[] => {
    const out: number[] = []
    for (let y = cy - 38; y < cy - 24; y++) {
      for (let x = x0; x < x0 + 20; x++) out.push(x, y)
    }
    return out
  }
  const segments = [
    sidePts(cx, cy - 20, cy + 10, 32, 42, -1),
    sidePts(cx, cy + 10, cy + 40, 32, 42, -1),
    sidePts(cx, cy - 20, cy + 10, 32, 42, 1),
    sidePts(cx, cy + 10, cy + 40, 32, 42, 1),
    top(cx - 40),
    top(cx + 20),
  ]
  const far = medianRgb(img, sidePts(cx, cy - 20, cy + 40, 70, 90, -1).concat(sidePts(cx, cy - 20, cy + 40, 70, 90, 1)))
  let lift = Infinity
  for (let c = 0; c < 3; c++) lift = Math.min(lift, f(wall[c] - far[c]))
  const lit = !lantern && lift > LIT_LIFT
  const grey = f(f(f(wall[0] + wall[1]) + wall[2]) / 3)
  const scale = lantern ? [grey, grey, grey] : lit ? far : wall
  const excess: [number, number, number][] = segments.map((s) => {
    const g = meanRgb(img, s)
    let base: [number, number, number]
    if (lit) {
      let o = lift
      for (let c = 0; c < 3; c++) o = Math.min(o, f(g[c] - far[c]))
      o = Math.max(o, 0)
      base = [f(far[0] + o), f(far[1] + o), f(far[2] + o)]
    } else {
      base = wall
    }
    const out: [number, number, number] = [0, 0, 0]
    for (let c = 0; c < 3; c++) out[c] = f(f(Math.max(f(g[c] - base[c]), 0)) / Math.max(scale[c], 4))
    return out
  })
  const e: [number, number, number] = [
    median(excess.map((x) => x[0])),
    median(excess.map((x) => x[1])),
    median(excess.map((x) => x[2])),
  ]
  return [glowPoint(e), excess.map(glowPoint)]
}

/** Least lift of the wall over the far stone (70-90 px out, outside the
 * cell) that marks a cell lit as a reachable destination. Unlit cells of the
 * labeled frames stay below 5, lit ones measure 13 to 50. */
const LIT_LIFT = 10.0

/** Chromaticity of a glow excess (pulled to grey when faint) and its strength. */
function glowPoint(e: [number, number, number]): Float32Array {
  const sum = f(f(e[0] + e[1]) + e[2])
  const k = f(3.0 / f(sum + 0.3))
  const out = new Float32Array(4)
  out[0] = f(k * e[0])
  out[1] = f(k * e[1])
  out[2] = f(k * e[2])
  out[3] = f(sum / 12.0)
  return out
}

/** The median of f32 values. */
function median(v: number[]): number {
  const sorted = [...v].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const n = sorted.length
  if (n % 2 === 1) return sorted[n / 2]
  return f(f(sorted[n / 2 - 1] + sorted[n / 2]) / 2)
}

/** Per-channel median RGB over the given pixels. */
function medianRgb(img: Rgba, pts: number[]): [number, number, number] {
  const ch: number[][] = [[], [], []]
  for (let i = 0; i < pts.length; i += 2) {
    const p = img.rgb(pts[i], pts[i + 1])
    for (let c = 0; c < 3; c++) ch[c].push(p[c])
  }
  return [median(ch[0]), median(ch[1]), median(ch[2])]
}

/** Gold arrow pixels around each of the 16 warden spots. */
function arrowScores(img: Rgba): number[] {
  const out: number[] = []
  for (const [ax, ay] of ARROW) {
    let n = 0
    for (let y = ay - 22; y < ay + 22; y++) {
      for (let x = ax - 22; x < ax + 22; x++) {
        const [r, g, b] = img.rgb(x, y)
        if (r > 60 && r >= g && g > b && (r - b) * 2 > r && g * 20 > r * 11) n += 1
      }
    }
    out.push(n)
  }
  return out
}

/** Red pixels of the small jaws crown above the portrait. */
function crownScore(img: Rgba, cell: number): number {
  const [cx, cy] = portrait(cell)
  let n = 0
  for (let y = cy - 40; y < cy - 15; y++) {
    for (let x = cx - 20; x < cx + 20; x++) {
      const [r, g, b] = img.rgb(x, y)
      if (r > 140 && g * 2 < r && b * 2 < r + 40) n += 1
    }
  }
  return f(n / 1000.0)
}

/** Share of saturated red pixels that marks the big jaws of a Consume target
 * pick on a cell: the score is the smallest share of the three bands the
 * jaws fill (left and right of the portrait, under it). Measured over 81
 * trainingdata frames and 44 run-log frames: the cells of every other screen,
 * and the cells a target pick does not offer, score 0.000 (an Ultimate's red
 * glow included); the offered targets score 0.086 to 0.317. */
const TARGET_MIN = 0.04

/** Whether the big jaws surround a cell's portrait: see [`TARGET_MIN`]. */
function hasTargetJaws(img: Rgba, cell: number): boolean {
  const [cx, cy] = portrait(cell)
  const red = (r: number, g: number, b: number): boolean => r > 150 && g * 2 < r && b * 2 < r
  const bands: [[number, number], [number, number]][] = [
    [[cx - 40, cx + 40], [cy + 50, cy + 80]],
    [[cx - 58, cx - 38], [cy - 30, cy + 50]],
    [[cx + 38, cx + 58], [cy - 30, cy + 50]],
  ]
  return bands.every(([xs, ys]) => colourShare(img, xs, ys, red) >= TARGET_MIN)
}

/** Mean share of pale grey pixels in the four boxes at a cell's corners that
 * marks the white corner brackets of a "Select an Objective" pick: the
 * Sewer Ratway's around every cell but the Interrogation Room, the Hunt's
 * around its targets. Measured on rec2-t340 and 13 frames of a Trap run
 * under that heading (2560x1440): bracketed cells score 0.11 to 0.32, every
 * other cell 0.00. */
const BRACKET_MIN = 0.05

/** Share of pale grey pixels on the portrait that marks the white glow the
 * Hunt draws on a lone target in place of the brackets: 0.48 on the one
 * such frame, every other cell of those frames at most 0.14 (a Chromatic
 * Prisoner rising) and of the manage screen before it 0.06. */
const HIGHLIGHT_MIN = 0.3

/** Whether a "Select an Objective" pick is on screen: a cell in corner
 * brackets or in the Hunt's white glow (see [`BRACKET_MIN`] and
 * [`HIGHLIGHT_MIN`]). The heading stays up, with neither, while a Prey mark
 * lands and on the next morning while a Chromatic Prisoner leaves its cell. */
export function pickShown(img: Rgba): boolean {
  const pale = (r: number, g: number, b: number): boolean => {
    const min = Math.min(r, g, b)
    const max = Math.max(r, g, b)
    return min >= 150 && max - min < 40
  }
  return CELLS.some((c) => {
    const [cx, cy] = portrait(c)
    const xs: [number, number][] = [
      [cx - 80, cx - 52],
      [cx + 52, cx + 80],
    ]
    const ys: [number, number][] = [
      [cy - 66, cy - 38],
      [cy + 34, cy + 62],
    ]
    let brackets = 0
    for (const x of xs) {
      for (const y of ys) brackets += colourShare(img, x, y, pale)
    }
    brackets /= 4
    return brackets >= BRACKET_MIN || colourShare(img, [cx - 40, cx + 40], [cy - 50, cy + 40], pale) >= HIGHLIGHT_MIN
  })
}

/** Share of the pixels in a box whose colour passes `pick`. */
function colourShare(img: Rgba, xs: [number, number], ys: [number, number], pick: (r: number, g: number, b: number) => boolean): number {
  let n = 0
  for (let y = ys[0]; y < ys[1]; y++) {
    for (let x = xs[0]; x < xs[1]; x++) {
      const [r, g, b] = img.rgb(x, y)
      if (pick(r, g, b)) n += 1
    }
  }
  return f(n / f((xs[1] - xs[0]) * (ys[1] - ys[0])))
}

/** Share of cream pixels that marks the Tusk of Iron Tongs of Lust: Mammoth,
 * a curved tusk drawn over the bottom of the portrait. Measured on a 62-frame
 * run: 150 marked Mammoth cells score 0.063 to 0.094, unmarked Mammoths
 * 0.000, every other beast and empty cell at most 0.013 (one frame in the
 * middle of a chain animation aside); the cells of the 32 labeled
 * trainingdata/s16 frames at most 0.010. The upper bounds on r and r - b
 * leave out the warden's gold arrow, brighter and more saturated than the
 * Tusk, which scored 0.040 where it crossed a Rat's box. */
const TUSK_MIN = 0.03

/** Whether the Tusk mark is on a cell: see [`TUSK_MIN`]. */
function hasTusk(img: Rgba, cell: number): boolean {
  const [cx, cy] = portrait(cell)
  const cream = (r: number, g: number, b: number): boolean =>
    r > 170 && r < 248 && g > 140 && r - b > 45 && r - b <= 100 && r - g < 45
  return colourShare(img, [cx - 20, cx + 25], [cy + 22, cy + 50], cream) >= TUSK_MIN
}

/** Share of amber pixels in the stem of the Blood-Stained Trap's Prey
 * crosshair, a gold and cream ring over the bottom of the portrait.
 * Measured on 79 s16 frames and a 98-frame Trap run (2560x1440): the 38
 * marked cells score 0.045 to 0.201 (0.045 and 0.080 on cells caught in a
 * rise animation), unmarked cells at most 0.083 (fire at the bottom of
 * rec4-t422) and the Tusk 0.000. */
const PREY_STEM_MIN = 0.03

/** Share of cream pixels in each of the crosshair's two arms. The 38 marked
 * cells score 0.106 to 0.190 on their weaker arm; the two unmarked cells
 * with any amber in the stem (above 0.005) score 0.000. The Tusk scores up
 * to 0.324 on the left arm and 0.000 on the right. */
const PREY_ARM_MIN = 0.05

/** Whether the Prey crosshair is on a cell: see [`PREY_STEM_MIN`] and
 * [`PREY_ARM_MIN`]. One frame of a cell's rise animation washes it out. */
function hasPreyMark(img: Rgba, cell: number): boolean {
  const [cx, cy] = portrait(cell)
  const amber = (r: number, g: number, b: number): boolean => r > 180 && g > 100 && b < 80 && r - b > 130
  const cream = (r: number, g: number, b: number): boolean => r > 190 && g > 170 && b > 120 && r - b < 90
  const arms = [
    colourShare(img, [cx - 19, cx - 7], [cy + 24, cy + 42], cream),
    colourShare(img, [cx + 7, cx + 18], [cy + 24, cy + 42], cream),
  ]
  return (
    colourShare(img, [cx - 4, cx + 5], [cy + 22, cy + 54], amber) >= PREY_STEM_MIN && arms.every((a) => a >= PREY_ARM_MIN)
  )
}

/** Half the width and height of the box around a portrait that a tooltip
 * panel is looked for in. */
const TIP_BOX: [number, number] = [70, 45]

/** Sample step in that box, both ways. */
const TIP_STEP = 3

/** Fewest pixels in a horizontal run of panel colour: the tooltip panel is a
 * flat fill, the board's dark stone breaks such runs within a few pixels. */
const TIP_RUN = 40

/** Share of the box in such runs that marks the cell covered. Measured on the
 * Rusty Saw tooltip (rec3-t161): 0.68 and 0.94 on the cells under it, 0.44 on
 * cell 14 it only clips (read right); on the Agonizing Muzzle tooltip
 * (rec4-t412) 0.61 and 0.79 on cells 15 and 16 and 0.59 on cell 14, whose
 * portrait it hides down to the padlock; boards without a tooltip stay at or
 * below 0.30. */
const TIP_SHARE = 0.5

/** The tooltip panel colour: a dark grey (22-48 green), red within 2 of green
 * and blue 0-4 above it. A recorded frame's compression tints the flat panel
 * in blocks, some with blue 3 above green, some with blue equal to green and
 * red 2 below (rec4-t412). The board's stone is warm, red above blue. */
function tipColour(img: Rgba, x: number, y: number): boolean {
  const [r, g, b] = img.rgb(x, y)
  return g >= 22 && g <= 48 && Math.abs(r - g) <= 2 && b - g >= 0 && b - g <= 4
}

/** Whether a tooltip panel (an instrument's name and text drawn when the
 * mouse rests on its icon) covers the cell: the share of the box around the
 * portrait in long horizontal runs of panel colour. */
function tooltipCovers(img: Rgba, cell: number): boolean {
  const [cx, cy] = portrait(cell)
  const [bw, bh] = TIP_BOX
  const x0 = cx - bw - TIP_RUN
  let hit = 0
  let total = 0
  for (let y = cy - bh; y <= cy + bh; y += TIP_STEP) {
    // The row reaches TIP_RUN past the box so a run that crosses its edge counts.
    const panel: boolean[] = []
    for (let x = x0; x <= cx + bw + TIP_RUN; x++) panel.push(tipColour(img, x, y))
    const long = new Array<boolean>(panel.length).fill(false)
    let i = 0
    while (i < panel.length) {
      const start = i
      while (i < panel.length && panel[i]) i += 1
      if (i - start >= TIP_RUN) long.fill(true, start, i)
      i = Math.max(i, start + 1)
    }
    for (let x = cx - bw; x <= cx + bw; x += TIP_STEP) {
      total += 1
      if (long[x - x0]) hit += 1
    }
  }
  return hit >= TIP_SHARE * total
}

// ---------- Templates ----------

/** Beast classes: the four beasts, then an open empty cell and a closed one. */
const CLASSES: (Beast | null)[] = ['mammoth', 'lion', 'wolf', 'rat', null, null]

/** A two-class score split learned from labeled samples. */
export class Split {
  constructor(
    readonly threshold: number,
    readonly scale: number
  ) {}

  /** The split learned from the positive and negative samples. */
  static learn(pos: number[], neg: number[]): Split {
    const meanOf = (v: number[]): number => {
      let s = 0
      for (const x of v) s = f(s + x)
      return f(s / Math.max(v.length, 1))
    }
    if (pos.length === 0 || neg.length === 0) return new Split(0.5, 0.25)
    let lo = Infinity
    for (const x of pos) lo = Math.min(lo, x)
    let hi = -Infinity
    for (const x of neg) hi = Math.max(hi, x)
    const threshold = lo > hi ? f(f(lo + hi) / 2) : f(f(meanOf(pos) + meanOf(neg)) / 2)
    return new Split(threshold, Math.max(Math.abs(f(f(meanOf(pos) - meanOf(neg)) / 2)), 1e-3))
  }

  /** The decision and a 0-1 confidence. */
  decide(score: number): [boolean, number] {
    return [score > this.threshold, Math.min(Math.abs(f(score - this.threshold)) / this.scale, 1.0)]
  }
}

/** The templates the reader scores the board with. */
export class Templates {
  constructor(
    /** One standardized face patch per entry of `CLASSES` (empty when unseen). */
    readonly beast: Float32Array[],
    readonly padlock: Float32Array,
    readonly padlockSplit: Split,
    readonly event: Float32Array,
    readonly eventSplit: Split,
    readonly crownSplit: Split,
    /** Glow centroid per tier 0-4 (empty when unseen). */
    readonly tier: Float32Array[]
  ) {}

  /** The templates as the binary the reader reads them from. */
  toBytes(): Uint8Array {
    const out: number[] = []
    const put = (v: Float32Array | number[]): void => {
      const a = v instanceof Float32Array ? v : Float32Array.from(v)
      out.push(a.length & 255, (a.length >> 8) & 255, (a.length >> 16) & 255, (a.length >> 24) & 255)
      for (const x of a) {
        const b = new Uint8Array(4)
        new DataView(b.buffer).setFloat32(0, x, true)
        out.push(b[0], b[1], b[2], b[3])
      }
    }
    for (const v of MAGIC) out.push(v)
    this.beast.forEach((v) => put(v))
    put(this.padlock)
    put([this.padlockSplit.threshold, this.padlockSplit.scale])
    put(this.event)
    put([this.eventSplit.threshold, this.eventSplit.scale])
    put([this.crownSplit.threshold, this.crownSplit.scale])
    this.tier.forEach((v) => put(v))
    return new Uint8Array(out)
  }

  /** The templates read from the binary the Rust build wrote. */
  static fromBytes(bytes: Uint8Array): Templates {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let pos = 0
    for (let i = 0; i < MAGIC.length; i++) {
      if (bytes[i] !== MAGIC[i]) throw new Error('not an S16 template file')
    }
    pos = MAGIC.length
    const take = (): Float32Array => {
      const n = view.getUint32(pos, true)
      pos += 4
      const v = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        v[i] = view.getFloat32(pos, true)
        pos += 4
      }
      return v
    }
    const split = (v: Float32Array): Split => new Split(v[0], v[1])
    const beast: Float32Array[] = []
    for (let i = 0; i < CLASSES.length; i++) beast.push(take())
    const padlock = take()
    const padlockSplit = split(take())
    const event = take()
    const eventSplit = split(take())
    const crownSplit = split(take())
    const tier: Float32Array[] = []
    for (let i = 0; i < 5; i++) tier.push(take())
    return new Templates(beast, padlock, padlockSplit, event, eventSplit, crownSplit, tier)
  }
}

const MAGIC = [83, 49, 54, 84, 80, 76, 48, 49] // "S16TPL01"

let cachedTemplates: Templates | null = null

/** The templates built from the labeled frames and kept with the reader. */
export function embeddedTemplates(): Templates {
  if (cachedTemplates === null) {
    cachedTemplates = Templates.fromBytes(readFileSync(new URL('../../../assets/s16-templates.bin', import.meta.url)))
  }
  return cachedTemplates
}

// ---------- Labels ----------

/** What the labels say about one cell. */
export interface CellTruth {
  /** null when the frame's padlocks were not labeled (day banner). */
  locked: boolean | null
  /** Beast (null when labeled "?") and tier of the inmate. */
  inmate: { beast: Beast | null; tier: number } | null
  /** The glow tier of a "?" portrait on a locked cell (label "scratch"). */
  scratch: number | null
  event: boolean
  jaws: boolean
}

/** One frame of data/scan-truth-s16.json. */
export interface FrameTruth {
  name: string
  screen: string
  warden: number | null
  covered: number[]
  /** Cells 2-16 at index cell - 2. */
  cells: CellTruth[]
}

/** The beast a label names, whatever its case. */
function beastNamed(s: string): Beast | null {
  const lower = s.toLowerCase()
  return BEAST_KEYS.find((b) => b === lower) ?? null
}

/** The labels of a frame. */
export function parseTruth(name: string, v: Record<string, unknown>): FrameTruth {
  const nums = (key: string): number[] => {
    const a = v[key]
    return Array.isArray(a) ? a.filter((x): x is number => typeof x === 'number') : []
  }
  const screen = typeof v['screen'] === 'string' ? (v['screen'] as string) : ''
  const locked = nums('locked')
  const lockedKnown = !(screen === 'dayBanner' && locked.length === 0)
  const events = nums('events')
  const jaws = nums('jaws')
  const inmates = new Map<number, { beast: Beast | null; tier: number }>()
  const inmateObj = v['inmates']
  if (inmateObj !== null && typeof inmateObj === 'object' && !Array.isArray(inmateObj)) {
    for (const [k, s] of Object.entries(inmateObj as Record<string, unknown>)) {
      if (typeof s !== 'string') continue
      const at = s.indexOf('/')
      inmates.set(Number(k), { beast: beastNamed(s.slice(0, at)), tier: Number(s.slice(at + 1)) })
    }
  }
  const scratch = new Map<number, number>()
  const scratchObj = v['scratch']
  if (scratchObj !== null && typeof scratchObj === 'object' && !Array.isArray(scratchObj)) {
    for (const [k, t] of Object.entries(scratchObj as Record<string, unknown>)) {
      if (typeof t === 'number') scratch.set(Number(k), t)
    }
  }
  const cells = CELLS.map((c) => ({
    locked: lockedKnown ? locked.includes(c) : null,
    inmate: inmates.get(c) ?? null,
    scratch: scratch.get(c) ?? null,
    event: events.includes(c),
    jaws: jaws.includes(c),
  }))
  const warden = typeof v['warden'] === 'number' ? (v['warden'] as number) : null
  return { name, screen, warden, covered: nums('covered'), cells }
}

/** Every frame of the label file, sorted by name. */
export function parseAllTruth(json: unknown): FrameTruth[] {
  const obj = json as Record<string, unknown>
  const out: FrameTruth[] = []
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('_')) continue
    out.push(parseTruth(k, v as Record<string, unknown>))
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return out
}

/** Whether the frame shows the board to read. */
export function hasBoard(t: FrameTruth): boolean {
  return t.screen === 'board' || t.screen === 'chainTarget' || t.screen === 'dayBanner'
}

/** The cell's labels. */
export function cellTruth(t: FrameTruth, cell: number): CellTruth {
  return t.cells[cell - 2]
}

/** The labeled frames found in `dir` (sorted by name) with their labels from
 * `labels`; frames without a board are left out. */
export function loadLabeled(dir: string, labels: string): [Rgba, FrameTruth][] {
  const text = readFileSync(labels, 'utf8')
  const json = JSON.parse(text) as unknown
  const out: [Rgba, FrameTruth][] = []
  for (const t of parseAllTruth(json).filter(hasBoard)) {
    const path = `${dir}/${t.name}`
    try {
      out.push([loadPng(path), t])
    } catch {
      // A frame that is not there is left out.
    }
  }
  return out
}

// ---------- Building ----------

/** The mean of the feature vectors. */
function meanOf(vs: Float32Array[]): Float32Array {
  const first = vs[0]
  if (first === undefined) return new Float32Array(0)
  const m = new Float32Array(first.length)
  for (const v of vs) {
    for (let i = 0; i < m.length; i++) m[i] = f(m[i] + f(v[i] / vs.length))
  }
  return m
}

/** Builds the templates from labeled frames with a board, as
 * [`loadLabeled`] gives them (covered cells left out). */
export function buildTemplates(frames: [Rgba, FrameTruth][]): Templates {
  const beast: Float32Array[][] = [[], [], [], [], [], []]
  const tier: Float32Array[][] = [[], [], [], [], []]
  const locks: Float32Array[] = []
  const events: Float32Array[] = []
  for (const [img, t] of frames) {
    for (const c of CELLS) {
      if (t.covered.includes(c)) continue
      const ct = cellTruth(t, c)
      let cls: number | null = null
      if (ct.inmate !== null) cls = ct.inmate.beast === null ? null : beastIndex(ct.inmate.beast)
      else if (ct.locked === true) cls = 5
      else if (ct.locked === false) cls = 4
      if (cls !== null) beast[cls].push(beastFeature(img, c))
      if (ct.inmate !== null && t.warden !== c && t.screen === 'board') {
        tier[ct.inmate.tier].push(tierFeature(img, c, false)[0])
      }
      const [px, py] = padlockSpot(c)
      if (ct.locked === true) locks.push(padlockFeature(img, px, py))
      if (ct.event) {
        const [ex, ey] = eventSpot(c)
        events.push(eventFeature(img, ex, ey))
      }
    }
  }
  const unit = (v: Float32Array): Float32Array => {
    normalize(v)
    return v
  }
  const padlock = unit(meanOf(locks))
  const event = unit(meanOf(events))
  // Second pass: the score splits, with the same search the reader uses.
  const lp: number[] = []
  const ln: number[] = []
  const ep: number[] = []
  const en: number[] = []
  const jp: number[] = []
  const jn: number[] = []
  for (const [img, t] of frames) {
    for (const c of CELLS) {
      if (t.covered.includes(c)) continue
      const ct = cellTruth(t, c)
      if (ct.locked !== null) {
        const s = search(img, padlockSpot(c), padlock, padlockFeature)
        if (ct.locked) lp.push(s)
        else ln.push(s)
      }
      const s = search(img, eventSpot(c), event, eventFeature)
      if (ct.event) ep.push(s)
      else en.push(s)
      if (ct.inmate !== null && t.screen === 'board') {
        const s = crownScore(img, c)
        if (ct.jaws) jp.push(s)
        else jn.push(s)
      }
    }
  }
  return new Templates(
    beast.map((v) => unit(meanOf(v))),
    padlock,
    Split.learn(lp, ln),
    event,
    Split.learn(ep, en),
    Split.learn(jp, jn),
    tier.map((v) => meanOf(v))
  )
}

/** The face patch of a cell's portrait. */
function beastFeature(img: Rgba, cell: number): Float32Array {
  const [x, y] = portrait(cell)
  return face(img, x, y)
}

// ---------- Reading ----------

/** One cell as read, each field with a 0-1 confidence. */
export interface CellRead {
  locked: boolean
  lockedConf: number
  /** The rarity glow around the "?" portrait of a locked cell (a Scratch
   * mark): the tier of the inmate behind the door. */
  glow: number | null
  glowConf: number
  /** Beast and rarity tier (0 Normal to 4 Ultimate). */
  inmate: { beast: Beast; tier: number } | null
  beastConf: number
  tierConf: number
  /** The strength of the inmate's rarity glow: below GLOW_MIN the
   * portrait has none, so `inmate` reads Normal whatever the rarity. */
  halo: number
  /** The orange Prison Incident "!". */
  event: boolean
  eventConf: number
  /** The small red crown: the inmate has something to consume. Weak on a
   * red-tinted target pick and next to a red (Ultimate) glow. */
  jaws: boolean
  jawsConf: number
  /** The big red jaws a Consume target pick draws around each inmate the
   * eater can consume. */
  target: boolean
  /** The Tusk of Iron Tongs of Lust: Mammoth. Read on any inmate, since
   * whether a Replace keeps the mark on the cell is not known. */
  tusk: boolean
  /** The Blood-Stained Trap's Prey crosshair: a Lion's Hunt marked this
   * inmate. Its cream ring also passes the Tusk test, so a marked cell
   * reads no Tusk. */
  prey: boolean
  /** A tooltip panel covers the cell, so the reads above are of the panel. */
  covered: boolean
}

/** The board as read. */
export class Scene {
  constructor(
    /** Cells 2-16 at index cell - 2. */
    readonly cells: CellRead[],
    /** The cell (1-16) the warden's arrow points at. */
    readonly warden: number | null,
    readonly wardenConf: number
  ) {}

  /** The cell's read. */
  cell(cell: number): CellRead {
    return this.cells[cell - 2]
  }
}

/** The nearest beast class of the best of the face features (one per spot)
 * and the margin to the next one. */
function beastClass(fs: Float32Array[], t: Templates): [number, number] {
  const scores: [number, number][] = []
  t.beast.forEach((tpl, k) => {
    if (tpl.length === 0) return
    let best = -Infinity
    for (const feat of fs) best = Math.max(best, dot(feat, tpl))
    scores.push([best, k])
  })
  scores.sort((a, b) => (a[0] > b[0] ? -1 : a[0] < b[0] ? 1 : 0))
  const top = scores[0]
  const next = scores[1]
  return [top[1], Math.min(f(f((top[0] - (next === undefined ? 0 : next[0])) / 0.2)), 1.0)]
}

/** How far from its spot a vault portrait's face is searched. The slots sit
 * at the frame's right edge, where a frame scaled from another size moves
 * them most: at 2560x1440 a lion's face sat 8 px above the spot, and in a
 * 1895x1058 screenshot 12 px right of it. At the spot itself the vault's
 * flame then scores the lion under the mammoth. */
const VAULT_SEARCH = 12

/** The beast of a portrait centred at `(x, y)` outside the board (a
 * Chromatic Prisoner slot), with the embedded templates; null when the
 * nearest class is an empty or closed cell. */
export function beastAt(img: Rgba, at: [number, number]): [Beast | null, number] {
  const [k, conf] = beastClass(facesAround(img, at[0], at[1], VAULT_SEARCH), embeddedTemplates())
  return [CLASSES[k], conf]
}

/** Reads the board with the embedded templates. */
export function readScene(img: Rgba): Scene {
  return readSceneWith(img, embeddedTemplates())
}

/** Nearest tier centroid and its distance margin to the next one. */
function nearestTier(g: Float32Array, t: Templates): [number, number] {
  const d: [number, number][] = []
  t.tier.forEach((m, i) => {
    if (m.length === 0) return
    let acc = 0
    for (let k = 0; k < m.length; k++) acc = f(acc + f(f(m[k] - g[k]) * f(m[k] - g[k])))
    d.push([acc, i])
  })
  d.sort((a, b) => (a[0] > b[0] ? 1 : a[0] < b[0] ? -1 : 0))
  const tier = d.length === 0 ? 0 : d[0][1]
  const margin = d.length < 2 ? 0 : f(f(d[1][0] - d[0][0]) / Math.max(f(d[1][0] + d[0][0]), 1e-6))
  return [tier, margin]
}

/** The rarity glow around a portrait: the tier, a 0-1 confidence and the
 * glow strength. The confidence is the margin of the median glow, scaled
 * down when fewer than 4 of the 6 ring segments agree on the tier (a jaws
 * overlay or a lit frame on part of the ring). A white glow is grey in
 * every segment, so a Normal read loses its confidence when the segment
 * hues scatter (red jaws and a blue glow whose median lands on grey). The
 * strength is the weaker of the median glow and the glow above the
 * portrait: a glow rises above the frame, while the light of a Prison
 * Incident "!" next to a plain padlock brightens only the sides. */
function glowTier(img: Rgba, cell: number, lantern: boolean, t: Templates): [number, number, number] {
  const [g, segments] = tierFeature(img, cell, lantern)
  const [tier, margin] = nearestTier(g, t)
  let agree = 0
  for (const s of segments) {
    if (nearestTier(s, t)[0] === tier) agree += 1
  }
  let conf = f(margin * Math.min(f(agree / 4.0), 1.0))
  if (tier === 0) {
    const spread = median(
      segments.map((s) => {
        let acc = 0
        for (let i = 0; i < 3; i++) acc = f(acc + f(f(s[i] - g[i]) * f(s[i] - g[i])))
        return acc
      })
    )
    conf = f(conf * f(Math.min(Math.max(f(f(0.12 - spread) / 0.06), 0), 1)))
  }
  const top = f(f(segments[4][3] + segments[5][3]) / 2.0)
  return [tier, conf, Math.min(g[3], top)]
}

/** Glow strength that marks a "?" portrait with a rarity glow on a locked
 * cell. Measured on locked cells of both recordings: plain padlocks and
 * unglowing "?" stay at or below 0.07, glowing "?" measure 0.12
 * (a lit cell) to 0.8. Also the least glow of a portrait: labeled Normal
 * inmates measure 0.17 and up, and after a reconnect the game draws the
 * portraits with no glow at all (0 to 0.07, 2026-10-24 recording). */
export const GLOW_MIN = 0.1

/** Fewest gold pixels that make an arrow. */
const ARROW_MIN = 40

/** Reads the board with the given templates. */
export function readSceneWith(img: Rgba, t: Templates): Scene {
  const arrows = arrowScores(img)
  const order = arrows.map((_, i) => i)
  order.sort((a, b) => arrows[b] - arrows[a])
  const best = arrows[order[0]]
  const second = arrows[order[1]]
  const warden = best >= ARROW_MIN ? order[0] + 1 : null
  const wardenConf = warden !== null ? f(1 - f(second / best)) : 0.0

  const cells = CELLS.map((c): CellRead => {
    const r: CellRead = {
      locked: false,
      lockedConf: 0,
      glow: null,
      glowConf: 0,
      inmate: null,
      beastConf: 0,
      tierConf: 0,
      halo: 0,
      event: false,
      eventConf: 0,
      jaws: false,
      jawsConf: 0,
      target: false,
      tusk: false,
      prey: false,
      covered: tooltipCovers(img, c),
    }
    const s = search(img, padlockSpot(c), t.padlock, padlockFeature)
    ;[r.locked, r.lockedConf] = t.padlockSplit.decide(s)
    const e = search(img, eventSpot(c), t.event, eventFeature)
    ;[r.event, r.eventConf] = t.eventSplit.decide(e)

    // The face at the spots within +-4 px of the usual one: on a lit
    // cell with a path line through it the face has been seen 4-8 px higher.
    const [x, y] = portrait(c)
    const [k, conf] = beastClass(facesAround(img, x, y, 4), t)
    r.beastConf = conf
    const beast = CLASSES[k]
    if (beast !== null && !r.locked) {
      const [tier, tierConf, halo] = glowTier(img, c, warden === c, t)
      r.tierConf = tierConf
      r.halo = halo
      r.inmate = { beast, tier }
      const [jaws, jawsConf] = t.crownSplit.decide(crownScore(img, c))
      r.jaws = jaws
      r.jawsConf = jawsConf
      r.target = hasTargetJaws(img, c)
      r.prey = hasPreyMark(img, c)
      r.tusk = !r.prey && hasTusk(img, c)
    } else if (r.locked) {
      r.beastConf = r.lockedConf
      const [tier, glowConf, strength] = glowTier(img, c, false, t)
      if (strength >= GLOW_MIN) {
        r.glow = tier
        r.glowConf = f(glowConf * Math.min(f(f(strength - GLOW_MIN) / 0.02), 1.0))
      }
    }
    return r
  })
  return new Scene(cells, warden, wardenConf)
}
