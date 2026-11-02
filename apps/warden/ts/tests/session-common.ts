//! Helpers of the session tests: the saved frames read into a session, with
//! the `~` and `_` variants that spoil the instrument panel's first slot,
//! and the synthetic scene and panels a read is made of without a frame.

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { Session, type Reading } from '@/app/session'
import type { Tool } from '@/engine/data'
import { loadPng, Rgba } from '@/reader/mod'
import { Scene, type CellRead } from '@/reader/scene'
import type { Panels, Screen } from '@/reader/panels'
import { frames } from './common'

/** Rounds of the full solves the session tests wait for. */
export const ROLLOUTS = 400

/** The path of the saved frame `name`, without the `~` and `_` marks. */
export function framePath(name: string): string {
  return join(frames(), name.replace(/^[~_]/, ''))
}

/** True when the saved frames hold every one of `names`; says which is
 * missing otherwise. */
export function have(names: string[]): boolean {
  const missing = names.find((f) => !existsSync(framePath(f)))
  if (missing !== undefined) console.log(`skipped: ${missing} is missing`)
  return missing === undefined
}

/** Saved frame `name`; a leading `~` covers its first instrument slot with
 * noise, so the panel's read is unsure, and a leading `_` with one colour,
 * so the panel reads empty. */
export function frame(name: string): Rgba {
  const img = loadPng(framePath(name))
  const mark = name[0]
  if (mark !== '~' && mark !== '_') return img
  const noise = mark === '~'
  // The slot's 89 px icon around (122, 391); frames load at 1918x1078.
  let seed = 1
  for (let y = 346; y < 436; y++) {
    for (let x = 77; x < 167; x++) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      const i = (y * img.w + x) * 4
      img.data.fill(noise ? seed >>> 24 : 20, i, i + 3)
    }
  }
  return img
}

/** Reads `names` (see [`frame`]) in order and gives the session; null
 * (skipped) when one is missing. */
export async function readAll(tools: Tool[], names: string[]): Promise<Session | null> {
  if (!have(names)) return null
  const s = new Session(20, tools, null, null)
  for (const f of names) {
    s.readInBackground(frame(f))
    await s.wait()
  }
  return s
}

/** Reads the saved frame `name` in `s` and gives the reading on show. */
export async function readNext(s: Session, name: string): Promise<Reading> {
  s.readInBackground(loadPng(framePath(name)))
  await s.wait()
  return s.reading as Reading
}

/** Polls `s` until `done` holds, for at most 60 s. */
export async function pollUntil(s: Session, done: (s: Session) => boolean): Promise<void> {
  const until = Date.now() + 60_000
  while (!done(s)) {
    if (Date.now() >= until) throw new Error('no read finished in 60 s')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** A sure read of a plain cell: locked, no marker, nothing doubtful. */
export function sureCell(over: Partial<CellRead> = {}): CellRead {
  return {
    locked: true,
    lockedConf: 1,
    glow: null,
    glowConf: 1,
    inmate: null,
    beastConf: 1,
    tierConf: 1,
    halo: 1,
    event: false,
    eventConf: 1,
    jaws: false,
    jawsConf: 1,
    target: false,
    tusk: false,
    prey: false,
    covered: false,
    ...over,
  }
}

/** A scene that reads every cell (screen cells 2-16) as locked and sure,
 * with the warden's arrow on screen cell `warden`, unless `cells` overrides
 * some reads: the run rules' input, which needs no frame. */
export function syntheticScene(warden: number, cells: Record<number, Partial<CellRead>> = {}): Scene {
  const reads = Array.from({ length: 15 }, (_, k) => sureCell(cells[k + 2]))
  return new Scene(reads, warden, 1)
}

/** The panels of a board screen: every decision button on offer, the days
 * counter at `days`, nothing else read, unless `over` overrides it. */
export function syntheticPanels(screen: Screen, days: number | null, over: Partial<Panels> = {}): Panels {
  return {
    screen,
    days,
    doors: [],
    decision: ['Consume', 'Replace', 'Hunt', 'End'],
    instruments: [],
    rerolls: 0,
    vault: [],
    toolIcons: false,
    theme: null,
    objective: null,
    held: null,
    spots: [],
    ...over,
  }
}

/** A black 1920 x 1080 frame: no board, no pick, no days counter. */
export function black(): Rgba {
  const data = new Uint8Array(1920 * 1080 * 4)
  for (let i = 3; i < data.length; i += 4) data[i] = 255
  return new Rgba(1920, 1080, data)
}
