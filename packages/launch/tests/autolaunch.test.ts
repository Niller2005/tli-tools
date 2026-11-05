import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MinigameView } from '@tli/gamelog'
import { AutoLauncher, newlyOpen, statesOf, toolsToAutoLaunch } from '../src/autolaunch'
import { Launcher, type Child } from '../src/launcher'
import { CLAIM_MS, claimOpen, isRunning, registerRunning, releaseClaim } from '../src/running'
import { defaultSettings, setToolSettings } from '../src/settings'
import { toolById } from '../src/tools'

const view = (warden: MinigameView['warden'], vorax: MinigameView['vorax'], arcana: MinigameView['arcana']): MinigameView => ({
  warden,
  vorax,
  arcana,
  log: 'ok',
})

describe('the auto-launch transitions', () => {
  test('a closed board that opens is a transition', () => {
    expect(newlyOpen(statesOf(view('closed', 'closed', 'closed')), view('open', 'closed', 'closed'))).toEqual(['warden'])
    expect(newlyOpen(statesOf(view('closed', 'closed', 'closed')), view('closed', 'open', 'closed'))).toEqual(['vorax'])
    expect(newlyOpen(statesOf(view('closed', 'closed', 'closed')), view('closed', 'closed', 'open'))).toEqual(['arcana'])
  })

  test('a board that stays open is not a transition, and neither is one that closes', () => {
    expect(newlyOpen(statesOf(view('open', 'closed', 'unknown')), view('open', 'closed', 'unknown'))).toEqual([])
    expect(newlyOpen(statesOf(view('open', 'closed', 'unknown')), view('closed', 'closed', 'unknown'))).toEqual([])
  })

  test('the first sample is not a transition, however open the board already is', () => {
    expect(newlyOpen(statesOf(null), view('open', 'open', 'open'))).toEqual([])
  })

  test('a log that said nothing and then says the board is open is a transition', () => {
    expect(newlyOpen(statesOf(view('unknown', 'unknown', 'unknown')), view('open', 'unknown', 'unknown'))).toEqual(['warden'])
  })

  test('no view means nothing opens', () => {
    expect(newlyOpen(statesOf(view('closed', 'closed', 'closed')), null)).toEqual([])
  })
})

describe('the tools that open by themselves', () => {
  test('only the tools of the minigames that opened, with auto-launch on and nothing running', () => {
    const settings = setToolSettings(
      setToolSettings(defaultSettings(), 'warden', { autoLaunch: true }),
      'arcana',
      { autoLaunch: true },
    )
    const tools = toolsToAutoLaunch(['warden', 'arcana'], settings, () => false)
    expect(tools.map(tool => tool.id)).toEqual(['warden', 'arcana'])
  })

  test('a tool that is already running is not opened again', () => {
    const settings = setToolSettings(defaultSettings(), 'warden', { autoLaunch: true })
    const tools = toolsToAutoLaunch(['warden'], settings, id => id === 'warden')
    expect(tools).toEqual([])
  })

  test('auto-launch is off unless the player turns it on', () => {
    expect(toolsToAutoLaunch(['warden', 'vorax', 'arcana'], defaultSettings(), () => false)).toEqual([])
  })

  test('a tool without the minigame that opened is not opened', () => {
    const settings = setToolSettings(defaultSettings(), 'tracker', { autoLaunch: true })
    expect(toolsToAutoLaunch(['warden'], settings, () => false)).toEqual([])
    expect(toolById('tracker')?.game).toBeUndefined()
  })
})

describe('a program that opens the tools without the dashboard', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tli-auto-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const opened = (): { launcher: Launcher; started: string[][] } => {
    const started: string[][] = []
    const launcher = new Launcher({
      env: { TLI_TERMINAL: 'ghostty' },
      host: {
        which: (program: string) => `/usr/bin/${program}`,
        spawn: (argv): Child => {
          started.push(argv)
          return { pid: 4242, exited: new Promise<number>(() => {}) }
        },
      },
    })
    return { launcher, started }
  }
  const on = setToolSettings(defaultSettings(), 'warden', { autoLaunch: true })
  const closed = view('closed', 'closed', 'closed')
  const wardenOpen = view('open', 'closed', 'closed')

  test('the tool opens when its board opens after the first sample, and only once', () => {
    const { launcher, started } = opened()
    const auto = new AutoLauncher({ launcher, argv: ['--log=/tmp/UE_game.log'], dir, which: () => '/usr/bin/x' })
    expect(auto.step(closed, on)).toEqual([])
    const first = auto.step(wardenOpen, on)
    expect(first.map(launched => launched.tool.id)).toEqual(['warden'])
    expect(first[0]?.result.ok).toBe(true)
    expect(started).toHaveLength(1)
    // the board stays open, then closes and opens again: the window is still there
    expect(auto.step(wardenOpen, on)).toEqual([])
    auto.step(closed, on)
    expect(auto.step(wardenOpen, on)).toEqual([])
    expect(started).toHaveLength(1)
  })

  test('a board that is open at the first sample opens nothing', () => {
    const { launcher, started } = opened()
    const auto = new AutoLauncher({ launcher, argv: [], dir, which: () => '/usr/bin/x' })
    expect(auto.step(wardenOpen, on)).toEqual([])
    expect(started).toEqual([])
  })

  test('a tool that another program says it runs is not opened', () => {
    const { launcher, started } = opened()
    const release = registerRunning('warden', dir)
    const auto = new AutoLauncher({ launcher, argv: [], dir, which: () => '/usr/bin/x' })
    auto.step(closed, on)
    expect(auto.step(wardenOpen, on)).toEqual([])
    expect(started).toEqual([])
    release()
  })

  test('two programs that see the same board open do not both open the tool', () => {
    const one = opened()
    const two = opened()
    const a = new AutoLauncher({ launcher: one.launcher, argv: [], dir, which: () => '/usr/bin/x' })
    const b = new AutoLauncher({ launcher: two.launcher, argv: [], dir, which: () => '/usr/bin/x' })
    a.step(closed, on)
    b.step(closed, on)
    a.step(wardenOpen, on)
    b.step(wardenOpen, on)
    expect(one.started.length + two.started.length).toBe(1)
  })

  test('a tool that could not be opened leaves the way free for the next open', () => {
    const { launcher } = opened()
    const auto = new AutoLauncher({ launcher, argv: [], dir, which: () => null })
    auto.step(closed, on)
    const failed = auto.step(wardenOpen, on)
    expect(failed[0]?.result.ok).toBe(false)
    expect(claimOpen('warden', dir)).toBe(true)
  })
})

describe('the tools that say they run', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tli-run-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('a tool runs from the time it says so until it is released', () => {
    expect(isRunning('warden', dir)).toBe(false)
    const release = registerRunning('warden', dir)
    expect(isRunning('warden', dir)).toBe(true)
    release()
    expect(isRunning('warden', dir)).toBe(false)
  })

  test('a pid that no process has is not a running tool', () => {
    // the largest pid Linux hands out is 2^22; no process has the one past it
    const release = registerRunning('warden', dir, 2 ** 22 + 1)
    expect(isRunning('warden', dir)).toBe(false)
    release()
  })

  test('the first of two processes of a tool, ending, does not take the second one away', () => {
    const first = registerRunning('warden', dir, process.pid)
    const second = registerRunning('warden', dir, 1)
    first()
    expect(isRunning('warden', dir)).toBe(true)
    second()
    expect(isRunning('warden', dir)).toBe(false)
  })

  test('a claim holds the others off until it is released or goes stale', () => {
    expect(claimOpen('warden', dir, 1_000)).toBe(true)
    expect(claimOpen('warden', dir, 1_000 + CLAIM_MS - 1)).toBe(false)
    expect(claimOpen('warden', dir, 1_000 + CLAIM_MS)).toBe(true)
    releaseClaim('warden', dir)
    expect(claimOpen('warden', dir, 1_001)).toBe(true)
  })
})
