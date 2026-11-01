import { describe, expect, test } from 'bun:test'
import { ItemNames, Tracker } from '@tli/tracker'
import { KeyCodes, createTestRenderer } from '@opentui/core/testing'
import { TrackerApp } from '../src/app'
import { matchesFilter } from '../src/view'

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
    kind: 'map',
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
    xp: 0,
    affixes: [],
    session: 0,
  })
  tracker.runs.push({
    id: 2,
    kind: 'map',
    zone: 'test',
    name: 'Shadow Outpost',
    levelId: 4709,
    start: NOW - 100_000,
    end: NOW - 40_000,
    loot: new Map([[200, 3]]),
    cost: new Map(),
    fe: 0,
    xp: 0,
    affixes: [],
    session: 0,
  })
  return tracker
}

/** A tracker with a visit to the Tartarus prison in it. */
function trackerWithPrison(): Tracker {
  const tracker = trackerWithItems()
  tracker.runs.push({
    id: 3,
    kind: 'prison',
    zone: 'ZhongZuiDiYu',
    name: 'Tartarus Prison',
    levelId: 235501,
    start: NOW - 900_000,
    end: NOW - 500_000,
    loot: new Map([
      [300, 2],
      [100, 9],
    ]),
    cost: new Map(),
    fe: 0,
    xp: 0,
    affixes: [],
    session: 0,
  })
  return tracker
}

/** A tracker app on a test renderer. */
async function setup(width = 120, height = 24, tracker = trackerWithItems()) {
  // The kitty keyboard protocol sends every key on its own, so the escape key does not have to
  // wait for the terminal's parser to see whether more of a sequence is coming.
  const test = await createTestRenderer({ width, height, kittyKeyboard: true })
  const state = { quit: false, reported: false, read: false, opened: [] as string[] }
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
      onOpenWindow: (tool) => {
        // the tests never open a window: they only remember what was asked for
        state.opened.push(tool.id)
        return `${tool.name} is open in a new window`
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

  test('the list of the runs says what kind of run each one is', async () => {
    const { test } = await setup(160, 45, trackerWithPrison())
    const frame = test.captureCharFrame()
    expect(frame).toContain('prison')
    expect(frame).toContain('Tartarus Prison')
    test.renderer.destroy()
  })

  test('the community prices are shown with their own mark, and the footer says where they are from', async () => {
    const tracker = trackerWithItems()
    tracker.prices.setBaseline([
      [400, 7],
      [100, 3],
    ])
    const { test, app } = await setup(160, 45, tracker)
    app.state.focus = 'prices'
    app.draw()
    await test.renderOnce()
    app.state.baselineAt = app.state.now - 3_600_000
    app.state.baselineCount = 2
    app.draw()
    await test.renderOnce()
    const frame = test.captureCharFrame()
    const prices = column(frame, 72, 160)
    // the row of a community price ends in ~, the other two in * and ·
    expect(prices).toContain('~')
    expect(frame).toContain('Prices: tlicompanion.com')
    expect(frame).toContain('2 prices')
    expect(frame).toContain('1h 00m old')
    test.renderer.destroy()
  })

  test('the prices the player set and learned win over the community ones', async () => {
    const tracker = trackerWithItems()
    tracker.prices.setBaseline([
      [100, 3],
      [200, 3],
      [300, 3],
    ])
    tracker.prices.learn(300, [25], NOW)
    const { test, app } = await setup(160, 45, tracker)
    app.state.focus = 'prices'
    app.draw()
    await test.renderOnce()
    const prices = column(test.captureCharFrame(), 72, 160)
    expect(prices).toContain('Ancient Relic')
    test.renderer.destroy()
  })

  test('the detail of a run says what kind of run it is', async () => {
    const { test, app } = await setup(160, 45, trackerWithPrison())
    app.state.detail = 3
    app.draw()
    await test.renderOnce()
    const frame = test.captureCharFrame()
    expect(frame).toContain('kind')
    expect(frame).toContain('prison')
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

  test('the menu opens, picks with enter and runs the key of an entry', async () => {
    const { test, app, tracker } = await setup(120, 30)
    test.mockInput.pressKey('m')
    expect(app.state.menu).toBe(0)
    await test.renderOnce()
    const frame = test.captureCharFrame()
    expect(frame).toContain('Menu')
    expect(frame).toContain('Clear every price learned')

    const taxed = tracker.taxed
    test.mockInput.pressKey('t')
    expect(app.state.menu).toBeNull()
    expect(tracker.taxed).toBe(!taxed)

    test.mockInput.pressKey('m')
    for (let i = 0; i < 5; i++) test.mockInput.pressArrow('down')
    expect(app.state.menu).toBe(5)
    test.mockInput.pressEnter()
    expect(app.state.menu).toBeNull()
    expect(tracker.taxed).toBe(taxed)

    test.mockInput.pressKey('m')
    test.mockInput.pressEscape()
    expect(app.state.menu).toBeNull()
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

  test('a, v and w open the minigame tools in a window of their own', async () => {
    const { test, app, state } = await setup(120, 24)
    test.mockInput.pressKey('a')
    test.mockInput.pressKey('v')
    test.mockInput.pressKey('w')
    expect(state.opened).toEqual(['arcana', 'vorax', 'warden'])
    expect(app.state.message).toContain('is open in a new window')
    test.renderer.destroy()
  })

  test('the tracker keeps following the log while a tool is open', async () => {
    const { test, app, state } = await setup(120, 24)
    test.mockInput.pressKey('v')
    expect(state.opened).toEqual(['vorax'])
    expect(app.state.focus).toBe('runs')
    expect(app.state.paused).toBe(false)
    test.mockInput.pressKey('j')
    expect(app.state.runsAt).toBe(1)
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

/** The part of the frame a column of the screen has, from left to right. */
function column(frame: string, from: number, to: number): string {
  return frame
    .split('\n')
    .map((line) => line.slice(from, to))
    .join('\n')
}

describe('the search of the tracker screen', () => {
  test('the bag can be searched', async () => {
    const { test, app } = await setup(120, 24)
    app.state.focus = 'inventory'
    app.draw()
    await test.renderOnce()
    test.mockInput.pressKey('/')
    await test.mockInput.typeText('ember')
    await test.renderOnce()
    const frame = test.captureCharFrame()
    const bag = column(frame, 0, 54)
    expect(bag).toContain('Ember Core')
    expect(bag).not.toContain('Silver Shard')
    expect(bag).not.toContain('Ancient Relic')
    expect(bag).toContain('Bag /ember (1/3)')
    expect(app.state.inventoryFilter).toBe('ember')
    test.renderer.destroy()
  })

  test('the search does not mind capitals', async () => {
    const { test, app } = await setup(120, 24)
    app.state.focus = 'inventory'
    app.draw()
    await test.renderOnce()
    test.mockInput.pressKey('/')
    await test.mockInput.typeText('EMBER')
    await test.renderOnce()
    const bag = column(test.captureCharFrame(), 0, 54)
    expect(bag).toContain('Ember Core')
    expect(bag).not.toContain('Silver Shard')
    test.renderer.destroy()
  })

  test('the search finds an item by its number', async () => {
    const { test, app } = await setup(120, 24)
    app.state.focus = 'inventory'
    app.draw()
    await test.renderOnce()
    test.mockInput.pressKey('/')
    await test.mockInput.typeText('200')
    await test.renderOnce()
    const bag = column(test.captureCharFrame(), 0, 54)
    expect(bag).toContain('Silver Shard')
    expect(bag).not.toContain('Ember Core')
    test.renderer.destroy()
  })

  test('every word of the search has to match', async () => {
    const { test, app } = await setup(120, 24)
    app.state.focus = 'inventory'
    app.draw()
    await test.renderOnce()
    test.mockInput.pressKey('/')
    await test.mockInput.typeText('ember core')
    await test.renderOnce()
    expect(column(test.captureCharFrame(), 0, 54)).toContain('Ember Core')
    test.mockInput.pressBackspace()
    test.mockInput.pressBackspace()
    test.mockInput.pressBackspace()
    test.mockInput.pressBackspace()
    await test.mockInput.typeText('silver')
    await test.renderOnce()
    const bag = column(test.captureCharFrame(), 0, 54)
    expect(bag).not.toContain('Ember Core')
    expect(bag).not.toContain('Silver Shard')
    expect(bag).toContain('no item matches "ember silver"')
    test.renderer.destroy()
  })

  test('the prices can be searched too, and the filters are apart', async () => {
    const { test, app } = await setup(120, 24)
    app.state.focus = 'prices'
    app.draw()
    await test.renderOnce()
    test.mockInput.pressKey('/')
    await test.mockInput.typeText('relic')
    await test.renderOnce()
    const frame = test.captureCharFrame()
    const prices = column(frame, 54, 120)
    expect(prices).toContain('Ancient Relic')
    expect(prices).not.toContain('Silver Shard')
    expect(prices).toContain('Prices (* set) /relic (1/3)')
    expect(app.state.pricesFilter).toBe('relic')
    expect(app.state.inventoryFilter).toBe('')
    expect(frame).toContain('/relic')
    test.renderer.destroy()
  })

  test('nothing matches says so', async () => {
    const { test, app } = await setup(120, 24)
    app.state.focus = 'inventory'
    app.draw()
    await test.renderOnce()
    test.mockInput.pressKey('/')
    await test.mockInput.typeText('zzz')
    await test.renderOnce()
    const bag = column(test.captureCharFrame(), 0, 54)
    expect(bag).toContain('no item matches "zzz"')
    expect(bag).toContain('Bag /zzz (0/3)')
    test.renderer.destroy()
  })

  test('the keys of the search box do nothing else', async () => {
    const { test, app, tracker } = await setup(120, 24)
    app.state.focus = 'inventory'
    app.draw()
    await test.renderOnce()
    test.mockInput.pressKey('/')
    await test.mockInput.typeText('tcp')
    await test.renderOnce()
    expect(tracker.taxed).toBe(true)
    expect(tracker.mapCosts).toBe(false)
    expect(app.state.paused).toBe(false)
    expect(app.state.searching).toBe('inventory')
    expect(app.state.inventoryFilter).toBe('tcp')
    test.renderer.destroy()
  })

  test('enter keeps the filter and gives the keys back', async () => {
    const { test, app } = await setup(120, 24)
    app.state.focus = 'inventory'
    app.draw()
    await test.renderOnce()
    test.mockInput.pressKey('/')
    await test.mockInput.typeText('ember')
    test.mockInput.pressEnter()
    await test.renderOnce()
    expect(app.state.searching).toBeNull()
    expect(app.state.inventoryFilter).toBe('ember')
    expect(column(test.captureCharFrame(), 0, 54)).toContain('Ember Core')
    test.mockInput.pressKey('j')
    expect(app.state.inventoryAt).toBe(0)
    test.renderer.destroy()
  })

  test('escape while typing takes the filter away and leaves the search', async () => {
    const { test, app } = await setup(120, 24)
    app.state.focus = 'inventory'
    app.draw()
    await test.renderOnce()
    test.mockInput.pressKey('/')
    await test.mockInput.typeText('ember')
    test.mockInput.pressEscape()
    await test.renderOnce()
    expect(app.state.searching).toBeNull()
    expect(app.state.inventoryFilter).toBe('')
    const bag = column(test.captureCharFrame(), 0, 54)
    expect(bag).toContain('Silver Shard')
    expect(bag).toContain('Bag (3)')
    test.renderer.destroy()
  })

  test('escape takes the filter away when the keys are back', async () => {
    const { test, app } = await setup(120, 24)
    app.state.focus = 'inventory'
    app.draw()
    await test.renderOnce()
    test.mockInput.pressKey('/')
    await test.mockInput.typeText('ember')
    test.mockInput.pressEnter()
    await test.renderOnce()
    expect(app.state.inventoryFilter).toBe('ember')
    test.mockInput.pressEscape()
    await test.renderOnce()
    expect(app.state.inventoryFilter).toBe('')
    expect(app.state.message).toContain('filter')
    expect(column(test.captureCharFrame(), 0, 54)).toContain('Bag (3)')
    test.renderer.destroy()
  })

  test('escape closes the detail of a run before it takes the filter away', async () => {
    const { test, app } = await setup(120, 24)
    app.state.focus = 'inventory'
    app.state.inventoryFilter = 'ember'
    app.draw()
    await test.renderOnce()
    test.mockInput.pressEnter()
    expect(app.state.detail).not.toBeNull()
    test.mockInput.pressEscape()
    expect(app.state.detail).toBeNull()
    expect(app.state.inventoryFilter).toBe('ember')
    test.renderer.destroy()
  })

  test('the keys work on the row that is left by the filter', async () => {
    const tracker = trackerWithItems()
    const { test, app } = await setup(120, 24, tracker)
    app.state.focus = 'inventory'
    app.draw()
    await test.renderOnce()
    test.mockInput.pressKey('/')
    await test.mockInput.typeText('ember')
    test.mockInput.pressEnter()
    await test.renderOnce()
    test.mockInput.pressKey('e')
    expect(app.state.editing?.item).toBe(100)
    test.mockInput.pressBackspace()
    await test.mockInput.typeText('42')
    test.mockInput.pressEnter()
    expect(tracker.prices.price(100)).toBe(42)
    expect(tracker.prices.price(300)).toBe(25)
    test.renderer.destroy()
  })

  test('the pointer stays inside the rows that are left', async () => {
    const { test, app } = await setup(120, 24)
    app.state.focus = 'inventory'
    app.draw()
    await test.renderOnce()
    test.mockInput.pressKey('j')
    test.mockInput.pressKey('j')
    expect(app.state.inventoryAt).toBe(2)
    test.mockInput.pressKey('/')
    await test.mockInput.typeText('ember')
    await test.renderOnce()
    expect(app.state.inventoryAt).toBe(0)
    test.mockInput.pressKey('j')
    expect(app.state.inventoryAt).toBe(0)
    test.renderer.destroy()
  })

  test('the runs cannot be searched', async () => {
    const { test, app } = await setup(120, 24)
    test.mockInput.pressKey('/')
    await test.renderOnce()
    expect(app.state.searching).toBeNull()
    expect(app.state.message).toContain('nothing to search')
    test.renderer.destroy()
  })

  test('the help says how the search works', async () => {
    const { test } = await setup(120, 24)
    test.mockInput.pressKey('?')
    await test.renderOnce()
    expect(test.captureCharFrame()).toContain('search the list that has the focus')
    test.renderer.destroy()
  })

  test('the search box fits at every size', async () => {
    for (const width of [60, 80, 120, 200]) {
      for (const height of [10, 24, 50]) {
        const { test, app } = await setup(width, height)
        app.state.focus = 'inventory'
        app.draw()
        test.mockInput.pressKey('/')
        await test.renderOnce()
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
})

describe('the words of a filter', () => {
  test('a word matches the name of an item, its number, or the start of a word of its name', () => {
    expect(matchesFilter('Ember Core', 100, 'ember')).toBe(true)
    expect(matchesFilter('Ember Core', 100, 'EMBER')).toBe(true)
    expect(matchesFilter('Ember Core', 100, 'core')).toBe(true)
    expect(matchesFilter('Ember Core', 100, '100')).toBe(true)
    expect(matchesFilter('Ember Core', 100, 'ember core')).toBe(true)
    expect(matchesFilter('Ember Core', 100, 'ember silver')).toBe(false)
    expect(matchesFilter('Ember Core', 100, 'silver')).toBe(false)
    expect(matchesFilter('Ember Core', 100, '10')).toBe(false)
    expect(matchesFilter('Ember Core', 100, '')).toBe(true)
  })
})

/** Three finished maps that had the same modifier, worth different amounts, so the page of them has something to say. */
function trackerWithModifiers(): Tracker {
  const tracker = trackerWithItems()
  tracker.affixNames.set(77, '+10% additional Drop Quantity')
  for (const run of tracker.runs) run.affixes.push(77)
  tracker.runs.push({
    id: 9,
    kind: 'map',
    zone: 'test',
    name: 'Third Map',
    levelId: 1,
    start: NOW - 30_000,
    end: NOW - 10_000,
    loot: new Map([[300, 4]]),
    cost: new Map(),
    fe: 0,
    xp: 0,
    affixes: [77, 12345],
    session: 0,
  })
  return tracker
}

describe('the pages', () => {
  test('f, h and g open the page of the modifiers, of the exchange and of the sessions, and the same key or esc closes it', async () => {
    const { test, app } = await setup(120, 30, trackerWithModifiers())
    test.mockInput.pressKey('f')
    expect(app.state.page).toBe('affixes')
    await test.renderOnce()
    expect(test.captureCharFrame()).toContain('Which map modifiers paid')
    test.mockInput.pressKey('f')
    expect(app.state.page).toBeNull()

    test.mockInput.pressKey('h')
    expect(app.state.page).toBe('exchange')
    // another page's key switches to it
    test.mockInput.pressKey('g')
    expect(app.state.page).toBe('sessions')
    test.mockInput.pressEscape()
    expect(app.state.page).toBeNull()
    test.renderer.destroy()
  })

  test('the keys of the panels do nothing while a page covers them', async () => {
    const { test, app, tracker } = await setup(120, 30)
    test.mockInput.pressKey('g')
    test.mockInput.pressKey('t')
    expect(tracker.taxed).toBe(true)
    test.mockInput.pressKey('j')
    expect(app.state.runsAt).toBe(0)
    test.renderer.destroy()
  })

  test('a modifier on three maps is compared with the average map, one the game does not say in words is left out', async () => {
    const { test } = await setup(140, 30, trackerWithModifiers())
    test.mockInput.pressKey('f')
    await test.renderOnce()
    const frame = test.captureCharFrame()
    expect(frame).toContain('+10% additional Drop Quantity')
    expect(frame).toContain('3 maps')
    expect(frame).not.toContain('12345')
    test.renderer.destroy()
  })

  test('the exchange page says what changed in the bag, newest first, with the FE paid and collected', async () => {
    const tracker = trackerWithItems()
    tracker.trades.push(
      { id: 1, at: NOW - 5000, kind: 'buy', items: [[100300, -206]] },
      { id: 2, at: NOW - 4000, kind: 'receive', items: [[100, 3], [100300, 40]] },
      { id: 3, at: NOW - 3000, kind: 'list', items: [[300, -1]] },
    )
    const { test } = await setup(140, 30, tracker)
    test.mockInput.pressKey('h')
    await test.renderOnce()
    const frame = test.captureCharFrame()
    expect(frame).toContain('FE paid 206')
    expect(frame).toContain('FE collected 40')
    expect(frame).toContain('1 × Ancient Relic')
    expect(frame).toContain('3 × Ember Core')
    expect(frame.indexOf('1 × Ancient Relic')).toBeLessThan(frame.indexOf('3 × Ember Core'))
    test.renderer.destroy()
  })
})

describe('the sessions', () => {
  test('n asks for a name and starts the session with it, N ends it, and the page adds the runs up', async () => {
    const { test, app, tracker } = await setup(140, 30)
    test.mockInput.pressKey('n')
    expect(app.state.naming).toBe(true)
    await test.renderOnce()
    expect(test.captureCharFrame()).toContain('session name')
    for (let i = 0; i < 12; i += 1) test.mockInput.pressBackspace()
    await test.mockInput.typeText('Fire farm')
    test.mockInput.pressEnter()
    expect(app.state.naming).toBe(false)
    expect(tracker.session?.name).toBe('Fire farm')
    await test.renderOnce()
    expect(test.captureCharFrame()).toContain('[session Fire farm]')

    test.mockInput.pressKey('g')
    await test.renderOnce()
    const frame = test.captureCharFrame()
    expect(frame).toContain('Fire farm')
    expect(frame).toContain('going on')
    test.mockInput.pressEscape()

    test.mockInput.pressKey('N')
    expect(tracker.session).toBeNull()
    expect(app.state.message).toContain('Fire farm')
    test.renderer.destroy()
  })

  test('esc leaves the name box without starting anything', async () => {
    const { test, app, tracker } = await setup(120, 24)
    test.mockInput.pressKey('n')
    await test.mockInput.typeText('x')
    test.mockInput.pressEscape()
    expect(app.state.naming).toBe(false)
    expect(tracker.sessions).toHaveLength(0)
    test.renderer.destroy()
  })
})

describe('the experience in the header', () => {
  test('the level and the experience per hour are there once the log has said the level, and not before', async () => {
    const empty = await setup(160, 24, new Tracker({ names: names() }))
    expect(empty.test.captureCharFrame()).not.toContain('XP/h')
    empty.test.renderer.destroy()

    const tracker = trackerWithItems()
    tracker.feed([
      '[2026.10.31-02.21.44:746][899]TLLua: Display: [Game] ExpMgr@UpdateExp Percent:6257480 94',
    ])
    const { test } = await setup(160, 24, tracker)
    const frame = test.captureCharFrame()
    expect(frame).toContain('level 94')
    expect(frame).toContain('XP/h')
    test.renderer.destroy()
  })
})
