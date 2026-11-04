// The screen the tracker draws.
//
// The screen is a tree of OpenTUI renderables: the header, the four panels and the footer. It is
// built once and then updated from the state, so the layout is flexbox all the way and a resize is
// the renderer's business, not the tracker's.
//
// Nothing here reads the log or writes a file: the screen only draws what it is given.

import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  ScrollBoxRenderable,
  StyledText,
  TextRenderable,
  type CliRenderer,
  type TextChunk,
} from '@opentui/core'
import {
  type Row,
  backgroundColor,
  borderColor,
  brandChunks,
  chip,
  clock,
  color,
  colorEnabled,
  defaultBackground,
  defaultForeground,
  duration,
  fe,
  fit,
  footerChunks,
  meter,
  num,
  panelBorderStyle,
  panelTitle,
  price,
  stat,
  surfaceColor,
  signTone,
  topBarChunks,
  keyHint,
  type Tone,
  toneOn,
  rowChunks,
  theme,
  textColor,
  titleColor,
  tone,
  visibleLength,
} from '@tli/tui'
import type { Run, Tracker } from '@tli/tracker'
import { ATTRIBUTION, ATTRIBUTION_URL } from '@tli/tracker'
import {
  MENU,
  type BagRow,
  type Panel,
  type PriceRow,
  type Rows,
  type ViewState,
  affixRows,
  bagRows,
  findRun,
  lootRows,
  priceRows,
  runRows,
  sessionRows,
  tradeRows,
  tradeTotals,
} from './view'

/** Below this width the panels are stacked instead of side by side. */
const NARROW = 80

/** The columns a panel's border takes up. */
const BORDER = 2

/** The column the scrollbar takes up. */
const SCROLLBAR = 1

/** How much of the filter the title of a panel shows. */
const TITLE_FILTER = 20

/** The width of the column that says what kind of run it is. */
const KIND_WIDTH = 7

/** The name of a list panel: its name, the filter and how many rows there are. */
function listTitle(name: string, count: number, total: number, filter: string): string {
  if (filter.trim() === '') return `${name} (${total})`
  return `${name} /${fit(filter, TITLE_FILTER)} (${count}/${total})`
}

/** A big number in few columns: 292224385 -> "292.2M", 61000 -> "61.0k", 840 -> "840". */
function compact(value: number): string {
  const sign = value < 0 ? '-' : ''
  const n = Math.abs(value)
  if (n >= 1e9) return `${sign}${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${sign}${(n / 1e6).toFixed(1)}M`
  if (n >= 1e4) return `${sign}${(n / 1e3).toFixed(1)}k`
  return `${sign}${num(n)}`
}

/** A day and a time of the player's own clock: "11-01 14:05". */
function stamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** What the screen tells the app when the player uses it. */
export interface ScreenHooks {
  /** the player clicked a panel */
  onFocus?: (panel: Panel) => void
  /** the player clicked a row of a list */
  onPick?: (panel: Panel, index: number) => void
  /** the player typed in the input box that is open */
  onEdit?: (text: string) => void
  /** the player pressed enter in the input box that is open */
  onSubmit?: (text: string) => void
}

/** A panel with a list in it. */
interface ListPanel {
  box: BoxRenderable
  scroll: ScrollBoxRenderable
  text: TextRenderable
  /** what was in the panel last time, so it is only drawn again when it changed */
  key: string
}

/** The keys the help lists. */
const HELP: [string, string][] = [
  ['↑↓  j/k', 'move in the panel that has the focus'],
  ['tab', 'the next panel (shift+tab the one before)'],
  ['⏎', 'the detail of the run that is picked out'],
  ['esc', 'back, leave the price, or take the filter away'],
  ['t', 'the trade tax on and off'],
  ['c', 'the cost of the map counts against the profit, or not'],
  ['p', 'stop and start the clock'],
  ['e', 'set the price of the item that is picked out (empty = reset)'],
  ['u', 'reset a hand-set price to the learned one'],
  ['d', 'remove the item from the prices (learned and set)'],
  ['i', 'open the wiki page of the item that is picked out'],
  ['z', 'clear every price learned from exchange searches (press twice)'],
  ['b', 'fetch the community prices again'],
  ['s', 'change how the list is sorted'],
  ['/', 'search the list that has the focus (enter keeps it, esc clears it)'],
  ['x', 'write the loot report to a csv file'],
  ['o', 'the loot card over the game: off, bottom-left, bottom-right (starts the overlay)'],
  ['f', 'which modifiers of the maps paid (a page; esc or the same key closes it)'],
  ['h', 'what you did at the exchange: listings, payments, what you collected'],
  ['g', 'the sessions, each with its runs, FE and experience added up'],
  ['n', 'start a session of your own: it asks for a name, the runs after it are its'],
  ['N', 'end the session that is going on'],
  ['r', 'read the log again from where it was'],
  ['a', 'open Arcana in a window of its own'],
  ['v', 'open Vorax in a window of its own'],
  ['w', 'open Warden in a window of its own'],
  ['m', 'a menu of what the keys do, to pick from'],
  ['?', 'this help'],
  ['q', 'quit'],
]

/** The tracker's screen. */
export class TrackerScreen {
  /** the tree that is drawn */
  readonly root: BoxRenderable

  private readonly renderer: CliRenderer
  private readonly tracker: Tracker
  private readonly hooks: ScreenHooks

  private readonly header: BoxRenderable
  private readonly titleText: TextRenderable
  private readonly currentText: TextRenderable
  private readonly statsText: TextRenderable
  private readonly flagsText: TextRenderable
  private readonly messageText: TextRenderable

  private readonly body: BoxRenderable
  private readonly leftColumn: BoxRenderable
  private readonly rightColumn: BoxRenderable

  private readonly current: ListPanel
  private readonly runs: ListPanel
  private readonly best: ListPanel
  private readonly bag: ListPanel
  private readonly prices: ListPanel

  private readonly footer: BoxRenderable
  private readonly hintText: TextRenderable
  private readonly priceLabel: TextRenderable
  private readonly priceInput: InputRenderable
  private readonly priceHint: TextRenderable
  private readonly searchLabel: TextRenderable
  private readonly searchInput: InputRenderable
  private readonly searchHint: TextRenderable

  private readonly overlay: BoxRenderable
  private readonly overlayBox: BoxRenderable
  private readonly overlayScroll: ScrollBoxRenderable
  private readonly overlayText: TextRenderable

  /** whether the panels are stacked */
  private narrow = false
  /** the width of the left column */
  private leftWidth = 0
  /** the width of the right column */
  private rightWidth = 0

  constructor(renderer: CliRenderer, tracker: Tracker, hooks: ScreenHooks = {}) {
    this.renderer = renderer
    this.tracker = tracker
    this.hooks = hooks

    this.root = new BoxRenderable(renderer, {
      id: 'tracker',
      width: '100%',
      height: '100%',
      flexDirection: 'column',
    })

    this.header = new BoxRenderable(renderer, {
      id: 'header',
      width: '100%',
      flexDirection: 'column',
      flexShrink: 0,
    })
    const titleRow = new BoxRenderable(renderer, {
      id: 'title-row',
      width: '100%',
      height: 1,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexShrink: 0,
      backgroundColor: surfaceColor(),
    })
    this.titleText = new TextRenderable(renderer, {
      id: 'title',
      content: 'TLI Loot Tracker',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    titleRow.add(this.titleText)
    this.header.add(titleRow)

    this.currentText = new TextRenderable(renderer, {
      id: 'current-line',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
      visible: false,
    })
    this.statsText = new TextRenderable(renderer, {
      id: 'stats',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    this.flagsText = new TextRenderable(renderer, {
      id: 'flags',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    this.messageText = new TextRenderable(renderer, {
      id: 'message',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    this.header.add(this.currentText)
    this.header.add(this.statsText)
    this.header.add(this.flagsText)
    this.header.add(this.messageText)

    this.body = new BoxRenderable(renderer, {
      id: 'body',
      width: '100%',
      flexGrow: 1,
      flexBasis: 0,
      flexDirection: 'row',
    })
    this.leftColumn = new BoxRenderable(renderer, {
      id: 'left',
      flexDirection: 'column',
      flexShrink: 0,
    })
    this.rightColumn = new BoxRenderable(renderer, {
      id: 'right',
      flexDirection: 'column',
      flexShrink: 0,
    })
    this.current = this.makePanel('current', panelTitle('Current run'), null)
    this.bag = this.makePanel('bag', panelTitle('Bag'), 'inventory')
    this.runs = this.makePanel('runs', panelTitle('Recent runs'), 'runs')
    this.best = this.makePanel('best', panelTitle('Best run'), null)
    this.best.box.flexGrow = 0
    this.best.box.flexShrink = 0
    this.best.box.height = 3
    this.best.box.flexBasis = 3
    this.prices = this.makePanel('prices', panelTitle('Prices (* set)'), 'prices')
    this.leftColumn.add(this.current.box)
    this.leftColumn.add(this.bag.box)
    this.rightColumn.add(this.best.box)
    this.rightColumn.add(this.runs.box)
    this.rightColumn.add(this.prices.box)
    this.body.add(this.leftColumn)
    this.body.add(this.rightColumn)

    this.footer = new BoxRenderable(renderer, {
      id: 'footer',
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 0,
      backgroundColor: surfaceColor(),
    })
    this.hintText = new TextRenderable(renderer, {
      id: 'hints',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    this.priceLabel = new TextRenderable(renderer, {
      id: 'price-label',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
      visible: false,
    })
    this.priceInput = new InputRenderable(renderer, {
      id: 'price-input',
      width: 12,
      visible: false,
      textColor: textColor(),
      cursorColor: textColor(),
    })
    this.priceHint = new TextRenderable(renderer, {
      id: 'price-hint',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
      visible: false,
    })
    this.searchLabel = new TextRenderable(renderer, {
      id: 'search-label',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
      visible: false,
    })
    this.searchInput = new InputRenderable(renderer, {
      id: 'search-input',
      width: 24,
      visible: false,
      textColor: textColor(),
      cursorColor: textColor(),
    })
    this.searchHint = new TextRenderable(renderer, {
      id: 'search-hint',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
      visible: false,
    })
    this.footer.add(this.hintText)
    this.footer.add(this.priceLabel)
    this.footer.add(this.priceInput)
    this.footer.add(this.priceHint)
    this.footer.add(this.searchLabel)
    this.footer.add(this.searchInput)
    this.footer.add(this.searchHint)

    this.overlay = new BoxRenderable(renderer, {
      id: 'overlay',
      position: 'absolute',
      left: 0,
      top: 0,
      width: '100%',
      height: '100%',
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: backgroundColor(),
      visible: false,
    })
    this.overlayBox = new BoxRenderable(renderer, {
      id: 'overlay-box',
      border: true,
      borderStyle: 'rounded',
      title: '',
      flexDirection: 'column',
      overflow: 'hidden',
      backgroundColor: backgroundColor(),
    })
    this.overlayScroll = new ScrollBoxRenderable(renderer, {
      id: 'overlay-scroll',
      width: '100%',
      height: '100%',
      viewportOptions: { backgroundColor: backgroundColor() },
      contentOptions: { backgroundColor: backgroundColor() },
    })
    this.overlayText = new TextRenderable(renderer, {
      id: 'overlay-text',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    this.overlayScroll.add(this.overlayText)
    this.overlayBox.add(this.overlayScroll)
    this.overlay.add(this.overlayBox)

    this.root.add(this.header)
    this.root.add(this.body)
    this.root.add(this.footer)
    this.root.add(this.overlay)

    this.priceInput.on(InputRenderableEvents.ENTER, (value: string) => {
      this.hooks.onSubmit?.(value)
    })
    this.priceInput.on(InputRenderableEvents.INPUT, (value: string) => {
      this.hooks.onEdit?.(value)
    })

    this.searchInput.on(InputRenderableEvents.ENTER, (value: string) => {
      this.hooks.onSubmit?.(value)
    })
    this.searchInput.on(InputRenderableEvents.INPUT, (value: string) => {
      this.hooks.onEdit?.(value)
    })
  }

  /** A panel with a list in it. */
  private makePanel(id: string, title: string, panel: Panel | null): ListPanel {
    const box = new BoxRenderable(this.renderer, {
      id,
      border: true,
      borderStyle: 'rounded',
      title,
      flexDirection: 'column',
      flexGrow: 1,
      flexBasis: 0,
      overflow: 'hidden',
    })
    const scroll = new ScrollBoxRenderable(this.renderer, {
      id: `${id}-scroll`,
      width: '100%',
      height: '100%',
      scrollbarOptions: {
        trackOptions: {
          foregroundColor: colorEnabled() ? color(theme.scrollThumb) : defaultForeground(),
          backgroundColor: colorEnabled() ? color(theme.scrollTrack) : defaultBackground(),
        },
      },
    })
    const text = new TextRenderable(this.renderer, {
      id: `${id}-text`,
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    scroll.add(text)
    box.add(scroll)

    if (panel !== null) {
      box.onMouseDown = () => {
        this.hooks.onFocus?.(panel)
      }
      text.onMouseDown = (event) => {
        const row = event.y - scroll.viewport.y + scroll.scrollTop
        if (row < 0) return
        this.hooks.onPick?.(panel, row)
      }
    }

    return { box, scroll, text, key: '' }
  }

  /** The input box the state has open, drawn from the state: which one it is, its label and its
   * text. The cursor in the text is the input's own; the value is only written when it differs,
   * so writing what the player typed does not move the cursor. */
  private drawBox(state: ViewState): void {
    const box = state.box
    const priceOpen = box !== null && box.kind !== 'search'
    this.priceLabel.visible = priceOpen
    this.priceInput.visible = priceOpen
    this.priceHint.visible = priceOpen
    if (priceOpen && box !== null) {
      this.priceInput.width = box.kind === 'name' ? 28 : 12
      this.priceLabel.content =
        box.kind === 'name'
          ? new StyledText([tone('purple', 'session '), tone('dim', 'name  ')])
          : new StyledText([tone('dim', 'price '), tone('blue', box.name), tone('dim', ' (FE)  ')])
      if (this.priceInput.value !== box.text) this.priceInput.value = box.text
      this.priceInput.focus()
    } else {
      this.priceInput.blur()
      this.priceInput.width = 12
    }

    const searchOpen = box !== null && box.kind === 'search'
    this.searchLabel.visible = searchOpen
    this.searchInput.visible = searchOpen
    this.searchHint.visible = searchOpen
    if (searchOpen && box !== null) {
      this.searchLabel.content = new StyledText([tone('dim', 'search ')])
      if (this.searchInput.value !== box.text) this.searchInput.value = box.text
      this.searchInput.focus()
    } else {
      this.searchInput.blur()
    }
  }


  /** Scrolls the page or the detail that covers the screen by some rows, or back to its top. */
  scrollOverlay(by: number, top = false): void {
    if (top) this.overlayScroll.scrollTo(0)
    else this.overlayScroll.scrollBy(by)
  }


  /** Draws the state. */
  draw(state: ViewState): void {
    const width = this.renderer.width
    const height = this.renderer.height
    this.layout(width, state)
    this.drawHeader(state, width)
    this.drawCurrent(state)
    this.drawRuns(state)
    this.drawBest()
    const bag = bagRows(this.tracker, state.inventorySort, state.inventoryFilter)
    const prices = priceRows(this.tracker, state.pricesSort, state.pricesFilter)
    this.drawBag(state, bag)
    this.drawPrices(state, prices)
    this.drawBox(state)
    this.drawFooter(state, width)
    this.drawOverlay(state, width, height)
  }

  /** Works out how the panels are put on the screen. */
  private layout(width: number, state: ViewState): void {
    this.narrow = width < NARROW
    const left = this.narrow ? width : Math.floor(width * 0.45)
    this.leftWidth = left
    this.rightWidth = this.narrow ? width : width - left

    this.body.flexDirection = this.narrow ? 'column' : 'row'
    this.leftColumn.width = left
    this.rightColumn.width = this.rightWidth
    this.leftColumn.flexGrow = this.narrow ? 1 : 0
    this.rightColumn.flexGrow = this.narrow ? 1 : 0
    this.leftColumn.flexBasis = this.narrow ? 0 : undefined
    this.rightColumn.flexBasis = this.narrow ? 0 : undefined

    this.current.box.visible = !this.narrow
    this.bag.box.visible = !this.narrow || state.focus === 'inventory'
    this.runs.box.visible = !this.narrow || state.focus === 'runs'
    this.prices.box.visible = !this.narrow || state.focus === 'prices'
    this.leftColumn.visible = this.current.box.visible || this.bag.box.visible
    this.rightColumn.visible = this.runs.box.visible || this.prices.box.visible

    this.borders(this.current, false)
    this.borders(this.best, false)
    this.borders(this.bag, state.focus === 'inventory')
    this.borders(this.runs, state.focus === 'runs')
    this.borders(this.prices, state.focus === 'prices')
    this.runs.box.title = panelTitle('Recent runs', state.focus === 'runs')
  }

  /** The border and the title of a panel, in the colour of the focus. */
  private borders(panel: ListPanel, focused: boolean): void {
    panel.box.borderStyle = panelBorderStyle(focused)
    panel.box.borderColor = borderColor(focused)
    panel.box.titleColor = titleColor(focused)
  }

  /** The width the text of a panel has. */
  private panelWidth(panel: ListPanel): number {
    const column = panel === this.current || panel === this.bag ? this.leftWidth : this.rightWidth
    return Math.max(4, column - BORDER - SCROLLBAR)
  }

  /** The title, the numbers and the switches along the top. */
  private drawHeader(state: ViewState, width: number): void {
    this.titleText.width = width
    this.titleText.content = new StyledText(topBarChunks({ name: 'TLI Loot Tracker', sub: state.logFile }, width))

    this.currentText.visible = this.narrow
    if (this.narrow) {
      const run = this.tracker.currentRun
      if (run === null) {
        this.currentText.content = new StyledText([tone('dim', 'not in a map')])
      } else {
        const worth = this.tracker.valueOfRun(run).gross
        this.currentText.content = new StyledText([
          tone('blue', run.name),
          tone('dim', ' · '),
          tone('teal', duration(state.now - run.start)),
          tone('dim', ' · '),
          tone('orange', `${run.loot.size} kinds`),
          tone('dim', ' · '),
          tone(worth > 0 ? 'gold' : 'dim', fe(worth)),
        ])
      }
      this.currentText.width = width
    }

    const stats = this.tracker.stats(state.now)
    const money = (value: number): 'gold' | 'dim' => (value > 0 ? 'gold' : 'dim')
    const segments: TextChunk[][] = [
      stat('net worth', fe(stats.netWorth), money(stats.netWorth)),
      stat('FE/h', num(stats.fePerHour), money(stats.fePerHour)),
      stat('FE/run', num(stats.fePerRun), money(stats.fePerRun)),
      stat('runs', String(stats.runs), 'orange'),
      stat('time', duration(stats.totalTime), 'teal'),
      stat('avg', duration(stats.avgRunTime), 'teal'),
    ]
    if (stats.level !== null) {
      const level: TextChunk[] = stat('level', String(stats.level), 'purple')
      if (stats.levelProgress !== null) {
        level.push(...meter(stats.levelProgress, 10, 'purple'))
        level.push(tone('dim', ` ${(stats.levelProgress * 100).toFixed(1)}%`))
      }
      segments.push(level)
      segments.push(stat('XP/h', compact(stats.xpPerHour), stats.xpPerHour > 0 ? 'purple' : 'dim'))
      if (stats.levelEta !== null) segments.push(stat('next level in', duration(stats.levelEta), 'teal'))
    }
    this.statsText.content = new StyledText(this.pack(segments, width))
    this.statsText.width = width

    const chips: TextChunk[] = [
      chip(this.tracker.taxed ? 'tax on' : 'tax off', this.tracker.taxed ? 'green' : 'dim'),
      tone('default', '  '),
      chip(this.tracker.mapCosts ? 'map cost on' : 'map cost off', this.tracker.mapCosts ? 'green' : 'dim'),
    ]
    if (state.paused) chips.push(tone('default', '  '), chip('PAUSED', 'yellow'))
    const session = this.tracker.session
    if (session !== null) chips.push(tone('default', '  '), chip(`session ${fit(session.name, 24)}`, 'purple'))
    const character = this.tracker.character
    if (character !== '') {
      chips.push(tone('default', '  '), chip(`character …${character.slice(-6)}${this.tracker.characterIds.length > 1 ? ` of ${this.tracker.characterIds.length}` : ''}`, 'dim'))
    }
    this.flagsText.content = new StyledText(chips)
    this.flagsText.width = width

    const message = state.logNote !== '' ? state.logNote : state.message
    if (message === '') {
      this.messageText.content = new StyledText([])
    } else {
      const problem =
        state.logNote !== '' || /could not|cannot|can not|failed|missing|not there|no longer/i.test(message)
      this.messageText.content = new StyledText([
        tone(problem ? 'red' : 'accent', '› '),
        tone(problem ? 'red' : 'accent', message),
      ])
    }
    this.messageText.width = width
  }

  /** Puts the pieces of a line on as many lines as they need. */
  private pack(segments: TextChunk[][], width: number): TextChunk[] {
    const gap = '   '
    const lines: TextChunk[][] = []
    let current: TextChunk[] = []
    let currentWidth = 0

    for (const segment of segments) {
      const text = segment.map((chunk) => chunk.text).join('')
      const segmentWidth = visibleLength(text)
      if (current.length > 0 && currentWidth + gap.length + segmentWidth > width) {
        lines.push(current)
        current = []
        currentWidth = 0
      }
      if (current.length > 0) {
        current.push(tone('default', gap))
        currentWidth += gap.length
      }
      current.push(...segment)
      currentWidth += segmentWidth
    }
    if (current.length > 0) lines.push(current)

    const chunks: TextChunk[] = []
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (line === undefined) continue
      chunks.push(...line)
      if (index < lines.length - 1) chunks.push(tone('default', '\n'))
    }
    return chunks
  }

  /** The panel of the run that is going on. */
  private drawCurrent(state: ViewState): void {
    const run = this.tracker.currentRun
    const rows: Row[] = []
    if (run === null) {
      rows.push({ cells: [{ text: 'not in a map', tone: 'dim' }] })
    } else {
      const worth = this.tracker.valueOfRun(run).gross
      const loot = lootRows(this.tracker, run.loot)
      const qtyWidth = Math.max(3, ...loot.map((item) => visibleLength(num(item.qty))))
      const valueWidth = Math.max(13, ...loot.map((item) => visibleLength(fe(item.worth))))
      rows.push({
        cells: [
          { text: run.name, tone: 'blue' },
          { text: run.kind === 'prison' ? 'prison' : '', tone: 'purple', width: KIND_WIDTH },
        ],
      })
      rows.push({
        cells: [
          { text: duration(state.now - run.start), tone: 'teal', width: 9 },
          { text: `${run.loot.size} kinds`, tone: 'orange' },
          { text: fe(worth), tone: worth > 0 ? 'gold' : 'dim', width: valueWidth, align: 'right' },
        ],
      })
      for (const item of loot) {
        rows.push({
          cells: [
            { text: item.name, tone: 'blue' },
            { text: num(item.qty), tone: 'orange', width: qtyWidth, align: 'right' },
            { text: fe(item.worth), tone: item.worth > 0 ? 'gold' : 'dim', width: valueWidth, align: 'right' },
          ],
        })
      }
    }
    this.drawList(this.current, rows)
  }

  /** The panel of the runs that are done. */
  private drawRuns(state: ViewState): void {
    const runs = runRows(this.tracker, state.now)
    if (runs.length === 0) {
      this.drawList(this.runs, [{ cells: [{ text: 'no runs yet', tone: 'dim' }] }])
      return
    }
    const durationWidth = Math.max(8, ...runs.map((run) => visibleLength(duration(run.took))))
    const valueWidth = Math.max(13, ...runs.map((run) => visibleLength(fe(run.worth))))

    const rows: Row[] = runs.map((run, index) => ({
      selected: state.focus === 'runs' && index === state.runsAt,
      cells: [
        { text: `#${run.id}`, tone: 'dim', width: 5, align: 'right' },
        { text: run.kind === 'prison' ? 'prison' : '', tone: 'purple', width: KIND_WIDTH },
        { text: run.name, tone: 'blue' },
        { text: duration(run.took), tone: 'teal', width: durationWidth, align: 'right' },
        { text: fe(run.worth), tone: run.worth > 0 ? 'gold' : 'dim', width: valueWidth, align: 'right' },
      ],
    }))
    this.drawList(this.runs, rows)
    this.keepVisible(this.runs, state.focus === 'runs' ? state.runsAt : -1)
  }

  /** The run worth the most, in one line above the recent runs. */
  private drawBest(): void {
    const runs = runRows(this.tracker, 0)
    let best: (typeof runs)[number] | null = null
    for (const run of runs) if (best === null || run.worth > best.worth) best = run
    this.best.box.visible = best !== null && best.worth > 0 && this.runs.box.visible
    if (best === null) return
    this.drawList(this.best, [
      {
        cells: [
          { text: `#${best.id}`, tone: 'dim', width: 5, align: 'right' },
          { text: best.kind === 'prison' ? 'prison' : '', tone: 'purple', width: KIND_WIDTH },
          { text: best.name, tone: 'blue' },
          { text: duration(best.took), tone: 'teal', width: 8, align: 'right' },
          { text: fe(best.worth), tone: 'green', width: 13, align: 'right' },
        ],
      },
    ])
  }

  /** The panel of what the player has. */
  private drawBag(state: ViewState, bag: Rows<BagRow>): void {
    this.bag.box.title = panelTitle(listTitle('Bag', bag.rows.length, bag.total, state.inventoryFilter), state.focus === 'inventory')
    if (bag.rows.length === 0) {
      const empty =
        state.inventoryFilter === ''
          ? 'the bag is empty'
          : `no item matches "${state.inventoryFilter}"`
      this.drawList(this.bag, [{ cells: [{ text: empty, tone: 'dim' }] }])
      return
    }
    const qtyWidth = Math.max(3, ...bag.rows.map((row) => visibleLength(num(row.qty))))
    const valueWidth = Math.max(13, ...bag.rows.map((row) => visibleLength(fe(row.worth))))
    const rows: Row[] = bag.rows.map((row, index) => ({
      selected: state.focus === 'inventory' && index === state.inventoryAt,
      cells: [
        { text: row.name, tone: 'blue' },
        { text: num(row.qty), tone: 'orange', width: qtyWidth, align: 'right' },
        { text: fe(row.worth), tone: row.worth > 0 ? 'gold' : 'dim', width: valueWidth, align: 'right' },
      ],
    }))
    this.drawList(this.bag, rows)
    this.keepVisible(this.bag, state.focus === 'inventory' ? state.inventoryAt : -1)
  }

  /** The panel of the prices the tracker knows. */
  private drawPrices(state: ViewState, prices: Rows<PriceRow>): void {
    this.prices.box.title = panelTitle(listTitle('Prices (* set)', prices.rows.length, prices.total, state.pricesFilter), state.focus === 'prices')
    if (prices.rows.length === 0) {
      const empty =
        state.pricesFilter === ''
          ? 'no prices yet: look an item up on the exchange'
          : `no item matches "${state.pricesFilter}"`
      this.drawList(this.prices, [{ cells: [{ text: empty, tone: 'dim' }] }])
      return
    }
    const valueWidth = Math.max(13, ...prices.rows.map((row) => visibleLength(price(row.price))))
    const rows: Row[] = prices.rows.map((row, index) => ({
      selected: state.focus === 'prices' && index === state.pricesAt,
      cells: [
        { text: row.name, tone: 'blue' },
        { text: price(row.price), tone: row.price > 0 ? 'gold' : 'dim', width: valueWidth, align: 'right' },
        {
          text: row.source === 'set' ? '*' : row.source === 'baseline' ? '~' : '·',
          tone: row.source === 'set' ? 'accent' : 'dim',
          width: 1,
          align: 'right',
        },
      ],
    }))
    this.drawList(this.prices, rows)
    this.keepVisible(this.prices, state.focus === 'prices' ? state.pricesAt : -1)
  }

  /** Puts the rows of a panel on the screen, when what they say or the width changed. */
  private drawList(panel: ListPanel, rows: Row[]): void {
    const width = this.panelWidth(panel)
    const key = JSON.stringify(rows)
    if (panel.key === key && panel.text.width === width) return
    panel.key = key
    panel.text.width = width
    const chunks: TextChunk[] = []
    for (let index = 0; index < rows.length; index += 1) {
      if (index > 0) chunks.push(tone('default', '\n'))
      const row = rows[index]
      if (row !== undefined) chunks.push(...rowChunks(row, width))
    }
    panel.text.content = new StyledText(chunks)
  }

  /** Scrolls a list so that the row that is picked out stays in sight. */
  private keepVisible(panel: ListPanel, index: number): void {
    if (index < 0) return
    const rows = panel.scroll.viewport.height
    if (rows <= 0) return
    const top = panel.scroll.scrollTop
    if (index < top) {
      panel.scroll.scrollTo(index)
      return
    }
    if (index >= top + rows) {
      panel.scroll.scrollTo(index - rows + 1)
    }
  }

  /** The keys at the bottom, or the line of the price that is being typed in. */
  private drawFooter(state: ViewState, width: number): void {
    const hints: [string, string][] = [
      ['↑↓', 'move'],
      ['tab', 'panel'],
      ['⏎', 'detail'],
      ['/', 'search'],
      ['m', 'menu'],
      ['?', 'help'],
      ['q', 'quit'],
    ]
    // a filter being typed replaces the keys, as a message does in every tool; the other filters
    // are chips before them, and the prices' attribution is the quiet piece after them
    const focused = state.focus === 'inventory' ? state.inventoryFilter : state.focus === 'prices' ? state.pricesFilter : ''
    const message = focused === '' ? '' : `/${fit(focused, 16)} filter, esc takes it away`
    const chips: [string, Tone][] = []
    if (state.focus !== 'inventory' && state.inventoryFilter !== '') {
      chips.push([`bag /${fit(state.inventoryFilter, 14)}`, 'dim'])
    }
    if (state.focus !== 'prices' && state.pricesFilter !== '') {
      chips.push([`prices /${fit(state.pricesFilter, 14)}`, 'dim'])
    }
    this.hintText.content = new StyledText(
      footerChunks({ hints, message, chips, after: this.baselineChip(state) }, width),
    )
    this.hintText.width = width
    this.hintText.visible = state.box === null
    this.priceHint.content = new StyledText(
      footerChunks(
        {
          hints:
            state.box?.kind === 'name'
              ? [['enter', 'starts it'], ['esc', 'leaves it']]
              : [['enter', 'keeps it · empty enter resets'], ['esc', 'leaves it']],
        },
        this.renderer.width,
      ),
    )
    this.searchHint.content = new StyledText(
      footerChunks({ hints: [['enter', 'keeps it'], ['esc', 'takes it away']] }, this.renderer.width),
    )
  }

  /** Where the community prices came from and how old they are, as the footer shows it. */
  private baselineChip(state: ViewState): TextChunk[][] {
    if (state.baselineAt === null) return []
    const age = duration(Math.max(0, state.now - state.baselineAt))
    return [
      [
        tone('dim', '~ '),
        tone('dim', `${ATTRIBUTION} (${ATTRIBUTION_URL}) · `),
        tone('dim', `${num(state.baselineCount)} prices · ${age} old`),
      ],
    ]
  }

  /** The help, or the detail of a run, over the whole screen. */
  private drawOverlay(state: ViewState, width: number, height: number): void {
    if (state.menu !== null) {
      this.drawMenu(state.menu, width, height)
      return
    }
    const run = findRun(this.tracker, state.detail)
    if (run === null && !state.help && state.page === null) {
      this.overlay.visible = false
      return
    }

    const boxWidth = Math.max(20, width - 4)
    const boxHeight = Math.max(4, height - 4)
    this.overlayBox.width = boxWidth
    this.overlayBox.height = boxHeight
    const textWidth = Math.max(10, boxWidth - BORDER - SCROLLBAR)

    if (state.page !== null) {
      const page = this.pageChunks(state.page, textWidth, state.now)
      this.overlayText.content = new StyledText(page)
    } else if (run !== null) {
      this.overlayText.content = new StyledText([
        tone('brand', `Run #${run.id}`),
        tone('dim', ': '),
        tone('blue', run.name),
        tone('default', '\n'),
        ...this.detailChunks(run, textWidth, state.now),
      ])
    } else {
      this.overlayText.content = new StyledText([
        ...brandChunks('TLI Loot Tracker'),
        tone('dim', ' · Help'),
        tone('default', '\n'),
        ...this.helpChunks(),
      ])
    }
    this.overlayText.width = textWidth
    this.overlay.visible = true
  }

  /** The menu: a small dialog with the entries by section, the picked one on the selection. */
  private drawMenu(at: number, width: number, height: number): void {
    const longest = MENU.reduce((n, item) => Math.max(n, item.label.length), 0)
    const inner = longest + 6
    const chunks: TextChunk[] = [
      tone('brand', 'Menu'),
      tone('default', '  '),
      ...footerChunks({ hints: [['↑↓', 'pick'], ['⏎', 'do it'], ['esc', 'close']] }, inner),
      tone('default', '\n'),
    ]
    let section = ''
    let line = 1
    let pickedLine = 1
    MENU.forEach((item, index) => {
      if (item.section !== section) {
        section = item.section
        chunks.push(tone('default', '\n'), tone('accent', section), tone('default', '\n'))
        line += 2
      }
      if (index === at) pickedLine = line
      const key = ` ${item.key.padEnd(2)}`
      const label = item.label.padEnd(inner - 3)
      chunks.push(
        ...(index === at
          ? [toneOn('accent', `▸${key}${label}`, theme.selection)]
          : [tone('key', key), tone('default', label)]),
        tone('default', '\n'),
      )
      line += 1
    })
    const boxHeight = Math.min(Math.max(4, height - 2), line + 2)
    this.overlayBox.width = Math.min(Math.max(20, width - 4), inner + 6 + BORDER + SCROLLBAR)
    this.overlayBox.height = boxHeight
    this.overlayText.content = new StyledText(chunks)
    this.overlayText.width = Math.max(10, inner + 6)
    this.overlay.visible = true
    this.overlayScroll.scrollTo(Math.max(0, pickedLine - (boxHeight - BORDER) + 2))
  }

  /** The detail of one run. */
  private detailChunks(run: Run, width: number, now: number): TextChunk[] {
    const worth = this.tracker.valueOfRun(run)
    const end = run.end ?? now
    const chunks: TextChunk[] = []
    const line = (parts: TextChunk[]): void => {
      chunks.push(...parts, tone('default', '\n'))
    }

    line([tone('dim', 'started    '), tone('teal', clock(run.start))])
    line([tone('dim', 'ended      '), tone('teal', clock(end))])
    line([tone('dim', 'duration   '), tone('teal', duration(end - run.start))])
    line([tone('dim', 'kind       '), tone(run.kind === 'prison' ? 'purple' : 'default', run.kind)])
    line([tone('dim', 'loot value '), tone(worth.gross > 0 ? 'gold' : 'dim', fe(worth.gross))])
    if (run.xp > 0) line([tone('dim', 'experience '), tone('purple', num(run.xp))])
    line([])
    line([tone('brand', 'Loot')])

    const loot = lootRows(this.tracker, run.loot)
    if (loot.length === 0) line([tone('dim', 'nothing was picked up')])
    for (const item of loot) {
      line([
        tone('orange', num(item.qty)),
        tone('dim', ' × '),
        tone('blue', item.name),
        ...this.valueChunks(fe(item.worth), width - visibleLength(`${num(item.qty)} × ${item.name}`), item.worth > 0 ? 'gold' : 'dim'),
      ])
    }

    if (run.cost.size > 0) {
      line([])
      line([tone('yellow', 'Map cost')])
      for (const item of lootRows(this.tracker, run.cost)) {
        line([
          tone('orange', num(item.qty)),
          tone('dim', ' × '),
          tone('blue', item.name),
          ...this.valueChunks(fe(item.worth), width - visibleLength(`${num(item.qty)} × ${item.name}`), item.worth > 0 ? 'gold' : 'dim'),
        ])
      }
    }

    const named = run.affixes.filter((id) => this.tracker.affixNames.has(id))
    if (run.affixes.length > 0) {
      line([])
      line([tone('brand', 'Map modifiers')])
      for (const id of named) line([tone('default', fit(this.tracker.affixNames.get(id) ?? '', width))])
      const plain = run.affixes.length - named.length
      if (plain > 0) line([tone('dim', `${plain} more the game does not say in words`)])
    }

    line([])
    line(keyHint('⏎', 'back'))
    return chunks
  }

  /** The value of a line, at the right of it. */
  private valueChunks(value: string, width: number, style: 'gold' | 'dim' | 'red'): TextChunk[] {
    const gap = Math.max(1, width - visibleLength(value))
    return [tone('default', ' '.repeat(gap)), tone(style, value)]
  }

  /** The help. */
  private helpChunks(): TextChunk[] {
    const chunks: TextChunk[] = []
    const line = (parts: TextChunk[]): void => {
      chunks.push(...parts, tone('default', '\n'))
    }
    line([tone('brand', 'Keys')])
    line([])
    for (const [key, label] of HELP) {
      const cap = ` ${key} `
      const pad = ' '.repeat(Math.max(1, 11 - visibleLength(cap)))
      line([tone('key', cap), tone('dim', `${pad}${label}`)])
    }
    line([])
    line([tone('dim', 'The tracker only reads the log. It never touches the game.')])
    return chunks
  }

  /** A page that covers the screen: the modifiers that paid, the exchange, or the sessions. */
  private pageChunks(page: 'affixes' | 'exchange' | 'sessions', width: number, now: number): TextChunk[] {
    const chunks: TextChunk[] = []
    const line = (parts: TextChunk[]): void => {
      chunks.push(...parts, tone('default', '\n'))
    }
    const close = (): void => {
      line([])
      line(footerChunks({ hints: [['esc', 'or the key of the page closes it'], ['↑↓', 'scroll'], ['f h g', 'switch page']] }, width))
    }
    const signed = (value: number): string => `${value > 0 ? '+' : ''}${num(value)}`

    if (page === 'affixes') {
      line([tone('brand', 'Which map modifiers paid')])
      const rows = affixRows(this.tracker)
      if (rows.length === 0) {
        line([tone('dim', 'Nothing to compare yet: a modifier needs three finished maps that had it.')])
      } else {
        const average = (rows[0]?.avgWorth ?? 0) - (rows[0]?.versus ?? 0)
        line([tone('dim', `Maps with the modifier, against the average map (${fe(average)}). A comparison, not a cause.`)])
        line([])
        for (const row of rows) {
          const versus = `${signed(row.versus).padStart(10)} FE `
          const maps = `${String(row.runs).padStart(4)} maps `
          const averageWorth = `${num(row.avgWorth).padStart(10)} FE avg  `
          const stat = versus + maps + averageWorth
          line([
            tone(signTone(row.versus), versus),
            tone('orange', maps),
            tone('gold', averageWorth),
            tone('default', fit(row.text, Math.max(8, width - stat.length))),
          ])
        }
      }
      close()
      return chunks
    }

    if (page === 'exchange') {
      const totals = tradeTotals(this.tracker)
      line([tone('brand', 'The exchange')])
      line([
        tone('dim', 'FE paid '),
        tone('gold', num(totals.spent)),
        tone('dim', '   FE collected '),
        tone('gold', num(totals.received)),
        tone('dim', '   the log says what changed in the bag, not the price of a listing'),
      ])
      line([])
      const rows = tradeRows(this.tracker)
      if (rows.length === 0) line([tone('dim', 'Nothing yet: listings, purchases and what you collect show up here.')])
      const label = { list: 'listed', buy: 'paid', receive: 'collected', recall: 'took back' } as const
      for (const row of rows) {
        const what = row.items.map((item) => `${num(Math.abs(item.delta))} × ${item.name}`).join(', ')
        const money = row.fe === 0 ? '' : `${signed(row.fe)} FE`
        const head = `${stamp(row.at)}  ${label[row.kind].padEnd(11)}`
        const shown = fit(what, Math.max(8, width - head.length - money.length - 2))
        line([
          tone('dim', head),
          tone('default', shown),
          ...(money === '' ? [] : this.valueChunks(money, width - head.length - visibleLength(shown), row.fe < 0 ? 'red' : 'gold')),
        ])
      }
      close()
      return chunks
    }

    line([tone('brand', 'Sessions')])
    const rows = sessionRows(this.tracker, now)
    if (rows.length === 0) line([tone('dim', 'None yet. n starts one: the runs that begin after it are its, N ends it.')])
    for (const row of rows) {
      const { session, totals } = row
      line([])
      line([
        tone(row.active ? 'green' : 'blue', `${row.active ? '▸ ' : '  '}${session.name}`),
        tone('dim', `  ${stamp(session.start)}${session.end === null ? ' · going on' : ` → ${stamp(session.end)}`}`),
      ])
      line([
        tone('dim', '    runs '),
        tone('orange', String(totals.runs)),
        tone('dim', '  time '),
        tone('teal', duration(totals.totalTime)),
        tone('dim', '  FE '),
        tone(totals.fe > 0 ? 'gold' : 'dim', num(totals.fe)),
        tone('dim', '  FE/h '),
        tone(totals.fePerHour > 0 ? 'gold' : 'dim', num(totals.fePerHour)),
        tone('dim', '  loot '),
        tone(totals.lootValue > 0 ? 'gold' : 'dim', fe(totals.lootValue)),
        tone('dim', '  XP/h '),
        tone(totals.xpPerHour > 0 ? 'purple' : 'dim', compact(totals.xpPerHour)),
      ])
    }
    close()
    return chunks
  }
}
