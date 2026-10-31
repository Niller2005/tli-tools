// What the helper does when the player does something.
//
// The app holds the state of the screen and the rules for the keys. It draws itself through the
// screen, and it does not know anything about the terminal: that is the renderer's business.

import type { CliRenderer, KeyEvent } from '@opentui/core'
import { VoraxScreen } from './screen'
import { TARGETS, type ViewState } from './view'

/** What the app tells the program around it. */
export interface AppHooks {
  /** the player wants to leave */
  onQuit: () => void
  /** the player wants the board read now */
  onSnap: () => void
  /** the player chose another target score */
  onTarget: (target: number) => void
  /** the player turned the deep check on or off */
  onDeep: (deepOn: boolean) => void
}

/** The helper, as a program the player can use. */
export class VoraxApp {
  /** the state of the screen */
  readonly state: ViewState
  /** the screen it draws on */
  readonly screen: VoraxScreen

  private readonly hooks: AppHooks

  constructor(renderer: CliRenderer, state: ViewState, hooks: AppHooks) {
    this.state = state
    this.hooks = hooks
    this.screen = new VoraxScreen(renderer)
    renderer.root.add(this.screen.root)
  }

  /** Draws the screen. */
  draw(): void {
    this.screen.draw(this.state)
  }

  /** Does a key press. */
  key(key: KeyEvent): void {
    if (key.ctrl && key.name === 'c') {
      this.hooks.onQuit()
      return
    }

    switch (this.typed(key)) {
      case 'q':
        this.hooks.onQuit()
        return
      case 'r':
        this.hooks.onSnap()
        break
      case 't':
        this.state.target = TARGETS[(TARGETS.indexOf(this.state.target) + 1) % TARGETS.length] ?? TARGETS[0] ?? 925_000
        this.hooks.onTarget(this.state.target)
        break
      case 'd':
        this.state.deepOn = !this.state.deepOn
        this.hooks.onDeep(this.state.deepOn)
        break
      default:
        return
    }
    key.preventDefault()
    this.draw()
  }

  /** The character a key typed, or an empty string when it typed none. */
  private typed(key: KeyEvent): string {
    if (key.sequence.length === 1) return key.sequence
    if (key.name.length === 1) return key.name
    return ''
  }
}
