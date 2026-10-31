// What the app does when the player does something.
//
// The app holds the state of the screen and the rules for the keys. It draws itself through the
// screen, and it does not know anything about the terminal: that is the renderer's business.

import type { CliRenderer, KeyEvent } from '@opentui/core'
import type { Tracker } from '@tli/arcana'
import type { ItemNames } from '@tli/tracker'
import { ArcanaScreen } from './screen'
import { PANELS, entriesOf, type ViewState } from './view'

/** What the app tells the program around it. */
export interface AppHooks {
  /** the player wants to leave */
  onQuit: () => void
  /** the player wants the log read again */
  onRead: () => void
}

/** The arcana app, as a program the player can use. */
export class ArcanaApp {
  /** the state of the screen */
  readonly state: ViewState
  /** the screen it draws on */
  readonly screen: ArcanaScreen

  private readonly tracker: Tracker
  private readonly hooks: AppHooks

  constructor(
    renderer: CliRenderer,
    tracker: Tracker,
    names: ItemNames,
    state: ViewState,
    hooks: AppHooks,
  ) {
    this.tracker = tracker
    this.hooks = hooks
    this.state = state
    this.screen = new ArcanaScreen(renderer, tracker, names, {
      onPick: (index) => {
        this.pick(index)
      },
    })
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

    const char = this.typed(key)
    if (char === 'q') {
      this.hooks.onQuit()
      return
    }

    this.state.message = ''

    if (this.state.help) {
      // any key goes back
      this.state.help = false
      key.preventDefault()
      this.draw()
      return
    }

    switch (key.name) {
      case 'up':
        this.move(-1)
        break
      case 'down':
        this.move(1)
        break
      case 'pageup':
        this.move(-10)
        break
      case 'pagedown':
        this.move(10)
        break
      case 'tab': {
        if (this.state.detail) break
        const at = PANELS.indexOf(this.state.focus)
        const step = key.shift ? -1 : 1
        this.state.focus = PANELS[(at + step + PANELS.length) % PANELS.length] ?? 'history'
        this.state.scroll = 0
        break
      }
      case 'return': {
        if (this.state.detail) {
          this.state.detail = false
        } else if (this.state.focus === 'history' && entriesOf(this.tracker.state).length > 0) {
          this.state.detail = true
        }
        this.state.scroll = 0
        break
      }
      case 'escape':
        this.state.detail = false
        this.state.scroll = 0
        break
      default:
        this.action(char)
        break
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

  /** Does a key that is a letter. */
  private action(char: string): void {
    switch (char) {
      case 'j':
        this.move(1)
        return
      case 'k':
        this.move(-1)
        return
      case 't':
        this.state.taxed = !this.state.taxed
        this.state.message = `the trade tax is ${this.state.taxed ? 'on' : 'off'}`
        return
      case 'r':
        this.hooks.onRead()
        this.state.message = 'the log was read again'
        return
      case '?':
        this.state.help = true
        return
      default:
        return
    }
  }

  /** Moves the pointer in the history, or scrolls the detail and the totals. */
  private move(by: number): void {
    if (!this.state.detail && this.state.focus === 'history') {
      const last = Math.max(0, entriesOf(this.tracker.state).length - 1)
      this.state.cursor = Math.max(0, Math.min(last, this.state.cursor + by))
      return
    }
    this.state.scroll = Math.max(0, this.state.scroll + by)
  }

  /** Points at a row of the history, as the mouse did. */
  private pick(index: number): void {
    const rows = entriesOf(this.tracker.state).length
    if (rows === 0) return
    this.state.cursor = Math.max(0, Math.min(index, rows - 1))
    this.draw()
  }
}
