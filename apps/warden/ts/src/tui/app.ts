// The part of Warden that turns the session's state into the terminal's state.
//
// The capture loop owns the game window and the log. This module owns the screen and the keys.

import type { KeyEvent } from '@opentui/core'
import type { CliRenderer } from '@opentui/core'
import type { Session } from '@/app/session'
import { problem } from '@/reader/ocr'
import { WardenScreen } from './screen'
import { publishCard, type Card, type Rect } from '@tli/overlay'
import { cardOf } from './card'
import { freshView, stateFromSession, type ViewState } from './view'

/** What the app tells the program around it. */
export interface AppHooks {
  /** the player wants to read the board now */
  onRead: () => void
  /** the player wants to leave */
  onQuit: () => void
}

/** Warden's terminal application. */
export class WardenApp {
  /** the state the screen shows */
  readonly state: ViewState
  /** the screen it draws on */
  readonly screen: WardenScreen

  private readonly session: Session
  private readonly hooks: AppHooks
  /** where the last picture of the game was taken from, in the compositor's logical pixels */
  area: () => Rect | null = () => null

  constructor(renderer: CliRenderer, session: Session, hooks: AppHooks) {
    this.session = session
    this.hooks = hooks
    this.state = freshView()
    this.screen = new WardenScreen(renderer)
    renderer.root.add(this.screen.root)
  }

  /** Draws the screen from the session. */
  draw(captureNote = this.state.captureNote): void {
    Object.assign(this.state, stateFromSession(this.session, captureNote, problem()))
    this.screen.draw(this.state)
    this.publish()
  }

  /** The card shown for the solve in progress: while it runs, the card stays as it was. The overlay then does not
   * redraw, change its move or re-order its rows with every round of playouts, nor with every read of the same
   * board (each read hands out a new model, so the model cannot tell a new board from the same one). */
  private shown: { solve: number; card: Card | null } | null = null

  private publish(): void {
    const state = this.state
    const solve = this.session.solveId
    if (state.solving && this.shown !== null && this.shown.solve === solve) {
      publishCard('warden', this.shown.card)
      return
    }
    const area = this.area()
    const card = cardOf(state, area === null ? null : this.session.markOn(area))
    // a solve in progress shows the move without the ranking, which only the finished solve can give
    this.shown = { solve, card: card !== null && state.solving ? { ...card, lines: [] } : card }
    publishCard('warden', this.shown.card)
  }

  /** Does a key press. */
  key(key: KeyEvent): void {
    const char = key.sequence.length === 1 ? key.sequence : key.name.length === 1 ? key.name : ''
    if (char === 'q') {
      this.hooks.onQuit()
      return
    }
    if (char === 'r') {
      this.hooks.onRead()
      return
    }
    key.preventDefault()
  }
}
