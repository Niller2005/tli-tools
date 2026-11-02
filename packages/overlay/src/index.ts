// The hand-over between the tools and the overlay.
//
// The overlay is a separate process (`gtk/overlay.py`, a wlr-layer-shell surface above the game). It
// never reads the game: the tools write what they would show as a card, and the overlay draws the cards.
// A second file goes the other way: where the overlay's cards are on the screen, so that the capture can
// black them out of the pictures it takes (a layer surface is part of what `grim` takes of an output).
//
// Everything lives in `$XDG_RUNTIME_DIR/tli-overlay/`:
//   cards/<tool>.json   written by a tool, read by the overlay
//   rects.json          written by the overlay, read by the capture
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The colours a line can be written in. The overlay draws the ones it knows and shows the rest plain. */
export type CardTone =
  | 'default' | 'dim' | 'bold' | 'accent' | 'gold' | 'green' | 'yellow' | 'red'
  | 'blue' | 'purple' | 'orange' | 'teal' | 'pink'

const TONES = new Set<string>(['default', 'dim', 'bold', 'accent', 'gold', 'green', 'yellow', 'red', 'blue', 'purple', 'orange', 'teal', 'pink'])

/** The tone as the overlay knows it: the tools' own names that the overlay has no colour for show plain. */
export function toCardTone(tone: string | undefined): CardTone | undefined {
  if (tone === 'cyan') return 'accent'
  if (tone === 'paused') return 'yellow'
  return tone !== undefined && TONES.has(tone) ? (tone as CardTone) : undefined
}

export interface CardLine {
  text: string
  tone?: CardTone
}

/** What a tool shows on the overlay. */
export interface Card {
  /** the tool that wrote the card; also the card's file name */
  tool: string
  /** the small heading: "Vorax · round 6" */
  title: string
  /** the move */
  head: string
  headTone?: CardTone
  /** why the move is that one */
  basis?: string
  /** the other options, best first */
  lines?: CardLine[]
  /** places on the screen to outline, in the compositor's logical pixels: the cell or card to click */
  marks?: Rect[]
}

/** A card as it sits on disk: the card and the process that wrote it. */
export interface StoredCard extends Card {
  pid: number
}

/** A rectangle in the compositor's logical pixels. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export function overlayDir(env: Record<string, string | undefined> = process.env): string {
  return join(env.XDG_RUNTIME_DIR ?? tmpdir(), 'tli-overlay')
}

const cardPath = (tool: string, dir: string) => join(dir, 'cards', `${tool}.json`)

const alive = (pid: number): boolean => Number.isInteger(pid) && pid > 0 && existsSync(`/proc/${pid}`)

/** Writes the card the overlay shows for `card.tool`. `null` takes it down. */
export function publishCard(tool: string, card: Card | null, dir = overlayDir()): void {
  const path = cardPath(tool, dir)
  if (card === null) {
    rmSync(path, { force: true })
    return
  }
  mkdirSync(join(dir, 'cards'), { recursive: true })
  const stored: StoredCard = { ...card, tool, pid: process.pid }
  // the overlay may read at any time: write beside the file and move it into place
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(stored))
  renameSync(tmp, path)
}

/** The cards of the tools that are still running, in the order of their names. */
export function readCards(dir = overlayDir()): StoredCard[] {
  const cards: StoredCard[] = []
  let names: string[]
  try { names = readdirSync(join(dir, 'cards')).filter(n => n.endsWith('.json')).sort() } catch { return cards }
  for (const name of names) {
    const path = join(dir, 'cards', name)
    try {
      const card = JSON.parse(readFileSync(path, 'utf8')) as StoredCard
      if (alive(card.pid)) cards.push(card)
      else rmSync(path, { force: true })
    } catch { /* half-written or gone: the next read sees it whole */ }
  }
  return cards
}

/** Where the overlay's cards are right now, or none when the overlay is not running. */
export function readRects(dir = overlayDir()): Rect[] {
  try {
    const stored = JSON.parse(readFileSync(join(dir, 'rects.json'), 'utf8')) as { pid: number; rects: Rect[] }
    return alive(stored.pid) ? stored.rects : []
  } catch { return [] }
}

/** The picture `mask` works on. */
export interface Pixels {
  width: number
  height: number
  data: Uint8ClampedArray
}

/**
 * Blacks out the parts of the picture the overlay covers.
 *
 * `area` is the part of the screen the picture shows, in logical pixels; the picture may be finer (a scaled
 * output). The picture is changed in place; the number of rectangles that touched it is returned.
 */
export function maskOverlay(img: Pixels, area: Rect, rects: readonly Rect[]): number {
  const sx = img.width / area.width
  const sy = img.height / area.height
  let touched = 0
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor((r.x - area.x) * sx))
    const y0 = Math.max(0, Math.floor((r.y - area.y) * sy))
    const x1 = Math.min(img.width, Math.ceil((r.x + r.width - area.x) * sx))
    const y1 = Math.min(img.height, Math.ceil((r.y + r.height - area.y) * sy))
    if (x1 <= x0 || y1 <= y0) continue
    touched++
    for (let y = y0; y < y1; y++) {
      for (let i = (y * img.width + x0) * 4, end = (y * img.width + x1) * 4; i < end; i += 4) {
        img.data[i] = 0
        img.data[i + 1] = 0
        img.data[i + 2] = 0
        img.data[i + 3] = 255
      }
    }
  }
  return touched
}
