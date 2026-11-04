// Finds the page of the Torchlight: Infinite wiki (https://tlidb.com, a fan-made site) that is
// about an item, so the player can see what the item looks like and what it does.
//
// The wiki names a page after the item, with the spaces made into underscores and the quotes,
// colons and brackets left out ("Last Man's Cudgel" is `Last_Mans_Cudgel`). The names the tracker
// has are not always the wiki's: the table is older than the wiki, and the gear the player picks
// up is named after the attribute it rolls ("Magic Shoes (Int)"), while the wiki has a page for the
// base type ("All Magic Shoes"). So the name the tracker has is tried first, and when the wiki has
// no such page, the wiki is asked who it knows the id as; the card it hands out for an id has the
// name of the page.

/** Where the wiki lives. */
export const WIKI_SITE = 'https://tlidb.com'

/** The English part of the wiki. */
export const WIKI_LANG = 'en'

/** How long a request may take. */
const TIMEOUT_MS = 10_000

const USER_AGENT = 'tli-tools tracker'

/** What the wiki is asked with; `fetch` is the one that is used, the tests give their own. */
export type WikiFetch = (url: string, init?: RequestInit) => Promise<Response>

/** The name the tracker has for an item, without what it adds to tell items apart. */
export function plainName(name: string): string {
  return name
    .replace(/ \((?:lv \d+|#\d+)\)$/, '')
    .replace(/ \((?:Str|Dex|Int)\)$/, '')
    .trim()
}

/** The address part of the page the wiki has about an item of this name. */
export function wikiSlug(name: string): string {
  return plainName(name)
    .replace(/['’:,()!?"]/g, '')
    .replace(/\s+/g, '_')
}

/** The address of a page. */
export function wikiUrl(slug: string): string {
  return `${WIKI_SITE}/${WIKI_LANG}/${encodeURIComponent(slug)}`
}

/** The address of the wiki's search for a name, for when no page can be found. */
export function wikiSearchUrl(name: string): string {
  return `${WIKI_SITE}/${WIKI_LANG}/search?q=${encodeURIComponent(plainName(name))}`
}

/** The address of the card the wiki hands out for an id. */
function cardUrl(item: number): string {
  return `${WIKI_SITE}/${WIKI_LANG}/hover?s=ItemBase%2F${item}`
}

/** The name on a card the wiki handed out; null when the card has none (the wiki does not know the id). */
export function cardName(html: string): string | null {
  const title = /class="card-title[^"]*"[^>]*>([^<]*)</.exec(html)
  if (title === null) return null
  const name = title[1]
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim()
  return name === '' ? null : name
}

/** What was found for an item. */
export interface WikiTarget {
  /** the address to open */
  url: string
  /** whether it is the page of the item; false when it is the wiki's search for the name */
  page: boolean
}

async function ask(fetcher: WikiFetch, url: string, method: 'GET' | 'HEAD'): Promise<Response> {
  return fetcher(url, {
    method,
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
}

/** Whether the wiki has a page at this address. Throws when the wiki cannot be reached. */
async function pageExists(fetcher: WikiFetch, url: string): Promise<boolean> {
  const res = await ask(fetcher, url, 'HEAD')
  if (res.status === 404) return false
  if (!res.ok) throw new Error(`the wiki answered ${res.status}`)
  return true
}

/**
 * Finds the page about an item.
 *
 * `name` is what the tracker calls the item, or null when it does not know. Throws when the wiki
 * cannot be reached; resolves to null when neither the name nor the id leads anywhere.
 */
export async function findWikiPage(
  item: number,
  name: string | null,
  fetcher: WikiFetch = fetch,
): Promise<WikiTarget | null> {
  if (name !== null) {
    const url = wikiUrl(wikiSlug(name))
    if (await pageExists(fetcher, url)) return { url, page: true }
  }

  const res = await ask(fetcher, cardUrl(item), 'GET')
  if (res.ok) {
    const known = cardName(await res.text())
    if (known !== null) {
      const url = wikiUrl(wikiSlug(known))
      if (await pageExists(fetcher, url)) return { url, page: true }
    }
  } else if (res.status !== 404) {
    throw new Error(`the wiki answered ${res.status}`)
  }

  if (name === null) return null
  return { url: wikiSearchUrl(name), page: false }
}
