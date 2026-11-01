import { describe, expect, test } from 'bun:test'
import { Tracker } from '../src/engine'
import { parseLine } from '../src/parse'
import {
  BAG_SNAPSHOT,
  ENTER_MAP,
  EXP_MOVES,
  IN_HIDEOUT,
  LOGIN,
  LOGIN_OTHER,
  PICK_MATERIAL,
  SMALL_PLAYER_ID,
  XCHG_BUY,
  XCHG_LIST,
  XCHG_RECALL,
  XCHG_RECEIVE,
} from './fixtures'

const FIRST = '980032478075064320'
const SECOND = '980032478075064321'

describe('the character that is logged in', () => {
  test('the login says which character it is; a small id of a fight is not one', () => {
    expect(parseLine(LOGIN[0] as string)).toMatchObject({ t: 'player', id: FIRST })
    expect(parseLine(SMALL_PLAYER_ID[0] as string)).toBeNull()
  })

  test('what was read before the log said who was playing is that character\'s', () => {
    const t = new Tracker()
    t.feed(BAG_SNAPSHOT)
    t.feed(IN_HIDEOUT)
    t.feed(ENTER_MAP)
    t.feed(LOGIN)
    expect(t.character).toBe(FIRST)
    expect(t.characterIds).toEqual([FIRST])
    expect(t.inventory.count(100200)).toBe(3858)
    expect(t.currentRun).not.toBeNull()
  })

  test('another character has a bag, runs and experience of its own, and the first one is where it was left', () => {
    const t = new Tracker()
    t.feed(LOGIN)
    t.feed(BAG_SNAPSHOT)
    t.feed(IN_HIDEOUT)
    t.feed(ENTER_MAP)
    t.feed(PICK_MATERIAL)
    t.feed(EXP_MOVES.slice(0, 2))

    t.feed(LOGIN_OTHER)
    expect(t.character).toBe(SECOND)
    expect(t.inventory.count(100200)).toBe(0)
    expect(t.runs).toHaveLength(0)
    expect(t.currentRun).toBeNull()
    expect(t.stats().level).toBeNull()

    // the run the first character was in ended when it left, and it is kept
    t.feed(LOGIN)
    expect(t.character).toBe(FIRST)
    expect(t.inventory.count(100200)).toBeGreaterThan(3858)
    expect(t.runs).toHaveLength(1)
    expect(t.runs[0]?.end).not.toBeNull()
    expect(t.runs[0]?.xp).toBe(51294)
    expect(t.characterIds.sort()).toEqual([FIRST, SECOND])
  })

  test('the prices are the same for every character', () => {
    const t = new Tracker()
    t.feed(LOGIN)
    t.prices.setOverride(100200, 2)
    t.feed(LOGIN_OTHER)
    expect(t.prices.price(100200)).toBe(2)
  })

  test('the characters are saved and come back, the one that was playing first', () => {
    const t = new Tracker()
    t.feed(LOGIN)
    t.feed(BAG_SNAPSHOT)
    t.feed(IN_HIDEOUT)
    t.feed(ENTER_MAP)
    t.feed(LOGIN_OTHER)
    t.feed(XCHG_LIST)

    const again = new Tracker()
    again.restore(t.snapshot())
    expect(again.character).toBe(SECOND)
    expect(again.characterIds.sort()).toEqual([FIRST, SECOND])
    again.feed(LOGIN)
    expect(again.inventory.count(100200)).toBe(3858)
    expect(again.runs).toHaveLength(1)
    again.feed(LOGIN_OTHER)
    expect(again.trades).toHaveLength(0)
  })
})

describe('what the player did at the exchange', () => {
  test('a listing, a purchase, collecting it and taking a listing back are each an entry with what changed in the bag', () => {
    const t = new Tracker()
    t.feed(BAG_SNAPSHOT)
    t.feed([
      '[2026.10.31-02.00.00:000][1]TLLua: Display: [Game] BagMgr@:Modfy BagItem PageId = 102 SlotId = 0 ConfigBaseId = 100300 Num = 500',
      '[2026.10.31-02.00.00:001][1]TLLua: Display: [Game] ItemChange@ Add Id=3010_68f93dc1-d4d3-11f1-a1ef-000000000066 BagNum=1 in PageId=100 SlotId=6',
    ])
    t.feed(XCHG_LIST)
    t.feed(XCHG_BUY)
    t.feed(XCHG_RECEIVE)
    t.feed(XCHG_RECALL)
    expect(t.trades.map((entry) => entry.kind)).toEqual(['list', 'buy', 'receive', 'recall'])
    expect(t.trades.map((entry) => entry.id)).toEqual([1, 2, 3, 4])
    expect(t.trades[0]?.items).toEqual([[3010, -1]])
    expect(t.trades[1]?.items).toEqual([[100300, 294 - 500]])
    expect(t.trades[2]?.items).toEqual([[4520, 1]])
    expect(t.trades[3]?.items).toEqual([[4533, 1]])
  })

  test('the changes of other blocks are not the exchange\'s', () => {
    const t = new Tracker()
    t.feed(BAG_SNAPSHOT)
    t.feed(IN_HIDEOUT)
    t.feed(ENTER_MAP)
    t.feed(PICK_MATERIAL)
    expect(t.trades).toHaveLength(0)
  })
})

describe('sessions', () => {
  test('the runs that begin during a session are the session\'s, and it adds them up on its own', () => {
    const t = new Tracker()
    t.feed(IN_HIDEOUT)
    t.feed(ENTER_MAP) // a run before the session
    const session = t.startSession('  Fire farm  ', 1000)
    expect(session.name).toBe('Fire farm')
    expect(t.session?.id).toBe(1)
    expect(t.currentRun?.session).toBe(0)

    t.feed(IN_HIDEOUT)
    t.feed(ENTER_MAP)
    t.feed(PICK_MATERIAL)
    expect(t.currentRun?.session).toBe(1)
    const now = Date.parse('2026-10-29T21:28:06.033Z') + 60_000
    expect(t.sessionTotals(1, now)?.runs).toBe(1)
    expect(t.sessionTotals(1, now)?.totalTime).toBe(60_000)
    expect(t.sessionTotals(7, now)).toBeNull()
  })

  test('starting another one ends the one that was going on, and ending it leaves later runs outside any', () => {
    const t = new Tracker()
    t.startSession('', 100)
    expect(t.sessions[0]?.name).toBe('Session 1')
    t.startSession('second', 200)
    expect(t.sessions).toMatchObject([
      { id: 1, start: 100, end: 200 },
      { id: 2, name: 'second', start: 200, end: null },
    ])
    expect(t.endSession(300)?.id).toBe(2)
    expect(t.session).toBeNull()
    t.feed(IN_HIDEOUT)
    t.feed(ENTER_MAP)
    expect(t.currentRun?.session).toBe(0)
    expect(t.endSession(400)).toBeNull()
  })

  test('a session survives the tracker being saved and started again', () => {
    const t = new Tracker()
    t.startSession('keep', 100)
    const again = new Tracker()
    again.restore(t.snapshot())
    expect(again.session?.name).toBe('keep')
    again.feed(IN_HIDEOUT)
    again.feed(ENTER_MAP)
    expect(again.currentRun?.session).toBe(1)
  })
})
