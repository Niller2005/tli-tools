// Opening a window inside tmux.
//
// When the tracker runs inside tmux, the window it opens is a pane of the same session: the
// tracker keeps the focus and the terminal stays where it is.
//
// tmux runs the command with `/bin/sh -c`, so the arguments are put in one shell string, quoted
// the way a shell reads them.

import type { TerminalRequest } from './terminal'

/** How tmux is asked for a window. */
export type TmuxMode = 'split-h' | 'split-v' | 'window'

/** The modes tmux can be asked for. */
export const TMUX_MODES: readonly TmuxMode[] = ['split-h', 'split-v', 'window']

/** The mode the environment asks for. */
export function tmuxMode(env: Record<string, string | undefined>): TmuxMode {
  const mode = env.TLI_TMUX_MODE
  if (mode === 'split-v' || mode === 'window') return mode
  return 'split-h'
}

/** How the window is called in the message to the player. */
export function tmuxWindowName(mode: TmuxMode): string {
  if (mode === 'window') return 'tmux window'
  if (mode === 'split-v') return 'tmux pane below this one'
  return 'tmux pane beside this one'
}

/** Puts an argument in quotes that the shell reads as one word. */
export const shellQuote = (argument: string): string => `'${argument.replaceAll("'", `'\\''`)}'`

/** The command as one string that the shell reads. */
export const shellCommand = (argv: readonly string[]): string => argv.map(shellQuote).join(' ')

/** The tmux server to talk to. */
export interface TmuxSocket {
  /** the flag tmux takes the socket with */
  flag: '-S' | '-L'
  /** the socket: a path for `-S`, a name for `-L` */
  name: string
}

/**
 * The server to talk to: the one the player is in, unless they name another one.
 *
 * `TLI_TMUX_SOCKET` is a path when it starts with a slash and a socket name otherwise. The socket
 * of the session the player is in is in `TMUX`, before the first comma.
 */
export function tmuxSocket(env: Record<string, string | undefined>): TmuxSocket | null {
  const given = env.TLI_TMUX_SOCKET
  if (given !== undefined && given !== '') {
    return given.startsWith('/') ? { flag: '-S', name: given } : { flag: '-L', name: given }
  }
  const tmux = env.TMUX
  if (tmux !== undefined && tmux !== '') {
    const path = tmux.split(',')[0]
    if (path !== undefined && path !== '') return { flag: '-S', name: path }
  }
  return null
}

/** How the tmux command that opens the window is put together. */
export interface TmuxOptions {
  /** how the window is made */
  mode: TmuxMode
  /** the server to talk to */
  socket: TmuxSocket | null
  /** whether tmux takes the environment with `-e` */
  envFlag: boolean
}

/** The argv of the tmux command that opens the window. */
export function tmuxArgv(request: TerminalRequest, options: TmuxOptions): string[] {
  const server = options.socket === null ? [] : [options.socket.flag, options.socket.name]
  const environment = Object.entries(request.env ?? {})
  const withEnv = options.envFlag
    ? environment.flatMap(([key, value]) => ['-e', `${key}=${value}`])
    : []
  const prefix = options.envFlag || environment.length === 0
    ? []
    : ['env', ...environment.map(([key, value]) => shellQuote(`${key}=${value}`))]
  const command = [...prefix, shellCommand(request.command)].join(' ')

  if (options.mode === 'window') {
    return [
      'tmux',
      ...server,
      'new-window',
      '-d',
      '-n',
      request.title,
      '-P',
      '-F',
      '#{pane_id}',
      '-c',
      request.cwd,
      ...withEnv,
      command,
    ]
  }

  return [
    'tmux',
    ...server,
    'split-window',
    options.mode === 'split-v' ? '-v' : '-h',
    '-d',
    '-P',
    '-F',
    '#{pane_id}',
    '-c',
    request.cwd,
    ...withEnv,
    command,
  ]
}

/** The argv that asks tmux for the panes it has. */
export function tmuxPanesArgv(socket: TmuxSocket | null): string[] {
  const server = socket === null ? [] : [socket.flag, socket.name]
  return ['tmux', ...server, 'list-panes', '-a', '-F', '#{pane_id}']
}

/** The pane id in what tmux wrote. */
export function parsePaneId(output: string): string | null {
  for (const line of output.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('%')) return trimmed
  }
  return null
}

/** The argv that asks tmux for the pid of the process of every pane. */
export function tmuxPanePidsArgv(socket: TmuxSocket | null): string[] {
  const server = socket === null ? [] : [socket.flag, socket.name]
  return ['tmux', ...server, 'list-panes', '-a', '-F', '#{pane_id} #{pane_pid}']
}

/** The pid of each pane, from what tmux wrote. */
export function parsePanePids(output: string): Record<string, number> {
  const pids: Record<string, number> = {}
  for (const line of output.split('\n')) {
    const [pane, pid] = line.trim().split(/\s+/)
    if (pane !== undefined && pane.startsWith('%') && pid !== undefined && /^\d+$/.test(pid)) {
      pids[pane] = Number(pid)
    }
  }
  return pids
}

/** The argv that makes a pane the active pane of its window. */
export function tmuxSelectPaneArgv(socket: TmuxSocket | null, pane: string): string[] {
  const server = socket === null ? [] : [socket.flag, socket.name]
  return ['tmux', ...server, 'select-pane', '-t', pane]
}

/**
 * The argv that makes the window a pane is in the one the player sees.
 *
 * `select-pane` alone does not bring a pane of another window to the front: the window has to be
 * selected too. tmux takes a pane as the target and selects the window it is in.
 */
export function tmuxSelectWindowArgv(socket: TmuxSocket | null, pane: string): string[] {
  const server = socket === null ? [] : [socket.flag, socket.name]
  return ['tmux', ...server, 'select-window', '-t', pane]
}

/** Whether tmux takes the environment with `-e`. */
export function tmuxTakesEnv(commands: string): boolean {
  for (const line of commands.split('\n')) {
    const name = line.split(' ')[0]
    if (name !== 'split-window' && name !== 'new-window') continue
    if (line.includes('[-e environment]')) return true
  }
  return false
}
