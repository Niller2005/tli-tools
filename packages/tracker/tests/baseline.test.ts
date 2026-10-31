import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BASELINE_MAX_AGE_MS,
  baselineAge,
  baselineIsStale,
  parsePrices,
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
  test('are read out of what the API answered', () => {
    const prices = parsePrices(COMMUNITY_PRICES)
    expect(prices.length).toBe(5)
    expect(prices[1]).toEqual([100200, 0.0006])
    expect(prices[4]).toEqual([110306, 1])
  })

  test('the ones that are not prices are left out', () => {
    const prices = parsePrices({
      items: [
        { id: 100200, price: 0.5 },
        { id: 200, price: 0 },
        { id: 300, price: null },
        { id: 400 },
        { price: 5 },
        'nonsense',
        null,
      ],
    })
    expect(prices).toEqual([[100200, 0.5]])
  })

  test('an answer that is not a list of prices is nothing', () => {
    expect(parsePrices({ error: 'not found' })).toEqual([])
    expect(parsePrices({ items: 'nope' })).toEqual([])
    expect(parsePrices(null)).toEqual([])
    expect(parsePrices('nope')).toEqual([])
  })
})

describe('the prices on disk', () => {
  const data: BaselineData = {
    fetchedAt: 1_700_000_000_000,
    source: 'https://tlicompanion.com',
    prices: [
      [100200, 0.00040004],
      [110306, 2],
    ],
  }

  test('are read back', async () => {
    const path = await folder()
    await writeBaseline(data, path)
    const read = await readBaseline(path)
    expect(read?.fetchedAt).toBe(data.fetchedAt)
    expect(read?.source).toBe('https://tlicompanion.com')
    expect(read?.prices).toEqual(data.prices)
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
      source: 'https://tlicompanion.com',
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
      source: 'https://tlicompanion.com',
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
