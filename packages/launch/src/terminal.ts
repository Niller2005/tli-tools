// The terminal emulators a window can be opened in.
//
// The tools in this repo are full-screen programs: two of them cannot share one terminal, so a
// tool can be started in a window of its own instead, and the program that opened it keeps running.
//
// The argv of each emulator is built by a pure function, so it can be looked at without a
// terminal being anywhere near. Where the window ends up on the screen is the compositor's job:
// we only ask a terminal emulator to open one.

/** What a new terminal window runs. */
export interface TerminalRequest {
  /** the title of the window */
  title: string
  /** the directory the command runs in */
  cwd: string
  /** the command, as argv */
  command: string[]
  /** extra environment variables for the command */
  env?: Record<string, string>
}

/** A terminal that can open a window. */
export interface Terminal {
  /** the name of the terminal */
  id: string
  /** the program that is run */
  program: string
  /** the whole argv, the program first */
  argv: (request: TerminalRequest) => string[]
}

/** Ghostty: the title and the directory are config keys, the command comes after `-e`. */
export const ghosttyArgv = (request: TerminalRequest): string[] => [
  'ghostty',
  `--title=${request.title}`,
  `--working-directory=${request.cwd}`,
  '-e',
  ...request.command,
]

/** Kitty: the title and the directory are options, the command comes after `--`. */
export const kittyArgv = (request: TerminalRequest): string[] => [
  'kitty',
  '--title',
  request.title,
  '--directory',
  request.cwd,
  '--',
  ...request.command,
]

/** Foot: the title and the directory are options, the command comes after them. */
export const footArgv = (request: TerminalRequest): string[] => [
  'foot',
  `--title=${request.title}`,
  `--working-directory=${request.cwd}`,
  ...request.command,
]

/** Alacritty: the title and the directory are options, the command comes after `-e`. */
export const alacrittyArgv = (request: TerminalRequest): string[] => [
  'alacritty',
  '--title',
  request.title,
  '--working-directory',
  request.cwd,
  '-e',
  ...request.command,
]

/** WezTerm: the command comes after `--`; it has no option for the title. */
export const weztermArgv = (request: TerminalRequest): string[] => [
  'wezterm',
  'start',
  '--cwd',
  request.cwd,
  '--',
  ...request.command,
]

/** XTerm: the title comes after `-T`, the command after `-e`. */
export const xtermArgv = (request: TerminalRequest): string[] => [
  'xterm',
  '-T',
  request.title,
  '-e',
  ...request.command,
]

/** xdg-terminal-exec: it picks the terminal of the desktop, so the command is all it takes. */
export const xdgTerminalExecArgv = (request: TerminalRequest): string[] => [
  'xdg-terminal-exec',
  ...request.command,
]

/** The terminals that are looked for, in the order they are tried. */
export const TERMINALS: Terminal[] = [
  { id: 'ghostty', program: 'ghostty', argv: ghosttyArgv },
  { id: 'kitty', program: 'kitty', argv: kittyArgv },
  { id: 'foot', program: 'foot', argv: footArgv },
  { id: 'alacritty', program: 'alacritty', argv: alacrittyArgv },
  { id: 'wezterm', program: 'wezterm', argv: weztermArgv },
  { id: 'xdg-terminal-exec', program: 'xdg-terminal-exec', argv: xdgTerminalExecArgv },
  { id: 'xterm', program: 'xterm', argv: xtermArgv },
]

/** The terminal with this name, when it is one we know. */
export const terminalById = (id: string): Terminal | undefined =>
  TERMINALS.find(terminal => terminal.id === id)

/** A terminal we do not know: the program is run as it is, with the command behind it. */
const customTerminal = (program: string): Terminal => ({
  id: program,
  program,
  argv: (request: TerminalRequest) => [program, ...request.command],
})

/** How the terminal is looked for. */
export interface FindTerminalOptions {
  /** the environment to look in */
  env?: Record<string, string | undefined>
  /** finds a program on PATH */
  which?: (program: string) => string | null
}

/**
 * Finds the terminal to open a window in: `TLI_TERMINAL` first, then `TERMINAL`, then the
 * terminals that are installed, in the order they are tried.
 *
 * `TLI_TERMINAL` is the player's own choice and is always used. `TERMINAL` is usually the name of
 * the terminal's colours rather than a program, so it is only used when it names a terminal we
 * know or a program that is installed.
 */
export function findTerminal(options: FindTerminalOptions = {}): Terminal | null {
  const env = options.env ?? process.env
  const which = options.which ?? ((program: string) => Bun.which(program))

  const chosen = env.TLI_TERMINAL
  if (chosen !== undefined && chosen !== '') {
    return terminalById(chosen) ?? customTerminal(chosen)
  }

  const fromEnv = env.TERMINAL
  if (fromEnv !== undefined && fromEnv !== '') {
    const known = terminalById(fromEnv)
    if (known !== undefined) return known
    if (which(fromEnv) !== null) return customTerminal(fromEnv)
  }

  for (const terminal of TERMINALS) {
    if (which(terminal.program) !== null) return terminal
  }
  return null
}
