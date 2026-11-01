import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import type { MinigameView } from '@tli/gamelog'
import { TOOLS, defaultSettings, setToolSettings, type Settings, type Tool } from '@tli/launch'
import { NARROW, optionRows, toolRows } from '../src/screen'
import { DashboardApp, freshState } from '../src/app'
import type { StatusData } from '../src/status'
import { emptyStatus } from '../src/status'

const VIEW: MinigameView = {
  warden: 'closed',
  vorax: 'open',
  arcana: 'unknown',
  log: 'missing',
}

const NOW = Date.parse('2026-11-01T12:00:00')

const STATUS: StatusData = {
  lines: {
    vorax: { id: 'vorax', line: 'open', tone: 'ok', at: 0 },
    warden: { id: 'warden', line: 'closed', tone: 'dim', at: 0 },
    tracker: { id: 'tracker', line: '3 runs today · 41.3 FE/h · last: The Frozen Fjord', tone: 'ok', at: NOW },
    arcana: { id: 'arcana', line: 'Tarot Path closed · 2 chests held · 5 trials', tone: 'dim', at: NOW },
  },
  summary: {
    runsToday: 3,
    feToday: 234.5,
    fePerHour: 41.3,
    bestRun: { id: 7, kind: 'map', name: 'The Frozen Fjord', fe: 12, worth: 120, startedAt: 0, endedAt: 1 },
    lastRun: { id: 9, kind: 'map', name: 'Thetimberlands', fe: 30, worth: 45, startedAt: 0, endedAt: 1 },
    feTotal: 1234,
    at: NOW,
  },
  health: { path: '/game/UE_game.log', size: 123_456_789, modifiedAt: NOW - 5000, detail: 'ok' },
  capture: {
    tools: [
      { name: 'grim', found: true },
      { name: 'niri', found: false },
      { name: 'tesseract', found: true },
    ],
    noCapture: false,
    path: 'grim',
  },
  baselineAge: 60_000,
  itemAge: 5 * 24 * 3600 * 1000,
  running: [{ id: 'vorax', pid: 4321, since: NOW - 60_000, via: 'tmux', running: true, exitCode: null }],
  at: NOW,
}

/** A dashboard on a test renderer. */
async function setup(width = 120, height = 24, settings: Settings = defaultSettings()) {
  // Kitty mode sends each key on its own, so the parser never has to wait for the rest of an
  // escape sequence.
  const test = await createTestRenderer({ width, height, kittyKeyboard: true })
  const state = freshState(settings)
  state.view = VIEW
  state.status = STATUS
  const calls = {
    quit: 0,
    run: [] as Tool[],
    opened: [] as Tool[],
    closed: [] as Tool[],
    focused: [] as Tool[],
    settings: [] as Settings[],
    baseline: 0,
  }
  const app = new DashboardApp(test.renderer, state, {
    onQuit: () => {
      calls.quit += 1
    },
    onRun: (tools) => {
      calls.run.push(...tools)
    },
    onOpenWindow: (tool) => {
      // the tests never open a window: they only remember what was asked for
      calls.opened.push(tool)
      return `${tool.name} is open in a new window`
    },
    onSettings: (settings) => {
      calls.settings.push(settings)
    },
    onClose: (tool) => {
      calls.closed.push(tool)
      return `${tool.id} was asked to stop`
    },
    onFocus: (tool) => {
      calls.focused.push(tool)
      return `${tool.id} is focused`
    },
    onBaseline: () => {
      calls.baseline += 1
      return 'the community prices are being fetched'
    },
  })
  test.renderer.root.add(app.screen.root)
  test.renderer.keyInput.on('keypress', (key) => app.key(key))
  app.draw()
  await test.renderOnce()
  return { test, app, calls, state }
}

describe('the dashboard screen', () => {
  test('it draws at every size without spilling over the edge', async () => {
    for (const width of [40, 60, 80, 99, 120, 200]) {
      for (const height of [10, 24, 40]) {
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

  test('it lists the tools, their badges and their status lines', async () => {
    const { test } = await setup()
    const frame = test.captureCharFrame()
    for (const wanted of [
      'Torchlight: Infinite tools',
      'Vorax Helper',
      'Tartarus Warden',
      'Loot Tracker',
      'Arcana (Tarot Path)',
      '● open',
      '○ closed',
      '? unknown',
      'log: missing',
      '3 runs today · 41.3 FE/h',
    ]) {
      expect(frame).toContain(wanted)
    }
    test.renderer.destroy()
  })

  test('a status line that only repeats the badge is not drawn twice', async () => {
    const { test, state } = await setup()
    // the Vorax line is 'open', which the badge next to it says already
    const frame = test.captureCharFrame()
    const vorax = frame.split('\n').find(line => line.includes('Vorax Helper'))
    expect(vorax).toContain('● open')
    expect(vorax?.replace('● open', '')).not.toContain('open')
    state.status = { ...STATUS, lines: { ...STATUS.lines, vorax: { id: 'vorax', line: '', tone: 'dim', at: 0 } } }
    test.renderer.destroy()
  })

  test('the cursor moves and the description follows it', async () => {
    const { test, app } = await setup()
    expect(app.state.cursor).toBe(0)
    test.mockInput.pressKey('j')
    expect(app.state.cursor).toBe(1)
    test.mockInput.pressKey('j')
    expect(app.state.cursor).toBe(2)
    await test.renderOnce()
    expect(test.captureCharFrame()).toContain("Reads the game's log and shows what each map run gave")
    test.mockInput.pressKey('k')
    expect(app.state.cursor).toBe(1)
    await test.renderOnce()
    expect(test.captureCharFrame()).toContain('Reads the Tartarus prison board')
    test.renderer.destroy()
  })

  test('space picks a tool and A picks them all', async () => {
    const { test, app } = await setup()
    test.mockInput.pressKey(' ')
    expect(app.state.picked.has('vorax')).toBe(true)
    test.mockInput.pressKey(' ')
    expect(app.state.picked.has('vorax')).toBe(false)
    test.mockInput.pressKey('A')
    expect(app.state.picked.size).toBe(4)
    test.renderer.destroy()
  })

  test('enter runs the tool under the cursor', async () => {
    const { test, calls } = await setup()
    test.mockInput.pressKey('j')
    test.mockInput.pressKey('j')
    test.mockInput.pressEnter()
    expect(calls.run.map((tool) => tool.id)).toEqual(['tracker'])
    test.renderer.destroy()
  })

  test('w opens the tool under the cursor in a window of its own', async () => {
    const { test, app, calls } = await setup()
    test.mockInput.pressKey('w')
    expect(calls.opened.map((tool) => tool.id)).toEqual(['vorax'])
    expect(app.state.message).toContain('is open in a new window')
    await test.renderOnce()
    expect(test.captureCharFrame()).toContain('is open in a new window')
    test.mockInput.pressKey('j')
    test.mockInput.pressKey('w')
    expect(calls.opened.map((tool) => tool.id)).toEqual(['vorax', 'warden'])
    test.renderer.destroy()
  })

  test('q and ctrl+c leave the dashboard', async () => {
    const { test, calls } = await setup()
    test.mockInput.pressKey('q')
    expect(calls.quit).toBe(1)
    test.mockInput.pressCtrlC()
    expect(calls.quit).toBe(2)
    test.renderer.destroy()
  })

  test('a message is shown and then cleared by the next key', async () => {
    const state = freshState()
    state.message = 'something went wrong'
    state.view = VIEW
    state.status = STATUS
    const test = await createTestRenderer({ width: 120, height: 24, kittyKeyboard: true })
    const app = new DashboardApp(test.renderer, state, {
      onQuit: () => {},
      onRun: () => {},
      onOpenWindow: (tool) => `${tool.name} is open in a new window`,
      onSettings: () => {},
      onClose: (tool) => `${tool.id} was asked to stop`,
      onFocus: (tool) => `${tool.id} is focused`,
      onBaseline: () => 'the community prices are being fetched',
    })
    test.renderer.root.add(app.screen.root)
    test.renderer.keyInput.on('keypress', (key) => app.key(key))
    app.draw()
    await test.renderOnce()
    expect(test.captureCharFrame()).toContain('something went wrong')
    test.mockInput.pressKey('j')
    expect(app.state.message).toBe('')
    await test.renderOnce()
    expect(test.captureCharFrame()).not.toContain('something went wrong')
    test.renderer.destroy()
  })

  test('the badges can be refreshed from the log', async () => {
    const { test, app, state } = await setup()
    state.view = { ...VIEW, arcana: 'closed' }
    app.draw()
    await test.renderOnce()
    expect(test.captureCharFrame()).toContain('○ closed')
    test.renderer.destroy()
  })
})

describe('the panels', () => {
  test('the session, the log and the capture, the running tools and the data are shown', async () => {
    const { test } = await setup(120, 40)
    const frame = test.captureCharFrame()
    for (const wanted of [
      'Session',
      'runs today',
      '3',
      '41.3 FE/h',
      '1,234 FE',
      'Log and capture',
      'written 5s ago',
      'grim ✓',
      'niri ✗',
      'Running tools and data',
      'vorax',
      'tmux · 1m 00s · running',
      '1m 00s old',
      '120h 00m old',
    ]) {
      expect(frame).toContain(wanted)
    }
    test.renderer.destroy()
  })

  test('a narrow screen stacks the list over one pane, and tab says which', async () => {
    const { test, app } = await setup(NARROW - 1, 30)
    let frame = test.captureCharFrame()
    expect(frame).toContain('Session')
    // the list has the whole width, so a long status line is not cut short
    expect(frame).toContain('Tarot Path closed · 2 chests held · 5 trials')
    expect(frame).not.toContain('Log and capture')
    expect(frame).not.toContain('Running tools and data')

    test.mockInput.pressKey('\t')
    await test.renderOnce()
    frame = test.captureCharFrame()
    expect(frame).not.toContain('Session')
    expect(frame).toContain('Log and capture')

    test.mockInput.pressKey('\t')
    await test.renderOnce()
    frame = test.captureCharFrame()
    expect(frame).not.toContain('Log and capture')
    expect(frame).toContain('Running tools and data')

    test.mockInput.pressKey('\t')
    await test.renderOnce()
    frame = test.captureCharFrame()
    expect(frame).toContain('Session')
    expect(app.state.pane).toBe(0)
    test.renderer.destroy()
  })

  test('a wide screen shows every pane at once', async () => {
    const { test } = await setup(NARROW, 30)
    const frame = test.captureCharFrame()
    for (const wanted of ['Session', 'Log and capture', 'Running tools and data']) {
      expect(frame).toContain(wanted)
    }
    test.renderer.destroy()
  })
})

describe('the options dialog', () => {
  test('it lists only the options the tool takes, and keeps them', async () => {
    const { test, app, calls } = await setup()
    test.mockInput.pressKey('o')
    await test.renderOnce()
    let frame = test.captureCharFrame()
    expect(frame).toContain('Vorax Helper · options')
    expect(frame).toContain('colours off')
    expect(frame).toContain('does not read the game log')
    expect(frame).toContain('capture command')

    test.mockInput.pressKey(' ')
    await test.renderOnce()
    expect(calls.settings.at(-1)?.tools.vorax?.noColor).toBe(true)
    expect(app.state.message).toContain('colours off on')
    frame = test.captureCharFrame()
    expect(frame).toContain('[x] colours off')

    test.mockInput.pressEscape()
    await test.renderOnce()
    expect(test.captureCharFrame()).not.toContain('Vorax Helper · options')
    test.renderer.destroy()
  })

  test('a tool that takes one option lists only that one', async () => {
    const { test } = await setup()
    test.mockInput.pressKey('j')
    test.mockInput.pressKey('j')
    test.mockInput.pressKey('o')
    await test.renderOnce()
    const frame = test.captureCharFrame()
    expect(frame).toContain('Loot Tracker · options')
    expect(frame).toContain('colours off')
    expect(frame).not.toContain('capture command')
    expect(frame).not.toContain('does not read the game log')
    test.renderer.destroy()
  })

  test('a capture command is typed in and kept, and escape puts it away', async () => {
    const { test, app, calls } = await setup()
    test.mockInput.pressKey('o')
    test.mockInput.pressKey('j')
    test.mockInput.pressKey('j')
    test.mockInput.pressKey('j')
    test.mockInput.pressEnter()
    expect(app.state.editing).toBe(true)
    await test.renderOnce()
    expect(test.captureCharFrame()).toContain('command')

    await test.mockInput.typeText('grim -o {out}')
    test.mockInput.pressEnter()
    await test.renderOnce()
    expect(app.state.editing).toBe(false)
    expect(calls.settings.at(-1)?.tools.vorax?.captureCmd).toBe('grim -o {out}')
    expect(app.state.message).toContain('the capture command of Vorax Helper is grim -o {out}')
    test.renderer.destroy()
  })
})

describe('the keys of the launcher', () => {
  test('x asks for the tool under the cursor to stop, and f for its window', async () => {
    const { test, calls } = await setup()
    test.mockInput.pressKey('j')
    test.mockInput.pressKey('x')
    test.mockInput.pressKey('f')
    expect(calls.closed.map((tool) => tool.id)).toEqual(['warden'])
    expect(calls.focused.map((tool) => tool.id)).toEqual(['warden'])
    test.renderer.destroy()
  })

  test('b fetches the community prices without stopping the screen', async () => {
    const { test, app, calls } = await setup()
    test.mockInput.pressKey('b')
    expect(calls.baseline).toBe(1)
    expect(app.state.message).toBe('the community prices are being fetched')
    test.renderer.destroy()
  })

  test('a turns auto-launch on for a tool with a minigame, and says no to one without', async () => {
    const { test, app, calls } = await setup()
    test.mockInput.pressKey('j')
    test.mockInput.pressKey('a')
    expect(calls.settings.at(-1)?.tools.warden?.autoLaunch).toBe(true)
    expect(app.state.message).toContain('Tartarus Warden opens by itself')
    test.mockInput.pressKey('a')
    expect(calls.settings.at(-1)?.tools.warden?.autoLaunch).toBe(false)

    test.mockInput.pressKey('j')
    test.mockInput.pressKey('a')
    expect(calls.settings.length).toBe(2)
    expect(app.state.message).toContain('Loot Tracker has no minigame')
    test.renderer.destroy()
  })

  test('the help lists the keys, and any of them puts it away', async () => {
    const { test, app } = await setup()
    test.mockInput.pressKey('?')
    await test.renderOnce()
    const frame = test.captureCharFrame()
    expect(frame).toContain('this help')
    expect(frame).toContain('run the picked tools here')
    expect(frame).toContain('fetch the community prices again')
    expect(app.state.help).toBe(true)

    test.mockInput.pressKey('?')
    expect(app.state.help).toBe(false)
    await test.renderOnce()
    expect(test.captureCharFrame()).not.toContain('this help')
    test.renderer.destroy()
  })
})

describe('the options a tool takes', () => {
  test('every tool in the table takes at least the colours', () => {
    for (const tool of TOOLS) {
      expect(optionRows(tool).length).toBeGreaterThan(0)
    }
    expect(optionRows(TOOLS[0] as Tool).map((row) => row.key)).toEqual([
      'noColor',
      'noLog',
      'niriScreenshot',
      'captureCmd',
    ])
  })
})

describe('the status before anything was read', () => {
  test('the empty status says nothing and nothing is running', () => {
    const status = emptyStatus()
    expect(status.lines).toEqual({})
    expect(status.running).toEqual([])
    expect(status.summary.runsToday).toBe(0)
    expect(status.baselineAge).toBeNull()
  })
})

describe('auto-launch marker', () => {
  test('a minigame tool that is on auto is marked, the others are not', () => {
    const state = freshState(setToolSettings(defaultSettings(), 'warden', { autoLaunch: true }))
    const marked = toolRows(state).filter((row) => row.auto).map((row) => row.tool.id)
    expect(marked).toEqual(['warden'])
  })
})
