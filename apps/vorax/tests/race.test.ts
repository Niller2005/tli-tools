import { describe, expect, test } from 'bun:test'
import { race } from '@/strategy/race'
import type { Tally } from '@/strategy/bot'

/** A slice function where option i scores `means[i]` a future; records what it was asked. */
function slicer(means: number[]) {
  const calls: { alive: number[]; from: number; to: number }[] = []
  const slice = (alive: number[], from: number, to: number): Tally[] => {
    calls.push({ alive: [...alive], from, to })
    return alive.map((i) => ({ goal: means[i] * (to - from), reached: i === 0 ? to - from : 0, n: to - from }))
  }
  return { slice, calls }
}

describe('race', () => {
  test('equal options are all played every slice, to the maximum', () => {
    const { slice, calls } = slicer([5, 5, 5])
    const t = race(3, slice, { step: 10, max: 40, margin: 0.05 })
    expect(calls.map((c) => [c.from, c.to])).toEqual([[0, 10], [10, 20], [20, 30], [30, 40]])
    expect(t.map((x) => x.n)).toEqual([40, 40, 40])
  })

  test('the last slice is cut to the maximum', () => {
    const { slice, calls } = slicer([1, 1])
    const t = race(2, slice, { step: 10, max: 25, margin: 0.1 })
    expect(calls.map((c) => [c.from, c.to])).toEqual([[0, 10], [10, 20], [20, 25]])
    expect(t.map((x) => x.n)).toEqual([25, 25])
  })

  test('an option clearly behind is dropped after the first slice and played no more', () => {
    const { slice, calls } = slicer([100, 50, 100])
    const t = race(3, slice, { step: 10, max: 30, margin: 0.25 })
    expect(calls[0].alive).toEqual([0, 1, 2])
    expect(calls[1].alive).toEqual([0, 2])
    expect(calls[2].alive).toEqual([0, 2])
    expect(t.map((x) => x.n)).toEqual([30, 10, 30])
  })

  test('an option exactly at the margin stays; one just under it goes', () => {
    const stays = slicer([100, 75])
    expect(race(2, stays.slice, { step: 5, max: 10, margin: 0.25 }).map((x) => x.n)).toEqual([10, 10])
    const goes = slicer([100, 74])
    expect(race(2, goes.slice, { step: 5, max: 10, margin: 0.25 }).map((x) => x.n)).toEqual([10, 5])
  })

  test('the racing stops when one option is left, before the maximum', () => {
    const { slice, calls } = slicer([100, 1])
    const t = race(2, slice, { step: 10, max: 100, margin: 0.1 })
    expect(calls).toHaveLength(2)
    expect(t.map((x) => x.n)).toEqual([20, 10])
  })

  test('one option alone is played one slice and left', () => {
    const { slice, calls } = slicer([3])
    const t = race(1, slice, { step: 10, max: 100, margin: 0.1 })
    expect(calls).toHaveLength(1)
    expect(t[0].n).toBe(10)
  })

  test('the totals add up what each slice gave, goal and reached alike', () => {
    const { slice } = slicer([4, 4])
    const t = race(2, slice, { step: 10, max: 30, margin: 0.1 })
    expect(t[0]).toEqual({ goal: 120, reached: 30, n: 30 })
    expect(t[1]).toEqual({ goal: 120, reached: 0, n: 30 })
  })

  test('a maximum of zero plays nothing', () => {
    const { slice, calls } = slicer([1, 2])
    const t = race(2, slice, { step: 10, max: 0, margin: 0.1 })
    expect(calls).toEqual([])
    expect(t).toEqual([{ goal: 0, reached: 0, n: 0 }, { goal: 0, reached: 0, n: 0 }])
  })

  test('no options give no totals and no slices', () => {
    const { slice, calls } = slicer([])
    expect(race(0, slice, { step: 10, max: 30, margin: 0.1 })).toEqual([])
    expect(calls).toEqual([])
  })

  test('a leader that scores nothing keeps every option that also scores nothing', () => {
    const { slice } = slicer([0, 0])
    expect(race(2, slice, { step: 5, max: 10, margin: 0.1 }).map((x) => x.n)).toEqual([10, 10])
  })

  test('a dropped option stays dropped even if it would have caught up', () => {
    // option 1 trails in the first slice and would lead later: it is not played again
    const calls: number[][] = []
    const slice = (alive: number[], from: number): Tally[] => {
      calls.push([...alive])
      return alive.map((i) => ({ goal: (i === 1 ? (from === 0 ? 10 : 1000) : 100) * 5, reached: 0, n: 5 }))
    }
    const t = race(2, slice, { step: 5, max: 15, margin: 0.1 })
    expect(calls).toEqual([[0, 1], [0]])
    expect(t[1].n).toBe(5)
  })
})
