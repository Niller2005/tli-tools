// The tools that can be started, and the windows they can be started in.
//
// The tracker and the dashboard both start tools: the tracker opens one in a window of its own,
// the dashboard starts the ones that take the terminal over. They read the same table of tools.

export {
  Launcher,
  defaultHost,
  type Child,
  type LauncherHost,
  type LauncherOptions,
  type OpenReason,
  type OpenRequest,
  type OpenResult,
} from './launcher'

export {
  TERMINALS,
  alacrittyArgv,
  findTerminal,
  footArgv,
  ghosttyArgv,
  kittyArgv,
  terminalById,
  weztermArgv,
  xdgTerminalExecArgv,
  xtermArgv,
  type FindTerminalOptions,
  type Terminal,
  type TerminalRequest,
} from './terminal'

export {
  TMUX_MODES,
  parsePaneId,
  shellCommand,
  shellQuote,
  tmuxArgv,
  tmuxMode,
  tmuxPanesArgv,
  tmuxSocket,
  tmuxTakesEnv,
  tmuxWindowName,
  type TmuxMode,
  type TmuxOptions,
  type TmuxSocket,
} from './tmux'

export { TOOLS, missing, toolById, type Tool } from './tools'

export {
  childEnv,
  childFlags,
  openTool,
  type OpenToolOptions,
} from './open'
