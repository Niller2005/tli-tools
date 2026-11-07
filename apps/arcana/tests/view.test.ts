import { describe, expect, test } from 'bun:test'
import { Tracker, emptyHistory, type Contest, type History, type Session } from '@tli/arcana'
import { ItemNames } from '@tli/tracker'
import { KeyCodes, createTestRenderer } from '@opentui/core/testing'
import { ArcanaApp } from '../src/app'
import { chestsByRarity, entriesOf, freshView, rewardsOf, selectedEntry, totalsOf } from '../src/view'

const FE = 100300

const session = (id: number, openedAt: number, extra: Partial<Session> = {}): Session => ({
  id,
  openedAt,
  closedAt: openedAt + 1000,
  cells: 0,
  moves: [],
  chests: [],
  chestsSkipped: 0,
  notes: 0,
  played: 0,
  lifeLost: 0,
  lifeWon: 0,
  ...extra,
})

const contest = (extra: Partial<Contest> = {}): Contest => ({ askedAt: null, openedAt: null, closedAt: null, chests: [], ...extra })

const history = (extra: Partial<History> = {}): History => ({ ...emptyHistory(), ...extra })

describe('entriesOf', () => {
  test('an empty history has no entries', () => {
    expect(entriesOf(emptyHistory())).toEqual([])
  })

  test('entries come newest first, whatever order the visits were stored in', () => {
    const entries = entriesOf(history({ sessions: [session(1, 100), session(3, 300), session(2, 200)] }))
    expect(entries.map((e) => e.session?.id)).toEqual([3, 2, 1])
  })

  test('a contest belongs to the last visit that began before it', () => {
    const c = contest({ askedAt: 250 })
    const entries = entriesOf(history({ sessions: [session(1, 100), session(2, 200), session(3, 300)], contests: [c] }))
    expect(entries.find((e) => e.session?.id === 2)?.contest).toBe(c)
    expect(entries.filter((e) => e.contest !== null)).toHaveLength(1)
  })

  test('a contest that began exactly when a visit did belongs to that visit', () => {
    const c = contest({ askedAt: 200 })
    const entries = entriesOf(history({ sessions: [session(1, 100), session(2, 200)], contests: [c] }))
    expect(entries.find((e) => e.session?.id === 2)?.contest).toBe(c)
  })

  test('a contest before every visit stands alone', () => {
    const c = contest({ askedAt: 50 })
    const entries = entriesOf(history({ sessions: [session(1, 100)], contests: [c] }))
    expect(entries).toHaveLength(2)
    expect(entries[1]).toEqual({ at: 50, session: null, contest: c })
  })

  test('a second contest after the same visit stands alone rather than replacing the first', () => {
    const first = contest({ askedAt: 150 })
    const second = contest({ askedAt: 160 })
    const entries = entriesOf(history({ sessions: [session(1, 100)], contests: [first, second] }))
    expect(entries.find((e) => e.session !== null)?.contest).toBe(first)
    expect(entries.find((e) => e.session === null)?.contest).toBe(second)
  })

  test('a contest is dated by the asking, else the page, else its first chest, else zero', () => {
    const at = (c: Contest): number => entriesOf(history({ contests: [c] }))[0].at
    expect(at(contest({ askedAt: 10, openedAt: 20, chests: [{ at: 30, rewards: [] }] }))).toBe(10)
    expect(at(contest({ openedAt: 20, chests: [{ at: 30, rewards: [] }] }))).toBe(20)
    expect(at(contest({ chests: [{ at: 30, rewards: [] }] }))).toBe(30)
    expect(at(contest())).toBe(0)
  })

  test('standalone contests and visits sort together by time', () => {
    const entries = entriesOf(history({ sessions: [session(1, 100), session(2, 300)], contests: [contest({ askedAt: 50 }), contest({ askedAt: 400 })] }))
    // the contest at 400 follows visit 2, the one at 50 precedes everything
    expect(entries.map((e) => e.at)).toEqual([300, 100, 50])
    expect(entries[0].contest?.askedAt).toBe(400)
  })

  test('building the entries does not change the history', () => {
    const h = history({ sessions: [session(1, 100), session(2, 200)], contests: [contest({ askedAt: 150 })] })
    const before = structuredClone(h)
    entriesOf(h)
    expect(h).toEqual(before)
  })
})

describe('selectedEntry', () => {
  test('there is none in an empty history', () => {
    expect(selectedEntry(emptyHistory(), 0)).toBeNull()
    expect(selectedEntry(emptyHistory(), 5)).toBeNull()
  })

  test('a pointer past the end sits on the oldest entry', () => {
    const h = history({ sessions: [session(1, 100), session(2, 200)] })
    expect(selectedEntry(h, 0)?.session?.id).toBe(2)
    expect(selectedEntry(h, 1)?.session?.id).toBe(1)
    expect(selectedEntry(h, 99)?.session?.id).toBe(1)
  })
})

describe('rewardsOf', () => {
  test('a contest with no chests has no rewards', () => {
    expect(rewardsOf(contest()).size).toBe(0)
  })

  test('chests that gave nothing add nothing', () => {
    expect(rewardsOf(contest({ chests: [{ at: 1, rewards: [] }, { at: 2, rewards: [] }] })).size).toBe(0)
  })

  test('the same item from different chests adds up', () => {
    const r = rewardsOf(
      contest({
        chests: [
          { at: 1, rewards: [{ item: 1, qty: 2 }, { item: 2, qty: 1 }] },
          { at: 2, rewards: [{ item: 1, qty: 3 }, { item: 1, qty: 1 }] },
        ],
      }),
    )
    expect(Object.fromEntries(r)).toEqual({ 1: 6, 2: 1 })
  })
})

describe('chestsByRarity', () => {
  test('every rarity and the unknown one are present, at zero when none was taken', () => {
    const counts = chestsByRarity([])
    expect([...counts.keys()]).toEqual(['Bai', 'Green', 'Blue', 'Zi', 'Jin', 'Hong', 'Cai', 'unknown'])
    expect([...counts.values()].every((n) => n === 0)).toBe(true)
  })

  test('chests are counted across visits, and an unshown rarity counts as unknown', () => {
    const counts = chestsByRarity([
      session(1, 0, { chests: [{ slot: 1, rarity: 'Blue', at: 0, upgrades: 0 }, { slot: 2, rarity: null, at: 0, upgrades: 0 }] }),
      session(2, 0, { chests: [{ slot: 3, rarity: 'Blue', at: 0, upgrades: 1 }] }),
    ])
    expect(counts.get('Blue')).toBe(2)
    expect(counts.get('unknown')).toBe(1)
    expect(counts.get('Zi')).toBe(0)
  })
})

describe('totalsOf', () => {
  const price = (item: number): number => ({ [FE]: 1, 3902: 10, 77: 0 })[item] ?? 0

  test('an empty history adds up to zeros', () => {
    const t = totalsOf(emptyHistory(), price, true)
    expect(t).toMatchObject({ sessions: 0, moves: 0, cells: 0, notes: 0, played: 0, lifeLost: 0, lifeWon: 0, contests: 0, opened: 0, upgrades: 0, trials: [] })
    expect(t.rewards.size).toBe(0)
    expect(t.value).toEqual({ gross: 0, tax: 0, net: 0, fe: 0 })
  })

  test('the visits\' counts are summed', () => {
    const move = { at: 0, steps: [], cells: 0, left: 0, right: 0, landed: null, chest: null, upgraded: [], life: 0, played: 0, gained: 0, shuffled: false, messages: [] }
    const t = totalsOf(
      history({
        sessions: [
          session(1, 0, { cells: 5, notes: 2, played: 3, lifeLost: 1, lifeWon: 2, chestsSkipped: 1, moves: [move, move], chests: [{ slot: 1, rarity: 'Zi', at: 0, upgrades: 2 }] }),
          session(2, 0, { cells: 7, notes: 1, played: 1, lifeLost: 4, moves: [move], chests: [{ slot: 2, rarity: 'Blue', at: 0, upgrades: 1 }] }),
        ],
      }),
      price,
      true,
    )
    expect(t).toMatchObject({ sessions: 2, moves: 3, cells: 12, notes: 3, played: 4, lifeLost: 5, lifeWon: 2, chestsSkipped: 1, upgrades: 3 })
  })

  test('a saved visit with no skipped-chest count counts as none', () => {
    const old = { ...session(1, 0), chestsSkipped: undefined } as unknown as Session
    expect(totalsOf(history({ sessions: [old, session(2, 0, { chestsSkipped: 2 })] }), price, true).chestsSkipped).toBe(2)
  })

  test('rewards and opened chests are summed over all contests', () => {
    const t = totalsOf(
      history({
        contests: [
          contest({ chests: [{ at: 0, rewards: [{ item: 3902, qty: 1 }] }, { at: 0, rewards: [] }] }),
          contest({ chests: [{ at: 0, rewards: [{ item: 3902, qty: 2 }, { item: FE, qty: 5 }] }] }),
          contest(),
        ],
      }),
      price,
      false,
    )
    expect(t.contests).toBe(3)
    expect(t.opened).toBe(3)
    expect(Object.fromEntries(t.rewards)).toEqual({ [FE]: 5, 3902: 3 })
    expect(t.value.gross).toBe(35)
    expect(t.value.fe).toBe(5)
  })

  test('the tax is taken from everything but FE, and only when it is on', () => {
    const h = history({ contests: [contest({ chests: [{ at: 0, rewards: [{ item: 3902, qty: 10 }, { item: FE, qty: 100 }] }] })] })
    const taxed = totalsOf(h, price, true).value
    const free = totalsOf(h, price, false).value
    expect(free.tax).toBe(0)
    expect(free.net).toBe(200)
    expect(taxed.gross).toBe(200)
    expect(taxed.tax).toBeGreaterThan(0)
    expect(taxed.tax).toBeLessThan(100)
    expect(taxed.net).toBeCloseTo(taxed.gross - taxed.tax)
  })

  test('trials are counted by arcana, the most often first and ties by name', () => {
    const t = totalsOf(
      history({
        trials: [
          { at: 1, arcana: 'TheSun' },
          { at: 2, arcana: 'TheHermit' },
          { at: 3, arcana: 'TheSun' },
          { at: 4, arcana: 'TheChariot' },
          { at: 5, arcana: '' },
        ],
      }),
      price,
      true,
    )
    expect(t.trials).toEqual([
      ['TheSun', 2],
      ['', 1],
      ['TheChariot', 1],
      ['TheHermit', 1],
    ])
  })

  test('totalsOf does not change the history', () => {
    const h = history({ sessions: [session(1, 0)], contests: [contest({ chests: [{ at: 0, rewards: [{ item: 1, qty: 1 }] }] })], trials: [{ at: 1, arcana: 'A' }] })
    const before = structuredClone(h)
    totalsOf(h, price, true)
    expect(h).toEqual(before)
  })
})

describe('the keys on edge states', () => {
  const names = new ItemNames({})

  async function setup(h: History) {
    const test = await createTestRenderer({ width: 120, height: 30, kittyKeyboard: true })
    const state = freshView('/tmp/UE_game.log')
    const calls = { quit: 0, read: 0 }
    const app = new ArcanaApp(test.renderer, new Tracker(h), names, state, {
      onQuit: () => void calls.quit++,
      onRead: () => void calls.read++,
    })
    test.renderer.keyInput.on('keypress', (key) => app.key(key))
    app.draw()
    await test.renderOnce()
    return { test, app, calls }
  }

  const three = (): History => history({ sessions: [session(1, 100), session(2, 200), session(3, 300)] })

  test('enter on an empty history opens no detail', async () => {
    const { test, app } = await setup(emptyHistory())
    test.mockInput.pressEnter()
    expect(app.state.detail).toBe(false)
    test.mockInput.pressKey(KeyCodes.ARROW_DOWN)
    expect(app.state.cursor).toBe(0)
    test.renderer.destroy()
  })

  test('enter on the totals panel opens no detail', async () => {
    const { test, app } = await setup(three())
    test.mockInput.pressKey(KeyCodes.TAB)
    test.mockInput.pressEnter()
    expect(app.state.detail).toBe(false)
    test.renderer.destroy()
  })

  test('tab does nothing while the detail is open', async () => {
    const { test, app } = await setup(three())
    test.mockInput.pressEnter()
    test.mockInput.pressKey(KeyCodes.ARROW_DOWN)
    test.mockInput.pressKey(KeyCodes.TAB)
    expect(app.state.focus).toBe('history')
    expect(app.state.scroll).toBe(1)
    test.renderer.destroy()
  })

  test('the pointer does not move while the detail is open; the scroll does', async () => {
    const { test, app } = await setup(three())
    test.mockInput.pressKey(KeyCodes.ARROW_DOWN)
    test.mockInput.pressEnter()
    test.mockInput.pressKey(KeyCodes.ARROW_DOWN)
    expect(app.state.cursor).toBe(1)
    expect(app.state.scroll).toBe(1)
    test.renderer.destroy()
  })

  test('scrolling never goes above the top', async () => {
    const { test, app } = await setup(three())
    test.mockInput.pressEnter()
    test.mockInput.pressKey(KeyCodes.ARROW_UP)
    test.mockInput.pressKey('\x1b[5~')
    expect(app.state.scroll).toBe(0)
    test.renderer.destroy()
  })

  test('changing panel, closing the detail and opening it all reset the scroll', async () => {
    const { test, app } = await setup(three())
    test.mockInput.pressKey(KeyCodes.TAB)
    test.mockInput.pressKey(KeyCodes.ARROW_DOWN)
    expect(app.state.scroll).toBe(1)
    test.mockInput.pressKey(KeyCodes.TAB)
    expect(app.state.scroll).toBe(0)
    test.mockInput.pressEnter()
    test.mockInput.pressKey(KeyCodes.ARROW_DOWN)
    test.mockInput.pressEscape()
    expect(app.state.scroll).toBe(0)
    expect(app.state.detail).toBe(false)
    test.renderer.destroy()
  })

  test('the history pointer keeps its row when the panel is changed away and back', async () => {
    const { test, app } = await setup(three())
    test.mockInput.pressKey(KeyCodes.ARROW_DOWN)
    test.mockInput.pressKey(KeyCodes.TAB)
    test.mockInput.pressKey(KeyCodes.ARROW_DOWN)
    test.mockInput.pressKey(KeyCodes.TAB)
    expect(app.state.cursor).toBe(1)
    test.renderer.destroy()
  })

  test('the key that closes the help does nothing else', async () => {
    const { test, app, calls } = await setup(three())
    test.mockInput.pressKey('?')
    test.mockInput.pressKey('t')
    expect(app.state.help).toBe(false)
    expect(app.state.taxed).toBe(true)
    test.mockInput.pressKey('j')
    expect(app.state.cursor).toBe(1)
    expect(calls.read).toBe(0)
    test.renderer.destroy()
  })

  test('q quits even with the help open', async () => {
    const { test, calls } = await setup(three())
    test.mockInput.pressKey('?')
    test.mockInput.pressKey('q')
    expect(calls.quit).toBe(1)
    test.renderer.destroy()
  })

  test('page keys move the pointer by ten and stop at the ends', async () => {
    const h = emptyHistory()
    for (let i = 1; i <= 15; i++) h.sessions.push(session(i, i * 100))
    const { test, app } = await setup(h)
    test.mockInput.pressKey('\x1b[6~')
    expect(app.state.cursor).toBe(10)
    test.mockInput.pressKey('\x1b[6~')
    expect(app.state.cursor).toBe(14)
    test.mockInput.pressKey('\x1b[5~')
    expect(app.state.cursor).toBe(4)
    test.mockInput.pressKey('\x1b[5~')
    expect(app.state.cursor).toBe(0)
    test.renderer.destroy()
  })

  test('r asks for the log to be read and nothing else changes', async () => {
    const { test, app, calls } = await setup(three())
    test.mockInput.pressKey('r')
    expect(calls.read).toBe(1)
    expect(app.state.cursor).toBe(0)
    expect(app.state.detail).toBe(false)
    test.renderer.destroy()
  })
})
