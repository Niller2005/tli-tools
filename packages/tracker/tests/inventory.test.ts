import { describe, expect, test } from 'bun:test'
import { Inventory } from '../src/inventory'

describe('the bag', () => {
  test('a slot that gets something is a gain', () => {
    const bag = new Inventory()
    const deltas = bag.set(102, 1, 100200, 3858, null, 'init')
    expect(deltas).toEqual([{ item: 100200, delta: 3858 }])
    expect(bag.count(100200)).toBe(3858)
  })

  test('a stack that grows is only the difference', () => {
    const bag = new Inventory()
    bag.set(102, 1, 100200, 3858, 'stack-1', 'update')
    const deltas = bag.set(102, 1, 100200, 3860, 'stack-1', 'update')
    expect(deltas).toEqual([{ item: 100200, delta: 2 }])
    expect(bag.count(100200)).toBe(3860)
  })

  test('the same line twice does not count twice', () => {
    const bag = new Inventory()
    bag.set(102, 1, 100200, 3858, 'stack-1', 'update')
    bag.set(102, 1, 100200, 3858, 'stack-1', 'update')
    expect(bag.count(100200)).toBe(3858)
  })

  test('gear that lands in a slot is a gain of one', () => {
    const bag = new Inventory()
    const deltas = bag.set(100, 15, 4654, 1, 'gear-1', 'add')
    expect(deltas).toEqual([{ item: 4654, delta: 1 }])
    expect(bag.count(4654)).toBe(1)
  })

  test('a stack that moves from one slot to another is not a gain', () => {
    const bag = new Inventory()
    bag.set(102, 1, 100200, 3858, 'stack-1', 'update')
    const deltas = bag.set(1, 4, 100200, 3858, 'stack-1', 'update')
    expect(deltas).toEqual([])
    expect(bag.count(100200)).toBe(3858)
  })

  test('a stack that moves and grows is only the growth', () => {
    const bag = new Inventory()
    bag.set(102, 1, 100200, 3858, 'stack-1', 'update')
    const deltas = bag.set(1, 4, 100200, 3860, 'stack-1', 'update')
    expect(deltas).toEqual([{ item: 100200, delta: 2 }])
    expect(bag.count(100200)).toBe(3860)
  })

  test('an item that is taken away is a loss', () => {
    const bag = new Inventory()
    bag.set(100, 4, 4109, 1, 'gear-1', 'add')
    const deltas = bag.clear(100, 4, 'gear-1')
    expect(deltas).toEqual([{ item: 4109, delta: -1 }])
    expect(bag.count(4109)).toBe(0)
  })

  test('taking an item away twice is only once', () => {
    const bag = new Inventory()
    bag.set(100, 4, 4109, 1, 'gear-1', 'add')
    bag.clear(100, 4, 'gear-1')
    expect(bag.clear(100, 4, 'gear-1')).toEqual([])
  })

  test('a slot that is emptied is a loss', () => {
    const bag = new Inventory()
    bag.set(100, 4, 4109, 1, null, 'init')
    expect(bag.clear(100, 4, null)).toEqual([{ item: 4109, delta: -1 }])
  })

  test('the bag being sorted takes everything out and puts it back', () => {
    const bag = new Inventory()
    bag.set(101, 47, 7032, 1, 'skill-1', 'add')
    bag.set(101, 19, 7430, 1, 'skill-2', 'add')
    const out = bag.resetPage(101)
    expect(out).toEqual([
      { item: 7032, delta: -1 },
      { item: 7430, delta: -1 },
    ])
    expect(bag.count(7032)).toBe(0)
    bag.set(101, 47, 7032, 1, 'skill-1', 'add')
    bag.set(101, 19, 7430, 1, 'skill-2', 'add')
    expect(bag.count(7032)).toBe(1)
    expect(bag.count(7430)).toBe(1)
  })

  test('the pages that are not the bag are left alone', () => {
    const bag = new Inventory()
    expect(bag.set(-1, 3, 2218, 1, 'gear-1', 'add')).toEqual([])
    expect(bag.count(2218)).toBe(0)
  })

  test('what the player has is the sum over the slots', () => {
    const bag = new Inventory()
    bag.set(102, 1, 100200, 100, null, 'init')
    bag.set(102, 2, 100200, 50, null, 'init')
    expect(bag.count(100200)).toBe(150)
    const totals = bag.totals()
    expect(totals.get(100200)).toBe(150)
  })
})

describe('a bag that is saved and put back', () => {
  test('keeps the same counts', () => {
    const bag = new Inventory()
    bag.set(102, 1, 100200, 3858, 'stack-1', 'update')
    bag.set(100, 15, 4654, 1, 'gear-1', 'add')
    const slots = bag.snapshot()
    const instances = bag.instancesSnapshot()

    const other = new Inventory()
    other.restore(slots, instances)
    expect(other.count(100200)).toBe(3858)
    expect(other.count(4654)).toBe(1)
  })

  test('a stack that grows after being put back is only the difference', () => {
    const bag = new Inventory()
    bag.set(102, 1, 100200, 3858, 'stack-1', 'update')
    const other = new Inventory()
    other.restore(bag.snapshot(), bag.instancesSnapshot())
    expect(other.set(102, 1, 100200, 3860, 'stack-1', 'update')).toEqual([{ item: 100200, delta: 2 }])
  })
})
