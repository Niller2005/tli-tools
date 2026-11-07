//! The screenshot reader for the S16 prison screen (docs/s16-screen.md).
//! The board scene comes from pixels (`scene`), the text panels from the
//! OCR engine (`ocr`, `panels`), and `model` joins them into a board
//! model.

export * from './click'
export * from './instruments'
export * from './layout'
export * from './model'
export * from './ocr'
export * from './panels'
export * from './scene'

import { readFileSync, writeFileSync } from 'node:fs'
import { asBytes, decodePng, encodePng, type Image } from '@tli/png'
import { layOutScaled } from './layout'
import { readPanelsTitled } from './panels'
import { readScene } from './scene'
import { ironLawDays, RUN_DAYS, toModel, type Warning } from './model'
import type { Model } from '@/board/board'
import type { Tool } from '@/engine/data'

/** Width and height of the reference frame every coordinate refers to. */
export const REF_W = 1918
export const REF_H = 1078

/** A pixel rectangle: left, top, width, height. */
export class Rect {
  constructor(
    readonly x: number,
    readonly y: number,
    readonly w: number,
    readonly h: number
  ) {}

  /** The centre of the rectangle. */
  centre(): [number, number] {
    return [this.x + Math.trunc(this.w / 2), this.y + Math.trunc(this.h / 2)]
  }
}

/** An 8-bit RGBA image, rows top to bottom. */
export class Rgba implements Image {
  constructor(
    readonly w: number,
    readonly h: number,
    readonly data: Uint8Array
  ) {}

  /** The image's width, as the shared image type names it. */
  get width(): number {
    return this.w
  }

  /** The image's height, as the shared image type names it. */
  get height(): number {
    return this.h
  }

  /** The RGB of pixel (x, y), clamped to the image. */
  rgb(x: number, y: number): [number, number, number] {
    const cx = Math.min(Math.max(x, 0), this.w - 1)
    const cy = Math.min(Math.max(y, 0), this.h - 1)
    const i = (cy * this.w + cx) * 4
    return [this.data[i], this.data[i + 1], this.data[i + 2]]
  }

  /** The part of the image inside `r`, clipped to the image. */
  crop(r: Rect): Rgba {
    const x0 = Math.min(Math.max(r.x, 0), this.w)
    const y0 = Math.min(Math.max(r.y, 0), this.h)
    const x1 = Math.min(Math.max(r.x + r.w, x0), this.w)
    const y1 = Math.min(Math.max(r.y + r.h, y0), this.h)
    const data = new Uint8Array((x1 - x0) * (y1 - y0) * 4)
    for (let y = y0; y < y1; y++) {
      const from = (y * this.w + x0) * 4
      data.set(this.data.subarray(from, from + (x1 - x0) * 4), (y - y0) * (x1 - x0) * 4)
    }
    return new Rgba(x1 - x0, y1 - y0, data)
  }

  /** Bilinear resize to `w` x `h`. */
  resize(w: number, h: number): Rgba {
    if (w === this.w && h === this.h) return new Rgba(this.w, this.h, this.data.slice())
    const f = Math.fround
    const data = new Uint8Array(w * h * 4)
    const sx = f(this.w / w)
    const sy = f(this.h / h)
    // Each output column's two source byte offsets in a row and its weight, worked out once.
    const cols: { x0: number; x1: number; t: number; u: number }[] = []
    for (let x = 0; x < w; x++) {
      const fx = f(Math.min(Math.max(f(f((x + 0.5) * sx) - 0.5), 0), this.w - 1))
      const x0 = Math.trunc(fx)
      const t = f(fx - x0)
      cols.push({ x0: x0 * 4, x1: Math.min(x0 + 1, this.w - 1) * 4, t, u: f(1 - t) })
    }
    const rowLen = this.w * 4
    for (let y = 0; y < h; y++) {
      const out = y * w * 4
      const fy = f(Math.min(Math.max(f(f((y + 0.5) * sy) - 0.5), 0), this.h - 1))
      const y0 = Math.trunc(fy)
      const y1 = Math.min(y0 + 1, this.h - 1)
      const ty = f(fy - y0)
      const uy = f(1 - ty)
      const top = this.data.subarray(y0 * rowLen, y0 * rowLen + rowLen)
      const bot = this.data.subarray(y1 * rowLen, y1 * rowLen + rowLen)
      for (let x = 0; x < w; x++) {
        const c = cols[x]
        for (let k = 0; k < 4; k++) {
          const t = f(f(top[c.x0 + k] * c.u) + f(top[c.x1 + k] * c.t))
          const b = f(f(bot[c.x0 + k] * c.u) + f(bot[c.x1 + k] * c.t))
          data[out + x * 4 + k] = Math.min(255, Math.max(0, Math.round(f(f(t * uy) + f(b * ty)))))
        }
      }
    }
    return new Rgba(w, h, data)
  }
}

/** Decodes a PNG into RGBA at its own size. */
export function decodePngRaw(bytes: Uint8Array): Rgba {
  const img = decodePng(bytes)
  return new Rgba(img.width, img.height, img.data)
}

/** The game window's picture, as the capture gives it, as the reader takes it. */
export function asRgba(img: { width: number; height: number; data: Uint8ClampedArray }): Rgba {
  const bytes = asBytes(img)
  return new Rgba(bytes.width, bytes.height, bytes.data)
}

/** Loads a PNG file in the board layout; see [`loadLayouts`]. */
export function loadPng(path: string): Rgba {
  return loadLayouts(path)[0]
}

/** Loads a PNG file at the reference size, in the board layout and, when it
 * differs, the title layout; see [`layout::layOutScaled`]. */
export function loadLayouts(path: string): [Rgba, Rgba | null] {
  let bytes: Uint8Array
  try {
    bytes = readFileSync(path)
  } catch (e) {
    throw new Error(`${path}: ${e instanceof Error ? e.message : String(e)}`)
  }
  let img: Rgba
  try {
    img = decodePngRaw(bytes)
  } catch (e) {
    throw new Error(`${path}: ${e instanceof Error ? e.message : String(e)}`)
  }
  const [board, title] = layOutScaled(img, null)
  return [board, title]
}

/** Writes an image as an 8-bit RGBA PNG file. */
export function savePng(path: string, img: Rgba): void {
  writeFileSync(path, encodePng(img))
}

/** Reads a screenshot into a board model and the warnings to check;
 * `heldTools` are the instruments the player holds, or when empty those the
 * instrument panel's icons name. */
export async function readModel(path: string, heldTools: Tool[] = []): Promise<[Model, Warning[]]> {
  const [img, title] = loadLayouts(path)
  const panels = await readPanelsTitled(img, title ?? img)
  const held = heldTools.length === 0 ? (panels.held ?? []) : heldTools.slice()
  // Only Iron Law runs past 20 days.
  const runDays = panels.days !== null && panels.days > RUN_DAYS ? ironLawDays() : RUN_DAYS
  return toModel(readScene(img), panels, held, null, runDays)
}
