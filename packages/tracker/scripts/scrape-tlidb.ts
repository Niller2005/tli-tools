// Collects the item ids and names the Torchlight: Infinite wiki publishes.
//
//   bun scripts/scrape-tlidb.ts                    scrape the wiki and write data/tlidb-items.json
//   bun scripts/scrape-tlidb.ts --ids=<file>       also look up the ids listed in a file
//   bun scripts/scrape-tlidb.ts --max=<n>          scrape at most n pages and stop
//   bun scripts/scrape-tlidb.ts --delay=<ms>       wait longer between the requests
//   bun scripts/scrape-tlidb.ts --out=<file>       write the table somewhere else
//   bun scripts/scrape-tlidb.ts --refresh          fetch the pages again, ignoring the cache
//
// The wiki (https://tlidb.com) has one page per item. The page says which id the game knows the
// item by, in its "Info" card ("id: 4110"), and the name of the item in its heading. The wiki also
// answers one id at a time: /en/hover?s=ItemBase%2F<id> gives the card of the item with that id,
// with its name and its tags.
//
// The card is the better source of the name, because a page can show more than one item: the
// pages of the gear the player picks up have a tab per kind of gear, and the heading of the page
// is the name of the tab that happens to be open, not the name of the item.
//
// The script is polite: it asks for one page at a time and waits between the requests. It keeps
// the pages it fetched under .cache/tlidb and what it read in them in .cache/tlidb/index.json, so
// a run that is interrupted can be continued without asking the wiki for the same page twice.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Where the wiki lives. */
const SITE = 'https://tlidb.com'
/** The English part of the wiki. */
const LANG = 'en'
/** The list of the wiki's pages the site itself hands out, used to start the crawl. */
const AUTOCOMPLETE = `${SITE}/i18n/autocomplete_${LANG}.json`

/** The kinds of page that show no item of their own. */
const NOT_ITEMS: Record<string, true> = {
  Tip: true,
  Manual: true,
  Help: true,
  'Statue of The New God': true,
  Feature: true,
}

/** The pages the crawl starts from, on top of the wiki's own list of its pages. */
const SEEDS = [
  'Inventory',
  'Legendary_Gear',
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
  'Active_Skill',
  'Support_Skill',
  'Passive_Skill',
  'Activation_Medium_Skill',
  'Universal_Items',
  'Compass',
  'Season_Compass',
  'Memory_Scrap',
  'Memory_Thread',
  'Core_Organ',
  'Normal_Organ',
  'Special_Organ_-_Other',
  'Divinity_Slate',
  'Divinity_Pact',
  'Divinity_Fragment',
  'Divinity_Stone',
  'Divinity_Emblems',
  'Tempering_Medal',
  'Fuel',
  'Ember',
  'Fossil',
  'Universal_Items',
  'Probe',
  'Void_Chart',
  'Astrolabe',
  'Beacon',
  'Prism',
  'Soul_Nail',
  'Gear_Blueprint',
  'Revival_Material',
  'Revival_Material_Lunar_Phase',
  'Vorax_Limb_Head',
  'Vorax_Limb_Chest',
  'Vorax_Limb_Hands',
  'Vorax_Limb_Legs',
  'Vorax_Limb_Neck',
  'Vorax_Limb_Digits',
  'Vorax_Limb_Waist',
  'Vorax_Aberrant_Limb_Digits',
  'Vorax_Aberrant_Limb_Legs',
  'Vorax_Aberrant_Limb_Waist',
]

/** What one item looks like in the file this script writes. */
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

/** The file this script writes: the item's id to what it is. */
export interface TlidbTable {
  meta: {
    generatedAt: string
    source: string
    count: number
  }
  items: Record<string, TlidbEntry>
}

const RE_H1 = /<h1>([\s\S]*?)<\/h1>/
const RE_ID = /<(?:div|li)>id:\s*(\d+)<\/(?:div|li)>/g
const RE_TAG = /<span class="border p-1 mb-1 tag tlborder">([^<]*)<\/span>/g
const RE_VER = /<div class="item_ver">([^<]*)<\/div>/
const RE_ICON = /<img src="[^"]*\/([^"/]+\.webp)" class="ui_item_base ui_item_quality(\d+)"/g
const RE_LEVEL = /<span class="border p-1 mb-1 tag tlborder">Require lv (\d+)<\/span>/
const RE_SLOT = /data-block="description2">([^<]*)</
const RE_HREF = /href="([^"]+)"/g
const RE_LEVEL_CARD = /card-header"[^>]*>([^<]*)<\/div>/g
const RE_CARD_TITLE = /class="card-title[^"]*"[^>]*>([^<]*)</

/** The parts of a wiki page the script reads. */
export interface Page {
  /** the ids the page says the game knows the items by */
  ids: number[]
  /** the name in the page's heading */
  name: string | null
  /** the tag for the attribute family, when the page shows one */
  family: string | null
  /** the tag for the rarity, when the page shows one */
  rarity: string | null
  /** the season the item is from */
  season: string | null
  /** the slot the item goes in */
  slot: string | null
  /** the level the item needs */
  level: number | null
  /** the file name of the icon */
  icon: string | null
  /** the pages the page links to, in its own content */
  links: string[]
}

/** Turns the text of a page into plain text. */
export function text(html: string): string {
  return html
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Reads the parts of a wiki page the script wants. */
export function parsePage(html: string): Page {
  const heading = RE_H1.exec(html)
  const ver = RE_VER.exec(html)

  const tags: string[] = []
  for (const match of html.matchAll(RE_TAG)) tags.push(text(match[1]))
  const level = RE_LEVEL.exec(html)
  const slot = RE_SLOT.exec(html)

  // the ids of the items the page shows, in the "Info" cards at the end of them
  const ids: number[] = []
  for (const match of html.matchAll(RE_ID)) {
    const id = Number(match[1])
    if (!ids.includes(id)) ids.push(id)
  }

  // the icon of the item itself is the first one that is not a small emblem
  let icon: string | null = null
  for (const match of html.matchAll(RE_ICON)) {
    if (match[1].includes('/')) continue
    icon = match[1]
    break
  }

  // the rarity is in the card that says which tier the item is
  let rarity: string | null = null
  for (const match of html.matchAll(RE_LEVEL_CARD)) {
    const head = text(match[1])
    if (/^(Legendary|Matchless|Ultimate|Precious)$/i.test(head)) {
      rarity = head
      break
    }
  }

  // the family is the tag that says which attributes the item rolls ("INT Boots")
  const family = tags.find((t) => /^(STR|DEX|INT)\s/.test(t)) ?? null

  // the links in the page's own content, so the crawl can walk from one page to the next
  const body = html.slice(html.indexOf('role="main"'))
  const links: string[] = []
  for (const match of body.matchAll(RE_HREF)) {
    const href = match[1]
    if (!/^[A-Za-z0-9][A-Za-z0-9_.%' -]*$/.test(href)) continue
    if (href.endsWith('.html') || href.endsWith('.json')) continue
    links.push(href)
  }

  return {
    ids,
    name: heading === null ? null : text(heading[1]),
    family,
    rarity,
    season: ver === null ? null : text(ver[1]),
    slot: slot === null ? null : text(slot[1]),
    level: level === null ? null : Number(level[1]),
    icon,
    links,
  }
}

/** Reads the card the wiki shows for one id. */
export function parseCard(html: string): {
  name: string | null
  family: string | null
  rarity: string | null
  season: string | null
  slot: string | null
  level: number | null
  icon: string | null
} {
  const title = RE_CARD_TITLE.exec(html)
  const ver = RE_VER.exec(html)
  const level = RE_LEVEL.exec(html)
  const slot = RE_SLOT.exec(html)

  const tags: string[] = []
  for (const match of html.matchAll(RE_TAG)) tags.push(text(match[1]))

  let icon: string | null = null
  for (const match of html.matchAll(RE_ICON)) {
    if (match[1].includes('/')) continue
    icon = match[1]
    break
  }

  let rarity: string | null = null
  for (const match of html.matchAll(RE_LEVEL_CARD)) {
    const head = text(match[1])
    if (/^(Legendary|Matchless|Ultimate|Precious)$/i.test(head)) {
      rarity = head
      break
    }
  }

  const family = tags.find((t) => /^(STR|DEX|INT)\s/.test(t)) ?? null
  return {
    name: title === null ? null : text(title[1]),
    family,
    rarity,
    season: ver === null ? null : text(ver[1]),
    slot: slot === null ? null : text(slot[1]),
    level: level === null ? null : Number(level[1]),
    icon,
  }
}

/** The file name a page is cached under. */
function cacheName(slug: string): string {
  return `${slug.replace(/[^A-Za-z0-9_.-]/g, '_')}.html`
}

/** What the crawl has read so far. */
interface State {
  done: Record<string, Page>
}

/** Waits a while, so the wiki is not asked for more than it can answer. */
function wait(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

/** Asks the wiki for a page, and returns its text. */
async function fetchPage(url: string, delay: number): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await wait(delay)
    try {
      const res = await fetch(url, {
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
        process.stderr.write(`could not fetch ${url}: ${String(e)}\n`)
        return null
      }
    }
  }
  return null
}

/** Asks the wiki for the card of one item, and keeps it so it is only asked once. */
async function fetchCard(id: number, cache: string, delay: number): Promise<string | null> {
  const file = join(cache, 'cards', `${id}.html`)
  try {
    return await readFile(file, 'utf8')
  } catch {
    /* not fetched yet */
  }
  const html = await fetchPage(`${SITE}/${LANG}/hover?s=ItemBase%2F${id}`, delay)
  if (html === null) return null
  await mkdir(join(cache, 'cards'), { recursive: true })
  await writeFile(file, html)
  return html
}

/** The list of the wiki's pages the site hands out, and what kind of page each one is. */
async function wikiPages(): Promise<Map<string, string>> {
  const pages = new Map<string, string>()
  try {
    const res = await fetch(AUTOCOMPLETE, {
      headers: { 'User-Agent': 'tli-tracker-item-names/1.0 (+item name lookup)' },
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) return pages
    const list = (await res.json()) as { value?: string; desc?: string }[]
    for (const entry of list) {
      if (typeof entry.value !== 'string') continue
      pages.set(entry.value, typeof entry.desc === 'string' ? entry.desc : '')
    }
  } catch {
    /* the crawl still starts from the seeds */
  }
  return pages
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const arg = (name: string): string | null =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null
  const has = (name: string): boolean => argv.includes(`--${name}`)

  const pkg = join(import.meta.dir, '..')
  const cache = arg('cache') ?? join(pkg, '.cache', 'tlidb')
  const out = arg('out') ?? join(pkg, 'data', 'tlidb-items.json')
  const delay = Number(arg('delay') ?? 1000)
  const max = Number(arg('max') ?? 0)
  const refresh = has('refresh')
  const crawl = !has('no-crawl')
  const idsFile = arg('ids')

  await mkdir(cache, { recursive: true })
  await mkdir(join(out, '..'), { recursive: true })

  const statePath = join(cache, 'index.json')
  let state: State = { done: {} }
  try {
    state = JSON.parse(await readFile(statePath, 'utf8')) as State
  } catch {
    /* a first run */
  }

  const listed = await wikiPages()

  // the ids the player has seen in the logs, and the names the wiki gives them
  const wanted = new Set<number>()
  if (idsFile !== null) {
    const lines = (await readFile(idsFile, 'utf8')).split('\n')
    for (const line of lines) {
      const id = line.trim()
      if (/^\d+$/.test(id)) wanted.add(Number(id))
    }
    process.stderr.write(`looking up ${wanted.size} ids\n`)
  }

  let fetched = 0
  const queue: string[] = []
  const queued = new Set<string>()
  const enqueue = (slug: string): void => {
    if (queued.has(slug)) return
    queued.add(slug)
    queue.push(slug)
  }
  for (const slug of SEEDS) {
    if (!crawl) break
    enqueue(slug)
  }
  for (const [slug, kind] of listed) {
    if (!crawl) break
    if (NOT_ITEMS[kind] === true) continue
    enqueue(slug)
  }

  while (queue.length > 0) {
    if (max > 0 && fetched >= max) break
    const slug = queue.shift() as string
    if (state.done[slug] !== undefined) continue

    let html: string | null = null
    const cached = join(cache, cacheName(slug))
    if (!refresh) {
      try {
        html = await readFile(cached, 'utf8')
      } catch {
        html = null
      }
    }
    if (html === null) {
      html = await fetchPage(`${SITE}/${LANG}/${slug}`, delay)
      if (html === null) {
        state.done[slug] = {
          ids: [],
          name: null,
          family: null,
          rarity: null,
          season: null,
          slot: null,
          level: null,
          icon: null,
          links: [],
        }
        continue
      }
      await writeFile(cached, html)
    }
    const page = parsePage(html)
    state.done[slug] = page
    for (const id of page.ids) wanted.add(id)
    for (const link of page.links) {
      const kind = listed.get(link)
      if (kind === undefined) continue
      if (NOT_ITEMS[kind] === true) continue
      enqueue(link)
    }
    fetched++

    if (fetched % 50 === 0) {
      await writeFile(statePath, JSON.stringify(state))
      process.stderr.write(`fetched ${fetched}, ${queue.length} left, ${Object.keys(state.done).length} done\n`)
    }
  }

  await writeFile(statePath, JSON.stringify(state))

  // the names the pages give the ids, for the ids no card has a name for
  const fromPages: Record<number, { name: string; slug: string; page: Page }> = {}
  for (const [slug, page] of Object.entries(state.done)) {
    if (page.name === null || page.name === '') continue
    for (const id of page.ids ?? []) {
      if (fromPages[id] !== undefined) continue
      fromPages[id] = { name: page.name, slug, page }
    }
  }

  const items: Record<string, TlidbEntry> = {}
  const ids = [...wanted].sort((a, b) => a - b)
  for (const id of ids) {
    const card = await fetchCard(id, cache, delay)
    if (card !== null) {
      const parsed = parseCard(card)
      if (parsed.name !== null && parsed.name !== '') {
        items[String(id)] = {
          name: parsed.name,
          ...(parsed.family !== null ? { family: parsed.family } : {}),
          ...(parsed.rarity !== null ? { rarity: parsed.rarity } : {}),
          ...(parsed.season !== null ? { season: parsed.season } : {}),
          ...(parsed.slot !== null ? { slot: parsed.slot } : {}),
          ...(parsed.level !== null ? { level: parsed.level } : {}),
          ...(parsed.icon !== null ? { icon: parsed.icon } : {}),
          from: 'card',
        }
        continue
      }
    }
    const page = fromPages[id]
    if (page === undefined) continue
    items[String(id)] = {
      name: page.name,
      slug: page.slug,
      ...(page.page.family !== null ? { family: page.page.family } : {}),
      ...(page.page.rarity !== null ? { rarity: page.page.rarity } : {}),
      ...(page.page.season !== null ? { season: page.page.season } : {}),
      ...(page.page.slot !== null ? { slot: page.page.slot } : {}),
      ...(page.page.level !== null ? { level: page.page.level } : {}),
      ...(page.page.icon !== null ? { icon: page.page.icon } : {}),
      from: 'page',
    }
  }

  const table: TlidbTable = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: `${SITE} (the Torchlight: Infinite wiki; a fan-made site, not affiliated with XD)`,
      count: Object.keys(items).length,
    },
    items,
  }
  await writeFile(out, `${JSON.stringify(table, null, 1)}\n`)
  process.stderr.write(
    `wrote ${table.meta.count} items from ${Object.keys(state.done).length} pages to ${out}\n`,
  )
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    process.stderr.write(`${String(e)}\n`)
    process.exit(1)
  })
}
