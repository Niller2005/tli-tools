import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { Model } from '@/board/board'
import { WardenScreen } from '@/tui/screen'
import { freshView, ringRows, type MoveView } from '@/tui/view'

function model(): Model {
  const cells = Array.from({ length: 16 }, (_, index) => {
    if (index === 0) return { kind: 'office' as const }
    if (index === 3) {
      return { kind: 'inmate' as const, beast: 'wolf' as const, tier: 2, ivory: false, prey: null, event: null }
    }
    return { kind: 'sealed' as const, event: null }
  })
  return new Model({
    v: 1,
    day: 4,
    maxDays: 8,
    step: 'patrol',
    warden: 3,
    dest: [],
    devourUsed: false,
    swapUsed: false,
    huntUsed: false,
    eventKind: 'execution',
    choice: { kind: 'cell', options: [], rerolls: 0 } as never,
    chainArmed: false,
    tools: [],
    vault: [],
    cells,
    objective: null,
  })
}

async function setup(width = 120, height = 40) {
  const test = await createTestRenderer({ width, height, kittyKeyboard: true })
  const screen = new WardenScreen(test.renderer)
  test.renderer.root.add(screen.root)
  const state = freshView('1920 x 1080')
  screen.draw(state)
  await test.renderOnce()
  return { test, screen, state }
}

describe("Warden's terminal screen", () => {
  test('it draws the empty state and the keys', async () => {
    const { test } = await setup()
    const frame = test.captureCharFrame()
    expect(frame).toContain('Warden')
    expect(frame).toContain('Tartarus prison board')
    expect(frame).toContain('game:')
    expect(frame).toContain('1920 x 1080')
    expect(frame).toContain('No board read yet.')
    expect(frame).toContain('r read now')
    expect(frame).toContain('q quit')
    test.renderer.destroy()
  })

  test('it draws the advice, the board and the ranking', async () => {
    const { test, screen, state } = await setup()
    const board = model()
    const advice: MoveView = {
      action: { type: 'patrol', cell: 5 },
      label: 'Go to cell 06',
      why: 'It opens the way to a Chromatic.',
      option: 0,
    }
    state.model = board
    state.day = `Day ${board.day} · 4 to Riot`
    state.advice = advice
    state.ranking = [{ rank: 1, mean: ' 1.25', label: 'Go to cell 06', chosen: true }]
    state.ring = ringRows(board, advice, [], [3])
    screen.draw(state)
    await test.renderOnce()
    const frame = test.captureCharFrame()
    expect(frame).toContain('NEXT MOVE')
    expect(frame).toContain('Go to cell 06')
    expect(frame).toContain('It opens the way to a Chromatic.')
    expect(frame).toContain('@04?')
    expect(frame).toContain('Moves by Riot loot per run')
    expect(frame).toContain('1.25')
    test.renderer.destroy()
  })

  test('it says when the board is closed and when the OCR is missing', async () => {
    const { test, screen, state } = await setup()
    state.captureNote = 'board closed – waiting for the board  log: enable log'
    state.ocrProblem = 'tesseract is not installed'
    screen.draw(state)
    await test.renderOnce()
    const frame = test.captureCharFrame()
    expect(frame).toContain('board closed – waiting for the board')
    expect(frame).toContain('log: enable log')
    expect(frame).toContain('tesseract is not installed')
    test.renderer.destroy()
  })

  test('it fits at terminal sizes', async () => {
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
})
