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
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
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
  /** a bottom corner of the screen to draw the card in, on a mostly transparent background; without it the card goes in the main stack */
  corner?: 'bottom-left' | 'bottom-right'
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

/**
 * Writes the card the overlay shows for `card.tool`. `null` takes it down. A card also makes the tool one
 * the overlay is kept for: while a process that has published one is alive, an overlay that was started
 * by `ensureOverlay` does not close.
 */
export function publishCard(tool: string, card: Card | null, dir = overlayDir()): void {
  const path = cardPath(tool, dir)
  if (card === null) {
    rmSync(path, { force: true })
    return
  }
  claim(tool, dir)
  mkdirSync(join(dir, 'cards'), { recursive: true })
  const stored: StoredCard = { ...card, tool, pid: process.pid }
  // the overlay may read at any time: write beside the file and move it into place
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(stored))
  renameSync(tmp, path)
}

const claimed = new Set<string>()

/** Says that this process wants the overlay up: `users/<tool>` holds its pid, and goes stale when it ends. */
function claim(tool: string, dir: string): void {
  const key = `${dir}\0${tool}`
  if (claimed.has(key)) return
  mkdirSync(join(dir, 'users'), { recursive: true })
  writeFileSync(join(dir, 'users', tool), String(process.pid))
  claimed.add(key)
}

/** The tool is done with the overlay: its card goes, and the overlay may close when no one else is left. */
export function releaseOverlay(tool: string, dir = overlayDir()): void {
  rmSync(cardPath(tool, dir), { force: true })
  rmSync(join(dir, 'users', tool), { force: true })
  claimed.delete(`${dir}\0${tool}`)
}

/** Whether an overlay process is up. */
export function overlayRunning(dir = overlayDir()): boolean {
  try {
    const pid = Number(readFileSync(join(dir, 'overlay.pid'), 'utf8'))
    return alive(pid) && readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('overlay.py')
  } catch { return false }
}

const LIBS = ['/usr/lib/libgtk4-layer-shell.so', '/usr/lib64/libgtk4-layer-shell.so', '/usr/lib/x86_64-linux-gnu/libgtk4-layer-shell.so']

/** The layer-shell library the overlay has to load before libwayland, or undefined when it is not installed. */
export const layerShellLib = (): string | undefined => LIBS.find(existsSync)

export type EnsureResult = { ok: true; started: boolean } | { ok: false; reason: string }

/**
 * Makes sure an overlay is up for this tool: it says the tool wants it, and starts one in the background
 * when none runs. One that this starts closes by itself a few seconds after the last tool that wanted it
 * has ended or called `releaseOverlay`; one the player started with `bun run overlay` is never closed.
 */
export function ensureOverlay(tool: string, dir = overlayDir()): EnsureResult {
  if (!process.env.WAYLAND_DISPLAY && process.env.XDG_SESSION_TYPE !== 'wayland') {
    return { ok: false, reason: 'the overlay needs a Wayland session' }
  }
  if (Bun.which('python3') === null) return { ok: false, reason: 'the overlay needs python3' }
  if (layerShellLib() === undefined) return { ok: false, reason: 'the overlay needs gtk4-layer-shell and python-gobject' }
  claim(tool, dir)
  if (overlayRunning(dir)) return { ok: true, started: false }
  const log = openSync(join(dir, 'overlay.log'), 'a')
  try {
    Bun.spawn([process.execPath, join(import.meta.dir, '..', 'scripts', 'start.ts'), '--auto-exit'], {
      stdio: ['ignore', log, log],
      detached: true,
    }).unref()
  } finally {
    closeSync(log)
  }
  return { ok: true, started: true }
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
