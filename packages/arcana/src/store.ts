// Saving what the tracker knows.
//
// Everything the tracker knows is written to one file, so the tracker can be stopped and
// started again and still know about the sessions that were already played. The file is
// written now and then, and when the tracker is left.
//
// The file also holds where the tracker was in the log, so that a restart carries on
// where it left off instead of reading the whole log again.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { emptyHistory, type History, type Snapshot } from './session'

/** The file the tracker saves itself in. */
export const STATE_FILE = 'state.json'

/** The version of the saved file this code writes. */
export const STATE_VERSION = 2

/** The directory the tracker keeps its files in. */
export function dataDir(): string {
  const xdg = process.env.XDG_DATA_HOME
  if (xdg !== undefined && xdg !== '') return join(xdg, 'tli-arcana')
  return join(process.env.HOME ?? '.', '.local', 'share', 'tli-arcana')
}

/** Where the tracker saves itself. */
export function statePath(): string {
  return join(dataDir(), STATE_FILE)
}

/** What is saved: the tracker's history, its bag and prices, and where it was in the log. */
export interface Saved {
  version: number
  /** the log that was being read, and how far */
  log: { file: string; offset: number }
  /** what the tracker knows */
  history: History
  /** the bag and the prices */
  snapshot: Snapshot
}

/** Reads what was saved; null when there is nothing saved, or it cannot be read. */
export async function load(path = statePath()): Promise<Saved | null> {
  try {
    const raw = await readFile(path, 'utf8')
    const saved = JSON.parse(raw) as Saved
    if (saved?.version !== STATE_VERSION) return null
    if (saved.history === undefined || saved.snapshot === undefined || saved.log === undefined) return null
    return saved
  } catch {
    return null
  }
}

/**
 * Writes what is saved.
 *
 * The file is written next to itself and then moved over the old one, so a crash halfway
 * through does not leave a half-written file behind.
 */
export async function save(saved: Saved, path = statePath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, `${JSON.stringify(saved)}\n`)
  await rename(tmp, path)
}

/** A history with nothing in it, for when nothing usable was saved. */
export function historyOf(saved: Saved | null): History {
  return saved === null ? emptyHistory() : saved.history
}
