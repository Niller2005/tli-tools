// The screen the tracker draws.
//
// The drawing is a plain function: it takes what the tracker knows and the state of the screen and
// gives back the lines. That way it can be looked at without a terminal.

import type { Run, Tracker } from '@tli/tracker'
import { clip, clock, duration, fe, num } from './format'
import { bagRows, priceRows, type ViewState } from './view'

/** A line with something on the left and something on the right. */
interface Row {
  left: string
  right?: string
}

/** Puts the parts of a row in their places, with the last part at the right. */
function line(row: Row, width: number): string {
  if (row.right === undefined) return clip(row.left, width)
  const gap = Math.max(1, width - row.left.length - row.right.length)
  return `${row.left}${' '.repeat(gap)}${row.right}`
}

/** A box with a title and lines in it. */
function box(title: string, lines: string[], width: number, focused: boolean): string[] {
  const inner = Math.max(1, width - 2)
  const head = ` ${focused ? `\x1b[1m${title}\x1b[0m` : title} `
  const top = `┌${head}${'─'.repeat(Math.max(0, inner - head.length))}┐`
  const bottom = `└${'─'.repeat(inner)}┘`
  const body = lines.map((l) => `│${clip(l, inner)}│`)
  return [top, ...body, bottom]
}

/** The rows of the recent runs list, newest first. */
function runRows(tracker: Tracker, state: ViewState, height: number): Row[] {
  const runs = tracker.runs.slice(-height).reverse()
  const rows: Row[] = []
  for (const run of runs) {
    const worth = tracker.valueOfRun(run)
    rows.push({
      left: `#${run.id} ${run.name}`,
      right: `${duration((run.end ?? state.now) - run.start)}  ${fe(worth.gross)}`,
    })
  }
  if (rows.length === 0) rows.push({ left: 'no runs yet' })
  return rows
}

/** The rows of the current run panel. */
function currentRows(tracker: Tracker, state: ViewState, height: number): Row[] {
  const run = tracker.currentRun
  if (run === null) return [{ left: 'not in a map' }]
  const rows: Row[] = []
  rows.push({ left: run.name })
  rows.push({
    left: `${duration(state.now - run.start)}   ${run.loot.size} kinds`,
    right: fe(tracker.valueOfRun(run).gross),
  })
  const loot = [...run.loot]
    .map(([item, qty]) => ({
      item,
      name: tracker.names.name(item),
      qty,
      worth: qty * tracker.prices.price(item),
    }))
    .sort((a, b) => b.worth - a.worth || b.qty - a.qty)
    .slice(0, Math.max(1, height - 3))
  for (const item of loot) rows.push({ left: item.name, right: `${num(item.qty)}  ${fe(item.worth)}` })
  return rows
}

/** The rows of the bag list. */
function inventoryRows(tracker: Tracker, state: ViewState, height: number): Row[] {
  const rows = bagRows(tracker, state.inventorySort)
  const lines: Row[] = []
  const start = Math.max(0, Math.min(state.inventoryAt - height + 1, rows.length - height))
  for (const row of rows.slice(start, start + height)) {
    lines.push({ left: row.name, right: `${num(row.qty)}  ${fe(row.worth)}` })
  }
  if (lines.length === 0) lines.push({ left: 'the bag is empty' })
  return lines
}

/** The rows of the price list. */
function priceRowsFor(tracker: Tracker, state: ViewState, height: number): Row[] {
  const rows = priceRows(tracker, state.pricesSort)
  const lines: Row[] = []
  const start = Math.max(0, Math.min(state.pricesAt - height + 1, rows.length - height))
  for (const row of rows.slice(start, start + height)) {
    lines.push({ left: row.name, right: `${fe(row.price)}${row.source === 'set' ? ' *' : ''}` })
  }
  if (lines.length === 0) lines.push({ left: 'no prices yet: look an item up on the exchange' })
  return lines
}

/** The detail of one run, over the whole screen. */
export function detailLines(tracker: Tracker, run: Run, width: number, now: number): string[] {
  const lines: string[] = []
  const worth = tracker.valueOfRun(run)
  const end = run.end ?? now
  lines.push(`\x1b[1mRun #${run.id}: ${run.name}\x1b[0m`)
  lines.push(`${clock(run.start)} - ${clock(end)}   ${duration(end - run.start)}   ${fe(worth.gross)}`)
  lines.push('')
  const loot = [...run.loot]
    .map(([item, qty]) => ({ item, name: tracker.names.name(item), qty, worth: qty * tracker.prices.price(item) }))
    .sort((a, b) => b.worth - a.worth || b.qty - a.qty)
  for (const item of loot) {
    lines.push(line({ left: `${num(item.qty)} x ${item.name}`, right: fe(item.worth) }, width))
  }
  if (run.cost.size > 0) {
    lines.push('')
    lines.push('cost:')
    for (const [item, qty] of run.cost) {
      lines.push(`  ${num(qty)} x ${tracker.names.name(item)}   ${fe(qty * tracker.prices.price(item))}`)
    }
  }
  lines.push('')
  lines.push('enter or q goes back')
  return lines
}

/** The whole screen. */
export function render(tracker: Tracker, state: ViewState, width: number, height: number): string[] {
  if (state.detail !== null) {
    const run = tracker.runs.find((r) => r.id === state.detail)
    if (run !== undefined) return detailLines(tracker, run, width, state.now)
  }

  const stats = tracker.stats(state.now)
  const lines: string[] = []

  const title = ' TLI Loot Tracker '
  const right = state.logNote === '' ? state.logFile : state.logNote
  lines.push(`\x1b[1m${title}\x1b[0m${' '.repeat(Math.max(1, width - title.length - right.length))}${right}`)

  const head = [
    `net worth ${fe(stats.netWorth)}`,
    `FE/h ${num(stats.fePerHour)}`,
    `FE/run ${num(stats.fePerRun)}`,
    `runs ${stats.runs}`,
    `time ${duration(stats.totalTime)}`,
    `avg ${duration(stats.avgRunTime)}`,
  ]
  lines.push(head.join('   '))
  const flags = `tax ${tracker.taxed ? 'on' : 'off'}   map cost ${tracker.mapCosts ? 'on' : 'off'}`
  lines.push(`${flags}${state.paused ? '   \x1b[33mPAUSED\x1b[0m' : ''}`)
  if (state.message !== '') lines.push(state.message)
  lines.push('')

  const body = Math.max(6, height - lines.length - 2)
  const leftWidth = Math.min(48, Math.max(30, Math.floor(width / 2)))
  const rightWidth = Math.max(20, width - leftWidth - 1)
  const upper = Math.max(3, Math.floor(body / 2))
  const lower = Math.max(3, body - upper - 4)

  const left = box(
    'Current run',
    currentRows(tracker, state, upper - 2).map((r) => line(r, leftWidth - 2)),
    leftWidth,
    state.focus === 'runs',
  )
  const recent = box(
    'Recent runs',
    runRows(tracker, state, upper - 2).map((r) => line(r, rightWidth - 2)),
    rightWidth,
    state.focus === 'runs',
  )
  const bag = box(
    `Bag (${tracker.inventory.totals().size})`,
    inventoryRows(tracker, state, lower - 2).map((r) => line(r, leftWidth - 2)),
    leftWidth,
    state.focus === 'inventory',
  )
  const prices = box(
    'Prices',
    priceRowsFor(tracker, state, lower - 2).map((r) => line(r, rightWidth - 2)),
    rightWidth,
    state.focus === 'prices',
  )

  for (let i = 0; i < Math.max(left.length, recent.length); i++) {
    lines.push(`${left[i] ?? ''}${recent[i] ?? ''}`)
  }
  for (let i = 0; i < Math.max(bag.length, prices.length); i++) {
    lines.push(`${bag[i] ?? ''}${prices[i] ?? ''}`)
  }

  lines.push('')
  if (state.editing !== null) {
    const name = tracker.names.name(state.editing.item)
    lines.push(`price of ${name} (FE): ${state.editing.text}\x1b[5m_\x1b[0m   enter keeps it, esc leaves it`)
  } else {
    lines.push(
      '\x1b[2m↑/↓ move   tab panel   enter detail   t tax   c map cost   e price   x csv   p pause   ? help   q quit\x1b[0m',
    )
  }
  return lines
}

/** The help screen. */
export function helpLines(width: number): string[] {
  const lines = [
    '\x1b[1mKeys\x1b[0m',
    '',
    '  up/down  j/k     move in the panel that has the focus',
    '  tab               the next panel (shift+tab the one before)',
    '  enter             the detail of the run that is picked out',
    '  esc               back, or leave the price',
    '  t                 the trade tax on and off',
    '  c                 the cost of the map counts against the profit, or not',
    '  p                 stop and start the clock',
    '  e                 set the price of the item that is picked out',
    '  s                 change how the list is sorted',
    '  x                 write the loot report to a csv file',
    '  r                 read the log again from where it was',
    '  ?                 this help',
    '  q                 quit',
    '',
    'The tracker only reads the log. It never touches the game.',
  ]
  return lines.map((l) => clip(l, width))
}
