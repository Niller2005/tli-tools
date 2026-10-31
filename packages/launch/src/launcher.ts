// Opening the window a tool runs in.
//
// The window is a pane of the player's own tmux session when they are in one, and a window of a
// terminal emulator otherwise. Either way the tool keeps running when the program that opened it
// is left, and the launcher remembers what it has open, so the same tool is not opened twice.

import { findTerminal, type Terminal } from './terminal'
import {
  parsePaneId,
  tmuxArgv,
  tmuxMode,
  tmuxPanesArgv,
  tmuxSocket,
  tmuxTakesEnv,
  tmuxWindowName,
  type TmuxSocket,
} from './tmux'

/** A child process the launcher started. */
export interface Child {
  /** resolves when the child has gone */
  exited: Promise<number>
}

/** What the launcher needs from the machine it runs on. */
export interface LauncherHost {
  /** finds a program on PATH */
  which: (program: string) => string | null
  /** starts a program that keeps running when the launcher is left */
  spawn: (argv: string[], options: { cwd: string; env: Record<string, string | undefined> }) => Child
  /** runs a program and gives back what it wrote to its standard output */
  run: (argv: string[], options: { cwd: string; env: Record<string, string | undefined> }) => string
}

/** The machine the launcher runs on. */
export const defaultHost: LauncherHost = {
  which: (program) => Bun.which(program),
  spawn: (argv, options) => {
    const child = Bun.spawn(argv, {
      cwd: options.cwd,
      env: options.env,
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
      // the window has to outlive the program that opened it
      detached: true,
    })
    // bun waits for its children when it shuts down; the window may outlive the tracker
    child.unref()
    return { exited: child.exited }
  },
  run: (argv, options) => {
    const result = Bun.spawnSync({
      cmd: argv,
      cwd: options.cwd,
      env: options.env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    return result.stdout.toString()
  },
}

/** What to open in a new window. */
export interface OpenRequest {
  /** the title of the window */
  title: string
  /** the directory the command runs in */
  cwd: string
  /** the command, as argv */
  command: string[]
  /** extra environment variables for the command */
  env?: Record<string, string>
  /** the name of the thing that is opened; a second window for the same name is not opened */
  key?: string
}

/** What happened when a window was asked for. */
export type OpenReason = 'opened' | 'already-open' | 'no-terminal' | 'failed'

/** The answer of the launcher. */
export interface OpenResult {
  /** whether the window was opened */
  ok: boolean
  /** the terminal that was used, when one was found */
  terminal: string | null
  /** what happened */
  reason: OpenReason
  /** what to tell the player */
  message: string
}

/** Something the launcher opened, and how to tell whether it is still there. */
interface Running {
  /** the terminal or the session it is in */
  kind: string
  /** whether it is still there */
  alive: () => boolean
}

/** How the launcher is set up. */
export interface LauncherOptions {
  /** the machine it runs on */
  host?: Partial<LauncherHost>
  /** the environment it looks in */
  env?: Record<string, string | undefined>
}

/** Opens windows for the tools, and remembers what it has open. */
export class Launcher {
  private readonly host: LauncherHost
  private readonly env: Record<string, string | undefined>
  private readonly running = new Map<string, Running>()
  /** whether tmux takes the environment with `-e`; asked once, then kept */
  private tmuxEnv: boolean | null = null

  constructor(options: LauncherOptions = {}) {
    this.host = { ...defaultHost, ...options.host }
    this.env = options.env ?? process.env
  }

  /** Whether the thing with this name is open. */
  isOpen(key: string): boolean {
    const running = this.running.get(key)
    return running !== undefined && running.alive()
  }

  /** Opens a window that runs the command, and says what happened. */
  open(request: OpenRequest): OpenResult {
    const key = request.key
    if (key !== undefined) {
      const running = this.running.get(key)
      if (running !== undefined && running.alive()) {
        return {
          ok: false,
          terminal: running.kind,
          reason: 'already-open',
          message: `${request.title} is already open`,
        }
      }
    }

    const socket = this.tmux()
    if (socket !== null) return this.openInTmux(request, socket)
    return this.openInTerminal(request)
  }

  /** The tmux server to open a pane in, when the player is in tmux and wants that. */
  private tmux(): TmuxSocket | null {
    // the player's own choice of terminal is stronger than being in tmux
    const chosen = this.env.TLI_TERMINAL
    if (chosen !== undefined && chosen !== '') return null

    const socket = tmuxSocket(this.env)
    if (socket === null) return null

    const inside = this.env.TMUX !== undefined && this.env.TMUX !== ''
    const named = this.env.TLI_TMUX_SOCKET !== undefined && this.env.TLI_TMUX_SOCKET !== ''
    if (!inside && !named) return null
    if (this.host.which('tmux') === null) return null
    return socket
  }

  /** Opens a pane of the player's own tmux session. */
  private openInTmux(request: OpenRequest, socket: TmuxSocket | null): OpenResult {
    const mode = tmuxMode(this.env)
    const argv = tmuxArgv(request, { mode, socket, envFlag: this.takesEnv() })

    let output: string
    try {
      output = this.host.run(argv, { cwd: request.cwd, env: this.env })
    } catch (error) {
      return {
        ok: false,
        terminal: 'tmux',
        reason: 'failed',
        message: `could not open a tmux pane: ${(error as Error).message}`,
      }
    }

    const pane = parsePaneId(output)
    if (pane === null) {
      const said = output.trim()
      return {
        ok: false,
        terminal: 'tmux',
        reason: 'failed',
        message: said === '' ? 'tmux did not open a pane' : `tmux did not open a pane: ${said}`,
      }
    }

    const key = request.key
    if (key !== undefined) {
      this.running.set(key, { kind: 'tmux', alive: () => this.paneIsThere(pane, socket) })
    }

    return {
      ok: true,
      terminal: 'tmux',
      reason: 'opened',
      message: `${request.title} is open in a new ${tmuxWindowName(mode)}`,
    }
  }

  /** Whether the pane is still in the session. */
  private paneIsThere(pane: string, socket: TmuxSocket | null): boolean {
    let output: string
    try {
      output = this.host.run(tmuxPanesArgv(socket), { cwd: process.cwd(), env: this.env })
    } catch {
      return false
    }
    return output
      .split('\n')
      .map(line => line.trim())
      .includes(pane)
  }

  /** Whether tmux takes the environment of the pane with `-e`. */
  private takesEnv(): boolean {
    if (this.tmuxEnv !== null) return this.tmuxEnv
    let commands: string
    try {
      // the list of commands does not need a server
      commands = this.host.run(['tmux', 'list-commands'], { cwd: process.cwd(), env: this.env })
    } catch {
      commands = ''
    }
    this.tmuxEnv = tmuxTakesEnv(commands)
    return this.tmuxEnv
  }

  /** Opens a window of a terminal emulator. */
  private openInTerminal(request: OpenRequest): OpenResult {
    const terminal: Terminal | null = findTerminal({ env: this.env, which: this.host.which })
    if (terminal === null) {
      return {
        ok: false,
        terminal: null,
        reason: 'no-terminal',
        message: 'no terminal was found; set TLI_TERMINAL to the one to use',
      }
    }

    let child: Child
    try {
      child = this.host.spawn(terminal.argv(request), {
        cwd: request.cwd,
        env: { ...this.env, ...request.env },
      })
    } catch (error) {
      return {
        ok: false,
        terminal: terminal.id,
        reason: 'failed',
        message: `could not start ${terminal.id}: ${(error as Error).message}`,
      }
    }

    const key = request.key
    if (key !== undefined) {
      let gone = false
      void child.exited.then(() => {
        gone = true
      })
      this.running.set(key, { kind: terminal.id, alive: () => !gone })
    }

    return {
      ok: true,
      terminal: terminal.id,
      reason: 'opened',
      message: `${request.title} is open in a new ${terminal.id} window`,
    }
  }
}
