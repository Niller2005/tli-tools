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
//   bun src/tui.ts --no-baseline       do not use the community prices
//
// Keys: up/down move, tab changes panel, enter detail, esc back, t tax, c map cost, e price,
// b community prices, x csv report, p pause, a/v/w open Arcana, Vorax or Warden in a window of
// their own, / searches the list that has the focus, ? help, q quits.

import { findLog } from '@tli/gamelog'
import { Launcher, openTool } from '@tli/launch'
import {
  ITEM_TABLE_PATH,
  ItemNames,
  LogReader,
  Tracker,
  baselineIsStale,
  fetchBaseline,
  loadTracker,
  readBaseline,
  saveTracker,
  userItemsPath,
  writeBaseline,
} from '@tli/tracker'
import { startApp } from '@tli/tui'
import { TrackerApp } from './app'
import { writeReport } from './report'

const arg = (name: string): string | null =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null
const flag = (name: string): boolean => process.argv.includes(`--${name}`)

if (flag('help')) {
  process.stdout.write(
    'bun src/tui.ts [--log=<UE_game.log>] [--reset] [--no-backfill] [--no-color] [--no-baseline]\n',
  )
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

/* ---------- the community prices ---------- */

// The prices of the community (TITrack). They are the floor under everything the tracker knows:
// a price set by hand and a price learned from the exchange both win over them. The prices that
// were fetched last are on disk, so the tracker starts with them even without a network.
const baselineOn = !flag('no-baseline')
const cached = baselineOn ? await readBaseline() : null
if (cached !== null) tracker.prices.setBaseline(cached.prices)

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
  onKey: (key) => {
    app.key(key)
  },
  onTick: () => {
    readLog()
    app.draw()
  },
  onSave: () => save(),
})

/* ---------- the app ---------- */

const launcher = new Launcher()

const app = new TrackerApp(terminal.renderer, tracker, names, logFile, {
  onQuit: () => {
    void terminal.quit()
  },
  onOpenWindow: (tool) => {
    // the tool goes into a window of its own, so the tracker keeps following the log
    return openTool(launcher, tool, { parentArgv: process.argv }).message
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
  onBaseline: () => {
    if (!baselineOn) return 'the community prices are turned off'
    void refreshBaseline()
    return 'the community prices are being fetched'
  },
})

if (cached !== null) {
  app.state.baselineAt = cached.fetchedAt
  app.state.baselineCount = cached.prices.length
}


/* ---------- going round ---------- */

/** Fetches the community prices and puts them under everything else. */
async function refreshBaseline(): Promise<void> {
  try {
    const data = await fetchBaseline()
    tracker.prices.setBaseline(data.prices)
    app.state.baselineAt = data.fetchedAt
    app.state.baselineCount = data.prices.length
    await writeBaseline(data)
    app.state.message = `the community prices are here: ${data.prices.length} items`
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    app.state.message = `the community prices could not be fetched: ${why}`
  }
  app.draw()
}

/** Saves what the tracker knows. */
async function save(): Promise<void> {
  await saveTracker({
    version: 1,
    log: { file: logFile, offset: reader.position },
    tracker: tracker.snapshot(),
  }).catch(() => undefined)
}


// the first read: the whole log, so the tracker knows about the runs that were already farmed
readLog()
app.draw()

// the community prices: the ones on disk are used until they are old, then they are fetched again
if (baselineOn && baselineIsStale(cached)) void refreshBaseline()


await terminal.done
