import { describe, expect, test } from 'bun:test'
import { childEnv, childFlags, openTool } from '../src/open'
import { Launcher, type Child, type LauncherHost } from '../src/launcher'
import {
  alacrittyArgv,
  findTerminal,
  footArgv,
  ghosttyArgv,
  kittyArgv,
  weztermArgv,
  xdgTerminalExecArgv,
  xtermArgv,
} from '../src/terminal'
import { parsePaneId, shellQuote, tmuxArgv, tmuxMode, tmuxPanesArgv, tmuxSocket } from '../src/tmux'
import { TOOLS, missing, toolById } from '../src/tools'

const REQUEST = {
  title: 'Vorax Helper',
  cwd: '/home/player/tli-tools/apps/vorax',
  command: ['bun', 'scripts/tui.ts'],
}

describe('the argv of each terminal', () => {
  test('ghostty takes the title and the directory as config keys', () => {
    expect(ghosttyArgv(REQUEST)).toEqual([
      'ghostty',
      '--title=Vorax Helper',
      '--working-directory=/home/player/tli-tools/apps/vorax',
      '-e',
      'bun',
      'scripts/tui.ts',
    ])
  })

  test('kitty takes the title and the directory as options', () => {
    expect(kittyArgv(REQUEST)).toEqual([
      'kitty',
      '--title',
      'Vorax Helper',
      '--directory',
      '/home/player/tli-tools/apps/vorax',
      '--',
      'bun',
      'scripts/tui.ts',
    ])
  })

  test('foot takes the title and the directory as options', () => {
    expect(footArgv(REQUEST)).toEqual([
      'foot',
      '--title=Vorax Helper',
      '--working-directory=/home/player/tli-tools/apps/vorax',
      'bun',
      'scripts/tui.ts',
    ])
  })

  test('alacritty takes the title and the directory as options', () => {
    expect(alacrittyArgv(REQUEST)).toEqual([
      'alacritty',
      '--title',
      'Vorax Helper',
      '--working-directory',
      '/home/player/tli-tools/apps/vorax',
      '-e',
      'bun',
      'scripts/tui.ts',
    ])
  })

  test('wezterm starts the command behind a dash', () => {
    expect(weztermArgv(REQUEST)).toEqual([
      'wezterm',
      'start',
      '--cwd',
      '/home/player/tli-tools/apps/vorax',
      '--',
      'bun',
      'scripts/tui.ts',
    ])
  })

  test('xterm takes the title with a capital T', () => {
    expect(xtermArgv(REQUEST)).toEqual([
      'xterm',
      '-T',
      'Vorax Helper',
      '-e',
      'bun',
      'scripts/tui.ts',
    ])
  })

  test('xdg-terminal-exec only needs the command', () => {
    expect(xdgTerminalExecArgv(REQUEST)).toEqual(['xdg-terminal-exec', 'bun', 'scripts/tui.ts'])
  })
})

describe('the terminal that is used', () => {
  const installed = (...programs: string[]): ((program: string) => string | null) => {
    return (program: string) => (programs.includes(program) ? `/usr/bin/${program}` : null)
  }

  test('TLI_TERMINAL is the player\'s own choice and is used first', () => {
    const terminal = findTerminal({
      env: { TLI_TERMINAL: 'kitty' },
      which: installed('ghostty', 'kitty'),
    })
    expect(terminal?.id).toBe('kitty')
  })

  test('TERMINAL is used when it names a terminal', () => {
    const terminal = findTerminal({
      env: { TERMINAL: 'alacritty' },
      which: installed('ghostty', 'alacritty'),
    })
    expect(terminal?.id).toBe('alacritty')
  })

  test('TERMINAL is the name of the colours and not of a program, so it is passed over', () => {
    const terminal = findTerminal({
      env: { TERMINAL: 'xterm-256color' },
      which: installed('ghostty'),
    })
    expect(terminal?.id).toBe('ghostty')
  })

  test('the terminals are tried in order', () => {
    const terminal = findTerminal({ env: {}, which: installed('foot', 'xterm', 'wezterm') })
    expect(terminal?.id).toBe('foot')
  })

  test('xdg-terminal-exec comes before the last resort', () => {
    const terminal = findTerminal({ env: {}, which: installed('xterm', 'xdg-terminal-exec') })
    expect(terminal?.id).toBe('xdg-terminal-exec')
  })

  test('without a terminal there is nothing to open', () => {
    expect(findTerminal({ env: {}, which: installed() })).toBeNull()
  })

  test('a program of the player\'s own is run as it is', () => {
    const terminal = findTerminal({ env: { TLI_TERMINAL: 'myterm' }, which: installed() })
    expect(terminal?.argv(REQUEST)).toEqual(['myterm', 'bun', 'scripts/tui.ts'])
  })
})

/** A machine that starts nothing, and remembers what it was asked. */
function fakeHost(): {
  host: Partial<LauncherHost>
  started: string[][]
  run: string[][]
} {
  const started: string[][] = []
  const run: string[][] = []
  return {
    host: {
      which: (program: string) => `/usr/bin/${program}`,
      spawn: (argv): Child => {
        started.push(argv)
        return { exited: Promise.resolve(0) }
      },
      run: (argv): string => {
        run.push(argv)
        return ''
      },
    },
    started,
    run,
  }
}

describe('the launcher', () => {
  test('a window is opened with the command and the environment of the parent', () => {
    const { host, started } = fakeHost()
    const launcher = new Launcher({ env: { TLI_TERMINAL: 'ghostty' }, host })
    const result = launcher.open({ ...REQUEST, env: { NO_COLOR: '1' } })
    expect(result.ok).toBe(true)
    expect(result.terminal).toBe('ghostty')
    expect(result.message).toContain('Vorax Helper')
    expect(started).toHaveLength(1)
    expect(started[0]).toEqual(ghosttyArgv(REQUEST))
  })

  test('a second window for the same tool is not opened', () => {
    const { host, started } = fakeHost()
    const launcher = new Launcher({ env: { TLI_TERMINAL: 'ghostty' }, host })
    launcher.open({ ...REQUEST, key: 'vorax' })
    const second = launcher.open({ ...REQUEST, key: 'vorax' })
    expect(second.ok).toBe(false)
    expect(second.reason).toBe('already-open')
    expect(second.message).toContain('already open')
    expect(started).toHaveLength(1)
  })

  test('the tool can be opened again once its window has gone', async () => {
    const { promise, resolve } = Promise.withResolvers<number>()
    const launcher = new Launcher({
      env: { TLI_TERMINAL: 'ghostty' },
      host: {
        which: (program: string) => `/usr/bin/${program}`,
        spawn: (): Child => ({ exited: promise }),
      },
    })
    launcher.open({ ...REQUEST, key: 'vorax' })
    expect(launcher.isOpen('vorax')).toBe(true)
    resolve(0)
    await promise
    expect(launcher.isOpen('vorax')).toBe(false)
    expect(launcher.open({ ...REQUEST, key: 'vorax' }).ok).toBe(true)
  })

  test('without a terminal it says so', () => {
    const launcher = new Launcher({
      env: {},
      host: { which: () => null },
    })
    const result = launcher.open(REQUEST)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no-terminal')
    expect(result.message).toContain('TLI_TERMINAL')
  })

  test('a terminal that will not start is said so', () => {
    const launcher = new Launcher({
      env: { TLI_TERMINAL: 'ghostty' },
      host: {
        which: (program: string) => `/usr/bin/${program}`,
        spawn: () => {
          throw new Error('no such file')
        },
      },
    })
    const result = launcher.open(REQUEST)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('failed')
    expect(result.message).toContain('ghostty')
  })
})

describe('the tmux window', () => {
  test('a pane beside the tracker is the default', () => {
    expect(tmuxMode({})).toBe('split-h')
    expect(tmuxMode({ TLI_TMUX_MODE: 'split-h' })).toBe('split-h')
  })

  test('the mode can be a pane below or a window of its own', () => {
    expect(tmuxMode({ TLI_TMUX_MODE: 'split-v' })).toBe('split-v')
    expect(tmuxMode({ TLI_TMUX_MODE: 'window' })).toBe('window')
  })

  test('an unknown mode is the default', () => {
    expect(tmuxMode({ TLI_TMUX_MODE: 'sideways' })).toBe('split-h')
  })

  test('a split is made beside the tracker, and it does not take the focus', () => {
    const argv = tmuxArgv(REQUEST, { mode: 'split-h', socket: null, envFlag: true })
    expect(argv).toEqual([
      'tmux',
      'split-window',
      '-h',
      '-d',
      '-P',
      '-F',
      '#{pane_id}',
      '-c',
      '/home/player/tli-tools/apps/vorax',
      "'bun' 'scripts/tui.ts'",
    ])
  })

  test('a split can be made below the tracker', () => {
    const argv = tmuxArgv(REQUEST, { mode: 'split-v', socket: null, envFlag: true })
    expect(argv).toContain('-v')
    expect(argv).toContain('split-window')
  })

  test('a window of its own has a name', () => {
    const argv = tmuxArgv(REQUEST, { mode: 'window', socket: null, envFlag: true })
    expect(argv).toContain('new-window')
    expect(argv).toContain('Vorax Helper')
    expect(argv).toContain('-d')
  })

  test('the socket of the session is used when there is one', () => {
    const argv = tmuxArgv(REQUEST, {
      mode: 'split-h',
      socket: { flag: '-S', name: '/tmp/tmux-1000/default' },
      envFlag: true,
    })
    expect(argv.slice(0, 3)).toEqual(['tmux', '-S', '/tmp/tmux-1000/default'])
  })

  test('the environment is given to tmux when it takes it', () => {
    const argv = tmuxArgv(
      { ...REQUEST, env: { NO_COLOR: '1' } },
      { mode: 'split-h', socket: null, envFlag: true },
    )
    expect(argv).toContain('-e')
    expect(argv).toContain('NO_COLOR=1')
  })

  test('an older tmux gets the environment in front of the command', () => {
    const argv = tmuxArgv(
      { ...REQUEST, env: { NO_COLOR: '1' } },
      { mode: 'split-h', socket: null, envFlag: false },
    )
    expect(argv).not.toContain('-e')
    expect(argv[argv.length - 1]).toBe("env 'NO_COLOR=1' 'bun' 'scripts/tui.ts'")
  })

  test('the command is quoted the way the shell reads it', () => {
    const argv = tmuxArgv(
      { ...REQUEST, command: ['sh', '-c', 'echo "hi there"'] },
      { mode: 'split-h', socket: null, envFlag: true },
    )
    expect(argv[argv.length - 1]).toBe(`'sh' '-c' 'echo "hi there"'`)
  })

  test('a quote in the command does not end the quoting', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
  })

  test('the panes of the session are asked for', () => {
    expect(tmuxPanesArgv(null)).toEqual([
      'tmux',
      'list-panes',
      '-a',
      '-F',
      '#{pane_id}',
    ])
  })

  test('the pane id is read from what tmux wrote', () => {
    expect(parsePaneId('%7\n')).toBe('%7')
    expect(parsePaneId('no pane here\n')).toBeNull()
  })

  test('the socket of the session is in TMUX', () => {
    expect(tmuxSocket({ TMUX: '/tmp/tmux-1000/default,1234,0' })).toEqual({
      flag: '-S',
      name: '/tmp/tmux-1000/default',
    })
  })

  test('a socket that is named is used', () => {
    expect(tmuxSocket({ TLI_TMUX_SOCKET: 'other' })).toEqual({ flag: '-L', name: 'other' })
    expect(tmuxSocket({ TLI_TMUX_SOCKET: '/tmp/other.sock' })).toEqual({
      flag: '-S',
      name: '/tmp/other.sock',
    })
  })
})

describe('the launcher in tmux', () => {
  /** A tmux that says which pane it made, and which panes it has. */
  function tmuxHost(panes: string[] = []): Partial<LauncherHost> {
    return {
      which: (program: string) => `/usr/bin/${program}`,
      run: (argv): string => {
        if (argv.includes('list-commands')) {
          return 'split-window (splitw) [-h] [-c start-directory] [-e environment] [-F format]\n'
        }
        if (argv.includes('list-panes')) return panes.join('\n')
        return '%3\n'
      },
    }
  }

  test('a pane is made instead of a window', () => {
    const host = tmuxHost()
    const launcher = new Launcher({ env: { TMUX: '/tmp/tmux-1000/default,1,0' }, host })
    const result = launcher.open({ ...REQUEST, key: 'vorax' })
    expect(result.ok).toBe(true)
    expect(result.terminal).toBe('tmux')
    expect(result.message).toContain('tmux pane')
  })

  test('the pane is asked for with the split and the directory', () => {
    const seen: string[][] = []
    const launcher = new Launcher({
      env: { TMUX: '/tmp/tmux-1000/default,1,0' },
      host: {
        ...tmuxHost(),
        run: (argv): string => {
          seen.push(argv)
          if (argv.includes('list-commands')) return 'split-window [-h] [-e environment]\n'
          return '%3\n'
        },
      },
    })
    launcher.open(REQUEST)
    const split = seen.find(argv => argv.includes('split-window'))
    expect(split).toBeDefined()
    expect(split).toContain('-h')
    expect(split).toContain('-d')
    expect(split).toContain('/home/player/tli-tools/apps/vorax')
  })

  test('a pane that is still there is not made twice', () => {
    const host = tmuxHost(['%3'])
    const launcher = new Launcher({ env: { TMUX: '/tmp/tmux-1000/default,1,0' }, host })
    launcher.open({ ...REQUEST, key: 'vorax' })
    const second = launcher.open({ ...REQUEST, key: 'vorax' })
    expect(second.ok).toBe(false)
    expect(second.reason).toBe('already-open')
  })

  test('a pane that has gone is made again', () => {
    const launcher = new Launcher({
      env: { TMUX: '/tmp/tmux-1000/default,1,0' },
      host: tmuxHost([]),
    })
    launcher.open({ ...REQUEST, key: 'vorax' })
    expect(launcher.isOpen('vorax')).toBe(false)
    expect(launcher.open({ ...REQUEST, key: 'vorax' }).ok).toBe(true)
  })

  test('the player\'s own terminal is stronger than being in tmux', () => {
    const launcher = new Launcher({
      env: { TMUX: '/tmp/tmux-1000/default,1,0', TLI_TERMINAL: 'ghostty' },
      host: {
        which: (program: string) => `/usr/bin/${program}`,
        spawn: (): Child => ({ exited: Promise.resolve(0) }),
        run: (): string => '%3\n',
      },
    })
    const result = launcher.open(REQUEST)
    expect(result.terminal).toBe('ghostty')
  })

  test('without tmux there is a terminal emulator', () => {
    const launcher = new Launcher({
      env: { TLI_TERMINAL: 'ghostty' },
      host: {
        which: (program: string) => `/usr/bin/${program}`,
        spawn: (): Child => ({ exited: Promise.resolve(0) }),
        run: (): string => '',
      },
    })
    expect(launcher.open(REQUEST).terminal).toBe('ghostty')
  })

  test('tmux that will not make a pane is said so', () => {
    const launcher = new Launcher({
      env: { TMUX: '/tmp/tmux-1000/default,1,0' },
      host: {
        which: (program: string) => `/usr/bin/${program}`,
        run: (): string => 'no server running\n',
      },
    })
    const result = launcher.open(REQUEST)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('failed')
    expect(result.message).toContain('tmux')
  })
})

describe('the tools', () => {
  test('the table has the minigames and the tracker in it', () => {
    expect(TOOLS.map(tool => tool.id)).toEqual(['vorax', 'warden', 'tracker', 'arcana'])
    expect(toolById('arcana')?.name).toBe('Arcana (Tarot Path)')
    expect(toolById('nothing')).toBeUndefined()
  })

  test('the programs a tool needs are looked for', () => {
    const vorax = toolById('vorax')
    expect(vorax).toBeDefined()
    expect(missing(vorax!, program => (program === 'bun' ? '/usr/bin/bun' : null))).toEqual([
      'tesseract',
    ])
  })
})

describe('the flags the child gets', () => {
  const arcana = toolById('arcana')
  const warden = toolById('warden')

  test('the log of the parent is passed on to the tools that read it', () => {
    expect(childFlags(arcana!, ['--log=/tmp/UE_game.log'])).toEqual(['--log=/tmp/UE_game.log'])
  })

  test('a tool that does not read the log does not get the flag', () => {
    expect(childFlags(warden!, ['--log=/tmp/UE_game.log'])).toEqual([])
  })

  test('the colours stay off when they were off', () => {
    expect(childFlags(arcana!, ['--no-color'])).toEqual(['--no-color'])
  })

  test('without the flags in the parent there is nothing to pass on', () => {
    expect(childFlags(arcana!, [])).toEqual([])
  })

  test('the colours of the parent are given to the child', () => {
    expect(childEnv({ NO_COLOR: '1', PATH: '/usr/bin' })).toEqual({
      NO_COLOR: '1',
      PATH: '/usr/bin',
    })
  })

  test('without NO_COLOR there is nothing to give', () => {
    expect(childEnv({ PATH: '/usr/bin' })).toEqual({ PATH: '/usr/bin' })
  })
})

describe('opening a tool', () => {
  test('the command of the tool is started with the flags of the parent', () => {
    const started: string[][] = []
    const launcher = new Launcher({
      env: { TLI_TERMINAL: 'ghostty' },
      host: {
        which: (program: string) => `/usr/bin/${program}`,
        spawn: (argv): Child => {
          started.push(argv)
          return { exited: Promise.resolve(0) }
        },
      },
    })
    const arcana = toolById('arcana')
    expect(arcana).toBeDefined()
    const result = openTool(launcher, arcana!, {
      parentArgv: ['--log=/tmp/UE_game.log'],
      which: () => '/usr/bin/bun',
    })
    expect(result.ok).toBe(true)
    expect(started[0]?.slice(-2)).toEqual(['src/tui.ts', '--log=/tmp/UE_game.log'])
  })

  test('a tool whose programs are not installed does not start', () => {
    const launcher = new Launcher({ env: { TLI_TERMINAL: 'ghostty' } })
    const vorax = toolById('vorax')
    expect(vorax).toBeDefined()
    const result = openTool(launcher, vorax!, { which: () => null })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Vorax Helper needs')
  })

  test('the window of a real tool runs it in its own folder', () => {
    const started: string[][] = []
    const launcher = new Launcher({
      env: { TLI_TERMINAL: 'ghostty' },
      host: {
        which: (program: string) => `/usr/bin/${program}`,
        spawn: (argv): Child => {
          started.push(argv)
          return { exited: Promise.resolve(0) }
        },
      },
    })
    const vorax = toolById('vorax')
    expect(vorax).toBeDefined()
    openTool(launcher, vorax!, { which: () => '/usr/bin/bun' })
    const argv = started[0]
    expect(argv).toBeDefined()
    expect(argv?.[0]).toBe('ghostty')
    expect(argv?.[1]).toBe('--title=Vorax Helper')
    expect(argv?.[2]).toBe(`--working-directory=${vorax!.cwd}`)
    expect(argv?.slice(4)).toEqual(['bun', 'scripts/tui.ts'])
  })
})
