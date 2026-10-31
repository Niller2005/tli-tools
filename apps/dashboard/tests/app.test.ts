import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import type { MinigameView } from '@tli/gamelog'
import type { Tool } from '@tli/launch'
import { DashboardApp, freshState } from '../src/app'

const VIEW: MinigameView = {
  warden: 'closed',
  vorax: 'open',
  arcana: 'unknown',
  log: 'missing',
}

/** A dashboard on a test renderer. */
async function setup(width = 120, height = 24, state = freshState()) {
  // Kitty mode sends each key on its own, so the parser never has to wait for the rest of an
  // escape sequence.
  const test = await createTestRenderer({ width, height, kittyKeyboard: true })
  const calls = { quit: 0, run: [] as Tool[], opened: [] as Tool[] }
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
  })
  test.renderer.root.add(app.screen.root)
  test.renderer.keyInput.on('keypress', (key) => app.key(key))
  state.view = VIEW
  app.draw()
  await test.renderOnce()
  return { test, app, calls, state }
}

describe('the dashboard screen', () => {
  test('it draws at every size without spilling over the edge', async () => {
    for (const width of [60, 80, 120, 200]) {
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

  test('it lists the tools and shows their badges', async () => {
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
    ]) {
      expect(frame).toContain(wanted)
    }
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

  test('space picks a tool and a picks them all', async () => {
    const { test, app } = await setup()
    test.mockInput.pressKey(' ')
    expect(app.state.picked.has('vorax')).toBe(true)
    test.mockInput.pressKey(' ')
    expect(app.state.picked.has('vorax')).toBe(false)
    test.mockInput.pressKey('a')
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
    const { test, app } = await setup(120, 24, state)
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
