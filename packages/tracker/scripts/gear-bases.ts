// Lists the ids of the gear the wiki has pages for.
//
//   bun scripts/gear-bases.ts                     the ids, one per line
//   bun scripts/gear-bases.ts --pages             the pages of the gear, one per line
//   bun scripts/gear-bases.ts --delay=800         wait longer between the requests
//
// The game knows the gear the player picks up by the id of its base type: the gear that rolls
// from the base "All Magic Shoes" is the id 4110 in the log, whatever it rolled. The wiki has a
// page for each base type, and the page says which id the game knows the base type by.
//
// This walks the wiki's pages of the gear (the pages of each slot, which list the base types
// that fit it), reads the pages of the base types they list, and writes the ids it finds. The
// ids can be piped into the scraper (see scrape-tlidb.ts), which asks the wiki to name them.
//
// The script is polite: it asks for one page at a time and waits between the requests, and it
// keeps the pages it fetched under .cache/tlidb, so a run that is interrupted can be continued.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Where the wiki lives. */
const SITE = 'https://tlidb.com'
/** The English part of the wiki. */
const LANG = 'en'

/** The wiki's pages of the gear: one per slot. */
const SLOTS = [
  'Claw',
  'Dagger',
  'One-Handed_Sword',
  'One-Handed_Hammer',
  'One-Handed_Axe',
  'Wand',
  'Rod',
  'Scepter',
  'Cane',
  'Pistol',
  'Two-Handed_Sword',
  'Two-Handed_Hammer',
  'Two-Handed_Axe',
  'Tin_Staff',
  'Cudgel',
  'Bow',
  'Crossbow',
  'Musket',
  'Fire_Cannon',
  'STR_Helmet',
  'DEX_Helmet',
  'INT_Helmet',
  'STR_Chest_Armor',
  'DEX_Chest_Armor',
  'INT_Chest_Armor',
  'STR_Gloves',
  'DEX_Gloves',
  'INT_Gloves',
  'STR_Boots',
  'DEX_Boots',
  'INT_Boots',
  'STR_Shield',
  'DEX_Shield',
  'INT_Shield',
  'Necklace',
  'Ring',
  'Spirit_Ring',
  'Belt',
]

const RE_TAB = /<div id="[^"]*" class="tab-pane[^"]*">/
const RE_LINK = /<a data-hover="[^"]*" href="([^"]+)">/g
const RE_ID = /<div>id:\s*(\d+)<\/div>/g

/** Waits a while, so the wiki is not asked for more than it can answer. */
function wait(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

/** Asks the wiki for a page, and returns its text. */
async function fetchPage(slug: string, delay: number): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await wait(delay)
    try {
      const res = await fetch(`${SITE}/${LANG}/${slug}`, {
        headers: {
          'User-Agent': 'tli-tracker-item-names/1.0 (+item name lookup for the Torchlight: Infinite loot tracker)',
          Accept: 'text/html',
        },
        signal: AbortSignal.timeout(30_000),
      })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (e) {
      if (attempt === 2) {
        process.stderr.write(`could not fetch ${slug}: ${String(e)}\n`)
        return null
      }
    }
  }
  return null
}

/** The pages of the base types the page of a slot lists in its first tab. */
function baseTypes(html: string): string[] {
  const tab = RE_TAB.exec(html)
  if (tab === null) return []
  const rest = html.slice(tab.index + tab[0].length)
  const next = RE_TAB.exec(rest)
  const panel = next === null ? rest : rest.slice(0, next.index)
  const links: string[] = []
  for (const match of panel.matchAll(RE_LINK)) {
    if (!links.includes(match[1])) links.push(match[1])
  }
  return links
}

/** The ids the page says the game knows the items by. */
function ids(html: string): number[] {
  const found: number[] = []
  for (const match of html.matchAll(RE_ID)) {
    const id = Number(match[1])
    if (!found.includes(id)) found.push(id)
  }
  return found
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const arg = (name: string): string | null =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null
  const pages = argv.includes('--pages')
  const delay = Number(arg('delay') ?? 1000)
  const cache = arg('cache') ?? join(import.meta.dir, '..', '.cache', 'tlidb')
  await mkdir(cache, { recursive: true })

  /** Reads a page, from the cache when it is there. */
  const page = async (slug: string): Promise<string | null> => {
    const file = join(cache, `${slug.replace(/[^A-Za-z0-9_.-]/g, '_')}.html`)
    try {
      return await readFile(file, 'utf8')
    } catch {
      /* not fetched yet */
    }
    const html = await fetchPage(slug, delay)
    if (html === null) return null
    await writeFile(file, html)
    return html
  }

  const gearPages: string[] = []
  for (const slot of SLOTS) {
    const html = await page(slot)
    if (html === null) {
      process.stderr.write(`no page for ${slot}\n`)
      continue
    }
    const bases = baseTypes(html)
    process.stderr.write(`${slot}: ${bases.length} base types\n`)
    for (const base of bases) if (!gearPages.includes(base)) gearPages.push(base)
  }

  if (pages) {
    for (const gearPage of gearPages) process.stdout.write(`${gearPage}\n`)
    return
  }

  const found: number[] = []
  for (const gearPage of gearPages) {
    const html = await page(gearPage)
    if (html === null) {
      process.stderr.write(`no page for ${gearPage}\n`)
      continue
    }
    for (const id of ids(html)) if (!found.includes(id)) found.push(id)
  }
  for (const id of found.sort((a, b) => a - b)) process.stdout.write(`${id}\n`)
  process.stderr.write(`${found.length} ids from ${gearPages.length} base type pages\n`)
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    process.stderr.write(`${String(e)}\n`)
    process.exit(1)
  })
}
