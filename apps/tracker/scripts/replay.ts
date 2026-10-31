// Replays a log file through the tracker and prints what came out.
//
//   bun scripts/replay.ts [--log=<UE_game.log>] [--runs] [--top=N]
//   bun scripts/replay.ts --render=160x45 [--out=screen.ansi]
//   bun scripts/replay.ts --html=160x45 [--out=screen.html]
//
// It is how the tracker is checked against a real log: how many runs were found, what was picked
// up, how long it took and how much memory it used. The `--render` and `--html` flags draw the
// screen the tracker draws, with OpenTUI's test renderer, and write it out.

import { findLog } from '@tli/gamelog'
import { ItemNames, LogReader, Tracker } from '@tli/tracker'
import { createTestRenderer } from '@opentui/core/testing'
import type { CapturedFrame } from '@opentui/core'
import { TrackerScreen } from '../src/screen'
import { freshView } from '../src/view'

const arg = (name: string): string | null =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null
const flag = (name: string): boolean => process.argv.includes(`--${name}`)

const given = arg('log')
const found = given !== null ? { file: given, exists: true } : findLog()
if (found === null) {
  process.stderr.write('the game log was not found; pass --log=<file>\n')
  process.exit(1)
}
if (!found.exists) {
  process.stderr.write(`the game log is not there: ${found.file}\n`)
  process.exit(1)
}
const logFile = found.file

const names = await ItemNames.load()
const tracker = new Tracker({ names })

const started = Date.now()
let lines = 0
const reader = new LogReader(found.file, 0)
reader.readAll((batch) => {
  lines += batch.lines.length
  tracker.feed(batch.lines)
})
const elapsed = Date.now() - started

/** The size of a frame, from a `--render=160x45` argument. */
function size(text: string): { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/.exec(text)
  if (match === null) {
    process.stderr.write('the size needs to be like 160x45\n')
    process.exit(1)
  }
  return { width: Number(match[1]), height: Number(match[2]) }
}

/** Draws the screen and returns what was drawn. */
async function draw(width: number, height: number): Promise<CapturedFrame> {
  const setup = await createTestRenderer({ width, height })
  try {
    const screen = new TrackerScreen(setup.renderer, tracker)
    setup.renderer.root.add(screen.root)
    screen.draw(freshView(logFile, Date.now()))
    await setup.renderOnce()
    return setup.captureSpans()
  } finally {
    await setup.dispose()
  }
}

/** The colour of a span, as a css colour. */
function css(color: { toInts(): [number, number, number, number] }): string {
  const [r, g, b, a] = color.toInts()
  return a === 0 ? 'transparent' : `rgb(${r},${g},${b})`
}

/** The frame as html, so it can be looked at in a browser. */
function html(frame: CapturedFrame): string {
  const rows = frame.lines
    .map((line) => {
      const spans = line.spans
        .map((span) => {
          const style = [`color:${css(span.fg)}`, `background:${css(span.bg)}`]
          if ((span.attributes & 1) !== 0) style.push('font-weight:bold')
          if ((span.attributes & 2) !== 0) style.push('opacity:0.6')
          if ((span.attributes & 4) !== 0) style.push('font-style:italic')
          if ((span.attributes & 8) !== 0) style.push('text-decoration:underline')
          if ((span.attributes & 32) !== 0) style.push('filter:invert(1)')
          const text = span.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          return `<span style="${style.join(';')}">${text}</span>`
        })
        .join('')
      return `<div>${spans}</div>`
    })
    .join('\n')

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>TLI Loot Tracker</title>
<style>
  body { background: #101010; margin: 0; padding: 16px; }
  pre { margin: 0; font-family: "DejaVu Sans Mono", monospace; font-size: 14px; line-height: 1.15; }
  pre span { white-space: pre; }
</style></head>
<body><pre>${rows}</pre></body></html>
`
}

/** The frame as ansi, so it can be looked at in a terminal. */
function ansi(frame: CapturedFrame): string {
  const lines = frame.lines.map((line) => {
    let out = ''
    let fg = ''
    let bg = ''
    let attributes = -1
    for (const span of line.spans) {
      const nextFg = css(span.fg)
      const nextBg = css(span.bg)
      if (nextFg !== fg || nextBg !== bg || span.attributes !== attributes) {
        fg = nextFg
        bg = nextBg
        attributes = span.attributes
        out += '\x1b[0m'
        if (span.attributes & 1) out += '\x1b[1m'
        if (span.attributes & 2) out += '\x1b[2m'
        if (span.attributes & 4) out += '\x1b[3m'
        if (span.attributes & 8) out += '\x1b[4m'
        if (span.attributes & 32) out += '\x1b[7m'
        if (nextFg !== 'transparent') {
          const [r, g, b] = span.fg.toInts()
          out += `\x1b[38;2;${r};${g};${b}m`
        }
        if (nextBg !== 'transparent') {
          const [r, g, b] = span.bg.toInts()
          out += `\x1b[48;2;${r};${g};${b}m`
        }
      }
      out += span.text
    }
    return `${out}\x1b[0m`
  })
  return `${lines.join('\n')}\n`
}

const renderSize = arg('render')
const htmlSize = arg('html')

if (renderSize !== null || htmlSize !== null) {
  const { width, height } = size(renderSize ?? htmlSize ?? '')
  const frame = await draw(width, height)
  const out = arg('out')
  const text = htmlSize !== null ? html(frame) : ansi(frame)
  if (out === null) {
    process.stdout.write(text)
  } else {
    await Bun.write(out, text)
    console.log(`screen:     ${out} (${width}x${height})`)
  }
  process.exit(0)
}

const memory = process.memoryUsage()
const stats = tracker.stats()

const top = Number(arg('top') ?? 15)
const loot = new Map<number, number>()
for (const run of tracker.runs) {
  for (const [item, qty] of run.loot) loot.set(item, (loot.get(item) ?? 0) + qty)
}
const best = [...loot]
  .map(([item, qty]) => ({ item, qty, worth: qty * tracker.prices.price(item) }))
  .sort((a, b) => b.worth - a.worth || b.qty - a.qty)
  .slice(0, top)

const mins = (ms: number): string => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

console.log(`log:        ${logFile}`)
console.log(`lines:      ${lines}`)
console.log(`took:       ${elapsed} ms`)
console.log(`peak rss:   ${(memory.rss / 1024 / 1024).toFixed(1)} MiB`)
console.log(`heap used:  ${(memory.heapUsed / 1024 / 1024).toFixed(1)} MiB`)
console.log('')
console.log(`runs:       ${stats.runs}`)
console.log(`total time: ${mins(stats.totalTime)}`)
console.log(`avg run:    ${mins(stats.avgRunTime)}`)
console.log(`FE picked:  ${stats.fe}`)
console.log(`loot value: ${stats.lootValue.toFixed(1)} FE`)
console.log(`FE/hour:    ${stats.fePerHour.toFixed(1)}`)
console.log(`FE/run:     ${stats.fePerRun.toFixed(2)}`)
console.log(`net worth:  ${stats.netWorth.toFixed(1)} FE`)
console.log(`prices:     ${tracker.prices.snapshot().learned.length} items`)
console.log('')
console.log('top loot by value:')
for (const row of best) {
  console.log(
    `  ${String(row.qty).padStart(6)} x ${names.name(row.item).padEnd(32)} ${row.worth.toFixed(1).padStart(9)} FE`,
  )
}

if (flag('runs')) {
  console.log('')
  console.log('runs:')
  for (const run of tracker.runs) {
    const worth = tracker.valueOfRun(run)
    console.log(
      `  #${String(run.id).padStart(3)} ${run.name.padEnd(42)} ${mins(run.end! - run.start).padStart(7)} ` +
        `${worth.gross.toFixed(1).padStart(9)} FE  ${run.loot.size} items`,
    )
  }
}
