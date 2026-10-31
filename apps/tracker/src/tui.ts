#!/usr/bin/env bun
// The Torchlight: Infinite loot tracker, in a terminal.
//
// It reads the game's log file and shows what the player picked up on each trip into a map, what
// it is worth, and what the player has. It only reads the log: it never touches the game.
//
//   bun src/tui.ts                     follow the log of the running game
//   bun src/tui.ts --log=<UE_game.log> read another log
//   bun src/tui.ts --reset             forget what was saved and read the log from its start
//   bun src/tui.ts --no-backfill       do not read the log's old lines, only the new ones
//   bun src/tui.ts --no-color          draw without colours
//
// Keys: up/down move, tab changes panel, enter detail, esc back, t tax, c map cost, e price,
// x csv report, p pause, ? help, q quits.

import { findLog } from '@tli/gamelog'
import { ITEM_TABLE_PATH, ItemNames, LogReader, Tracker, loadTracker, saveTracker, userItemsPath } from '@tli/tracker'
import { startApp } from '@tli/tui'
import type { KeyEvent } from '@opentui/core'
import { TrackerApp } from './app'
import { writeReport } from './report'

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
const tracker = new Tracker({ names })

/* ---------- what was saved ---------- */

const saved = flag('reset') ? null : await loadTracker()
const usable = saved !== null && saved.log.file === logFile ? saved : null
if (usable !== null) tracker.restore(usable.tracker)

const reader = new LogReader(logFile, usable?.log.offset ?? (flag('no-backfill') ? 'end' : 0))

/* ---------- reading the log ---------- */

let detailSeen = false

/** Reads what the log has, and keeps the screen's note about the log up to date. */
function readLog(): void {
  const batch = reader.read()
  if (batch.size === 0) {
    app.state.logNote = `the log is not there: ${logFile}`
    return
  }
  if (!detailSeen) {
    for (const line of batch.lines) {
      if (/\b(TLLua|TLGame):/.test(line)) {
        detailSeen = true
        break
      }
    }
  }
  tracker.feed(batch.lines)
  app.state.logNote = detailSeen ? '' : 'the game is not writing its own lines: turn on Enable Log (Esc, Account Related, Enable Log)'
}

/* ---------- the terminal ---------- */

const terminal = await startApp({
  onShutdown: () => save(),
})
const renderer = terminal.renderer

/* ---------- the app ---------- */

const app = new TrackerApp(renderer, tracker, names, logFile, {
  onQuit: () => {
    void quit()
  },
  onReport: () => {
    void writeReport(tracker, names).then(
      (path) => {
        app.state.message = `the report is in ${path}`
        app.draw()
      },
      () => {
        app.state.message = 'the report could not be written'
        app.draw()
      },
    )
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

/* ---------- going round ---------- */

/** Saves what the tracker knows. */
async function save(): Promise<void> {
  await saveTracker({
    version: 1,
    log: { file: logFile, offset: reader.position },
    tracker: tracker.snapshot(),
  }).catch(() => undefined)
}

/** Leaves, and puts the terminal back. */
async function quit(): Promise<void> {
  await terminal.stop()
  process.exit(0)
}

// the first read: the whole log, so the tracker knows about the runs that were already farmed
readLog()
app.draw()

setInterval(() => {
  readLog()
  app.draw()
}, 1000)

setInterval(() => {
  void save()
}, 30_000)

await terminal.done
