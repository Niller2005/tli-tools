// The loot report: a csv file of every run, what was picked up in it and what it was worth.
//
// It is written when the player presses x in the tracker, and it can also be made from the command
// line:
//
//   bun src/report.ts [--out=<file>] [--log=<UE_game.log>] [--full]
//
// Without `--full` the report starts from what the tracker saved and reads the log on from where
// the tracker left it, so it says the same as the screen; `--full` reads the whole log from its
// beginning into a tracker that knows nothing of the runs that were saved.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { findLog } from '@tli/gamelog'
import { ItemNames, LogReader, Tracker, loadTracker, readBaseline } from '@tli/tracker'

/** A field in the csv file: quoted when it has a comma or a quote in it. */
function field(text: string): string {
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

/** A row of the report. */
function row(cells: (string | number)[]): string {
  return cells.map((c) => field(String(c))).join(',')
}

/** The report of the runs: one line for the run, then one line for each item in it. */
export function lootReport(tracker: Tracker, names: ItemNames): string {
  const lines: string[] = []
  lines.push(row(['run', 'kind', 'zone', 'name', 'started', 'ended', 'seconds', 'item_id', 'item', 'qty', 'price', 'value']))
  for (const run of tracker.runs) {
    const head = [
      run.id,
      run.kind,
      run.zone,
      run.name,
      new Date(run.start).toISOString(),
      run.end === null ? '' : new Date(run.end).toISOString(),
      run.end === null ? '' : ((run.end - run.start) / 1000).toFixed(1),
    ]
    const loot = [...run.loot].sort((a, b) => b[1] - a[1])
    if (loot.length === 0) {
      lines.push(row([...head, '', '', 0, '', '']))
      continue
    }
    for (const [item, qty] of loot) {
      const price = tracker.prices.price(item)
      lines.push(row([...head, item, names.name(item), qty, price, (price * qty).toFixed(2)]))
    }
    for (const [item, qty] of run.cost) {
      const price = tracker.prices.price(item)
      lines.push(row([...head, item, `${names.name(item)} (cost)`, -qty, price, (-price * qty).toFixed(2)]))
    }
  }
  return `${lines.join('\n')}\n`
}

/** The name of the report file, with the day in it. */
export function reportName(now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `loot-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.csv`
}

/** Where the report is written. */
export function reportPath(out?: string | null): string {
  if (out !== undefined && out !== null) return out
  const home = process.env.HOME ?? '.'
  return `${home}/tli-loot-report.csv`
}

/** Writes the report and says where it went. */
export async function writeReport(tracker: Tracker, names: ItemNames, out?: string | null): Promise<string> {
  const path = reportPath(out)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, lootReport(tracker, names))
  return path
}

/** The command line: read the log and write the report. */
async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const arg = (name: string): string | null =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null

  const given = arg('log')
  const found = given !== null ? { file: given, exists: true } : findLog()
  if (found === null || !found.exists) {
    process.stderr.write('the game log was not found; pass --log=<file>\n')
    process.exit(1)
  }

  const names = await ItemNames.load()
  const tracker = new Tracker({ names })
  // the community prices that were fetched last, so the report says the same as the screen
  const cached = await readBaseline()
  if (cached !== null) tracker.prices.setBaseline(cached.prices)
  // what the tracker saved, when it was reading this same log: the report carries on from it
  const saved = argv.includes('--full') ? null : await loadTracker()
  const usable = saved !== null && saved.log.file === found.file ? saved : null
  if (usable !== null) tracker.restore(usable.tracker)
  const reader = new LogReader(found.file, usable?.log.offset ?? 0)
  reader.readAll((batch) => tracker.feed(batch.lines))

  const path = await writeReport(tracker, names, arg('out'))
  process.stdout.write(`${path}\n`)
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    process.stderr.write(`${String(e)}\n`)
    process.exit(1)
  })
}
