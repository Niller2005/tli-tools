// Replays a log file through the tracker and prints what came out.
//
//   bun scripts/replay.ts [--log=<UE_game.log>] [--runs] [--top=N]
//
// It is how the tracker is checked against a real log: how many runs were found, what was picked
// up, how long it took and how much memory it used.

import { findLog } from '@tli/gamelog'
import { ItemNames, LogReader, Tracker } from '@tli/tracker'

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

console.log(`log:        ${found.file}`)
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
