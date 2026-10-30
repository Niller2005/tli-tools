// Builds the item name table the tracker uses.
//
//   bun scripts/generate-items.ts                 fetch the upstream data and write data/items.json
//   bun scripts/generate-items.ts --from=<file>  use a copy of the upstream data on disk
//   bun scripts/generate-items.ts --out=<file>    write somewhere else
//
// The upstream data is `tlidb_items_seed_en.json` from the TITrack project
// (https://github.com/astockman99/TITrack), which is itself built from the Torchlight: Infinite
// wiki at https://tlidb.com and from the community translations. It maps the game's ConfigBaseId
// to the item's English name, its Chinese name and its kind.
//
// The tracker only needs the name and the kind, so this writes a smaller file of its own. Items the
// upstream data does not know are shown as "Item #<id>" and can be named by hand; see the README.

import { dirname, join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

/** Where the upstream data comes from. */
const UPSTREAM =
  'https://raw.githubusercontent.com/astockman99/TITrack/master/tlidb_items_seed_en.json'

/** What one item looks like in the file this script writes. */
export interface ItemEntry {
  /** the English name */
  name?: string
  /** the Chinese name */
  nameCn?: string
  /** the kind of item, in Chinese */
  type?: string
}

/** The file this script writes: the item's id to what it is. */
export interface ItemTable {
  meta: {
    generatedAt: string
    source: string
    count: number
  }
  items: Record<string, ItemEntry>
}

/** Turns the upstream file into the tracker's own table. */
export function normalize(upstream: unknown): ItemTable {
  const raw = upstream as { items?: { id?: unknown; name_en?: unknown; name_cn?: unknown; type_cn?: unknown }[] }
  const items: Record<string, ItemEntry> = {}
  for (const item of raw.items ?? []) {
    const id = String(item.id ?? '')
    if (id === '') continue
    const entry: ItemEntry = {}
    const name = String(item.name_en ?? '')
    const cn = String(item.name_cn ?? '')
    const type = String(item.type_cn ?? '')
    if (name !== '') entry.name = name
    if (cn !== '') entry.nameCn = cn
    if (type !== '') entry.type = type
    items[id] = entry
  }
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      source: `${UPSTREAM} (a build of the tlidb.com wiki data and the community translations)`,
      count: Object.keys(items).length,
    },
    items,
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const arg = (name: string): string | null =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null

  const from = arg('from')
  const out = arg('out') ?? join(import.meta.dir, '..', 'data', 'items.json')

  let raw: string
  if (from !== null) {
    raw = await Bun.file(from).text()
  } else {
    process.stderr.write(`fetching ${UPSTREAM}\n`)
    const res = await fetch(UPSTREAM)
    if (!res.ok) throw new Error(`could not fetch the upstream data: ${res.status} ${res.statusText}`)
    raw = await res.text()
  }

  const table = normalize(JSON.parse(raw))
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, `${JSON.stringify(table, null, 1)}\n`)
  process.stderr.write(`wrote ${table.meta.count} items to ${out}\n`)
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    process.stderr.write(`${String(e)}\n`)
    process.exit(1)
  })
}
