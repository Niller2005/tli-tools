// The tools that can be started, and the windows they can be started in.
//
// The tracker and the dashboard both start tools: the tracker opens one in a window of its own,
// the dashboard starts the ones that take the terminal over. They read the same table of tools.

export {
  Launcher,
  defaultHost,
  type Child,
  type CloseReason,
  type CloseResult,
  type FocusReason,
  type FocusResult,
  type LauncherHost,
  type LauncherOptions,
  type OpenReason,
  type OpenRequest,
  type OpenResult,
  type RunningEntry,
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
  parsePanePids,
  shellCommand,
  shellQuote,
  tmuxArgv,
  tmuxMode,
  tmuxPanePidsArgv,
  tmuxPanesArgv,
  tmuxSelectPaneArgv,
  tmuxSelectWindowArgv,
  tmuxSocket,
  tmuxTakesEnv,
  tmuxWindowName,
  type TmuxMode,
  type TmuxOptions,
  type TmuxSocket,
} from './tmux'

export { TOOLS, missing, toolById, type Tool, type ToolAccepts } from './tools'

export {
  SETTINGS_VERSION,
  defaultSettings,
  readSettings,
  setToolSettings,
  settingsPath,
  toolSettings,
  writeSettings,
  type Settings,
  type ToolSettings,
} from './settings'

export {
  childEnv,
  childFlags,
  openTool,
  optionFlags,
  type OpenToolOptions,
} from './open'
