import { describe, expect, test, vi } from 'bun:test'
import { createTestRenderer, type TestRendererSetup } from '@opentui/core/testing'
import { startApp, type App } from '../src/app'

/** An app on the test renderer, with the fake clock already turning. */
async function setup(): Promise<{
  app: App
  test: TestRendererSetup
  seen: { keys: string[]; quits: number; ticks: number; saves: number; shutdowns: number }
}> {
  const test = await createTestRenderer({ width: 80, height: 24, kittyKeyboard: true })
  const seen = { keys: [] as string[], quits: 0, ticks: 0, saves: 0, shutdowns: 0 }
  vi.useFakeTimers()
  const app = await startApp({
    renderer: test.renderer,
    signals: [],
    onShutdown: () => {
      seen.shutdowns += 1
    },
    onKey: (key) => {
      seen.keys.push(key.name)
    },
    onQuit: () => {
      seen.quits += 1
    },
    onTick: () => {
      seen.ticks += 1
    },
    tickEveryMs: 1000,
    onSave: () => {
      seen.saves += 1
    },
    saveEveryMs: 30_000,
  })
  return { app, test, seen }
}

/** Patches `process.exit` so an app that quits does not end the test run. */
function noExit(onExit: (code: number) => void): () => void {
  const real = process.exit
  process.exit = ((code?: number) => {
    onExit(code ?? 0)
  }) as typeof process.exit
  return () => {
    process.exit = real as typeof process.exit
  }
}

describe('the keys', () => {
  test('the app sees every key but ctrl+c, which quits', async () => {
    const { app, test, seen } = await setup()
    test.mockInput.pressKey('j')
    test.mockInput.pressKey('q')
    expect(seen.keys).toEqual(['j', 'q'])
    test.mockInput.pressCtrlC()
    expect(seen.keys).toEqual(['j', 'q'])
    expect(seen.quits).toBe(1)
    vi.useRealTimers()
    await app.stop()
    await test.dispose()
  })

  test('ctrl+c quits when the app says nothing about leaving', async () => {
    const test = await createTestRenderer({ width: 80, height: 24, kittyKeyboard: true })
    let shutdowns = 0
    const exits: number[] = []
    const { promise: left, resolve: leftOnce } = Promise.withResolvers<void>()
    const restore = noExit((code) => {
      exits.push(code)
      leftOnce()
    })
    const app = await startApp({
      renderer: test.renderer,
      signals: [],
      onShutdown: () => {
        shutdowns += 1
      },
      onKey: () => {},
    })
    test.mockInput.pressCtrlC()
    await left
    await app.done
    expect(shutdowns).toBe(1)
    expect(exits).toEqual([0])
    restore()
    await test.dispose()
  })
})

describe('the way out', () => {
  test('quit puts the terminal back and ends the process', async () => {
    const { app, test, seen } = await setup()
    const exits: number[] = []
    const restore = noExit((code) => exits.push(code))
    await app.quit()
    expect(seen.shutdowns).toBe(1)
    expect(exits).toEqual([0])
    restore()
    vi.useRealTimers()
    await test.dispose()
  })

  test('a signal puts the terminal back and ends the process', async () => {
    const test = await createTestRenderer({ width: 80, height: 24, kittyKeyboard: true })
    const order: string[] = []
    const { promise: left, resolve: leftOnce } = Promise.withResolvers<void>()
    const restore = noExit((code) => {
      order.push(`exit ${code}`)
      leftOnce()
    })
    const app = await startApp({
      renderer: test.renderer,
      signals: ['SIGUSR2'],
      onShutdown: () => {
        order.push('shutdown')
      },
    })
    process.kill(process.pid, 'SIGUSR2')
    await left
    await app.done
    expect(order).toEqual(['shutdown', 'exit 0'])
    restore()
    await test.dispose()
  })

  test('however often stop is called, the app shuts down once', async () => {
    const { app, test, seen } = await setup()
    await app.stop()
    await app.stop()
    expect(seen.shutdowns).toBe(1)
    await app.done
    vi.useRealTimers()
    await test.dispose()
  })
})

describe('the cadence', () => {
  test('the tick comes once a second, and stops when the app does', async () => {
    const { app, test, seen } = await setup()
    vi.advanceTimersByTime(2_500)
    expect(seen.ticks).toBe(2)
    await app.stop()
    vi.advanceTimersByTime(60_000)
    expect(seen.ticks).toBe(2)
    vi.useRealTimers()
    await test.dispose()
  })

  test('the save comes every 30 seconds, and stops when the app does', async () => {
    const { app, test, seen } = await setup()
    vi.advanceTimersByTime(60_000)
    expect(seen.saves).toBe(2)
    await app.stop()
    vi.advanceTimersByTime(60_000)
    expect(seen.saves).toBe(2)
    vi.useRealTimers()
    await test.dispose()
  })
})
