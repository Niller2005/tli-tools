#!/usr/bin/env bun
// Arcana (the Tarot Path and the Fateful Contest of Torchlight: Infinite), in a terminal.
//
// It reads the game's log file and keeps what the log says about the season's minigame: the
// visits to the Tarot Path, the moves, the notes, the chests, the trials, and what the Fateful
// Contest's chests gave. It only reads the log: it never touches the game.
//
//   bun src/tui.ts                     follow the log of the running game
//   bun src/tui.ts --log=<UE_game.log> read another log
//   bun src/tui.ts --reset             forget what was saved and read the log from its start
//   bun src/tui.ts --no-backfill       do not read the log's old lines, only the new ones
//   bun src/tui.ts --no-color          draw without colours
//
// Keys: up/down move, tab changes panel, enter shows a visit, t the tax, r reads the log, ?
// the help, q quits.

import { statSync } from 'node:fs'
import { Tracker, historyOf, load, save, type Saved, STATE_VERSION } from '@tli/arcana'
import { MinigameTracker, findLog, scanBack } from '@tli/gamelog'
import { ITEM_TABLE_PATH, ItemNames, LogReader, loadTracker, userItemsPath } from '@tli/tracker'
import { startApp } from '@tli/tui'
import type { KeyEvent } from '@opentui/core'
import { ArcanaApp } from './app'
import { freshView } from './view'

const arg = (name: string): string | null =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null
const flag = (name: string): boolean => process.argv.includes(`--${name}`)

if (flag('help')) {
  process.stdout.write('bun src/tui.ts [--log=<UE_game.log>] [--reset] [--no-backfill] [--no-color]\n')
  process.exit(0)
}

/* ---------- the log ---------- */

const given = arg('log')
const found = given !== null ? { file: given, exists: true } : findLog()
if (found === null) {
  process.stderr.write("the game's log was not found: is Torchlight: Infinite installed?\n")
  process.exit(1)
}
const logFile = found.file

const names = await ItemNames.load(ITEM_TABLE_PATH, userItemsPath())
const state = freshView(logFile)

/* ---------- what was saved ---------- */

const saved = flag('reset') ? null : await load()
const usable = saved !== null && saved.log.file === logFile ? saved : null
const tracker = new Tracker(historyOf(usable))
if (usable !== null) tracker.restore(usable.snapshot)
await borrowPrices()

/** The prices the loot tracker knows and this one does not: the ones the player set, and the ones it learned. */
async function borrowPrices(): Promise<void> {
  const loot = await loadTracker()
  if (loot === null) return
  for (const [item, info] of loot.tracker.prices) {
    if (tracker.prices.info(item) === null) tracker.prices.learn(item, [info.price], info.at)
  }
  for (const [item, price] of loot.tracker.overrides) {
    if (tracker.prices.override(item) === null) tracker.prices.setOverride(item, price)
  }
}

/** Where in the log to start: where the saved state left off, unless the log is shorter than that (it began again). */
function startOffset(): number | 'end' {
  if (usable === null) return flag('no-backfill') ? 'end' : 0
  let size = 0
  try {
    size = statSync(logFile).size
  } catch {
    return usable.log.offset
  }
  if (usable.log.offset <= size) return usable.log.offset
  tracker.logRestarted()
  return 0
}

const reader = new LogReader(logFile, startOffset())

/** What the log says about the minigame being open, seeded from the log's tail so that a start in the middle of a visit is right. */
const games = new MinigameTracker()
games.seed(scanBack(logFile))

/* ---------- reading the log ---------- */

/** Reads what the log has, all of it, and keeps the screen's note about the log up to date. */
function readLog(onProgress?: (done: number, size: number) => void): void {
  let size = 0
  for (;;) {
    const before = reader.position
    const batch = reader.read()
    size = batch.size
    if (batch.restarted) tracker.logRestarted()
    if (batch.lines.length > 0) {
      games.feed(batch.lines)
      tracker.feed(batch.lines)
      onProgress?.(batch.offset, batch.size)
    }
    // done when caught up, or when nothing more could be read (a missing log, or a line longer than a chunk)
    if (batch.size === 0 || batch.offset >= batch.size) break
    if (batch.offset === before && !batch.restarted) break
  }
  state.path = games.arcana.state
  if (size === 0) state.logNote = `the log is not there: ${logFile}`
  else state.logNote = games.detail ? '' : 'the game is not writing its own lines: turn on Enable Log (Esc, Account Related, Enable Log)'
}

/** The first read, which may be the whole of a log hundreds of megabytes long: it says how far it is. */
function firstRead(): void {
  const started = Date.now()
  let shown = 0
  readLog((done, size) => {
    if (!process.stderr.isTTY || size === 0 || Date.now() - started < 500 || Date.now() - shown < 200) return
    shown = Date.now()
    process.stderr.write(`\rreading the log ${Math.floor((done / size) * 100)}%`)
  })
  if (shown > 0) process.stderr.write('\r\x1b[K')
}

/* ---------- going round ---------- */

/** Saves what the tracker knows. */
async function saveState(): Promise<void> {
  const out: Saved = {
    version: STATE_VERSION,
    log: { file: logFile, offset: reader.position },
    history: tracker.state,
    snapshot: tracker.snapshot(),
  }
  await save(out).catch(() => undefined)
}

// the first read comes before the screen does, so that progress can be shown on a plain terminal
firstRead()

/* ---------- the terminal ---------- */

const terminal = await startApp({
  onShutdown: () => saveState(),
})
const renderer = terminal.renderer

/* ---------- the app ---------- */

const app = new ArcanaApp(renderer, tracker, names, state, {
  onQuit: () => {
    void quit()
  },
  onRead: () => {
    readLog()
  },
})

/* ---------- the keys ---------- */

const onKey = (key: KeyEvent): void => {
  app.key(key)
}
renderer.keyInput.on('keypress', onKey)
renderer.on('destroy', () => {
  renderer.keyInput.off('keypress', onKey)
})

/** Leaves, and puts the terminal back. */
async function quit(): Promise<void> {
  await terminal.stop()
  process.exit(0)
}

app.draw()

setInterval(() => {
  readLog()
  app.draw()
}, 1000)

setInterval(() => {
  void saveState()
}, 30_000)

await terminal.done
