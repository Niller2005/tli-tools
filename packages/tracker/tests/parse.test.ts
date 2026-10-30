import { describe, expect, test } from 'bun:test'
import { logTime, parseLine, zoneOf } from '../src/parse'
import {
  BACK_TO_HIDEOUT,
  BAG_SNAPSHOT,
  ENTER_MAP,
  ENGINE_NOISE,
  EXCHANGE_SEARCH,
  IN_HIDEOUT,
  PICK_GEAR,
  PICK_MATERIAL,
  SELL,
  SORT_BAG,
} from './fixtures'

describe('the time of a line', () => {
  test('is read from the front of the line', () => {
    expect(logTime(IN_HIDEOUT[0] as string)).toBe(Date.UTC(2026, 9, 29, 21, 9, 59, 736))
  })

  test('is nothing when the line has no time', () => {
    expect(logTime('LogDataTable: Warning: nothing')).toBeNull()
  })
})

describe('the level a line says', () => {
  test('is read out of the line', () => {
    const fact = parseLine(ENTER_MAP[0] as string)
    expect(fact).toEqual({ t: 'level', uid: 1071008, ltype: 3, lid: 4708, at: Date.UTC(2026, 9, 29, 21, 28, 6, 33) })
  })

  test('the hideout is a level of its own', () => {
    const fact = parseLine(BACK_TO_HIDEOUT[0] as string)
    expect(fact?.t).toBe('level')
    if (fact?.t !== 'level') throw new Error('not a level')
    expect(fact.ltype).toBe(0)
    expect(fact.lid).toBe(110)
  })
})

describe('the map a line says', () => {
  test('is read out of the level path', () => {
    const fact = parseLine(ENTER_MAP[1] as string)
    expect(fact?.t).toBe('path')
    if (fact?.t !== 'path') throw new Error('not a path')
    expect(zoneOf(fact.path)).toBe('SD_GeBuLinShanZhai')
  })

  test('is read out of the scene that was entered', () => {
    const fact = parseLine(ENTER_MAP[2] as string)
    expect(fact?.t).toBe('path')
    if (fact?.t !== 'path') throw new Error('not a path')
    expect(zoneOf(fact.path)).toBe('SD_GeBuLinShanZhai')
  })
})

describe('the bag a line says', () => {
  test('a slot of the snapshot is read', () => {
    const fact = parseLine(BAG_SNAPSHOT[1] as string)
    expect(fact).toEqual({
      t: 'bagSet',
      page: 102,
      slot: 1,
      item: 100200,
      num: 3858,
      uuid: null,
      op: 'init',
      at: Date.UTC(2026, 9, 29, 21, 10, 1, 860),
    })
  })

  test('a pick-up is read, with the stack it belongs to', () => {
    const fact = parseLine(PICK_MATERIAL[1] as string)
    expect(fact).toEqual({
      t: 'bagSet',
      page: 102,
      slot: 1,
      item: 100200,
      num: 4329,
      uuid: 'ff207782-c98d-11f1-8d7e-000000000033',
      op: 'update',
      at: Date.UTC(2026, 9, 29, 22, 40, 5, 80),
    })
  })

  test('new gear is read', () => {
    const fact = parseLine(PICK_GEAR[1] as string)
    expect(fact?.t).toBe('bagSet')
    if (fact?.t !== 'bagSet') throw new Error('not a bag set')
    expect(fact.item).toBe(4654)
    expect(fact.num).toBe(1)
    expect(fact.page).toBe(100)
  })

  test('an item that is taken away is read', () => {
    const fact = parseLine(SELL[1] as string)
    expect(fact).toEqual({
      t: 'bagClear',
      page: 100,
      slot: 4,
      item: 4109,
      uuid: '14f5076b-ce83-11f1-bfac-000000000020',
      at: Date.UTC(2026, 9, 29, 21, 19, 26, 761),
    })
  })

  test('the bag being sorted empties the page', () => {
    const fact = parseLine(SORT_BAG[1] as string)
    expect(fact).toEqual({ t: 'pageReset', page: 101, at: Date.UTC(2026, 9, 29, 21, 36, 29, 595) })
  })
})

describe('the blocks of the log', () => {
  test('the start and the end of a block are read', () => {
    expect(parseLine(PICK_MATERIAL[0] as string)).toEqual({
      t: 'proto',
      name: 'PickItems',
      start: true,
      at: Date.UTC(2026, 9, 29, 22, 40, 5, 80),
    })
    expect(parseLine(PICK_MATERIAL[3] as string)).toEqual({
      t: 'proto',
      name: 'PickItems',
      start: false,
      at: Date.UTC(2026, 9, 29, 22, 40, 5, 80),
    })
  })
})

describe('the lines that are not ours', () => {
  test('the lines of the engine are left alone', () => {
    expect(parseLine(ENGINE_NOISE[0] as string)).toBeNull()
  })

  test('the lines of the exchange are not bag lines', () => {
    for (const line of EXCHANGE_SEARCH) expect(parseLine(line)).toBeNull()
  })
})
