// Checks one run of the tracker against the raw log: it prints what the tracker says was picked up
// in the run, and the log's own lines for the same time.
//
//   bun scripts/verify-run.ts --run=5 [--log=<UE_game.log>]

import { findLog } from '@tli/gamelog'
import { ItemNames, LogReader, Tracker } from '@tli/tracker'
import { arg } from '@tli/tui'

const given = arg('log')
const found = given !== null ? { file: given, exists: true } : findLog()
if (found === null || !found.exists) {
  process.stderr.write('the game log was not found; pass --log=<file>\n')
  process.exit(1)
}

const wanted = Number(arg('run') ?? 1)
const names = await ItemNames.load()
const tracker = new Tracker({ names })

const reader = new LogReader(found.file, 0)
reader.readAll((batch) => tracker.feed(batch.lines))

const run = tracker.runs.find((r) => r.id === wanted)
if (run === undefined) {
  process.stderr.write(`there is no run ${wanted}\n`)
  process.exit(1)
}

const stamp = (ms: number): string => {
  const d = new Date(ms)
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${p(d.getUTCFullYear(), 4)}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}-${p(d.getUTCHours())}.${p(d.getUTCMinutes())}.${p(d.getUTCSeconds())}`
}

console.log(`run #${run.id}: ${run.name} (${run.zone})`)
console.log(`from ${stamp(run.start)} to ${stamp(run.end!)}`)
console.log('')
console.log('what the tracker says was picked up:')
for (const [item, qty] of [...run.loot].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(qty).padStart(6)} x ${names.name(item)} (#${item})`)
}
console.log('')
console.log('what the run cost:')
for (const [item, qty] of [...run.cost].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(qty).padStart(6)} x ${names.name(item)} (#${item})`)
}
console.log('')
console.log('the log says:')
const from = stamp(run.start)
const to = stamp(run.end!)
let proto = ''
const reader2 = new LogReader(found.file, 0)
reader2.readAll((batch) => {
  for (const line of batch.lines) {
    const at = line.slice(1, 20)
    if (at < from || at > to) continue
    if (line.includes('ItemChange@ ProtoName=')) proto = line.split('ProtoName=')[1]?.split(' ')[0] ?? ''
    if (!/ItemChange@ (Add|Update) /.test(line)) continue
    if (proto !== 'PickItem' && proto !== 'PickItems') continue
    console.log(`  ${line.slice(1, 20)} ${proto.padEnd(9)} ${line.split('[Game] ')[1] ?? line}`)
  }
})
