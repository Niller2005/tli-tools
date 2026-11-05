// Which tools are running, as every program on the machine can tell.
//
// The launcher remembers what it opened, but only in its own memory: a second program that wants to
// open the same tool does not know. So the tools say it themselves, in `$XDG_RUNTIME_DIR/tli-tools/`
// (the runtime directory is cleared at logout, so a pid never outlives the session):
//
//   running/<tool>.pid   written by a tool when it starts, taken away when it ends
//   claims/<tool>        written by a program that is about to open a tool, so that two programs that
//                        see the same board open do not both open it
//
// Both are advisory. A directory that cannot be written is never a reason to stop a tool, and
// without it the launcher's own memory still keeps one program from opening a tool twice.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** How long a claim holds the others off, in milliseconds: the time a window needs to come up. */
export const CLAIM_MS = 15_000

/** Where the tools say they run. */
export function runtimeDir(env: Record<string, string | undefined> = process.env): string {
  return join(env.XDG_RUNTIME_DIR ?? tmpdir(), 'tli-tools')
}

const pidFile = (id: string, dir: string): string => join(dir, 'running', `${id}.pid`)
const claimFile = (id: string, dir: string): string => join(dir, 'claims', id)

/** The pid a file holds, or null when it is not there or holds something else. */
function readPid(file: string): number | null {
  try {
    const pid = Number(readFileSync(file, 'utf8').trim())
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

/**
 * Says that this process is the tool `id`, until it ends. Returns what takes the entry away again;
 * it also goes by itself when the process exits. A second process of the same tool takes the entry
 * over, and the first one leaves it alone when it ends.
 */
export function registerRunning(id: string, dir: string = runtimeDir(), pid: number = process.pid): () => void {
  const file = pidFile(id, dir)
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${pid}\n`)
  } catch {
    return () => {}
  }
  const release = (): void => {
    process.off('exit', release)
    if (readPid(file) === pid) rmSync(file, { force: true })
  }
  process.on('exit', release)
  return release
}

/** Whether a process that said it is the tool `id` is still there. */
export function isRunning(id: string, dir: string = runtimeDir()): boolean {
  const pid = readPid(pidFile(id, dir))
  return pid !== null && existsSync(`/proc/${pid}`)
}

/**
 * Says that this program is about to open the tool `id`. False when another one said so less than
 * `CLAIM_MS` ago: that one is opening it, and this one must not.
 */
export function claimOpen(id: string, dir: string = runtimeDir(), now: number = Date.now()): boolean {
  const file = claimFile(id, dir)
  try {
    mkdirSync(dirname(file), { recursive: true })
  } catch {
    return true
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      // `wx` fails when the file is there, so of two programs that ask together, one wins
      writeFileSync(file, String(now), { flag: 'wx' })
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return true
    }
    let since = Number.NaN
    try {
      since = Number(readFileSync(file, 'utf8'))
    } catch {
      continue
    }
    if (now - since < CLAIM_MS) return false
    rmSync(file, { force: true })
  }
  return false
}

/** Takes a claim back, when the tool could not be opened after all. */
export function releaseClaim(id: string, dir: string = runtimeDir()): void {
  rmSync(claimFile(id, dir), { force: true })
}
