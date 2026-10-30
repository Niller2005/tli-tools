// Saving the tracker.
//
// Everything the tracker knows is written to one file, so the tracker can be stopped and started
// again and still know about the runs that were already farmed, the prices that were learned and
// where it was in the log. The file is written now and then, and when the tracker is left.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dataPath } from './items'
import type { SavedState } from './engine'

/** The file the tracker saves itself in. */
export const STATE_FILE = 'state.json'

/** Where the tracker saves itself. */
export function statePath(): string {
  return dataPath(STATE_FILE)
}

/** What is saved: the tracker's state, and where it was in the log. */
export interface SavedTracker {
  version: number
  /** the log that was being read */
  log: { file: string; offset: number }
  /** what the tracker knows */
  tracker: SavedState
}

/** Reads what was saved; null when there is nothing saved, or it cannot be read. */
export async function loadTracker(path = statePath()): Promise<SavedTracker | null> {
  try {
    const raw = await readFile(path, 'utf8')
    const saved = JSON.parse(raw) as SavedTracker
    if (saved?.version !== 1) return null
    if (saved.tracker?.version !== 1) return null
    return saved
  } catch {
    return null
  }
}

/**
 * Writes what is saved.
 *
 * The file is written next to itself and then moved over the old one, so a crash halfway through
 * does not leave a half-written file behind.
 */
export async function saveTracker(saved: SavedTracker, path = statePath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, `${JSON.stringify(saved)}\n`)
  await rename(tmp, path)
}
