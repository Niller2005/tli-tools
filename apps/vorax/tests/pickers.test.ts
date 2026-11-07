import { describe, expect, test } from 'bun:test'
import type { GameState } from '@/engine/types'
import { DEFAULT_TAU, tablePicker, tableValue, type Tables } from '@/strategy/pickers'

const tables: Tables = {
  threshold: 0,
  basic: { 1: 0.9, 2: 0.3, 3: 0.5 },
  pair: { '1,2': 0.8, '1,3': 0.2, '1,4': 0.7 },
  trio: { '1,2,3': 0.9, '1,2,4': 0.1, '1,2,5': 0.5 },
}

/** The parts of a game the pickers read: what is equipped, what is offered, and the refreshes left. */
function offer(have: number[], hand: number[], refreshes: number): GameState {
  return {
    phase: 'instrumentSelect',
    instruments: have.map((id) => ({ id, acquiredRound: 1 })),
    hand: hand.map((id) => ({ kind: 'instrument', id })),
    instrumentRefreshes: refreshes,
    potionRefreshes: 0,
  } as unknown as GameState
}

describe('tableValue', () => {
  test('with nothing equipped, the basic table is read', () => {
    expect(tableValue(tables, [], 1)).toBe(0.9)
    expect(tableValue(tables, [], 99)).toBeUndefined()
  })

  test('with one equipped, the pair table is read, in the order they were equipped', () => {
    expect(tableValue(tables, [1], 2)).toBe(0.8)
    expect(tableValue(tables, [2], 1)).toBeUndefined()
    expect(tableValue(tables, [1], 99)).toBeUndefined()
  })

  test('with two equipped, the trio table is read', () => {
    expect(tableValue(tables, [1, 2], 3)).toBe(0.9)
    expect(tableValue(tables, [2, 1], 3)).toBeUndefined()
  })
})

describe('tablePicker', () => {
  const pick = tablePicker(tables)

  test('takes the offer worth most', () => {
    expect(pick(offer([], [2, 1, 3], 0), 0)).toBe(1)
    expect(pick(offer([1], [3, 2, 4], 0), 0)).toBe(1)
    expect(pick(offer([1, 2], [5, 3, 4], 0), 0)).toBe(1)
  })

  test('refreshes when the best offer is under the threshold and a refresh is left', () => {
    expect(DEFAULT_TAU[0]).toBeGreaterThan(0.5)
    expect(pick(offer([], [2, 3, 2], 1), 0)).toBe('refresh')
    expect(pick(offer([1], [3, 3, 3], 2), 0)).toBe('refresh')
  })

  test('takes the best of a poor offer when there is no refresh left', () => {
    expect(pick(offer([], [2, 3, 2], 0), 0)).toBe(1)
  })

  test('an offer exactly at the threshold is taken, not refreshed', () => {
    const at = tablePicker({ ...tables, basic: { 1: 0.6, 2: 0.2, 3: 0.2 } }, [0.6, 0.6, 0.6])
    expect(at(offer([], [1, 2, 3], 2), 0)).toBe(0)
  })

  test('each pick stage has its own threshold, and a third one uses the last', () => {
    const t = tablePicker(tables, [0.95, 0.1, 0.99])
    // basic 0.9 < 0.95: refresh; pair 0.8 >= 0.1: take
    expect(t(offer([], [1, 2, 3], 1), 0)).toBe('refresh')
    expect(t(offer([1], [2, 3, 4], 1), 0)).toBe(0)
    // trio 0.9 < 0.99: refresh
    expect(t(offer([1, 2], [3, 4, 5], 1), 0)).toBe('refresh')
    // a missing threshold counts as no threshold
    const short = tablePicker(tables, [0.95])
    expect(short(offer([1], [3, 3, 3], 1), 0)).toBe(0)
  })

  test('ties go to the first of the best', () => {
    expect(pick(offer([], [1, 1, 2], 0), 0)).toBe(0)
  })
})
