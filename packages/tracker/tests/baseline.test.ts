import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BASELINE_MAX_AGE_MS,
  baselineAge,
  baselineFits,
  baselineIsStale,
  fetchBaseline,
  parsePrices,
  parseSeasons,
  pickSeason,
  readBaseline,
  writeBaseline,
  type BaselineData,
} from '../src/baseline'
import { PriceStore } from '../src/prices'
import { COMMUNITY_PRICES } from './fixtures'

const folders: string[] = []

/** A folder of its own for the file of one test. */
async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tli-tracker-baseline-'))
  folders.push(dir)
  return join(dir, 'baseline.json')
}

afterEach(async () => {
  while (folders.length > 0) {
    const dir = folders.pop()
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  }
})

describe('the prices of the community', () => {
  test('are read out of what the database answered', () => {
    const prices = parsePrices(COMMUNITY_PRICES)
    expect(prices.length).toBe(4)
    expect(prices[3]).toEqual([100200, 0.000350035])
    expect(prices[1]).toEqual([5030, 120000])
  })

  test('the ones that are not prices are left out', () => {
    const prices = parsePrices([
      { config_base_id: 100200, price_fe_median: 0.5 },
      { config_base_id: 200, price_fe_median: 0 },
      { config_base_id: 300, price_fe_median: null },
      { config_base_id: 400 },
      { price_fe_median: 5 },
      'nonsense',
      null,
    ])
    expect(prices).toEqual([[100200, 0.5]])
  })

  test('an answer that is not a list of rows is nothing', () => {
    expect(parsePrices({ message: 'not found' })).toEqual([])
    expect(parsePrices(null)).toEqual([])
    expect(parsePrices('nope')).toEqual([])
  })
})

describe('the season the prices are for', () => {
  // as the database counts them: the seasons of 1601, 1501 and 1401 are the ones everybody plays
  const answer = [
    { season_id: 1631, item_count: 119, latest_update: '2026-11-14T12:50:00Z' },
    { season_id: 1601, item_count: 2368, latest_update: '2026-11-14T12:50:00Z' },
    { season_id: 1531, item_count: 1063, latest_update: '2026-10-19T22:15:00Z' },
    { season_id: 1501, item_count: 2210, latest_update: '2026-11-14T12:50:00Z' },
    { season_id: 1, item_count: 779, latest_update: '2026-11-14T12:50:00Z' },
    { season_id: 0, item_count: 1767, latest_update: '2026-11-14T12:50:00Z' },
  ]

  test('is the newest ordinary one with enough prices', () => {
    expect(pickSeason(parseSeasons(answer))).toBe(1601)
  })

  test('is not a season that has just begun, nor a variant that grew', () => {
    const seasons = parseSeasons([
      { season_id: 1701, item_count: 12 },
      { season_id: 1631, item_count: 900 },
      { season_id: 1601, item_count: 2368 },
    ])
    expect(pickSeason(seasons)).toBe(1601)
  })

  test('is none when no season has enough', () => {
    expect(pickSeason(parseSeasons([{ season_id: 1701, item_count: 12 }]))).toBeNull()
    expect(pickSeason(parseSeasons('nope'))).toBeNull()
  })

  test('the prices on disk fit the season of the player, or any when the log has not said', () => {
    const data: BaselineData = { fetchedAt: 1, source: 'x', season: 1601, prices: [] }
    expect(baselineFits(data, 1601)).toBe(true)
    expect(baselineFits(data, 1701)).toBe(false)
    expect(baselineFits(data, null)).toBe(true)
    expect(baselineFits({ ...data, season: null }, 1601)).toBe(false)
    expect(baselineFits(null, null)).toBe(false)
  })
})

describe('fetching the prices', () => {
  /** Answers the way the database does, and writes down what it was asked. */
  function database(rows: unknown[][], asked: string[]): typeof fetch {
    let page = 0
    return (async (url: string) => {
      asked.push(url)
      if (url.endsWith('/rpc/get_available_seasons')) {
        return new Response(JSON.stringify([{ season_id: 1601, item_count: 2368 }]))
      }
      return new Response(JSON.stringify(rows[page++] ?? []))
    }) as unknown as typeof fetch
  }

  test('asks which seasons there are, and then for the prices of the newest one', async () => {
    const realFetch = globalThis.fetch
    const asked: string[] = []
    globalThis.fetch = database([COMMUNITY_PRICES], asked)
    try {
      const data = await fetchBaseline(5)
      expect(data.season).toBe(1601)
      expect(data.fetchedAt).toBe(5)
      expect(data.prices.length).toBe(4)
      expect(asked[1]).toContain('season_id=eq.1601')
    } finally {
      globalThis.fetch = realFetch
    }
  })

  test('asks for the season it is given, and does not ask which there are', async () => {
    const realFetch = globalThis.fetch
    const asked: string[] = []
    globalThis.fetch = database([COMMUNITY_PRICES], asked)
    try {
      const data = await fetchBaseline(5, 1531)
      expect(data.season).toBe(1531)
      expect(asked.length).toBe(1)
      expect(asked[0]).toContain('season_id=eq.1531')
    } finally {
      globalThis.fetch = realFetch
    }
  })

  test('goes on to the next page while the pages are full', async () => {
    const realFetch = globalThis.fetch
    const asked: string[] = []
    const full = Array.from({ length: 1000 }, (_, i) => ({ config_base_id: i + 1, price_fe_median: 1 }))
    globalThis.fetch = database([full, COMMUNITY_PRICES], asked)
    try {
      const data = await fetchBaseline(5, 1601)
      expect(data.prices.length).toBe(1004)
      expect(asked.length).toBe(2)
      expect(asked[1]).toContain('offset=1000')
    } finally {
      globalThis.fetch = realFetch
    }
  })

  test('an empty answer is an error, not an empty list of prices', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = database([[]], [])
    try {
      await expect(fetchBaseline(5, 1601)).rejects.toThrow('empty')
    } finally {
      globalThis.fetch = realFetch
    }
  })
})

describe('the prices on disk', () => {
  const data: BaselineData = {
    fetchedAt: 1_700_000_000_000,
    source: 'https://github.com/astockman99/TITrack',
    season: 1601,
    prices: [
      [100200, 0.00040004],
      [110306, 2],
    ],
  }

  test('are read back', async () => {
    const path = await folder()
    await writeBaseline(data, path)
    const read = await readBaseline(path)
    expect(read).toEqual(data)
  })

  test('the prices of an older version have no season', async () => {
    const path = await folder()
    await Bun.write(path, JSON.stringify({ fetchedAt: 1, source: 'https://tlicompanion.com', prices: [[1, 2]] }))
    const read = await readBaseline(path)
    expect(read?.season).toBeNull()
    expect(read?.prices).toEqual([[1, 2]])
  })

  test('are nothing when there are none', async () => {
    const path = await folder()
    expect(await readBaseline(path)).toBeNull()
  })

  test('a broken file is nothing', async () => {
    const path = await folder()
    await Bun.write(path, 'not json at all')
    expect(await readBaseline(path)).toBeNull()
  })

  test('a file without prices is nothing', async () => {
    const path = await folder()
    await Bun.write(path, JSON.stringify({ fetchedAt: 1 }))
    expect(await readBaseline(path)).toBeNull()
  })
})

describe('how old the prices are', () => {
  const now = 1_700_000_000_000

  test('the age is the time since they were fetched', () => {
    const data: BaselineData = {
      fetchedAt: now - 60_000,
      source: 'x',
      season: 1601,
      prices: [],
    }
    expect(baselineAge(data, now)).toBe(60_000)
  })

  test('there is no age when there is nothing', () => {
    expect(baselineAge(null, now)).toBeNull()
  })

  test('they are stale after an hour', () => {
    const fresh: BaselineData = {
      fetchedAt: now - BASELINE_MAX_AGE_MS + 1000,
      source: 'x',
      season: 1601,
      prices: [],
    }
    const old: BaselineData = { ...fresh, fetchedAt: now - BASELINE_MAX_AGE_MS - 1000 }
    expect(baselineIsStale(fresh, now)).toBe(false)
    expect(baselineIsStale(old, now)).toBe(true)
    expect(baselineIsStale(null, now)).toBe(true)
  })
})

describe('the prices under the ones the tracker knows', () => {
  test('are used when nothing else is known', () => {
    const prices = new PriceStore()
    prices.setBaseline([[100200, 0.00040004]])
    expect(prices.price(100200)).toBe(0.00040004)
    expect(prices.source(100200)).toBe('baseline')
  })

  test('are beaten by a price the player learned', () => {
    const prices = new PriceStore()
    prices.setBaseline([[100200, 0.00040004]])
    prices.learn(100200, [0.0005], Date.now())
    expect(prices.price(100200)).toBe(0.0005)
    expect(prices.source(100200)).toBe('learned')
  })

  test('are beaten by a price the player set', () => {
    const prices = new PriceStore()
    prices.setBaseline([[100200, 0.00040004]])
    prices.learn(100200, [0.0005], Date.now())
    prices.setOverride(100200, 1)
    expect(prices.price(100200)).toBe(1)
    expect(prices.source(100200)).toBe('set')
  })

  test('are not mixed into what was learned', () => {
    const prices = new PriceStore()
    prices.setBaseline([[100200, 0.00040004]])
    const saved = prices.snapshot()
    expect(saved.learned).toEqual([])
    expect(saved.overrides).toEqual([])
  })

  test('are taken away with the rest when an item is forgotten', () => {
    const prices = new PriceStore()
    prices.setBaseline([[100200, 0.00040004]])
    expect(prices.forget(100200)).toBe(true)
    expect(prices.price(100200)).toBe(0)
    expect(prices.isBaseline(100200)).toBe(false)
  })

  test('are left out when they are not a price', () => {
    const prices = new PriceStore()
    prices.setBaseline([
      [100200, 0.5],
      [300, 0],
      [400, -1],
    ])
    expect(prices.baselineCount).toBe(1)
    expect(prices.baseline(300)).toBeNull()
  })
})
