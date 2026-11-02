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
  MENU,
  PAGE_KEYS,
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
  /** the player wants the community prices fetched again; the message says what is happening */
  onBaseline?: () => string
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
  private clearAskedAt = 0

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
      onEdit: (text) => {
        this.edit(text)
      },
      onSubmit: (text) => {
        this.submit(text)
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
    // while an input box is open it has the keys; only escape comes back
    if (this.state.box !== null) {
      if (key.name === 'escape') {
        const box = this.state.box
        if (box.kind === 'search') this.clearFilter(box.panel)
        this.state.box = null
        key.preventDefault()
        this.draw()
      }
      return
    }


    if (this.state.menu !== null) {
      this.menuKey(key)
      key.preventDefault()
      this.draw()
      return
    }

    if (this.state.page !== null) {
      this.pageKey(key)
      key.preventDefault()
      this.draw()
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

  /** A key while the menu is open: move, pick with enter, or press the key of an entry. */
  private menuKey(key: KeyEvent): void {
    const at = this.state.menu ?? 0
    const char = this.typed(key)
    if (key.name === 'escape' || char === 'm') {
      this.state.menu = null
    } else if (key.name === 'up' || char === 'k') {
      this.state.menu = (at + MENU.length - 1) % MENU.length
    } else if (key.name === 'down' || char === 'j') {
      this.state.menu = (at + 1) % MENU.length
    } else if (key.name === 'return') {
      this.runMenu(MENU[at]?.key ?? '')
    } else if (MENU.some((item) => item.key === char)) {
      this.runMenu(char)
    }
  }

  /** Closes the menu and does what the entry says. Choosing the clear entry is the confirmation. */
  private runMenu(char: string): void {
    this.state.menu = null
    if (char === 'z') this.clearAskedAt = Date.now()
    this.action(char)
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
        this.state.box = { kind: 'price', item, name: this.names.name(item), text: known > 0 ? String(known) : '' }
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
        const wasBaseline = this.tracker.prices.isBaseline(item)
        this.state.message = this.tracker.prices.forget(item)
          ? `${name} is out of the prices (a new search on the exchange brings it back${
              wasBaseline ? ', and so do the community prices' : ''
            })`
          : `${name} is not in the prices`
        return
      }
      case 'z': {
        const now = Date.now()
        if (now - this.clearAskedAt > 5000) {
          this.clearAskedAt = now
          this.state.message = 'press z again within 5 s to clear every price learned from exchange searches'
          return
        }
        this.clearAskedAt = 0
        const n = this.tracker.prices.clearLearned()
        this.state.message = `cleared ${n} learned price${n === 1 ? '' : 's'} (hand-set and community prices stay)`
        return
      }
      case 'b': {
        this.state.message = this.hooks.onBaseline?.() ?? 'the community prices are not on'
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
      case '/': {
        const panel = this.state.focus
        if (panel === 'runs') {
          this.state.message = 'there is nothing to search in the runs'
          return
        }
        this.state.box = { kind: 'search', panel, text: this.filterOf(panel) }
        return
      }
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
      case 'm':
        this.state.menu = 0
        return
      case 'f':
      case 'h':
      case 'g': {
        this.state.page = PAGE_KEYS[char] ?? null
        this.state.detail = null
        this.screen.scrollOverlay(0, true)
        return
      }
      case 'n': {
        const last = this.tracker.sessions[this.tracker.sessions.length - 1]
        this.state.box = { kind: 'name', text: `Session ${(last?.id ?? 0) + 1}` }
        return
      }
      case 'N': {
        const ended = this.tracker.endSession()
        this.state.message = ended === null ? 'there is no session going on' : `the session ${ended.name} is over`
        return
      }
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

  /** A keystroke in whichever input box is open: the state keeps what is typed so far. */
  private edit(text: string): void {
    const box = this.state.box
    if (box === null) return
    box.text = text
    if (box.kind === 'search') this.setFilter(box.panel, text)
    this.draw()
  }

  /** The enter key in whichever input box is open. */
  private submit(text: string): void {
    const box = this.state.box
    if (box === null) return
    if (box.kind === 'price') this.setPrice(box.item, text)
    else if (box.kind === 'name') this.setName(text)
    else {
      // a search is kept when the box closes; only escape takes it away
      this.state.box = null
      this.draw()
    }
  }


  /** A key while a page is open: scroll it, or close it. */
  private pageKey(key: KeyEvent): void {
    const char = this.typed(key)
    if (key.name === 'escape' || char === 'q' || PAGE_KEYS[char] === this.state.page) {
      this.state.page = null
      return
    }
    const open = PAGE_KEYS[char]
    if (open !== undefined) {
      this.state.page = open
      this.screen.scrollOverlay(0, true)
      return
    }
    if (key.name === 'up' || char === 'k') this.screen.scrollOverlay(-1)
    else if (key.name === 'down' || char === 'j') this.screen.scrollOverlay(1)
    else if (key.name === 'pageup') this.screen.scrollOverlay(-10)
    else if (key.name === 'pagedown') this.screen.scrollOverlay(10)
  }

  /** Starts the session the player named. */
  private setName(text: string): void {
    const session = this.tracker.startSession(text, Date.now())
    this.state.message = `the session ${session.name} began: the runs from now on are its`
    this.state.box = null
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
    this.state.box = null
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
    this.draw()
  }

  /** Takes a hand-set price away, so the learned one counts again. */
  private resetPrice(item: number): void {
    const name = this.names.name(item)
    if (this.tracker.prices.override(item) === null) {
      this.state.message = `${name} has no price set by hand`
    } else {
      this.tracker.prices.setOverride(item, null)
      const known = this.tracker.prices.price(item)
      const source = this.tracker.prices.source(item)
      const where =
        source === 'learned' ? 'the learned price' : source === 'baseline' ? 'the community price' : 'nothing'
      this.state.message =
        known > 0
          ? `the set price of ${name} is gone, ${where} counts (${known} FE)`
          : `the set price of ${name} is gone, and nothing else knows what it is worth`
    }
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
