import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import type { Advice } from '@/strategy/advisor'
import { VoraxApp } from '../scripts/tui/app'
import { reportLines } from '../scripts/tui/report'
import { freshView, type Board, type ViewState } from '../scripts/tui/view'

/** The advice the instant answer gives: the first card, on the second tank. */
const QUICK: Advice = {
  best: { index: 0, targets: [1], value: 1200 },
  ranking: [
    { index: 0, targets: [1], value: 1200 },
    { index: 1, targets: [0], value: 900 },
  ],
  board: 5000,
  plan: false,
  final: true,
  ms: 12,
  unknown: [],
}

/** A board the reader worked out: round 6, three cards, two tanks. */
function board(): Board {
  return {
    x: {
      tanks: [
        { archetype: 'pest', rarity: 'normal', activity: 1000, quantity: 36 },
        { archetype: 'aemberon', rarity: 'magic', activity: 500, quantity: 24 },
        null,
        null,
        null,
        null,
      ],
      hand: ['Spinal Solution', 'Bone Sentry', 'Agito'],
      instruments: ['Limb-Stitching Specimen'],
      instrumentRounds: [1],
      phase: 'potion',
      round: 6,
      potionRefreshes: 2,
      instrumentRefreshes: 1,
    },
    round: 6,
    phase: 'potion',
    warnings: ['check tank 3'],
  }
}

/** A state with a board and its advice on it. */
function played(): ViewState {
  const state = freshView(925_000, true)
  state.board = board()
  state.quick = QUICK
  state.capture = 'window 12 "Torchlight: Infinite"'
  state.log = '/home/player/.steam/steam/steamapps/common/Torchlight Infinite/logs/UE_game.log'
  state.logLines = 421
  state.pictures = 7
  return state
}

/** The helper on a test renderer. */
async function setup(width = 120, height = 30, state = freshView(925_000, true)) {
  // The kitty keyboard protocol sends every key on its own, so the escape key does not have to
  // wait for the terminal's parser to see whether more of a sequence is coming.
  const test = await createTestRenderer({ width, height, kittyKeyboard: true })
  const calls = { quit: 0, snap: 0, target: [] as number[], deep: [] as boolean[] }
  const app = new VoraxApp(test.renderer, state, {
    onQuit: () => {
      calls.quit += 1
    },
    onSnap: () => {
      calls.snap += 1
    },
    onTarget: (target) => {
      calls.target.push(target)
    },
    onDeep: (deep) => {
      calls.deep.push(deep)
    },
  })
  test.renderer.keyInput.on('keypress', (key) => app.key(key))
  app.draw()
  await test.renderOnce()
  return { test, app, calls, state }
}

describe('the helper screen', () => {
  test('it draws at every size, from narrow to wide and tiny to tall', async () => {
    for (const width of [60, 80, 120, 200]) {
      for (const height of [10, 24, 50]) {
        const { test } = await setup(width, height, played())
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

  test('the header shows the target, the game and the log', async () => {
    const { test } = await setup(120, 30, played())
    const frame = test.captureCharFrame()
    expect(frame).toContain('Vorax Helper')
    expect(frame).toContain('target 925,000')
    expect(frame).toContain('window 12')
    expect(frame).toContain('UE_game.log')
    expect(frame).toContain('421 lines read')
    expect(frame).toContain('7 pictures read')
    test.renderer.destroy()
  })

  test('the header says when the log gate is closed', async () => {
    const state = freshView(925_000, true)
    state.capture = 'board closed – waiting for the board'
    const { test } = await setup(120, 30, state)
    expect(test.captureCharFrame()).toContain('board closed – waiting for the board')
    test.renderer.destroy()
  })

  test('without a board it says what to do', async () => {
    const { test } = await setup(120, 30)
    const frame = test.captureCharFrame()
    expect(frame).toContain('Open Surgical Preparation')
    expect(frame).toContain('Next move')
    expect(frame).not.toContain('Options')
    expect(frame).not.toContain('Board')
    test.renderer.destroy()
  })

  test('the board is on the screen, with the move and the warnings', async () => {
    const { test } = await setup(140, 30, played())
    const frame = test.captureCharFrame()
    expect(frame).toContain('Spinal Solution → tank 2')
    expect(frame).toContain('best for this round alone')
    expect(frame).toContain('Round 6 · potion pick')
    expect(frame).toContain('check tank 3')
    expect(frame).toContain('1,000 × 36')
    expect(frame).toContain('Spinal Solution | Bone Sentry | Agito')
    expect(frame).toContain('Limb-Stitching Specimen')
    test.renderer.destroy()
  })

  test('the deep check is on the screen while it runs', async () => {
    const state = played()
    state.deep = {
      rows: [
        {
          key: 'a',
          label: 'Spinal Solution',
          refresh: false,
          index: 0,
          targets: [1],
          n: 60,
          hits: 43,
          p: 0.71,
          lo: 0.6,
          hi: 0.8,
          mean: 900_000,
          p10: 700_000,
          diff: 0,
          diffCi: 0.01,
          out: false,
        },
      ],
      done: 12,
      total: 60,
      finished: false,
    }
    const { test } = await setup(140, 30, state)
    const frame = test.captureCharFrame()
    expect(frame).toContain('Chance to reach 925,000 · checking 12/60')
    expect(frame).toContain('71%')
    expect(frame).toContain('avg 900k')
    test.renderer.destroy()
  })

  test('a protocol round says there is nothing to work out', async () => {
    const state = played()
    state.board = { ...board(), phase: 'protocol', round: 11 }
    const { test } = await setup(140, 30, state)
    const frame = test.captureCharFrame()
    expect(frame).toContain('Protocol pick')
    expect(frame).toContain('Play it yourself')
    test.renderer.destroy()
  })

  test('q quits, r reads now, t changes the target and d turns the deep check off', async () => {
    const { test, calls, state } = await setup(120, 30, played())
    test.mockInput.pressKey('q')
    expect(calls.quit).toBe(1)
    test.mockInput.pressKey('r')
    expect(calls.snap).toBe(1)
    test.mockInput.pressKey('t')
    expect(state.target).toBe(1_120_000)
    expect(calls.target).toEqual([1_120_000])
    test.mockInput.pressKey('t')
    expect(state.target).toBe(600_000)
    test.mockInput.pressKey('d')
    expect(state.deepOn).toBe(false)
    expect(calls.deep).toEqual([false])
    test.renderer.destroy()
  })

  test('the deep check is shown as on and off', async () => {
    const { test, app } = await setup(120, 30, played())
    expect(test.captureCharFrame()).toContain('deep check on')
    app.state.deepOn = false
    app.draw()
    await test.renderOnce()
    expect(test.captureCharFrame()).toContain('deep check off')
    test.renderer.destroy()
  })

  test('the report prints the advice as plain text', async () => {
    const lines = reportLines(played())
    const text = lines.join('\n')
    expect(text).toContain('Vorax Helper · Linux terminal   target 925,000')
    expect(text).toContain('game: window 12 "Torchlight: Infinite"')
    expect(text).toContain('Spinal Solution → tank 2')
    expect(text).toContain('Round 6 · potion pick')
    expect(text).toContain('! check tank 3')
    expect(text).toContain('r read now · t target · d deep check on · q quit')
    expect(text).not.toContain('\x1b')
  })
})
