// What the tracker does when the player does something.
//
// The app holds the state of the screen and the rules for the keys and the mouse. It draws
// itself through the screen, and it does not know anything about the terminal: that is the
// renderer's business.

import type { KeyEvent } from '@opentui/core'
import type { CliRenderer } from '@opentui/core'
import { toolById, type Tool } from '@tli/launch'
import type { ItemNames, Tracker } from '@tli/tracker'
import { TrackerScreen } from './screen'
import {
  PANELS,
  bagRows,
  freshView,
  priceRows,
  type BagRow,
  type Panel,
  type PriceRow,
  type ViewState,
} from './view'

/** What the app tells the program around it. */
export interface AppHooks {
  /** the player wants to leave */
  onQuit: () => void
  /** the player wants the report */
  onReport: () => void
  /** the player wants the log read again */
  onRead: () => void
  /** the player wants a tool in a window of its own; the message says what happened */
  onOpenWindow: (tool: Tool) => string
}

/** The tools the tracker opens in a window of their own, and the key that opens them. */
const WINDOW_TOOLS: Record<string, string> = { a: 'arcana', v: 'vorax', w: 'warden' }

/** The tracker, as a program the player can use. */
export class TrackerApp {
  /** the state of the screen */
  readonly state: ViewState
  /** the screen it draws on */
  readonly screen: TrackerScreen

  private readonly tracker: Tracker
  private readonly names: ItemNames
  private readonly hooks: AppHooks
  private pausedAt: number | null = null

  constructor(
    renderer: CliRenderer,
    tracker: Tracker,
    names: ItemNames,
    logFile: string,
    hooks: AppHooks,
    now = Date.now(),
  ) {
    this.tracker = tracker
    this.names = names
    this.hooks = hooks
    this.state = freshView(logFile, now)
    this.screen = new TrackerScreen(renderer, tracker, {
      onFocus: (panel) => {
        this.state.focus = panel
        this.draw()
      },
      onPick: (panel, index) => {
        this.state.focus = panel
        this.select(panel, index)
        this.draw()
      },
      onPrice: (item, price) => {
        this.setPrice(item, price)
      },
      onSearch: (text) => {
        this.search(text)
      },
    })
    renderer.root.add(this.screen.root)
  }

  /** The time the screen shows: the clock stops when the player stops it. */
  now(): number {
    if (this.pausedAt !== null) return this.pausedAt
    return Date.now()
  }

  /** Draws the screen. */
  draw(): void {
    this.state.now = this.now()
    this.screen.draw(this.state)
  }

  /** Does a key press. */
  key(key: KeyEvent): void {
    if (key.ctrl && key.name === 'c') {
      this.hooks.onQuit()
      return
    }

    if (this.state.searching !== null) {
      this.searchKey(key)
      return
    }

    if (this.state.editing !== null) {
      if (key.name === 'escape') {
        this.state.editing = null
        this.screen.endPrice()
        key.preventDefault()
        this.draw()
      }
      return
    }

    if (this.state.help) {
      const char = this.typed(key)
      if (key.name === 'escape' || char === 'q' || char === '?') this.state.help = false
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
        const at = PANELS.indexOf(this.state.focus)
        const next = (at + (key.shift ? -1 : 1) + PANELS.length) % PANELS.length
        this.state.focus = PANELS[next] ?? 'runs'
        break
      }
      case 'return': {
        if (this.state.detail !== null) {
          this.state.detail = null
          break
        }
        const run = this.selectedRun()
        if (run !== null) this.state.detail = run
        break
      }
      case 'escape':
        this.escape()
        break
      default:
        this.action(this.typed(key))
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
      case 'q':
        this.hooks.onQuit()
        return
      case 'j':
        this.move(1)
        return
      case 'k':
        this.move(-1)
        return
      case 't':
        this.tracker.taxed = !this.tracker.taxed
        this.state.message = `the trade tax is ${this.tracker.taxed ? 'on' : 'off'}`
        return
      case 'c':
        this.tracker.mapCosts = !this.tracker.mapCosts
        this.state.message = `the cost of the map counts ${this.tracker.mapCosts ? 'against' : 'for nothing'} the profit`
        return
      case 'p':
        this.pausedAt = this.pausedAt === null ? Date.now() : null
        this.state.paused = this.pausedAt !== null
        this.state.message = this.pausedAt === null ? 'the clock is going again' : 'the clock is stopped'
        return
      case 'e': {
        const item = this.selectedItem()
        if (item === null) {
          this.state.message = 'there is nothing to set a price for'
          return
        }
        const known = this.tracker.prices.price(item)
        this.state.editing = { item, text: known > 0 ? String(known) : '' }
        this.screen.beginPrice(item, this.names.name(item), this.state.editing.text)
        return
      }
      case 'u': {
        const item = this.selectedItem()
        if (item === null) {
          this.state.message = 'there is nothing to reset'
          return
        }
        this.resetPrice(item)
        return
      }
      case 'd': {
        const item = this.selectedItem()
        if (item === null) {
          this.state.message = 'there is nothing to remove'
          return
        }
        const name = this.names.name(item)
        this.state.message = this.tracker.prices.forget(item)
          ? `${name} is out of the prices (a new search on the exchange brings it back)`
          : `${name} is not in the prices`
        return
      }
      case 's': {
        if (this.state.focus === 'inventory') {
          const order = ['value', 'qty', 'name'] as const
          const at = order.indexOf(this.state.inventorySort)
          this.state.inventorySort = order[(at + 1) % order.length] ?? 'value'
        } else if (this.state.focus === 'prices') {
          this.state.pricesSort = this.state.pricesSort === 'value' ? 'name' : 'value'
        } else {
          this.state.inventorySort = this.state.inventorySort === 'value' ? 'qty' : 'value'
        }
        return
      }
      case '/':
        this.beginSearch()
        return
      case 'x':
        this.hooks.onReport()
        return
      case 'r':
        this.hooks.onRead()
        this.state.message = 'the log was read again'
        return
      case 'a':
      case 'v':
      case 'w':
        this.openWindow(char)
        return
      case '?':
        this.state.help = true
        return
      default:
        return
    }
  }

  /** Opens a minigame's tool in a window of its own, and says what happened. */
  private openWindow(char: string): void {
    const id = WINDOW_TOOLS[char]
    if (id === undefined) return
    const tool = toolById(id)
    if (tool === undefined) {
      this.state.message = `there is no tool called ${id}`
      return
    }
    this.state.message = this.hooks.onOpenWindow(tool)
  }

  /** Opens the search box of the panel that has the focus. */
  private beginSearch(): void {
    if (this.state.focus === 'runs') {
      this.state.message = 'there is nothing to search in the runs'
      return
    }
    this.state.searching = this.state.focus
    this.screen.beginSearch(this.filterOf(this.state.focus))
    this.draw()
  }

  /** Does a key while the search box is open: the box has the keys, not the screen. */
  private searchKey(key: KeyEvent): void {
    const panel = this.state.searching
    if (panel === null) return
    if (key.name === 'escape') {
      key.preventDefault()
      this.state.searching = null
      this.clearFilter(panel)
      this.screen.endSearch()
      this.draw()
      return
    }
    if (key.name === 'return' || key.name === 'kpenter' || key.name === 'linefeed') {
      key.preventDefault()
      this.state.searching = null
      this.screen.endSearch()
      this.draw()
      return
    }
  }

  /** Filters the panel that is being searched, as the words are typed. */
  private search(text: string): void {
    const panel = this.state.searching
    if (panel === null) return
    this.setFilter(panel, text)
    this.draw()
  }

  /** What the escape key does: close the detail of a run, or take the filter away. */
  private escape(): void {
    if (this.state.detail !== null) {
      this.state.detail = null
      return
    }
    const panel = this.state.focus
    if (this.filterOf(panel) === '') return
    this.clearFilter(panel)
    this.state.message = 'the filter is gone'
  }

  /** The words the rows of a panel have to match. */
  private filterOf(panel: Panel): string {
    if (panel === 'inventory') return this.state.inventoryFilter
    if (panel === 'prices') return this.state.pricesFilter
    return ''
  }

  /** Sets the words the rows of a panel have to match, and keeps the pointer inside them. */
  private setFilter(panel: Panel, text: string): void {
    if (panel === 'inventory') this.state.inventoryFilter = text
    else if (panel === 'prices') this.state.pricesFilter = text
    this.clamp(panel)
  }

  /** Takes the filter of a panel away. */
  private clearFilter(panel: Panel): void {
    this.setFilter(panel, '')
  }

  /** The rows of a panel, with the filter of the panel on. */
  private rowsOf(panel: Panel): (BagRow | PriceRow)[] {
    if (panel === 'inventory') {
      return bagRows(this.tracker, this.state.inventorySort, this.state.inventoryFilter).rows
    }
    if (panel === 'prices') {
      return priceRows(this.tracker, this.state.pricesSort, this.state.pricesFilter).rows
    }
    return []
  }

  /** Keeps the pointer of a panel inside the rows that are shown. */
  private clamp(panel: Panel): void {
    const size = this.rowsOf(panel).length
    if (panel === 'inventory') {
      this.state.inventoryAt = Math.max(0, Math.min(this.state.inventoryAt, size - 1))
    } else if (panel === 'prices') {
      this.state.pricesAt = Math.max(0, Math.min(this.state.pricesAt, size - 1))
    }
  }

  /** Sets the price of an item, when the player confirms one. */
  private setPrice(item: number, price: string): void {
    const value = Number(price)
    if (price.trim() === '') {
      this.resetPrice(item)
      return
    }
    if (Number.isFinite(value) && value >= 0) {
      this.tracker.prices.setOverride(item, value)
      this.state.message = `the price of ${this.names.name(item)} is ${value} FE`
    } else {
      this.state.message = `${price} is not a price`
    }
    this.state.editing = null
    this.screen.endPrice()
    this.draw()
  }

  /** Takes a hand-set price away, so the learned one counts again. */
  private resetPrice(item: number): void {
    const name = this.names.name(item)
    if (this.tracker.prices.override(item) === null) {
      this.state.message = `${name} has no price set by hand`
    } else {
      this.tracker.prices.setOverride(item, null)
      const learned = this.tracker.prices.price(item)
      this.state.message = `the set price of ${name} is gone${learned > 0 ? `, the learned ${learned} FE counts` : ''}`
    }
    this.state.editing = null
    this.screen.endPrice()
    this.draw()
  }

  /** How many rows the focused panel has. */
  private panelSize(): number {
    if (this.state.focus === 'runs') return this.tracker.runs.length
    return this.rowsOf(this.state.focus).length
  }

  /** The item the keys are pointing at. */
  private selectedItem(): number | null {
    if (this.state.focus === 'inventory') {
      const rows = this.rowsOf('inventory')
      const row = rows[Math.min(this.state.inventoryAt, rows.length - 1)]
      return row?.item ?? null
    }
    const rows = this.rowsOf('prices')
    const row = rows[Math.min(this.state.pricesAt, rows.length - 1)]
    return row?.item ?? null
  }

  /** Moves the pointer in the focused panel. */
  private move(by: number): void {
    const size = this.panelSize()
    if (size === 0) return
    if (this.state.focus === 'runs') {
      this.state.runsAt = Math.max(0, Math.min(this.state.runsAt + by, size - 1))
      this.state.detail = null
    } else if (this.state.focus === 'inventory') {
      this.state.inventoryAt = Math.max(0, Math.min(this.state.inventoryAt + by, size - 1))
    } else {
      this.state.pricesAt = Math.max(0, Math.min(this.state.pricesAt + by, size - 1))
    }
  }

  /** Points at a row of a panel, as the mouse did. */
  private select(panel: Panel, index: number): void {
    const size = panel === 'runs' ? this.tracker.runs.length : this.rowsOf(panel).length
    if (size === 0) return
    const at = Math.max(0, Math.min(index, size - 1))
    if (panel === 'runs') {
      this.state.runsAt = at
      this.state.detail = null
    } else if (panel === 'inventory') {
      this.state.inventoryAt = at
    } else {
      this.state.pricesAt = at
    }
  }

  /** The run the keys are pointing at. */
  private selectedRun(): number | null {
    const run = [...this.tracker.runs].reverse()[this.state.runsAt]
    return run?.id ?? null
  }
}
