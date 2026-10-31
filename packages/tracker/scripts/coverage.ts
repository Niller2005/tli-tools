// Says how much of the loot in the game's logs the item table can name.
//
//   bun scripts/coverage.ts                                  the two logs of this machine
//   bun scripts/coverage.ts <log> [<log> ...]                the logs to read
//   bun scripts/coverage.ts --missing                        only the ids the table does not name
//   bun scripts/coverage.ts --ids                            every id the logs mention, one per line
//
// The script reads every line of every log, works out which item ids the game mentions in it,
// and compares them with the names in data/items.json. It says how many of the ids the table
// names, how many it does not, and how much of the loot that is, counted by the number of times
// the game mentions the item.
//
// With --missing or --ids it writes the ids themselves, one per line, so they can be piped into
// the scraper (see scrape-tlidb.ts) to have the wiki name them.

import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { parseLine } from '../src/parse'

/** The logs of this machine, when none are named. */
const DEFAULT_LOGS = [
  '/mnt/games/SteamLibrary/steamapps/common/Torchlight Infinite/UE_game/TorchLight/Saved/Logs/UE_game.log',
  '/mnt/games/SteamLibrary/steamapps/common/Torchlight Infinite/UE_game/TorchLight/Saved/Logs/UE_game-backup-2026.10.30-06.31.17.log',
]

/** What the logs say about one item id. */
interface Seen {
  /** how many times the game mentioned the item */
  count: number
  /** how many items of it the game counted */
  num: number
  /** the pages of the bag the item was seen on */
  pages: Set<number>
  /** the protocol blocks the item was seen in */
  protos: Set<string>
}

/** Reads a log and works out which item ids it mentions. */
export async function readLog(path: string): Promise<Map<number, Seen>> {
  const seen = new Map<number, Seen>()
  const decoder = new TextDecoder()
  let rest = ''
  let proto = ''
  const take = (line: string): void => {
    const fact = parseLine(line)
    if (fact === null) return
    if (fact.t === 'proto') {
      proto = fact.start ? fact.name : ''
      return
    }
    if (fact.t !== 'bagSet' && fact.t !== 'bagClear') return
    if (fact.item <= 0) return
    let entry = seen.get(fact.item)
    if (entry === undefined) {
      entry = { count: 0, num: 0, pages: new Set(), protos: new Set() }
      seen.set(fact.item, entry)
    }
    entry.count++
    if (fact.t === 'bagSet') entry.num += fact.num
    entry.pages.add(fact.page)
    if (proto !== '') entry.protos.add(proto)
  }

  for await (const chunk of Bun.file(path).stream()) {
    const text = rest + decoder.decode(chunk, { stream: true })
    const lines = text.split('\n')
    rest = lines.pop() ?? ''
    for (const line of lines) take(line)
  }
  take(rest)
  return seen
}

/** The names the item table has. */
async function readTable(): Promise<Record<string, { name?: string }>> {
  const tablePath = join(import.meta.dir, '..', 'data', 'items.json')
  const table = JSON.parse(await readFile(tablePath, 'utf8')) as {
    items: Record<string, { name?: string }>
  }
  return table.items
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const has = (name: string): boolean => argv.includes(`--${name}`)
  const logs = argv.filter((a) => !a.startsWith('--'))
  const paths = logs.length > 0 ? logs : DEFAULT_LOGS
  const items = await readTable()

  const all = new Map<number, Seen>()
  for (const path of paths) {
    const seen = await readLog(path)
    process.stderr.write(`${path}: ${seen.size} item ids\n`)
    for (const [id, entry] of seen) {
      const known = all.get(id)
      if (known === undefined) {
        all.set(id, {
          count: entry.count,
          num: entry.num,
          pages: new Set(entry.pages),
          protos: new Set(entry.protos),
        })
        continue
      }
      known.count += entry.count
      known.num += entry.num
      for (const page of entry.pages) known.pages.add(page)
      for (const proto of entry.protos) known.protos.add(proto)
    }
  }

  const isNamed = (id: number): boolean => {
    const name = items[String(id)]?.name
    return name !== undefined && name !== ''
  }

  if (has('--ids') || has('--missing')) {
    const ids = [...all.entries()]
      .filter(([id]) => !has('--missing') || !isNamed(id))
      .sort((a, b) => b[1].count - a[1].count || a[0] - b[0])
    for (const [id] of ids) process.stdout.write(`${id}\n`)
    return
  }

  let named = 0
  let unnamed = 0
  let namedCount = 0
  let unnamedCount = 0
  const unknown: { id: number; seen: Seen }[] = []
  for (const [id, entry] of [...all.entries()].sort((a, b) => a[0] - b[0])) {
    if (isNamed(id)) {
      named++
      namedCount += entry.count
    } else {
      unnamed++
      unnamedCount += entry.count
      unknown.push({ id, seen: entry })
    }
  }

  const total = all.size
  const pct = (n: number): string => `${((n / total) * 100).toFixed(2)}%`
  const pctCount = (n: number): string => `${((n / (namedCount + unnamedCount)) * 100).toFixed(2)}%`

  process.stdout.write(`\nids seen: ${total}\n`)
  process.stdout.write(`named: ${named} (${pct(named)}), unnamed: ${unnamed} (${pct(unnamed)})\n`)
  process.stdout.write(
    `mentions: ${namedCount + unnamedCount} in all; named: ${namedCount} (${pctCount(namedCount)}), unnamed: ${unnamedCount} (${pctCount(unnamedCount)})\n`,
  )
  process.stdout.write(`\nstill unknown:\n`)
  for (const { id, seen } of unknown) {
    const pages = [...seen.pages].sort((a, b) => a - b).join(',')
    const protos = [...seen.protos].join(',')
    process.stdout.write(
      `  ${id}\t${seen.count}\tnum ${seen.num}\tpages ${pages}\t${protos}\n`,
    )
  }
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    process.stderr.write(`${String(e)}\n`)
    process.exit(1)
  })
}
