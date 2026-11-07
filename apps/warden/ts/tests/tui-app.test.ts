import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestRenderer } from '@opentui/core/testing'
import { overlayDir, readCards } from '@tli/overlay'
import { Session } from '@/app/session'
import { loadPng } from '@/reader/mod'
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

  // The destination pick of day 2 starts on the strategy's pick (cell 9) and ends on another (cell 7). Every read of
  // the board during the solve hands the session a new model; the card must still stay as it first was until the
  // solve ends, and only then change to the finished one.
  test('the overlay card stays as it was while a solve runs, however often the board is read again', async () => {
    const frame = new URL('./fixtures/s16-destination-day2-1440p.png', import.meta.url).pathname
    const runtime = mkdtempSync(join(tmpdir(), 'warden-card-'))
    const saved = process.env.XDG_RUNTIME_DIR
    process.env.XDG_RUNTIME_DIR = runtime
    const test = await createTestRenderer({ width: 120, height: 40, kittyKeyboard: true })
    try {
      const session = new Session(1600, [], null, null)
      const app = new WardenApp(test.renderer, session, { onRead() {}, onQuit() {} })
      const card = () => readCards(overlayDir()).find((c) => c.tool === 'warden') ?? null
      const png = loadPng(frame)
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
      session.readLive(png)
      while (!session.solving) {
        session.poll()
        await sleep(10)
      }
      app.draw('')
      const first = card()
      expect(first).not.toBeNull()
      expect(first?.lines).toEqual([])
      let played = false
      while (session.solving) {
        session.readLive(png)
        session.poll()
        app.draw('')
        if (session.solving) {
          played ||= session.rounds >= 150
          expect(card()).toEqual(first)
        }
        await sleep(10)
      }
      expect(played).toBe(true)
      app.draw('')
      expect(card()?.lines?.length).toBeGreaterThan(0)
      expect(card()?.head).not.toBe(first?.head)
    } finally {
      test.renderer.destroy()
      if (saved === undefined) delete process.env.XDG_RUNTIME_DIR
      else process.env.XDG_RUNTIME_DIR = saved
      rmSync(runtime, { recursive: true, force: true })
    }
  })
})
