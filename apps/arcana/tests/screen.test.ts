import { describe, expect, test } from 'bun:test'
import { Tracker, emptyHistory, type Contest, type History, type Session } from '@tli/arcana'
import { ItemNames } from '@tli/tracker'
import { KeyCodes, createTestRenderer } from '@opentui/core/testing'
import { ArcanaApp } from '../src/app'
import { arcanaName, clock, stamp } from '../src/format'
import { freshView } from '../src/view'

const at = (h: number, m: number, s = 0): number => Date.UTC(2026, 9, 30, h, m, s)

const session = (id: number, openedAt: number, extra: Partial<Session> = {}): Session => ({
  id,
  openedAt,
  closedAt: openedAt + 180_000,
  cells: 65,
  moves: [],
  chests: [
    { slot: 1, rarity: 'Blue', at: openedAt, upgrades: 0 },
    { slot: 2, rarity: 'Zi', at: openedAt, upgrades: 2 },
    { slot: 3, rarity: null, at: openedAt, upgrades: 0 },
  ],
  notes: 15,
  chestsSkipped: 1,
  played: 14,
  lifeLost: 3,
  lifeWon: 3,
  ...extra,
})

const contest = (askedAt: number): Contest => ({
  askedAt,
  openedAt: askedAt + 1000,
  closedAt: askedAt + 400_000,
  chests: [
    { at: askedAt + 10_000, rewards: [{ item: 100300, qty: 3 }, { item: 3902, qty: 1 }] },
    { at: askedAt + 20_000, rewards: [{ item: 3902, qty: 2 }, { item: 999999, qty: 1 }] },
  ],
})

const names = new ItemNames({ '3902': { name: 'Test Rune' }, '100300': { name: 'Flame Elementium' } })

function trackerWith(history: History): Tracker {
  const t = new Tracker(history)
  t.prices.setOverride(3902, 10)
  return t
}

const full = (): History => ({
  sessions: [session(1, at(1, 0)), session(2, at(2, 0))],
  contests: [contest(at(0, 30)), contest(at(1, 5)), contest(at(2, 5))],
  trials: [
    { at: at(1, 1), arcana: 'TheSun' },
    { at: at(1, 2), arcana: 'TheSun' },
    { at: at(1, 3), arcana: 'TheHangedMan' },
  ],
  nextId: 3,
})

/** The app on a test renderer, with the keys it was given. */
async function setup(width = 120, height = 30, tracker = trackerWith(full())) {
  // The kitty keyboard protocol sends every key on its own, so the escape key does not have to
  // wait for the terminal's parser to see whether more of a sequence is coming.
  const test = await createTestRenderer({ width, height, kittyKeyboard: true })
  const state = freshView('/tmp/UE_game.log')
  const keys = { quit: false, read: false }
  const app = new ArcanaApp(test.renderer, tracker, names, state, {
    onQuit: () => {
      keys.quit = true
    },
    onRead: () => {
      keys.read = true
    },
  })
  test.renderer.keyInput.on('keypress', (key) => app.key(key))
  app.draw()
  await test.renderOnce()
  return { test, app, state, keys, tracker }
}

describe('the log clock', () => {
  test('times are read on the log\'s own clock', () => {
    expect(clock(at(21, 28, 6))).toBe('21:28:06')
    expect(stamp(at(1, 32))).toBe('10-30 01:32')
    expect(arcanaName('TheHangedMan')).toBe('The Hanged Man')
  })
})

describe('the screen', () => {
  test('it draws at every size, from narrow to wide and tiny to tall', async () => {
    for (const width of [60, 80, 120, 200]) {
      for (const height of [10, 24, 50]) {
        const { test } = await setup(width, height)
        const frame = test.captureSpans()
        expect(frame.rows).toBe(height)
        expect(frame.cols).toBe(width)
        for (const line of frame.lines) {
          const used = line.spans.reduce((sum, span) => sum + span.width, 0)
          expect(used).toBeLessThanOrEqual(width)
        }
        test.renderer.destroy()
      }
    }
  })

  test('an empty history says so, and says what to do', async () => {
    const { test } = await setup(120, 30, new Tracker())
    const frame = test.captureCharFrame()
    expect(frame).toContain('Arcana')
    expect(frame).toContain('Tarot Path: not seen in the log yet')
    expect(frame).toContain('No visits to the Tarot Path in the log yet.')
    expect(frame).toContain('/tmp/UE_game.log')
    expect(frame).toContain('Open the Tarot Path in the game to start a session.')
    test.renderer.destroy()
  })

  test('the history lists the visits with their contests', async () => {
    const { test } = await setup(160, 40)
    const frame = test.captureCharFrame()
    expect(frame).toContain('Now')
    expect(frame).toContain('History')
    expect(frame).toContain('#1')
    expect(frame).toContain('#2')
    expect(frame).toContain('2 chests,')
    expect(frame).toContain('the log began mid-contest')
    test.renderer.destroy()
  })

  test('the open state comes from the log, and a missed start is said', async () => {
    const { test, app, state } = await setup(120, 30, new Tracker())
    state.path = 'open'
    app.draw()
    await test.renderOnce()
    expect(test.captureCharFrame()).toContain('Tarot Path: open')
    expect(test.captureCharFrame()).toContain('the tracker started after it opened')
    test.renderer.destroy()
  })

  test('a note about the log replaces the path of the log', async () => {
    const { test, app, state } = await setup(120, 30, new Tracker())
    state.logNote = 'turn on Enable Log'
    app.draw()
    await test.renderOnce()
    const frame = test.captureCharFrame()
    expect(frame).toContain('turn on Enable Log')
    expect(frame).not.toContain('/tmp/UE_game.log')
    test.renderer.destroy()
  })

  test('the detail shows the moves and the contest\'s chests with names and values', async () => {
    const { test, app } = await setup(160, 40)
    // newest first: visit 2 and its contest, then visit 1 and its contest, then the lone contest
    app.state.cursor = 1
    app.state.detail = true
    app.draw()
    await test.renderOnce()
    const frame = test.captureCharFrame()
    expect(frame).toContain('Session #1')
    expect(frame).toContain('Fateful Contest')
    expect(frame).toContain('Test Rune')
    expect(frame).toContain('Flame Elementium')
    expect(frame).toContain('no price')
    expect(frame).toContain('esc back')
    test.renderer.destroy()
  })

  test('the totals panel lists the rewards, the most valuable first', async () => {
    const { test, app } = await setup(160, 40)
    app.state.focus = 'totals'
    app.draw()
    await test.renderOnce()
    const frame = test.captureCharFrame()
    expect(frame).toContain('Lifetime totals')
    expect(frame).toContain('The Sun 2')
    expect(frame.indexOf('Test Rune')).toBeGreaterThan(-1)
    expect(frame.indexOf('Test Rune')).toBeLessThan(frame.indexOf('Item #999999'))
    test.renderer.destroy()
  })

  test('the pointer stays on the screen when there are more rows than room', async () => {
    const history = emptyHistory()
    for (let i = 1; i <= 40; i++) history.sessions.push(session(i, at(1, 0) + i * 600_000))
    const { test, app } = await setup(120, 16, trackerWith(history))
    app.state.cursor = 0
    app.draw()
    await test.renderOnce()
    expect(test.captureCharFrame()).toContain('#40')
    app.state.cursor = 39
    app.draw()
    await test.renderOnce()
    expect(test.captureCharFrame()).toContain('#1 ')
    test.renderer.destroy()
  })

  test('the row that is picked out is marked, and the marker moves', async () => {
    const { test, app } = await setup(120, 30)
    await test.renderOnce()
    const first = test.captureCharFrame()
    expect(first).toContain('▸')
    const marked = first.split('\n').find((line) => line.includes('▸'))
    expect(marked).toContain('#2')
    app.state.cursor = 1
    app.draw()
    await test.renderOnce()
    const second = test.captureCharFrame()
    const nowMarked = second.split('\n').find((line) => line.includes('▸'))
    expect(nowMarked).toContain('#1')
    test.renderer.destroy()
  })

  test('the help opens and closes with any key', async () => {
    const { test, app } = await setup(120, 30)
    test.mockInput.pressKey('?')
    expect(app.state.help).toBe(true)
    await test.renderOnce()
    expect(test.captureCharFrame()).toContain('move in the history')
    test.mockInput.pressKey('x')
    expect(app.state.help).toBe(false)
    await test.renderOnce()
    expect(test.captureCharFrame()).not.toContain('move in the history')
    test.renderer.destroy()
  })
})

describe('the keys', () => {
  test('the pointer moves down and up in the history', async () => {
    const { test, app } = await setup(120, 30)
    expect(app.state.cursor).toBe(0)
    test.mockInput.pressKey(KeyCodes.ARROW_DOWN)
    expect(app.state.cursor).toBe(1)
    test.mockInput.pressKey('j')
    expect(app.state.cursor).toBe(2)
    test.mockInput.pressKey('k')
    expect(app.state.cursor).toBe(1)
    test.mockInput.pressKey(KeyCodes.ARROW_UP)
    expect(app.state.cursor).toBe(0)
    test.renderer.destroy()
  })

  test('the pointer does not go past the ends', async () => {
    const { test, app } = await setup(120, 30)
    test.mockInput.pressKey(KeyCodes.ARROW_UP)
    expect(app.state.cursor).toBe(0)
    for (let i = 0; i < 10; i++) test.mockInput.pressKey(KeyCodes.ARROW_DOWN)
    expect(app.state.cursor).toBe(2)
    test.renderer.destroy()
  })

  test('tab changes the panel and shift+tab goes back', async () => {
    const { test, app } = await setup(120, 30)
    expect(app.state.focus).toBe('history')
    test.mockInput.pressKey(KeyCodes.TAB)
    expect(app.state.focus).toBe('totals')
    test.mockInput.pressKey(KeyCodes.TAB)
    expect(app.state.focus).toBe('history')
    test.mockInput.pressKey(KeyCodes.TAB, { shift: true })
    expect(app.state.focus).toBe('totals')
    test.renderer.destroy()
  })

  test('enter opens the detail of a visit and escape closes it', async () => {
    const { test, app } = await setup(160, 40)
    test.mockInput.pressEnter()
    expect(app.state.detail).toBe(true)
    await test.renderOnce()
    expect(test.captureCharFrame()).toContain('Session #2')
    test.mockInput.pressEscape()
    expect(app.state.detail).toBe(false)
    await test.renderOnce()
    expect(test.captureCharFrame()).toContain('History')
    test.renderer.destroy()
  })

  test('enter closes the detail again', async () => {
    const { test, app } = await setup(160, 40)
    test.mockInput.pressEnter()
    expect(app.state.detail).toBe(true)
    test.mockInput.pressEnter()
    expect(app.state.detail).toBe(false)
    test.renderer.destroy()
  })

  test('the keys scroll the detail', async () => {
    const { test, app } = await setup(160, 40)
    test.mockInput.pressEnter()
    expect(app.state.scroll).toBe(0)
    test.mockInput.pressKey(KeyCodes.ARROW_DOWN)
    expect(app.state.scroll).toBe(1)
    test.mockInput.pressKey('\x1b[6~')
    expect(app.state.scroll).toBe(11)
    test.renderer.destroy()
  })

  test('the keys scroll the totals', async () => {
    const { test, app } = await setup(160, 40)
    test.mockInput.pressKey(KeyCodes.TAB)
    expect(app.state.focus).toBe('totals')
    test.mockInput.pressKey(KeyCodes.ARROW_DOWN)
    expect(app.state.scroll).toBe(1)
    test.renderer.destroy()
  })

  test('t turns the tax on and off and says so', async () => {
    const { test, app } = await setup(120, 30)
    test.mockInput.pressKey('t')
    expect(app.state.taxed).toBe(false)
    expect(app.state.message).toBe('the trade tax is off')
    test.mockInput.pressKey('t')
    expect(app.state.taxed).toBe(true)
    expect(app.state.message).toBe('the trade tax is on')
    test.renderer.destroy()
  })

  test('r reads the log again and says so', async () => {
    const { test, app, keys } = await setup(120, 30)
    test.mockInput.pressKey('r')
    expect(keys.read).toBe(true)
    expect(app.state.message).toBe('the log was read again')
    test.renderer.destroy()
  })

  test('q quits', async () => {
    const { test, keys } = await setup(120, 30)
    test.mockInput.pressKey('q')
    expect(keys.quit).toBe(true)
    test.renderer.destroy()
  })

  test('the message goes away with the next key', async () => {
    const { test, app } = await setup(120, 30)
    test.mockInput.pressKey('t')
    expect(app.state.message).toBe('the trade tax is off')
    test.mockInput.pressKey('t')
    expect(app.state.message).toBe('the trade tax is on')
    test.mockInput.pressKey('j')
    expect(app.state.message).toBe('')
    test.renderer.destroy()
  })

  test('the mouse picks a row of the history', async () => {
    const { test, app } = await setup(120, 30)
    const rows = test.renderer.root.findDescendantById('history-text')
    expect(rows).toBeDefined()
    await test.mockMouse.click(10, 7)
    expect(app.state.cursor).toBe(1)
    test.renderer.destroy()
  })
})
