import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { Session } from '@/app/session'
import { WardenApp } from '@/tui/app'

describe("Warden's terminal app", () => {
  test('r asks for a read and q asks to leave', async () => {
    const test = await createTestRenderer({ width: 120, height: 40, kittyKeyboard: true })
    const session = new Session(1600, [], null, null)
    let reads = 0
    let quits = 0
    const app = new WardenApp(test.renderer, session, {
      onRead: () => {
        reads += 1
      },
      onQuit: () => {
        quits += 1
      },
    })
    test.renderer.keyInput.on('keypress', (key) => app.key(key))
    app.draw('1920 x 1080')
    await test.renderOnce()

    test.mockInput.pressKey('r')
    expect(reads).toBe(1)
    test.mockInput.pressKey('q')
    expect(quits).toBe(1)
    test.renderer.destroy()
  })
})
