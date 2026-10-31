// Builds the item name table the tracker uses.
//
//   bun scripts/generate-items.ts                 fetch the upstream data and write data/items.json
//   bun scripts/generate-items.ts --from=<file>  use a copy of the upstream data on disk
//   bun scripts/generate-items.ts --out=<file>    write somewhere else
//   bun scripts/generate-items.ts --wiki=<file>   the names scraped from the wiki to merge in
//   bun scripts/generate-items.ts --no-wiki       do not merge the names scraped from the wiki
//
// The table is built from two sources.
//
// The first is `tlidb_items_seed_en.json` from the TITrack project
// (https://github.com/astockman99/TITrack), which is itself built from the Torchlight: Infinite
// wiki at https://tlidb.com and from the community translations. It maps the game's ConfigBaseId
// to the item's English name, its Chinese name and its kind.
//
// The second is `data/tlidb-items.json`, which `scripts/scrape-tlidb.ts` builds by reading the
// wiki itself. The wiki has a page per item, and the page says which id the game knows the item
// by. The upstream data does not have every id: the pages of the gear the player picks up, whose
// names are the names of the gear's base type, are mostly missing from it.
//
// The names the upstream data has are kept: it is the source the tracker already trusts, and it
// carries the Chinese names and the kinds as well. The wiki fills in the ids the upstream data
// leaves out. Every entry says which sources it came from.
//
// The tracker only needs the name and the kind, so this writes a smaller file of its own. Items the
// upstream data does not know are shown as "Item #<id>" and can be named by hand; see the README.

import { dirname, join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

/** Where the upstream data comes from. */
const UPSTREAM =
  'https://raw.githubusercontent.com/astockman99/TITrack/master/tlidb_items_seed_en.json'

/** Where the wiki comes from. */
const WIKI = 'https://tlidb.com'

/** What one item looks like in the file this script writes. */
export interface ItemEntry {
  /** the English name */
  name?: string
  /** the Chinese name */
  nameCn?: string
  /** the kind of item */
  type?: string
  /** the kind of item, in English */
  typeEn?: string
  /** where the entry came from: "titrack" or "tlidb" */
  sources?: string[]
}

/** One source of names. */
export interface ItemSource {
  /** the short name of the source */
  id: string
  /** where the names come from */
  url: string
  /** what the source is, in a line */
  note: string
  /** how many names the source gave */
  count: number
}

/** The file this script writes: the item's id to what it is. */
export interface ItemTable {
  meta: {
    generatedAt: string
    source: string
    count: number
    sources: ItemSource[]
  }
  items: Record<string, ItemEntry>
}

/** What the scraper writes about one item. */
export interface TlidbEntry {
  /** the name the wiki gives the item */
  name: string
  /** the page of the wiki the item is on, when it was read from a page */
  slug?: string
  /** the tag the page shows for the attribute family, when it shows one ("INT Boots") */
  family?: string
  /** the tag the page shows for the rarity, when it shows one */
  rarity?: string
  /** the season the item is from, when the page shows one ("SS14Season") */
  season?: string
  /** the slot the item goes in, when the page shows one ("Feet") */
  slot?: string
  /** the level the item needs, when the page shows one */
  level?: number
  /** the file name of the icon the page shows */
  icon?: string
  /** where the name came from: the card of the item, or the page of the item */
  from: 'card' | 'page'
}

/** The file the scraper writes. */
export interface TlidbTable {
  items: Record<string, TlidbEntry>
}

/** The attribute a family tag names, when the tag names one ("INT Boots" is intelligence). */
export function familyAttribute(family: string | undefined): string | null {
  if (family === undefined) return null
  const match = /^(STR|DEX|INT)\b/.exec(family)
  if (match === null) return null
  return match[1] === 'STR' ? 'Str' : match[1] === 'DEX' ? 'Dex' : 'Int'
}

/** Whether a name already says which attribute the item rolls. */
function saysAttribute(name: string, attribute: string): boolean {
  const words = attribute.toLowerCase()
  return new RegExp(`\\b(${words}|strength|dexterity|intelligence)\\b`, 'i').test(name)
}

/**
 * The name to show for an item the wiki has.
 *
 * The wiki names the gear the player picks up after the base type of the gear ("All Magic
 * Shoes"), which says nothing about the attributes the gear rolled. The page of the item also
 * shows which attribute family it rolls ("INT Boots"), so the name gets that in brackets, unless
 * the name already says it.
 */
export function displayName(entry: TlidbEntry): string {
  const name = entry.name.trim().replace(/^All\s+/, '')
  const attribute = familyAttribute(entry.family)
  if (attribute === null) return name
  if (saysAttribute(name, attribute)) return name
  return `${name} (${attribute})`
}

/** Turns the upstream file into the tracker's own table. */
export function normalize(upstream: unknown): ItemTable {
  const raw = upstream as { items?: { id?: unknown; name_en?: unknown; name_cn?: unknown; type_cn?: unknown }[] }
  const items: Record<string, ItemEntry> = {}
  for (const item of raw.items ?? []) {
    const id = String(item.id ?? '')
    if (id === '') continue
    const entry: ItemEntry = { sources: ['titrack'] }
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
      sources: [],
    },
    items,
  }
}

/**
 * Adds the names the wiki has to the table the upstream data made.
 *
 * The names the upstream data has are kept, and the wiki only fills in the ids the upstream data
 * leaves out. Every entry says which sources it came from.
 */
export function addWiki(table: ItemTable, wiki: TlidbTable): ItemTable {
  const items: Record<string, ItemEntry> = { ...table.items }
  for (const [id, entry] of Object.entries(wiki.items ?? {})) {
    const name = displayName(entry)
    if (name === '') continue
    const known = items[id]
    if (known === undefined) {
      const item: ItemEntry = { name, sources: ['tlidb'] }
      if (entry.family !== undefined) {
        item.type = entry.family
        item.typeEn = entry.family
      }
      items[id] = item
      continue
    }
    const sources = known.sources ?? []
    if (!sources.includes('tlidb')) sources.push('tlidb')
    known.sources = sources
    if (entry.family !== undefined && known.typeEn === undefined) known.typeEn = entry.family
    if (known.name === undefined) known.name = name
  }
  return {
    meta: { ...table.meta, count: Object.keys(items).length },
    items,
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const arg = (name: string): string | null =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null

  const from = arg('from')
  const out = arg('out') ?? join(import.meta.dir, '..', 'data', 'items.json')
  const wikiPath = arg('wiki') ?? join(import.meta.dir, '..', 'data', 'tlidb-items.json')
  const useWiki = !argv.includes('--no-wiki')

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

  let wiki: TlidbTable = { items: {} }
  if (useWiki) {
    try {
      wiki = JSON.parse(await readFile(wikiPath, 'utf8')) as TlidbTable
    } catch {
      process.stderr.write(`no wiki data at ${wikiPath}; the table will only have the upstream names\n`)
    }
  }
  const before = Object.keys(table.items).length
  const merged = addWiki(table, wiki)
  const items = merged.items

  const fromUpstream = Object.values(items).filter((e) => e.sources?.includes('titrack') === true).length
  const fromWiki = Object.values(items).filter((e) => e.sources?.includes('tlidb') === true).length

  const result: ItemTable = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: `${UPSTREAM} (a build of the tlidb.com wiki data and the community translations), plus ${WIKI} (the wiki read by scripts/scrape-tlidb.ts)`,
      count: Object.keys(items).length,
      sources: [
        {
          id: 'titrack',
          url: UPSTREAM,
          note: 'TITrack build of the Torchlight: Infinite wiki data and the community translations',
          count: fromUpstream,
        },
        {
          id: 'tlidb',
          url: WIKI,
          note: 'the Torchlight: Infinite wiki read by scripts/scrape-tlidb.ts; a fan-made site, not affiliated with XD',
          count: fromWiki,
        },
      ],
    },
    items,
  }

  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, `${JSON.stringify(result, null, 1)}\n`)
  process.stderr.write(
    `wrote ${result.meta.count} items to ${out} (${fromUpstream} from the upstream data, ${fromWiki} from the wiki; ${before} before the wiki was added)\n`,
  )
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    process.stderr.write(`${String(e)}\n`)
    process.exit(1)
  })
}
