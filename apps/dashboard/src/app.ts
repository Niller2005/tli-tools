// What the dashboard does when the player uses the keyboard.
//
// The state is plain data: the tool under the cursor, the tools that are picked and the message
// that is shown. The screen turns that state into an OpenTUI tree; this file only owns the rules
// for the keys.

import type { CliRenderer, KeyEvent } from '@opentui/core'
import type { MinigameView } from '@tli/gamelog'
import { DashboardScreen } from './screen'
import { missing, TOOLS, type Tool } from './tools'

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
}

/** The state a new dashboard starts in. */
export function freshState(): DashboardState {
  return { cursor: 0, picked: new Set<string>(), message: '', view: null }
}

/** The minigames' states, as a small string that can be compared. */
export function viewSignature(view: MinigameView): string {
  return `${view.warden}|${view.vorax}|${view.arcana}|${view.log}`
}

/** What the app tells the program around it. */
export interface DashboardHooks {
  /** the player wants to leave */
  onQuit: () => void
  /** the player wants to run the tools */
  onRun: (tools: Tool[]) => void
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
    this.screen = new DashboardScreen(renderer)
  }

  /** Draws the screen. */
  draw(): void {
    this.screen.draw(this.state)
  }

  /** Does a key press. */
  key(key: KeyEvent): void {
    const char = this.typed(key)

    if ((key.ctrl && (char === 'c' || key.name === 'c')) || char === 'q') {
      this.hooks.onQuit()
      key.preventDefault()
      return
    }

    if (key.name === 'up' || char === 'k') {
      this.move(-1)
    } else if (key.name === 'down' || char === 'j') {
      this.move(1)
    } else if (key.name === 'space') {
      this.toggle()
    } else if (char === 'a') {
      this.selectAll()
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

  /** Moves the cursor. */
  private move(by: number): void {
    this.state.cursor = (this.state.cursor + by + TOOLS.length) % TOOLS.length
  }

  /** Picks the tool under the cursor, or unpicks it. */
  private toggle(): void {
    const tool = TOOLS[this.state.cursor]
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
      const tool = TOOLS[this.state.cursor]
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
}
