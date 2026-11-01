//! The log's health: whether it is there, how fresh it is, and whether the
//! game's own lines are in it. For the dashboard's status pane.

import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs'
import { DETAIL, findLog } from './index'

/** What the dashboard shows about the log. */
export interface LogHealth {
  /** the log the capture would read, or null when the game is not installed */
  path: string | null
  /** the file's size in bytes, 0 when it is missing */
  size: number
  /** when the file was last written, in ms since the epoch; null when it is missing */
  modifiedAt: number | null
  /** the game's own lines are in the log (`ok`), it has none (`no-detail`), or there is no log (`missing`) */
  detail: 'ok' | 'no-detail' | 'missing'
}

/** How much of the log's tail is read to tell `ok` from `no-detail`. */
const PROBE_BYTES = 64 * 1024

/** Whether the log's tail has the game's own lines; null when it cannot be read. */
function tailHasDetail(file: string): boolean | null {
  let fd: number
  try {
    fd = openSync(file, 'r')
  } catch {
    return null
  }
  try {
    const size = fstatSync(fd).size
    const len = Number(BigInt(size) < BigInt(PROBE_BYTES) ? size : PROBE_BYTES)
    if (len === 0) return false
    const buf = Buffer.allocUnsafe(len)
    readSync(fd, buf, 0, len, size - len)
    return buf.toString('utf8').split('\n').some(line => DETAIL.test(line))
  } finally {
    closeSync(fd)
  }
}

/**
 * The log's health, without reading more than a small tail of it: where it is
 * (the player's choice, else the newest one the game writes), how big and how
 * fresh it is, and whether the game's own lines are in it. `detail` is
 * `'missing'` when the game is not installed or the log is gone.
 */
export function logHealth(given?: string): LogHealth {
  const log = findLog(given)
  if (log === null) return { path: null, size: 0, modifiedAt: null, detail: 'missing' }
  const detail = tailHasDetail(log.file)
  if (detail === null) return { path: log.file, size: 0, modifiedAt: null, detail: 'missing' }
  try {
    const s = statSync(log.file)
    if (!s.isFile()) throw new Error('not a file')
    return { path: log.file, size: s.size, modifiedAt: s.mtimeMs, detail: detail ? 'ok' : 'no-detail' }
  } catch {
    return { path: log.file, size: 0, modifiedAt: null, detail: 'missing' }
  }
}
