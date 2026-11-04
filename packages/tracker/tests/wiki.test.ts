import { describe, expect, test } from 'bun:test'
import { cardName, findWikiPage, wikiSearchUrl, wikiSlug, wikiUrl, type WikiFetch } from '../src/wiki'

/** A wiki that has these pages (by slug) and these cards (by id); asked addresses are kept. */
function wiki(pages: string[], cards: Record<number, string>): { fetcher: WikiFetch; asked: string[] } {
  const asked: string[] = []
  const fetcher: WikiFetch = async (url) => {
    asked.push(url)
    const card = /hover\?s=ItemBase%2F(\d+)$/.exec(url)
    if (card !== null) {
      const name = cards[Number(card[1])]
      const html = name === undefined ? '<div class="onHover"></div>' : `<h5 class="card-title" style="x">${name}</h5>`
      return new Response(html)
    }
    const slug = decodeURIComponent(url.split('/').pop() ?? '')
    return new Response('', { status: pages.includes(slug) ? 200 : 404 })
  }
  return { fetcher, asked }
}

describe('the slug of a page', () => {
  test('quotes, colons and brackets go, spaces become underscores', () => {
    expect(wikiSlug("Last Man's Cudgel")).toBe('Last_Mans_Cudgel')
    expect(wikiSlug('Chain Lightning: Web of Lightning (Magnificent)')).toBe(
      'Chain_Lightning_Web_of_Lightning_Magnificent',
    )
    expect(wikiSlug('Desire Core - Creation')).toBe('Desire_Core_-_Creation')
  })

  test('what the table adds to tell items apart is not part of the name', () => {
    expect(wikiSlug("Ranger's Rag (Str)")).toBe('Rangers_Rag')
    expect(wikiSlug("Divine Arbiter's Defense (Str) (lv 62)")).toBe('Divine_Arbiters_Defense')
    expect(wikiSlug("Goddess of Hunting's Divinity (#260001)")).toBe('Goddess_of_Huntings_Divinity')
  })

  test('the address is escaped', () => {
    expect(wikiUrl('Micro_Fate_Mana%')).toBe('https://tlidb.com/en/Micro_Fate_Mana%25')
  })
})

describe('the name on a card', () => {
  test('it is read, with its entities, and an empty card has none', () => {
    expect(cardName('<h5 class="card-title" style="a">Ranger&#x27;s Rag</h5>')).toBe("Ranger's Rag")
    expect(cardName('<div class="onHover"></div>')).toBeNull()
  })
})

describe('finding the page of an item', () => {
  test('the name the tracker has leads to the page when the wiki has one', async () => {
    const { fetcher, asked } = wiki(['Rangers_Rag'], {})
    const found = await findWikiPage(3011, "Ranger's Rag (Str)", fetcher)
    expect(found).toEqual({ url: 'https://tlidb.com/en/Rangers_Rag', page: true })
    expect(asked).toHaveLength(1)
  })

  test('an old name falls back to the name the wiki gives the id', async () => {
    const { fetcher } = wiki(['Swiftness_Dew'], { 7090: 'Swiftness Dew' })
    const found = await findWikiPage(7090, 'Blurry Steps', fetcher)
    expect(found).toEqual({ url: 'https://tlidb.com/en/Swiftness_Dew', page: true })
  })

  test('the gear the tracker names by attribute leads to the base type page', async () => {
    const { fetcher } = wiki(['All_Magic_Shoes'], { 4110: 'All Magic Shoes' })
    const found = await findWikiPage(4110, 'Magic Shoes (Int)', fetcher)
    expect(found?.url).toBe('https://tlidb.com/en/All_Magic_Shoes')
  })

  test('an item with no page falls back to the wiki search; an unnamed one to nothing', async () => {
    const { fetcher } = wiki([], {})
    expect(await findWikiPage(6011, 'Bound Elixir of Oblivion', fetcher)).toEqual({
      url: wikiSearchUrl('Bound Elixir of Oblivion'),
      page: false,
    })
    expect(await findWikiPage(5141, null, fetcher)).toBeNull()
  })

  test('an unnamed item is found by its id alone', async () => {
    const { fetcher } = wiki(['Hardrock_Mallet'], { 1001: 'Hardrock Mallet' })
    const found = await findWikiPage(1001, null, fetcher)
    expect(found?.url).toBe('https://tlidb.com/en/Hardrock_Mallet')
  })

  test('a wiki that cannot answer is an error, not a missing page', async () => {
    const fetcher: WikiFetch = async () => new Response('', { status: 503 })
    await expect(findWikiPage(1, 'Anything', fetcher)).rejects.toThrow('503')
  })
})
