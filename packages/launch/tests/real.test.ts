// Real checks: a tmux server of its own, and a real child process.
//
// The rest of the suite asks a machine that pretends. These two do not: a throwaway tmux server
// answers for real (panes are made, focused and closed), and the launcher really starts, lists
// and stops a process. Neither looks at the game or the screen: the commands are `sleep`, and
// TLI_NO_CAPTURE is set, as in every test of this repo.
//
// They are skipped when tmux or sleep is not installed.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { Launcher } from '../src/launcher'

/** Reads what a process is, from the file the kernel keeps for it. */
const commandOf = (pid: number): string => {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').trim()
  } catch {
    return ''
  }
}

/**
 * Waits until the say-so comes true, or gives up after the milliseconds.
 *
 * What is waited for lives in another process — a pane in the tmux server, a process in the
 * kernel's table — so there is no promise in this process to await and no fake timer that could
 * drive it: a real, short poll is the only honest way. It is bounded, and it fails with the
 * condition that did not come true rather than after a guessed delay.
 */
const eventually = async (saySo: () => boolean, ms = 5000): Promise<void> => {
  const deadline = Date.now() + ms
  while (!saySo()) {
    if (Date.now() > deadline) throw new Error('it did not happen in time')
    await Bun.sleep(50)
  }
}

describe.skipIf(Bun.which('tmux') === null)('the launcher against a real tmux server', () => {
  const socket = `/tmp/tli-launch-test-${process.pid}.sock`
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TLI_TMUX_SOCKET: socket,
    TLI_TMUX_MODE: 'window',
    TLI_NO_CAPTURE: '1',
  }

  /** Asks the server directly, outside the launcher. */
  const ask = (format: string): string =>
    Bun.spawnSync(['tmux', '-S', socket, 'display-message', '-p', format]).stdout.toString().trim()

  beforeAll(() => {
    const made = Bun.spawnSync(['tmux', '-S', socket, 'new-session', '-d', '-s', 'tli', '-x', '120', '-y', '30', 'sleep', '600'])
    if (made.exitCode !== 0) throw new Error(`the throwaway server would not start: ${made.stderr.toString()}`)
  })

  afterAll(() => {
    Bun.spawnSync(['tmux', '-S', socket, 'kill-server'])
    // a dead server's socket file is left behind; it is this test's to remove
    rmSync(socket, { force: true })
  })

  test('a tool is opened, listed, focused and closed in the server', async () => {
    const launcher = new Launcher({ env })
    const result = launcher.open({ key: 'probe', title: 'Probe', cwd: '/tmp', command: ['sleep', '600'] })
    expect(result.ok).toBe(true)
    expect(result.terminal).toBe('tmux')

    // the window the player sees is not the probe's yet
    expect(ask('#{window_name}')).not.toBe('Probe')

    const entry = launcher.list().find(running => running.id === 'probe')
    expect(entry).toBeDefined()
    expect(entry!.via).toBe('tmux')
    expect(entry!.running).toBe(true)
    expect(entry!.since).toBeGreaterThan(0)
    // the pid is the one tmux named for the pane, and it is the process of the command
    expect(entry!.pid).toBeGreaterThan(1)
    // tmux names the pid before the process has even exec'd, so its command is waited for
    if (existsSync('/proc')) await eventually(() => commandOf(entry!.pid!).includes('sleep'))

    // focusing brings the pane's window to the front and the pane to the eye
    const focused = launcher.focus('probe')
    expect(focused.ok).toBe(true)
    expect(ask('#{window_name}')).toBe('Probe')
    expect(Number(ask('#{pane_pid}'))).toBe(entry!.pid!)

    // closing tells the process of the pane, and only it, to stop; the pane and its window
    // leave the server in their own time, so both are waited for
    const closed = launcher.close('probe')
    expect(closed.ok).toBe(true)
    await eventually(() => !launcher.isOpen('probe') && ask('#{window_name}') !== 'Probe')
    const after = launcher.list().find(running => running.id === 'probe')
    expect(after!.running).toBe(false)
    // tmux does not tell how a pane's process ended, so there is no exit code to keep
    expect(after!.exitCode).toBeNull()
    expect(ask('#{window_name}')).not.toBe('Probe')
  })
})

describe.skipIf(Bun.which('sleep') === null)('the launcher with a real child', () => {
  test('a real process is started, listed, stopped, and its exit code is kept', async () => {
    // `sleep` stands in for the terminal: the launcher starts the program and remembers the
    // child, which is what these checks look at. No window is opened.
    const launcher = new Launcher({ env: { TLI_TERMINAL: 'sleep', PATH: process.env.PATH, TLI_NO_CAPTURE: '1' } })
    const result = launcher.open({ key: 'probe', title: 'Probe', cwd: '/tmp', command: ['600'] })
    expect(result.ok).toBe(true)

    const entry = launcher.list().find(running => running.id === 'probe')
    expect(entry).toBeDefined()
    expect(entry!.pid).toBeGreaterThan(1)
    // the pid is known before the exec, so the command is waited for
    if (existsSync('/proc')) await eventually(() => commandOf(entry!.pid!).includes('600'))
    // the process is there, as the kernel says
    expect(() => process.kill(entry!.pid!, 0)).not.toThrow()

    expect(launcher.close('probe').ok).toBe(true)
    await eventually(() => !launcher.isOpen('probe'))
    const after = launcher.list().find(running => running.id === 'probe')
    expect(after!.running).toBe(false)
    // sleep ends by the signal it was sent: 128 + 15
    expect(after!.exitCode).toBe(143)
  })
})
