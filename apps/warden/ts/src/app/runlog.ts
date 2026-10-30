//! The run log: per run, a folder of JSON lines (log.jsonl) with what the
//! session read, advised and was told, and the frames read (frame-NNNN.png),
//! so a run can be reviewed later. The writes run in the background, so a
//! frame's encode never stalls the window.
//!
//! A port of src/app/runlog.rs. The frames are kept as PNG: the app has no
//! JPEG encoder, and the reader never reads these files.

import { cloneModel, sameModel, type Model } from '@/board/board'
import type { Rgba } from '@/reader/mod'
import type { Screen } from '@/reader/panels'
import { encodePng } from '@tli/png'
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Run folders kept; older ones go when a folder starts. */
const KEEP = 10

/** Reads that install nothing on one screen in a row save a frame this often
 * (in ms), so a board the reader misses still shows in the log. */
const MISS_FRAME_EVERY = 60_000

/** The log of the run on show. A folder is made with its first line, so an
 * app opened and closed without a read leaves none. */
export class RunLog {
  private readonly root: string
  /** The run's folder. */
  private dirPath: string
  /** Frames saved in `dirPath`. */
  private frames = 0
  /** The screen and board of the last frame saved, and when; no board for
   * a read that installed none. */
  private last: { screen: Screen; model: Model | null; at: number } | null = null
  /** The fields of the last "window" line, which every later run's folder
   * starts with: the window is reported only when it changes. */
  private windowFields: Record<string, unknown> | null = null
  /** The writes sent so far, one after the other. */
  private queue: Promise<void> = Promise.resolve()
  /** The folder the last write made. */
  private made: string | null = null

  constructor(root: string) {
    this.root = root
    this.dirPath = join(root, folderName(new Date()))
  }

  /** The folder of the run on show. */
  dir(): string {
    return this.dirPath
  }

  /** Writes the "window" line, and again at the top of each later run's
   * folder. */
  window(fields: Record<string, unknown>): void {
    this.event('window', new Date(), fields)
    this.windowFields = { ...fields }
  }

  /** Starts a new run's folder, named from now; a second one in the same
   * second gets a suffix. It starts with the last window line. */
  newRun(): void {
    const name = folderName(new Date())
    let dir = join(this.root, name)
    let n = 2
    while (dir === this.dirPath || existsSync(dir)) {
      dir = join(this.root, `${name}-${n}`)
      n += 1
    }
    this.dirPath = dir
    this.frames = 0
    this.last = null
    if (this.windowFields !== null) this.event('window', new Date(), this.windowFields)
  }

  /** Writes one line: `at`, `kind`, then `fields` (a JSON object). */
  event(kind: string, at: Date, fields: Record<string, unknown>): void {
    const line: Record<string, unknown> = { at: timestamp(at), kind, ...fields }
    this.write(join(this.dirPath, 'log.jsonl'), `${JSON.stringify(line)}\n`)
  }

  /** Saves `frame` when its screen or board differs from the last frame
   * saved, and gives the file's name. A frame without a board (a read that
   * installed none) differs by its screen, or by [`MISS_FRAME_EVERY`]
   * since the last frame saved. */
  frame(screen: Screen, model: Model | null, frame: Rgba): string | null {
    const now = Date.now()
    if (this.last !== null) {
      const last = this.last.model
      const same =
        this.last.screen === screen &&
        (last === null ? model === null : model !== null && sameModel(last, model))
      if (same && (model !== null || now - this.last.at < MISS_FRAME_EVERY)) return null
    }
    this.last = { screen, model: model === null ? null : cloneModel(model), at: now }
    this.frames += 1
    const name = frameName(this.frames)
    this.write(join(this.dirPath, name), encodePng(frame))
    return name
  }

  /** Blocks until everything sent so far is written. */
  async wait(): Promise<void> {
    await this.queue
  }

  /** Queues a write; the errors are dropped: the log must not get in the
   * player's way. */
  private write(path: string, bytes: string | Uint8Array): void {
    this.queue = this.queue.then(() => this.writeNow(path, bytes)).catch(() => undefined)
  }

  /** Writes one file, making the run's folder when it is new. */
  private writeNow(path: string, bytes: string | Uint8Array): void {
    const dir = dirname(path)
    if (this.made !== dir) {
      mkdirSync(dir, { recursive: true })
      prune(this.root, KEEP)
      this.made = dir
    }
    if (typeof bytes === 'string') appendFileSync(path, bytes)
    else writeFileSync(path, bytes)
  }
}

/** "frame-0007.png". */
function frameName(n: number): string {
  return `frame-${String(n).padStart(4, '0')}.png`
}

/** The UTC date and time of `t`: (year, month, day, hour, minute, second,
 * millisecond). */
function civil(t: Date): [number, number, number, number, number, number, number] {
  return [
    t.getUTCFullYear(),
    t.getUTCMonth() + 1,
    t.getUTCDate(),
    t.getUTCHours(),
    t.getUTCMinutes(),
    t.getUTCSeconds(),
    t.getUTCMilliseconds(),
  ]
}

/** A run folder's name, UTC, so names sort by time: "2026-10-18_01-23-45". */
export function folderName(t: Date): string {
  const [y, mo, d, h, mi, s] = civil(t)
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}_${String(h).padStart(2, '0')}-${String(mi).padStart(2, '0')}-${String(s).padStart(2, '0')}`
}

/** A line's time, UTC: "2026-10-18T01:23:45.678Z". */
export function timestamp(t: Date): string {
  const [y, mo, d, h, mi, s, ms] = civil(t)
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}Z`
}

/** True for a name [`folderName`] gives, with or without a suffix. */
export function isRunFolder(name: string): boolean {
  if (name.length < 19) return false
  for (let k = 0; k < 19; k++) {
    const c = name[k]
    if (k === 4 || k === 7 || k === 13 || k === 16) {
      if (c !== '-') return false
    } else if (k === 10) {
      if (c !== '_') return false
    } else if (c < '0' || c > '9') {
      return false
    }
  }
  return true
}

/** Deletes the run folders under `root` but the newest `keep`. */
export function prune(root: string, keep: number): void {
  let runs: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!isRunFolder(entry.name)) continue
    runs.push(join(root, entry.name))
  }
  runs.sort()
  const old = Math.max(runs.length - keep, 0)
  for (const dir of runs.slice(0, old)) rmSync(dir, { recursive: true, force: true })
}
