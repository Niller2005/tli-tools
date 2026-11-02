import { describe, expect, test } from 'bun:test'
import { BOARD_CLOSED_STATUS, minigameCaptureGate, retryCapture, type MinigameView } from '../src/index'

/** A capture that fails the first `fail` grabs and succeeds after, counting what it was asked for. */
function fake(img: number, fail: number) {
  let grabs = 0
  return {
    count: () => grabs,
    capture: {
      grab: async () => {
        grabs += 1
        if (grabs <= fail) throw new Error('game window not found')
        return img
      },
    },
  }
}

/** A view whose Vorax game is closed by a log that can say so. */
const closedView: MinigameView = { warden: 'unknown', vorax: 'closed', arcana: 'unknown', log: 'ok' }

describe('retryCapture', () => {
  test('a failure opens the window and is remembered', async () => {
    let now = 10_000
    const f = fake(1, 1)
    const retry = retryCapture<number>(f.capture, { now: () => now })
    await expect(retry.grab()).rejects.toThrow('game window not found')
    expect(retry.paused()).toBe(true)
    expect(retry.error()).toBe('game window not found')
    now = 11_999
    expect(retry.paused()).toBe(true)
    now = 12_000
    expect(retry.paused()).toBe(false)
  })

  test('a grab inside the window does not reach the capture', async () => {
    let now = 0
    const f = fake(1, 1)
    const retry = retryCapture<number>(f.capture, { now: () => now })
    await expect(retry.grab()).rejects.toThrow('game window not found')
    await expect(retry.grab()).rejects.toThrow('game window not found')
    expect(f.count()).toBe(1)
  })

  test('force goes through the window, and its success clears the error', async () => {
    let now = 0
    const f = fake(7, 1)
    const retry = retryCapture<number>(f.capture, { now: () => now })
    await expect(retry.grab()).rejects.toThrow('game window not found')
    expect(await retry.grab({ force: true })).toBe(7)
    expect(f.count()).toBe(2)
    expect(retry.paused()).toBe(false)
    expect(retry.error()).toBe('')
  })

  test('heldUp says the gate or the error, never both, and nothing when a capture may go ahead', async () => {
    let now = 0
    const f = fake(1, 1)
    const retry = retryCapture<number>(f.capture, { now: () => now })
    const closed = minigameCaptureGate(closedView, 'vorax')
    await expect(retry.grab()).rejects.toThrow('game window not found')
    // a closed gate is the story even while the window is open
    expect(retry.heldUp(closed)).toBe(BOARD_CLOSED_STATUS)
    // an open gate leaves the error as the story
    const open = { allowed: true, status: '' }
    expect(retry.heldUp(open)).toBe('game window not found')
    // a manual read is never held up
    expect(retry.heldUp(closed, true)).toBe('')
    expect(retry.heldUp(open, true)).toBe('')
    // once the window has passed, an open gate holds nothing up
    now = 2000
    expect(retry.heldUp(open)).toBe('')
  })
})
