import { describe, expect, test } from 'bun:test'
import { ExchangeParser, FE_ITEM, parseQuote, parseRequest } from '../src/exchange'
import { PriceStore, referencePrice } from '../src/prices'
import { EXCHANGE_SEARCH } from './fixtures'

describe('the exchange', () => {
  test('the prices of a search are read', () => {
    const parser = new ExchangeParser()
    let quote = null
    for (const line of EXCHANGE_SEARCH) {
      const found = parser.feed(line)
      if (found !== null) quote = found
    }
    expect(quote).not.toBeNull()
    expect(quote?.item).toBe(8312)
    expect(quote?.prices).toEqual([5, 5, 6])
  })

  test('the item a search asked for is read', () => {
    const body = EXCHANGE_SEARCH.slice(2, 5).join('\n')
    expect(parseRequest(body)).toBe(8312)
  })

  test('an answer without prices is nothing', () => {
    expect(parseQuote('+errCode\n+itemGoldId [1234]')).toBeNull()
  })

  test('prices in another currency are left out', () => {
    const body = '+prices+1+currency [100200]\n| +unitPrices+1 [5.0]\n+itemGoldId [8312]'
    expect(parseQuote(body)).toBeNull()
  })
})

describe('the price of an item', () => {
  test('is the tenth of the listings', () => {
    const prices = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(referencePrice(prices)).toBe(10)
  })

  test('is the lowest when there is only one listing', () => {
    expect(referencePrice([7])).toBe(7)
  })

  test('is nothing when there are no listings', () => {
    expect(referencePrice([])).toBe(0)
  })

  test('does not care about the order of the listings', () => {
    expect(referencePrice([9, 1, 5, 3])).toBe(1)
  })
})

describe('the prices the tracker knows', () => {
  test('are learned from the exchange', () => {
    const prices = new PriceStore()
    prices.learn(8312, [5, 5, 6, 9], Date.now())
    expect(prices.price(8312)).toBe(5)
    expect(prices.info(8312)?.samples).toBe(1)
  })

  test('the FE is worth one', () => {
    const prices = new PriceStore()
    expect(prices.price(FE_ITEM)).toBe(1)
  })

  test('an item nobody looked up is worth nothing', () => {
    const prices = new PriceStore()
    expect(prices.price(12345)).toBe(0)
  })

  test('a price set by hand wins over what was learned', () => {
    const prices = new PriceStore()
    prices.learn(8312, [5, 5, 6, 9], Date.now())
    prices.setOverride(8312, 12)
    expect(prices.price(8312)).toBe(12)
    expect(prices.isOverride(8312)).toBe(true)
  })

  test('a price set by hand can be taken away', () => {
    const prices = new PriceStore()
    prices.learn(8312, [5, 5, 6, 9], Date.now())
    prices.setOverride(8312, 12)
    prices.setOverride(8312, null)
    expect(prices.price(8312)).toBe(5)
    expect(prices.isOverride(8312)).toBe(false)
  })

  test('the prices can be saved and put back', () => {
    const prices = new PriceStore()
    prices.learn(8312, [5, 5, 6, 9], Date.now())
    prices.setOverride(4711, 3)
    const saved = prices.snapshot()

    const other = new PriceStore()
    other.restore(saved.learned, saved.overrides)
    expect(other.price(8312)).toBe(5)
    expect(other.price(4711)).toBe(3)
  })
})
