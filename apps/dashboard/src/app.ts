// What the dashboard does when the player uses the keyboard.
//
// The state is plain data: the tool under the cursor, the tools that are picked, the message that
// is shown, the settings the player has made and the status the packages have read. The screen
// turns that state into an OpenTUI tree; this file only owns the rules for the keys.

import type { CliRenderer, KeyEvent } from '@opentui/core'
import type { MinigameView } from '@tli/gamelog'
import {
  defaultSettings,
  missing,
  setToolSettings,
  TOOLS,
  toolSettings,
  type Settings,
  type Tool,
  type ToolSettings,
} from '@tli/launch'
import { DashboardScreen, optionRows } from './screen'
import { emptyStatus, type StatusData } from './status'

/** What the dashboard is showing. */
export interface DashboardState {
  /** the tool under the cursor */
  cursor: number
  /** the tools the player has picked */
  picked: Set<string>
  /** the message under the list */
  message: string
  /** what the game's log says about the minigames */
  view: MinigameView | null
  /** what the packages have read: the panels and the tools' status lines */
  status: StatusData
  /** the player's settings, as they are kept in the settings file */
  settings: Settings
  /** which detail pane a narrow screen shows: 0 the session, 1 the log and the capture, 2 the tools and the data */
  pane: number
  /** the options dialog, when it is open: the tool it belongs to and the row the cursor is on */
  options: { tool: string; at: number } | null
  /** whether the help is open */
  help: boolean
  /** whether a capture command is being typed in */
  editing: boolean
}

/** The state a new dashboard starts in. */
export function freshState(settings: Settings = defaultSettings()): DashboardState {
  return {
    cursor: 0,
    picked: new Set<string>(),
    message: '',
    view: null,
    status: emptyStatus(),
    settings,
    pane: 0,
    options: null,
    help: false,
    editing: false,
  }
}


/** What the app tells the program around it. */
export interface DashboardHooks {
  /** the player wants to leave */
  onQuit: () => void
  /** the player wants to run the tools */
  onRun: (tools: Tool[]) => void
  /** the player wants the tool in a window of its own; the message says what happened */
  onOpenWindow: (tool: Tool) => string
  /** the settings changed; they are the caller's to keep on disk */
  onSettings: (settings: Settings) => void
  /** the player wants the running tool stopped; the message says what happened */
  onClose: (tool: Tool) => string
  /** the player wants the tool's window at the front; the message says what happened */
  onFocus: (tool: Tool) => string
  /** the player wants the community prices fetched again; the message says what is happening */
  onBaseline: () => string
}

/** The dashboard, as a program the player can use. */
export class DashboardApp {
  /** the state of the screen */
  readonly state: DashboardState
  /** the screen it draws on */
  readonly screen: DashboardScreen

  private readonly hooks: DashboardHooks

  constructor(renderer: CliRenderer, state: DashboardState, hooks: DashboardHooks) {
    this.state = state
    this.hooks = hooks
    this.screen = new DashboardScreen(renderer, {
      onCommand: (text) => {
        this.setCaptureCommand(text)
      },
    })
  }

  /** Draws the screen. */
  draw(): void {
    this.screen.draw(this.state)
  }

  /** Does a key press. */
  key(key: KeyEvent): void {
    const char = this.typed(key)

    if (key.ctrl && (char === 'c' || key.name === 'c')) {
      this.hooks.onQuit()
      key.preventDefault()
      return
    }

    // while a capture command is typed in, the input has the keys; only escape comes back
    if (this.state.editing) {
      if (key.name === 'escape') this.endCommand()
      return
    }

    if (char === 'q') {
      this.hooks.onQuit()
      key.preventDefault()
      return
    }

    if (this.state.options !== null) {
      this.optionsKey(key, char)
      key.preventDefault()
      this.draw()
      return
    }

    if (this.state.help) {
      if (key.name === 'escape' || char === 'q' || char === '?') this.state.help = false
      key.preventDefault()
      this.draw()
      return
    }

    if (key.name === 'up' || char === 'k') {
      this.move(-1)
    } else if (key.name === 'down' || char === 'j') {
      this.move(1)
    } else if (key.name === 'space') {
      this.toggle()
    } else if (char === 'A') {
      this.selectAll()
    } else if (char === 'a') {
      this.toggleAuto()
      this.draw()
      return
    } else if (char === 'w') {
      this.openWindow()
      key.preventDefault()
      return
    } else if (char === 'o') {
      this.openOptions()
      key.preventDefault()
      this.draw()
      return
    } else if (char === 'x') {
      const tool = this.current()
      if (tool !== undefined) this.state.message = this.hooks.onClose(tool)
      key.preventDefault()
      this.draw()
      return
    } else if (char === 'f') {
      const tool = this.current()
      if (tool !== undefined) this.state.message = this.hooks.onFocus(tool)
      key.preventDefault()
      this.draw()
      return
    } else if (char === 'b') {
      this.state.message = this.hooks.onBaseline()
      key.preventDefault()
      this.draw()
      return
    } else if (key.name === 'tab') {
      this.state.pane = (this.state.pane + 1) % 3
    } else if (char === '?') {
      this.state.help = true
    } else if (key.name === 'return') {
      this.run()
      key.preventDefault()
      return
    }

    this.state.message = ''
    key.preventDefault()
    this.draw()
  }

  /** The character a key typed, or an empty string when it typed none. */
  private typed(key: KeyEvent): string {
    if (key.sequence.length === 1) return key.sequence
    if (key.name.length === 1) return key.name
    return ''
  }

  /** The tool under the cursor. */
  private current(): Tool | undefined {
    return TOOLS[this.state.cursor]
  }

  /** Moves the cursor. */
  private move(by: number): void {
    this.state.cursor = (this.state.cursor + by + TOOLS.length) % TOOLS.length
  }

  /** Picks the tool under the cursor, or unpicks it. */
  private toggle(): void {
    const tool = this.current()
    if (tool === undefined) return
    if (this.state.picked.has(tool.id)) this.state.picked.delete(tool.id)
    else this.state.picked.add(tool.id)
  }

  /** Picks every tool. */
  private selectAll(): void {
    for (const tool of TOOLS) this.state.picked.add(tool.id)
  }

  /** Runs the picked tools, or the one under the cursor when none are picked. */
  private run(): void {
    const chosen = TOOLS.filter(tool => this.state.picked.has(tool.id))
    if (chosen.length === 0) {
      const tool = this.current()
      if (tool !== undefined) chosen.push(tool)
    }

    const gone = chosen.flatMap(tool => missing(tool).map(name => `${tool.name} needs ${name}`))
    if (gone.length > 0) {
      this.state.message = gone.join('; ')
      this.draw()
      return
    }

    this.hooks.onRun(chosen)
  }

  /** Opens the tool under the cursor in a window of its own, and leaves the terminal here. */
  private openWindow(): void {
    const tool = this.current()
    if (tool === undefined) return
    this.state.message = this.hooks.onOpenWindow(tool)
    this.draw()
  }

  /** Opens the options of the tool under the cursor. */
  private openOptions(): void {
    const tool = this.current()
    if (tool === undefined) return
    if (optionRows(tool).length === 0) {
      this.state.message = `${tool.name} takes no options`
      return
    }
    this.state.options = { tool: tool.id, at: 0 }
  }

  /** A key while the options dialog is open. */
  private optionsKey(key: KeyEvent, char: string): void {
    const options = this.state.options
    if (options === null) return
    const tool = TOOLS.find(t => t.id === options.tool)
    if (tool === undefined) {
      this.state.options = null
      return
    }
    const rows = optionRows(tool)
    if (rows.length === 0) {
      this.state.options = null
      return
    }

    if (key.name === 'escape' || char === 'o') {
      this.state.options = null
      return
    }
    if (key.name === 'up' || char === 'k') {
      options.at = (options.at + rows.length - 1) % rows.length
      return
    }
    if (key.name === 'down' || char === 'j') {
      options.at = (options.at + 1) % rows.length
      return
    }
    if (key.name === 'space' || key.name === 'return') {
      const row = rows[options.at]
      if (row === undefined) return
      if (row.key === 'captureCmd') {
        this.beginCommand(toolSettings(this.state.settings, tool.id).captureCmd ?? '')
        return
      }
      const now = !toolSettings(this.state.settings, tool.id)[row.key]
      this.setOption(tool, { [row.key]: now } as ToolSettings)
      this.state.message = `${tool.name}: ${row.label} ${now ? 'on' : 'off'}`
    }
  }

  /** Changes one tool's setting and keeps the settings on disk. */
  private setOption(tool: Tool, patch: ToolSettings): void {
    this.state.settings = setToolSettings(this.state.settings, tool.id, patch)
    this.hooks.onSettings(this.state.settings)
  }

  /** Turns auto-launch of the tool under the cursor on or off, and says which it is. */
  private toggleAuto(): void {
    const tool = this.current()
    if (tool === undefined) return
    if (tool.game === undefined) {
      this.state.message = `${tool.name} has no minigame of its own to watch`
      return
    }
    const on = !toolSettings(this.state.settings, tool.id).autoLaunch
    this.setOption(tool, { autoLaunch: on })
    this.state.message = on
      ? `${tool.name} opens by itself when its minigame opens`
      : `${tool.name} no longer opens by itself`
  }

  /** Starts typing a capture command in, from the value it has. */
  private beginCommand(value: string): void {
    this.state.editing = true
    this.screen.beginCommand(value)
  }

  /** Stops typing, and puts the input away. */
  private endCommand(): void {
    this.state.editing = false
    this.screen.endCommand()
    this.draw()
  }

  /** The capture command that was typed in, kept with the tool it belongs to. */
  private setCaptureCommand(text: string): void {
    const options = this.state.options
    const tool = options === null ? undefined : TOOLS.find(t => t.id === options.tool)
    this.endCommand()
    if (tool === undefined) return
    const command = text.trim()
    this.setOption(tool, { captureCmd: command === '' ? null : command })
    this.state.message =
      command === '' ? `the capture command of ${tool.name} is unset` : `the capture command of ${tool.name} is ${command}`
    this.draw()
  }
}
