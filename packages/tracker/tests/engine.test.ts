import { describe, expect, test } from 'bun:test'
import { STATE_VERSION, Tracker, migrateState } from '../src/engine'
import { ItemNames } from '../src/items'
import { TRADE_TAX, perHour, valueOf } from '../src/valuation'
import {
  BACK_TO_HIDEOUT,
  BAG_SNAPSHOT,
  ENTER_MAP,
  ENTER_PRISON,
  EXCHANGE_SEARCH,
  IN_HIDEOUT,
  MAP_COST,
  PICK_GEAR,
  PICK_IN_PRISON,
  PICK_MATERIAL,
  PICK_SAND_IN_PRISON,
  PRISON_BOARD,
  PRISON_BOARD_CLOSED,
  SELL,
  SORT_BAG,
} from './fixtures'

/** A tracker with the names of the items. */
function tracker(): Tracker {
  return new Tracker({ names: new ItemNames({ 100200: { name: 'Flame Sand' } }) })
}

describe('the tracker', () => {
  test('the bag is what the game says it is', () => {
    const t = tracker()
    t.feed(BAG_SNAPSHOT)
    expect(t.inventory.count(100200)).toBe(3858)
    expect(t.inventory.count(100300)).toBe(90)
  })

  test('a run is made of what was picked up in it', () => {
    const t = tracker()
    t.feed(BAG_SNAPSHOT)
    t.feed(IN_HIDEOUT)
    t.feed(ENTER_MAP)
    t.feed(PICK_MATERIAL)
    t.feed(PICK_GEAR)
    t.feed(BACK_TO_HIDEOUT)
    expect(t.runs).toHaveLength(1)
    const run = t.runs[0]
    expect(run?.loot.get(100200)).toBe(471)
    expect(run?.loot.get(4654)).toBe(1)
    expect(run?.name).toBe('Glacial Abyss - Shadow Outpost')
  })

  test('the cost of a map is kept for the run that follows', () => {
    const t = tracker()
    t.feed(BAG_SNAPSHOT)
    t.feed(IN_HIDEOUT)
    t.feed(MAP_COST)
    t.feed(ENTER_MAP)
    expect(t.currentRun?.cost.get(400006)).toBe(1)
    expect(t.currentRun?.cost.get(5028)).toBe(1)
  })

  test('an item that is sold is not loot', () => {
    const t = tracker()
    t.feed(BAG_SNAPSHOT)
    t.feed(ENTER_MAP)
    t.feed(SELL)
    t.feed(BACK_TO_HIDEOUT)
    expect(t.runs[0]?.loot.size).toBe(0)
  })

  test('sorting the bag is not loot', () => {
    const t = tracker()
    t.feed(BAG_SNAPSHOT)
    t.feed(ENTER_MAP)
    t.feed(SORT_BAG)
    t.feed(BACK_TO_HIDEOUT)
    expect(t.runs[0]?.loot.size).toBe(0)
  })

  test('the FE that is picked up is counted', () => {
    const t = tracker()
    t.feed(BAG_SNAPSHOT)
    t.feed(ENTER_MAP)
    t.feed([
      '[2026.10.29-22.40.05:080][655]TLLua: Display: [Game] ItemChange@ ProtoName=PickItems start',
      '[2026.10.29-22.40.05:080][655]TLLua: Display: [Game] ItemChange@ Update Id=100300_b33727d9-ca7e-11f1-b19f-00000000007a BagNum=95 in PageId=102 SlotId=0',
      '[2026.10.29-22.40.05:080][655]TLLua: Display: [Game] ItemChange@ ProtoName=PickItems end',
    ])
    expect(t.currentRun?.fe).toBe(5)
  })

  test('the prices of the exchange are learned', () => {
    const t = tracker()
    t.feed(EXCHANGE_SEARCH)
    expect(t.prices.price(8312)).toBe(5)
  })

  test('what the player has is worth what the prices say', () => {
    const t = tracker()
    t.feed(BAG_SNAPSHOT)
    t.prices.setOverride(100200, 0.5)
    t.prices.setOverride(100300, 1)
    t.taxed = false
    expect(t.netWorth()).toBeCloseTo(3858 * 0.5 + 90, 5)
  })
})

describe('the Tartarus prison', () => {
  test('what is picked up in the prison goes in the prison run', () => {
    const t = tracker()
    t.feed(PRISON_BOARD)
    t.feed(ENTER_PRISON)
    t.feed(PRISON_BOARD_CLOSED)
    t.feed(PICK_IN_PRISON)
    t.feed(PICK_SAND_IN_PRISON)
    t.feed(BACK_TO_HIDEOUT)
    expect(t.runs).toHaveLength(1)
    const run = t.runs[0]
    expect(run?.kind).toBe('prison')
    expect(run?.name).toBe('Tartarus Prison')
    expect(run?.zone).toBe('ZhongZuiDiYu')
    expect(run?.loot.get(2218)).toBe(1)
    expect(run?.loot.get(100200)).toBe(195)
  })

  test('the visit begins when the board opens', () => {
    const t = tracker()
    t.feed(PRISON_BOARD)
    expect(t.currentRun?.kind).toBe('prison')
    expect(t.currentRun?.name).toBe('Tartarus Prison')
  })

  test('a visit to the board without a challenge is not a run', () => {
    const t = tracker()
    t.feed(PRISON_BOARD)
    t.feed(PRISON_BOARD_CLOSED)
    t.feed(BACK_TO_HIDEOUT)
    expect(t.runs).toHaveLength(0)
    expect(t.currentRun).toBeNull()
  })
})

describe('the tracker that is saved and put back', () => {
  test('keeps the runs, the bag and the prices', () => {
    const t = tracker()
    t.feed(BAG_SNAPSHOT)
    t.feed(IN_HIDEOUT)
    t.feed(ENTER_MAP)
    t.feed(PICK_MATERIAL)
    t.feed(BACK_TO_HIDEOUT)
    t.feed(EXCHANGE_SEARCH)
    const saved = t.snapshot()

    const other = tracker()
    other.restore(saved)
    expect(other.runs).toHaveLength(1)
    expect(other.runs[0]?.loot.get(100200)).toBe(471)
    expect(other.inventory.count(100200)).toBe(4329)
    expect(other.prices.price(8312)).toBe(5)
  })

  test('the run that was going on is still going on', () => {
    const t = tracker()
    t.feed(IN_HIDEOUT)
    t.feed(ENTER_MAP)
    t.feed(PICK_GEAR)
    const saved = t.snapshot()

    const other = tracker()
    other.restore(saved)
    expect(other.currentRun?.loot.get(4654)).toBe(1)
  })

  test('the settings are kept', () => {
    const t = tracker()
    t.taxed = false
    t.mapCosts = true
    const saved = t.snapshot()
    const other = tracker()
    other.restore(saved)
    expect(other.taxed).toBe(false)
    expect(other.mapCosts).toBe(true)
  })

  test('the kind of a run is kept', () => {
    const t = tracker()
    t.feed(PRISON_BOARD)
    t.feed(ENTER_PRISON)
    const saved = t.snapshot()
    expect(saved.current?.kind).toBe('prison')

    const other = tracker()
    other.restore(saved)
    expect(other.currentRun?.kind).toBe('prison')
    expect(other.currentRun?.name).toBe('Tartarus Prison')
  })
})

describe('the state of the first version', () => {
  test('the runs of it are all map runs', () => {
    const t = tracker()
    t.feed(ENTER_MAP)
    t.feed(PICK_GEAR)
    t.feed(BACK_TO_HIDEOUT)
    const saved = t.snapshot()
    const old = { ...saved, version: 1, runs: saved.runs.map(({ kind: _kind, ...run }) => run) }
    const migrated = migrateState(old)
    expect(migrated?.version).toBe(STATE_VERSION)
    expect(migrated?.runs[0]?.kind).toBe('map')
  })

  test('a state of an unknown version is not used', () => {
    const t = tracker()
    const saved = t.snapshot()
    expect(migrateState({ ...saved, version: 99 })).toBeNull()
  })

  test('the tracker puts an old state back', () => {
    const t = tracker()
    t.feed(ENTER_MAP)
    t.feed(PICK_GEAR)
    const saved = t.snapshot()
    const old = {
      ...saved,
      version: 1,
      current: saved.current === null ? null : { ...saved.current, kind: undefined },
    }

    const other = tracker()
    other.restore(old)
    expect(other.currentRun?.kind).toBe('map')
    expect(other.currentRun?.loot.get(4654)).toBe(1)
  })
})

describe('what a pile of loot is worth', () => {
  const price = (item: number): number => (item === 100300 ? 1 : 10)

  test('is the sum of the items', () => {
    const worth = valueOf(
      [
        [100200, 2],
        [100300, 5],
      ],
      price,
      false,
    )
    expect(worth.gross).toBe(25)
    expect(worth.fe).toBe(5)
    expect(worth.tax).toBe(0)
  })

  test('the tax is on everything but the FE', () => {
    const worth = valueOf(
      [
        [100200, 2],
        [100300, 5],
      ],
      price,
      true,
    )
    expect(worth.gross).toBe(25)
    expect(worth.tax).toBeCloseTo(20 * TRADE_TAX, 10)
    expect(worth.net).toBeCloseTo(25 - 20 * TRADE_TAX, 10)
  })

  test('an amount of FE in an hour', () => {
    expect(perHour(360, 3_600_000)).toBe(360)
    expect(perHour(10, 0)).toBe(0)
  })
})
