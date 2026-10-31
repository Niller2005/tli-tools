import { describe, expect, test } from 'bun:test'
import { Tracker } from '../src/engine'
import { parseLine } from '../src/parse'
import { PUT_ON_LEGENDARY, PUT_ON_PLAIN, PICK_LEGENDARY, WORN_GEAR } from './fixtures'

describe('the line the game writes when something is put on', () => {
  test('is read', () => {
    const fact = parseLine(
      '[2026.10.31-02.33.16:299][969]TLLua: Display: [Game] AttributeMgr:SetPlayerEquipment(BaseId=3010, GoldId=112151, 4)',
    )
    expect(fact).toEqual({ t: 'equip', base: 3010, legendary: 112151, slot: 4, at: 1793413996299 })
  })

  test('says there is no legendary when there is none', () => {
    const fact = parseLine(
      '[2026.10.31-02.24.12:536][  6]TLLua: Display: [Game] AttributeMgr:SetPlayerEquipment(BaseId=4642, GoldId=0, 6)',
    )
    expect(fact).toEqual({ t: 'equip', base: 4642, legendary: 0, slot: 6, at: 1793413452536 })
  })
})

describe('the legendary of a piece of gear', () => {
  test('is not known when the log only says the base', () => {
    const tracker = new Tracker()
    tracker.feed(PICK_LEGENDARY)
    expect(tracker.legendaryOf(3010)).toBeNull()
    expect(tracker.itemOf(3010)).toBe(3010)
  })

  test('is known when the player puts the gear on', () => {
    const tracker = new Tracker()
    tracker.feed(PICK_LEGENDARY)
    tracker.feed(PUT_ON_LEGENDARY)
    expect(tracker.legendaryOf(3010)).toBe(112151)
    expect(tracker.itemOf(3010)).toBe(112151)
  })

  test('is known when the gear is on the character', () => {
    const tracker = new Tracker()
    tracker.feed(WORN_GEAR)
    expect(tracker.legendaryOf(4520)).toBe(113201)
  })

  test('is not there when the gear is ordinary', () => {
    const tracker = new Tracker()
    tracker.feed(PUT_ON_PLAIN)
    expect(tracker.legendaryOf(4642)).toBeNull()
  })

  test('is kept when the tracker is saved and read back', () => {
    const tracker = new Tracker()
    tracker.feed(PUT_ON_LEGENDARY)
    const other = new Tracker()
    other.restore(tracker.snapshot())
    expect(other.legendaryOf(3010)).toBe(112151)
  })
})

describe('the price of a legendary', () => {
  test('is what the price of the legendary is', () => {
    const tracker = new Tracker()
    tracker.feed(PUT_ON_LEGENDARY)
    tracker.prices.learn(112151, [10, 12, 14], Date.now())
    expect(tracker.prices.price(tracker.itemOf(3010))).toBe(10)
  })

  test('is what the community says of the legendary', () => {
    const tracker = new Tracker()
    tracker.feed(PUT_ON_LEGENDARY)
    tracker.prices.setBaseline([[112151, 7]])
    expect(tracker.prices.price(tracker.itemOf(3010))).toBe(7)
  })

  test('the base is worth nothing when the log does not name the legendary', () => {
    const tracker = new Tracker()
    tracker.feed(PICK_LEGENDARY)
    tracker.prices.setBaseline([[112151, 7]])
    expect(tracker.prices.price(tracker.itemOf(3010))).toBe(0)
  })
})
