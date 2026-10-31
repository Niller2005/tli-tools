import { describe, expect, test } from 'bun:test'
import { ItemNames, Tracker } from '@tli/tracker'
import { KeyCodes, createTestRenderer } from '@opentui/core/testing'
import { TrackerApp } from '../src/app'

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0)

function names(): ItemNames {
  return new ItemNames({
    '100': { name: 'Ember Core' },
    '200': { name: 'Silver Shard' },
    '300': { name: 'Ancient Relic' },
  })
}

function trackerWithItems(): Tracker {
  const tracker = new Tracker({ names: names() })
  tracker.inventory.set(102, 1, 100, 12, null, 'init')
  tracker.inventory.set(102, 2, 200, 7, null, 'init')
  tracker.inventory.set(102, 3, 300, 2, null, 'init')
  tracker.prices.setOverride(100, 5)
  tracker.prices.setOverride(200, 1.5)
  tracker.prices.setOverride(300, 25)
  tracker.runs.push({
    id: 1,
    zone: 'test',
    name: 'Glacial Abyss',
    levelId: 4708,
    start: NOW - 300_000,
    end: NOW - 120_000,
    loot: new Map([
      [100, 4],
      [300, 1],
    ]),
    cost: new Map(),
    fe: 0,
  })
  tracker.runs.push({
    id: 2,
    zone: 'test',
    name: 'Shadow Outpost',
    levelId: 4709,
    start: NOW - 100_000,
    end: NOW - 40_000,
    loot: new Map([[200, 3]]),
    cost: new Map(),
    fe: 0,
  })
  return tracker
}

/** A tracker app on a test renderer. */
async function setup(width = 120, height = 24, tracker = trackerWithItems()) {
  // The kitty keyboard protocol sends every key on its own, so the escape key does not have to
  // wait for the terminal's parser to see whether more of a sequence is coming.
  const test = await createTestRenderer({ width, height, kittyKeyboard: true })
  const state = { quit: false, reported: false, read: false }
  const app = new TrackerApp(
    test.renderer,
    tracker,
    names(),
    '/mnt/games/SteamLibrary/steamapps/common/Torchlight Infinite/logs/UE_game.log',
    {
      onQuit: () => {
        state.quit = true
      },
      onReport: () => {
        state.reported = true
      },
      onRead: () => {
        state.read = true
      },
    },
    NOW,
  )
  test.renderer.keyInput.on('keypress', (key) => app.key(key))
  app.draw()
  await test.renderOnce()
  return { test, app, state, tracker }
}

describe('the tracker screen', () => {
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

  test('an empty tracker still draws', async () => {
    const { test } = await setup(120, 24, new Tracker({ names: names() }))
    const frame = test.captureCharFrame()
    expect(frame).toContain('TLI Loot Tracker')
    expect(frame).toContain('no runs yet')
    expect(frame).toContain('the bag is empty')
    test.renderer.destroy()
  })

  test('the panels and the numbers are all on the screen', async () => {
    const { test } = await setup(160, 45)
    const frame = test.captureCharFrame()
    expect(frame).toContain('TLI Loot Tracker')
    expect(frame).toContain('net worth')
    expect(frame).toContain('Current run')
    expect(frame).toContain('Recent runs')
    expect(frame).toContain('Bag')
    expect(frame).toContain('Prices (* set)')
    expect(frame).toContain('Glacial Abyss')
    test.renderer.destroy()
  })

  test('the row that is picked out is marked in every panel', async () => {
    for (const focus of ['runs', 'inventory', 'prices'] as const) {
      const { test, app } = await setup(120, 24)
      app.state.focus = focus
      app.draw()
      await test.renderOnce()
      const frame = test.captureCharFrame()
      expect(frame).toContain('▸')
      test.renderer.destroy()
    }
  })

  test('the pointer moves down and up in the panel that has the focus', async () => {
    const { test, app } = await setup(120, 24)
    expect(app.state.runsAt).toBe(0)
    test.mockInput.pressKey(KeyCodes.ARROW_DOWN)
    expect(app.state.runsAt).toBe(1)
    test.mockInput.pressKey('j')
    expect(app.state.runsAt).toBe(1)
    test.mockInput.pressKey('k')
    expect(app.state.runsAt).toBe(0)
    test.mockInput.pressKey(KeyCodes.ARROW_UP)
    expect(app.state.runsAt).toBe(0)
    test.renderer.destroy()
  })

  test('tab changes the panel and shift+tab goes back', async () => {
    const { test, app } = await setup(120, 24)
    expect(app.state.focus).toBe('runs')
    test.mockInput.pressKey(KeyCodes.TAB)
    expect(app.state.focus).toBe('inventory')
    test.mockInput.pressKey(KeyCodes.TAB)
    expect(app.state.focus).toBe('prices')
    test.mockInput.pressKey(KeyCodes.TAB, { shift: true })
    expect(app.state.focus).toBe('inventory')
    test.renderer.destroy()
  })

  test('enter opens the detail of a run and escape closes it', async () => {
    const { test, app } = await setup(120, 24)
    test.mockInput.pressEnter()
    expect(app.state.detail).not.toBeNull()
    await test.renderOnce()
    expect(test.captureCharFrame()).toContain('Loot')
    test.mockInput.pressEscape()
    expect(app.state.detail).toBeNull()
    test.renderer.destroy()
  })

  test('t turns the tax on and off, c the cost of the map', async () => {
    const { test, tracker } = await setup(120, 24)
    test.mockInput.pressKey('t')
    expect(tracker.taxed).toBe(false)
    test.mockInput.pressKey('t')
    expect(tracker.taxed).toBe(true)
    test.mockInput.pressKey('c')
    expect(tracker.mapCosts).toBe(true)
    test.mockInput.pressKey('c')
    expect(tracker.mapCosts).toBe(false)
    test.renderer.destroy()
  })

  test('p stops the clock and starts it again', async () => {
    const { test, app } = await setup(120, 24)
    expect(app.state.paused).toBe(false)
    test.mockInput.pressKey('p')
    expect(app.state.paused).toBe(true)
    test.mockInput.pressKey('p')
    expect(app.state.paused).toBe(false)
    test.renderer.destroy()
  })

  test('e starts a price and enter keeps it', async () => {
    const tracker = trackerWithItems()
    const { test, app } = await setup(120, 24, tracker)
    test.mockInput.pressKey('e')
    expect(app.state.editing).not.toBeNull()
    await test.renderOnce()
    expect(test.captureCharFrame()).toContain('price')
    test.mockInput.pressBackspace()
    test.mockInput.pressBackspace()
    await test.mockInput.typeText('42')
    test.mockInput.pressEnter()
    expect(app.state.editing).toBeNull()
    expect(tracker.prices.price(300)).toBe(42)
    test.renderer.destroy()
  })

  test('u takes a set price away, and an empty price does the same', async () => {
    const tracker = trackerWithItems()
    tracker.prices.setOverride(300, null)
    tracker.prices.learn(300, [8, 8, 8], 0)
    const learned = tracker.prices.price(300)
    expect(learned).toBeGreaterThan(0)
    const { test, app } = await setup(120, 24, tracker)
    tracker.prices.setOverride(300, 42)
    expect(tracker.prices.price(300)).toBe(42)
    test.mockInput.pressKey('u')
    expect(tracker.prices.price(300)).toBe(learned)
    expect(app.state.message).toContain('is gone')

    tracker.prices.setOverride(300, 42)
    test.mockInput.pressKey('e')
    test.mockInput.pressBackspace()
    test.mockInput.pressBackspace()
    test.mockInput.pressEnter()
    expect(app.state.editing).toBeNull()
    expect(tracker.prices.price(300)).toBe(learned)

    test.mockInput.pressKey('u')
    expect(app.state.message).toContain('no price set by hand')
    test.renderer.destroy()
  })

  test('the bag, runs and prices follow a changed price or quantity', async () => {
    const tracker = trackerWithItems()
    const { test, app } = await setup(160, 40, tracker)
    await test.renderOnce()
    const before = test.captureCharFrame()
    tracker.prices.setOverride(300, 26)
    tracker.prices.setOverride(100, 6)
    app.draw()
    await test.renderOnce()
    const after = test.captureCharFrame()
    expect(after).not.toBe(before)
    expect(after).toContain('52 FE')
    expect(after).toContain('72 FE')
    expect(after).toContain('26 FE')
    tracker.inventory.set(102, 3, 300, 3, null, 'init')
    app.draw()
    await test.renderOnce()
    expect(test.captureCharFrame()).toContain('78 FE')
    test.renderer.destroy()
  })

  test('d removes an item from the prices', async () => {
    const tracker = trackerWithItems()
    tracker.prices.learn(300, [8, 8, 8], 0)
    const { test, app } = await setup(120, 24, tracker)
    expect(tracker.prices.price(300)).toBe(25)
    test.mockInput.pressKey('d')
    expect(tracker.prices.price(300)).toBe(0)
    expect(tracker.prices.info(300)).toBeNull()
    expect(app.state.message).toContain('out of the prices')
    test.renderer.destroy()
  })

  test('escape leaves the price without keeping it', async () => {
    const tracker = trackerWithItems()
    const { test, app } = await setup(120, 24, tracker)
    test.mockInput.pressKey('e')
    await test.mockInput.typeText('42')
    test.mockInput.pressEscape()
    expect(app.state.editing).toBeNull()
    expect(tracker.prices.price(300)).toBe(25)
    test.renderer.destroy()
  })

  test('escape leaves the price without keeping it', async () => {
    const tracker = trackerWithItems()
    const { test, app } = await setup(120, 24, tracker)
    test.mockInput.pressKey('e')
    await test.mockInput.typeText('42')
    test.mockInput.pressEscape()
    expect(app.state.editing).toBeNull()
    expect(tracker.prices.price(100)).toBe(5)
    test.renderer.destroy()
  })

  test('the help opens and closes', async () => {
    const { test, app } = await setup(120, 24)
    test.mockInput.pressKey('?')
    expect(app.state.help).toBe(true)
    await test.renderOnce()
    expect(test.captureCharFrame()).toContain('Keys')
    test.mockInput.pressKey('?')
    expect(app.state.help).toBe(false)
    test.renderer.destroy()
  })

  test('the help covers the panels behind it', async () => {
    const { test } = await setup(120, 24)
    test.mockInput.pressKey('?')
    await test.renderOnce()
    const frame = test.captureCharFrame()
    expect(frame).toContain('Keys')
    expect(frame).not.toContain('Glacial Abyss')
    expect(frame).not.toContain('Recent runs')
    expect(frame).not.toContain('Ember Core')
    test.renderer.destroy()
  })

  test('the detail of a run covers the panels behind it', async () => {
    const { test } = await setup(120, 24)
    test.mockInput.pressEnter()
    await test.renderOnce()
    const frame = test.captureCharFrame()
    expect(frame).toContain('Shadow Outpost')
    expect(frame).not.toContain('Ember Core')
    expect(frame).not.toContain('Recent runs')
    test.renderer.destroy()
  })

  test('q quits and x writes the report and r reads the log again', async () => {
    const { test, state } = await setup(120, 24)
    test.mockInput.pressKey('x')
    expect(state.reported).toBe(true)
    test.mockInput.pressKey('r')
    expect(state.read).toBe(true)
    test.mockInput.pressKey('q')
    expect(state.quit).toBe(true)
    test.renderer.destroy()
  })

  test('the mouse picks a row and gives the panel the focus', async () => {
    const { test, app } = await setup(120, 24)
    const runs = test.renderer.root.findDescendantById('runs-text')
    expect(runs).toBeDefined()
    await test.mockMouse.click(90, 6)
    expect(app.state.focus).toBe('runs')
    test.renderer.destroy()
  })
})
