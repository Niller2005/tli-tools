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
//
// Keys: up/down move, tab changes panel, enter shows a run, t the tax, c the map's cost, e a
// price, x the csv report, p stops the clock, ? the help, q quits.

import { findLog } from '@tli/gamelog'
import { ITEM_TABLE_PATH, ItemNames, LogReader, Tracker, loadTracker, saveTracker, userItemsPath } from '@tli/tracker'
import { helpLines, render } from './render'
import { writeReport } from './report'
import { PANELS, bagRows, freshView, priceRows } from './view'

const arg = (name: string): string | null =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null
const flag = (name: string): boolean => process.argv.includes(`--${name}`)

if (flag('help')) {
  process.stdout.write('bun src/tui.ts [--log=<UE_game.log>] [--reset] [--no-backfill]\n')
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
const state = freshView(logFile, Date.now())

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
    state.logNote = `the log is not there: ${logFile}`
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
  state.logNote = detailSeen ? '' : 'the game is not writing its own lines: turn on Enable Log (Esc, Account Related, Enable Log)'
}

/* ---------- the terminal ---------- */

/** The terminal in cbreak mode on the alternate screen, put back on leave. */
class Terminal {
  private constructor(private readonly saved: string) {}

  /** The terminal as it was, and the screen as it was. */
  static enter(): Terminal | null {
    const saved = stty(['-g'])
    if (saved === null) return null
    if (stty(['-icanon', '-echo', '-isig']) === null) return null
    process.stdout.write('\x1b[?1049h\x1b[?25l')
    return new Terminal(saved.trim())
  }

  /** The terminal as it was, and the screen as it was. */
  leave(): void {
    process.stdout.write('\x1b[?25h\x1b[?1049l')
    stty([this.saved])
  }
}

/** `stty` with the given arguments; its output, or null when it failed. */
function stty(args: string[]): string | null {
  const p = Bun.spawnSync(['stty', ...args], { stdin: 'inherit', stdout: 'pipe', stderr: 'ignore' })
  if (p.exitCode !== 0) return null
  return p.stdout.toString()
}

/* ---------- the screen ---------- */

let pausedAt: number | null = null
let showHelp = false

/** The time the screen shows: the clock stops when the player stops it. */
function now(): number {
  const real = Date.now()
  if (pausedAt !== null) return pausedAt
  return real
}

/** Draws the screen. */
function draw(): void {
  state.now = now()
  const width = process.stdout.columns || 100
  const height = process.stdout.rows || 30
  const lines = showHelp ? helpLines(width) : render(tracker, state, width, height)
  process.stdout.write(`\x1b[H${lines.map((l) => `${l}\x1b[K`).join('\n')}\n\x1b[J`)
}

/* ---------- the keys ---------- */

/** What a key press means. */
type Key = 'up' | 'down' | 'left' | 'right' | 'pageup' | 'pagedown' | 'tab' | 'backtab' | 'enter' | 'esc' | 'char'

/** Reads the keys out of what the terminal gave. */
function decode(chunk: Buffer): { key: Key; char: string }[] {
  const keys: { key: Key; char: string }[] = []
  let i = 0
  while (i < chunk.length) {
    const b = chunk[i] as number
    if (b === 0x1b) {
      const next = chunk[i + 1]
      if (next === 0x5b) {
        const code = chunk[i + 2]
        const key =
          code === 0x41 ? 'up' : code === 0x42 ? 'down' : code === 0x43 ? 'right' : code === 0x44 ? 'left' : code === 0x5a ? 'backtab' : code === 0x35 ? 'pageup' : code === 0x36 ? 'pagedown' : 'esc'
        keys.push({ key, char: '' })
        i += 3
        continue
      }
      keys.push({ key: 'esc', char: '' })
      i += 1
      continue
    }
    if (b === 0x0d || b === 0x0a) {
      keys.push({ key: 'enter', char: '' })
      i += 1
      continue
    }
    if (b === 0x09) {
      keys.push({ key: 'tab', char: '' })
      i += 1
      continue
    }
    const text = chunk.subarray(i, i + 1).toString('utf8')
    keys.push({ key: 'char', char: text })
    i += 1
  }
  return keys
}

/** How many rows the focused panel has. */
function panelSize(): number {
  if (state.focus === 'runs') return tracker.runs.length
  if (state.focus === 'inventory') return bagRows(tracker, state.inventorySort).length
  return priceRows(tracker, state.pricesSort).length
}

/** The item the keys are pointing at. */
function selectedItem(): number | null {
  if (state.focus === 'inventory') {
    const rows = bagRows(tracker, state.inventorySort)
    const row = rows[Math.min(state.inventoryAt, rows.length - 1)]
    return row?.item ?? null
  }
  const rows = priceRows(tracker, state.pricesSort)
  const row = rows[Math.min(state.pricesAt, rows.length - 1)]
  return row?.item ?? null
}

/** Moves the pointer in the focused panel. */
function move(by: number): void {
  const size = panelSize()
  if (size === 0) return
  if (state.focus === 'runs') {
    state.runsAt = Math.max(0, Math.min(state.runsAt + by, size - 1))
    const run = [...tracker.runs].reverse()[state.runsAt]
    if (run !== undefined) state.detail = null
  } else if (state.focus === 'inventory') {
    state.inventoryAt = Math.max(0, Math.min(state.inventoryAt + by, size - 1))
  } else {
    state.pricesAt = Math.max(0, Math.min(state.pricesAt + by, size - 1))
  }
}

/** The run the keys are pointing at. */
function selectedRun(): number | null {
  const run = [...tracker.runs].reverse()[state.runsAt]
  return run?.id ?? null
}

/** Does a key. */
function press(key: Key, char: string): boolean {
  if (state.editing !== null) {
    if (key === 'esc') {
      state.editing = null
      return true
    }
    if (key === 'enter') {
      const price = Number(state.editing.text)
      if (Number.isFinite(price) && price >= 0) {
        tracker.prices.setOverride(state.editing.item, price)
        state.message = `the price of ${tracker.names.name(state.editing.item)} is ${price} FE`
      }
      state.editing = null
      return true
    }
    if (key === 'char' && /[0-9.]/.test(char)) {
      state.editing.text += char
      return true
    }
    if (key === 'char' && char === '\x7f') {
      state.editing.text = state.editing.text.slice(0, -1)
      return true
    }
    return true
  }

  if (showHelp) {
    if (key === 'char' && (char === 'q' || char === '?' || char === '\x1b')) showHelp = false
    return true
  }

  switch (key) {
    case 'up':
      move(-1)
      return true
    case 'down':
      move(1)
      return true
    case 'pageup':
      move(-10)
      return true
    case 'pagedown':
      move(10)
      return true
    case 'tab': {
      const at = PANELS.indexOf(state.focus)
      state.focus = PANELS[(at + 1) % PANELS.length] ?? 'runs'
      return true
    }
    case 'backtab': {
      const at = PANELS.indexOf(state.focus)
      state.focus = PANELS[(at - 1 + PANELS.length) % PANELS.length] ?? 'runs'
      return true
    }
    case 'enter': {
      if (state.detail !== null) {
        state.detail = null
        return true
      }
      const run = selectedRun()
      if (run !== null) state.detail = run
      return true
    }
    case 'esc':
      state.detail = null
      return true
    default:
      break
  }

  switch (char) {
    case 'q':
      return false
    case 'j':
      move(1)
      return true
    case 'k':
      move(-1)
      return true
    case 't':
      tracker.taxed = !tracker.taxed
      state.message = `the trade tax is ${tracker.taxed ? 'on' : 'off'}`
      return true
    case 'c':
      tracker.mapCosts = !tracker.mapCosts
      state.message = `the cost of the map counts ${tracker.mapCosts ? 'against' : 'for nothing'} the profit`
      return true
    case 'p':
      pausedAt = pausedAt === null ? Date.now() : null
      state.message = pausedAt === null ? 'the clock is going again' : 'the clock is stopped'
      return true
    case 'e': {
      const item = selectedItem()
      if (item === null) {
        state.message = 'there is nothing to set a price for'
        return true
      }
      const known = tracker.prices.price(item)
      state.editing = { item, text: known > 0 ? String(known) : '' }
      return true
    }
    case 's': {
      if (state.focus === 'inventory') {
        const order = ['value', 'qty', 'name'] as const
        const at = order.indexOf(state.inventorySort)
        state.inventorySort = order[(at + 1) % order.length] ?? 'value'
      } else if (state.focus === 'prices') {
        state.pricesSort = state.pricesSort === 'value' ? 'name' : 'value'
      } else {
        state.inventorySort = state.inventorySort === 'value' ? 'qty' : 'value'
      }
      return true
    }
    case 'x': {
      void writeReport(tracker, names).then(
        (path) => {
          state.message = `the report is in ${path}`
        },
        () => {
          state.message = 'the report could not be written'
        },
      )
      return true
    }
    case 'r':
      readLog()
      state.message = 'the log was read again'
      return true
    case '?':
      showHelp = true
      return true
    default:
      return true
  }
}

/* ---------- going round ---------- */

const terminal = Terminal.enter()
let done = false

function quit(): void {
  if (done) return
  done = true
  void save()
  terminal?.leave()
  process.exit(0)
}

/** Saves what the tracker knows. */
async function save(): Promise<void> {
  await saveTracker({
    version: 1,
    log: { file: logFile, offset: reader.position },
    tracker: tracker.snapshot(),
  }).catch(() => undefined)
}

process.on('SIGINT', quit)
process.on('SIGTERM', quit)
process.stdout.on('resize', draw)

if (process.stdin.isTTY) {
  process.stdin.setRawMode?.(true)
  process.stdin.resume()
  process.stdin.on('data', (chunk: Buffer | string) => {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    for (const { key, char } of decode(bytes)) {
      if (!press(key, char)) {
        quit()
        return
      }
    }
    draw()
  })
}

// the first read: the whole log, so the tracker knows about the runs that were already farmed
readLog()

setInterval(() => {
  readLog()
  draw()
}, 1000)

setInterval(() => {
  void save()
}, 30_000)

draw()
