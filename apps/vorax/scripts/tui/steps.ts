// Where the advised move is on the game's picture: the card to play, the tanks to play it on, Confirm or Refresh.
// The same places the Windows helper boxes (web/js/analyze.js `stepsFor`), from the same layout the reader used.

import { handLayout } from '@/reader/scan/layout'
import type { Reading } from '@/reader/types'
import type { Crop } from '@/web/chrome'

const REF_H = 1440

/** Button places in reference pixels (1440 high) from the frame's centre, measured on a live 16:9 frame. */
const BTN = { confirm: { x: 126, y: 1363, w: 230, h: 52 }, refresh: { x: 329, y: 1363, w: 140, h: 52 } }

/** What the reader knew about the picture a board came from: how to find the board's places on it again. */
export interface Place {
  /** the whole picture, before the title bar and border were cut off */
  width: number
  height: number
  crop: Crop
  ui?: number
  shift?: Reading['handShift']
  tankFix?: Reading['tankFix']
  /** how many cards the hand holds */
  hand: 1 | 3 | 5
}

/** The move, as the places it touches: a card and the tanks to use it on, or the Refresh button. */
export type Choice = { refresh: true } | { refresh?: false; index: number; targets: number[] }

/** A box on the picture, in picture pixels. */
export interface Box { x: number; y: number; width: number; height: number }

/** The boxes of a move in the order they are clicked: the card, its tanks, then Confirm; or Refresh alone. */
export function stepBoxes(place: Place, choice: Choice): Box[] {
  const c = place.crop
  const ox = c.left ?? 0, oy = c.top ?? 0
  const w = place.width - ox - (c.right ?? 0), h = place.height - oy - (c.bottom ?? 0)
  const ui = place.ui ?? 1
  const hs = place.shift?.[2] ?? 1
  const L = handLayout({ width: w, height: h }, ui, place.shift)
  const k = L.hk ?? L.k
  const s1 = h / REF_H
  const cx = w / 2
  // the buttons grow from the bottom edge with the game's interface scale
  const bottom = (y: number) => (REF_H - (REF_H - y) * ui * hs) * s1
  const box = (x: number, y: number, bw: number, bh: number): Box => ({ x: ox + x - bw / 2, y: oy + y - bh / 2, width: bw, height: bh })
  const button = (b: { x: number; y: number; w: number; h: number }) => box(cx + b.x * k, bottom(b.y), b.w * k, b.h * k)

  if (choice.refresh) return [button(BTN.refresh)]
  const pos = (place.hand === 5 ? L.hand5 : place.hand === 1 ? [L.cards[1]] : L.cards)[choice.index]
  if (!pos) return []
  const out = [box(pos.cx, pos.cy, 210 * k, 300 * k)]
  // a tank takes a click on its monster, which floats above the label: a box over the glass above its name
  const fix = place.tankFix
  for (const t of choice.targets) {
    const band = L.nameBand[t]
    if (!band) continue
    out.push(box(fix ? fix.cx[t] : L.tankCx[t], band.y + (fix ? fix.dy : 0) - 170 * s1, 190 * s1, 250 * s1))
  }
  out.push(button(BTN.confirm))
  return out
}
