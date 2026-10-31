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
  clock,
  color,
  colorEnabled,
  defaultBackground,
  defaultForeground,
  duration,
  fe,
  price,
  fitEnd,
  num,
  rowChunks,
  theme,
  textColor,
  titleColor,
  tone,
  visibleLength,
} from '@tli/tui'
import type { Run, Tracker } from '@tli/tracker'
import {
  type Panel,
  type ViewState,
  bagRows,
  findRun,
  lootRows,
  priceRows,
  runRows,
} from './view'

/** Below this width the panels are stacked instead of side by side. */
const NARROW = 80

/** The columns a panel's border takes up. */
const BORDER = 2

/** The column the scrollbar takes up. */
const SCROLLBAR = 1

/** What the screen tells the app when the player uses the mouse. */
export interface ScreenHooks {
  /** the player clicked a panel */
  onFocus?: (panel: Panel) => void
  /** the player clicked a row of a list */
  onPick?: (panel: Panel, index: number) => void
  /** the player confirmed a price */
  onPrice?: (item: number, price: string) => void
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
  ['esc', 'back, or leave the price'],
  ['t', 'the trade tax on and off'],
  ['c', 'the cost of the map counts against the profit, or not'],
  ['p', 'stop and start the clock'],
  ['e', 'set the price of the item that is picked out (empty = reset)'],
  ['u', 'reset a hand-set price to the learned one'],
  ['d', 'remove the item from the prices (learned and set)'],
  ['s', 'change how the list is sorted'],
  ['x', 'write the loot report to a csv file'],
  ['r', 'read the log again from where it was'],
  ['a', 'open Arcana in a window of its own'],
  ['v', 'open Vorax in a window of its own'],
  ['w', 'open Warden in a window of its own'],
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
  private readonly pathText: TextRenderable
  private readonly currentText: TextRenderable
  private readonly statsText: TextRenderable
  private readonly flagsText: TextRenderable
  private readonly messageText: TextRenderable

  private readonly body: BoxRenderable
  private readonly leftColumn: BoxRenderable
  private readonly rightColumn: BoxRenderable

  private readonly current: ListPanel
  private readonly runs: ListPanel
  private readonly bag: ListPanel
  private readonly prices: ListPanel

  private readonly footer: BoxRenderable
  private readonly hintText: TextRenderable
  private readonly priceLabel: TextRenderable
  private readonly priceInput: InputRenderable
  private readonly priceHint: TextRenderable

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
  /** the item whose price is being typed in */
  private editingItem: number | null = null

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
    })
    this.titleText = new TextRenderable(renderer, {
      id: 'title',
      content: 'TLI Loot Tracker',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    this.pathText = new TextRenderable(renderer, {
      id: 'path',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    titleRow.add(this.titleText)
    titleRow.add(this.pathText)
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
    this.current = this.makePanel('current', 'Current run', null)
    this.bag = this.makePanel('bag', 'Bag', 'inventory')
    this.runs = this.makePanel('runs', 'Recent runs', 'runs')
    this.prices = this.makePanel('prices', 'Prices (* set)', 'prices')
    this.leftColumn.add(this.current.box)
    this.leftColumn.add(this.bag.box)
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
    this.footer.add(this.hintText)
    this.footer.add(this.priceLabel)
    this.footer.add(this.priceInput)
    this.footer.add(this.priceHint)

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
      const item = this.editingItem
      if (item === null) return
      this.hooks.onPrice?.(item, value)
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

  /** Starts typing in a price. */
  beginPrice(item: number, name: string, value: string): void {
    this.editingItem = item
    this.priceInput.value = value
    this.priceLabel.content = new StyledText([
      tone('accent', 'price '),
      tone('bold', name),
      tone('dim', ' (FE)  '),
    ])
    this.priceInput.visible = true
    this.priceLabel.visible = true
    this.priceHint.visible = true
    this.priceInput.focus()
  }

  /** Stops typing in a price. */
  endPrice(): void {
    this.editingItem = null
    this.priceInput.blur()
    this.priceInput.visible = false
    this.priceLabel.visible = false
    this.priceHint.visible = false
  }

  /** Draws the state. */
  draw(state: ViewState): void {
    const width = this.renderer.width
    const height = this.renderer.height
    this.layout(width, state)
    this.drawHeader(state, width)
    this.drawCurrent(state)
    this.drawRuns(state)
    this.drawBag(state)
    this.drawPrices(state)
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
    this.borders(this.bag, state.focus === 'inventory')
    this.borders(this.runs, state.focus === 'runs')
    this.borders(this.prices, state.focus === 'prices')
  }

  /** The border and the title of a panel, in the colour of the focus. */
  private borders(panel: ListPanel, focused: boolean): void {
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
    const title = 'TLI Loot Tracker'
    const room = Math.max(0, width - visibleLength(title) - 2)
    this.titleText.width = visibleLength(title)
    this.titleText.content = new StyledText([tone('accent', title)])
    this.pathText.width = room
    this.pathText.content = new StyledText([tone('dim', fitEnd(state.logFile, room))])

    this.currentText.visible = this.narrow
    if (this.narrow) {
      const run = this.tracker.currentRun
      if (run === null) {
        this.currentText.content = new StyledText([tone('dim', 'not in a map')])
      } else {
        const worth = this.tracker.valueOfRun(run).gross
        this.currentText.content = new StyledText([
          tone('accent', run.name),
          tone('dim', ` · ${duration(state.now - run.start)} · ${run.loot.size} kinds · `),
          tone(worth > 0 ? 'gold' : 'dim', fe(worth)),
        ])
      }
      this.currentText.width = width
    }

    const stats = this.tracker.stats(state.now)
    const amount = (value: number): 'gold' | 'dim' => (value > 0 ? 'gold' : 'dim')
    const segments: TextChunk[][] = [
      [tone('dim', 'net worth '), tone(amount(stats.netWorth), fe(stats.netWorth))],
      [tone('dim', 'FE/h '), tone(amount(stats.fePerHour), num(stats.fePerHour))],
      [tone('dim', 'FE/run '), tone(amount(stats.fePerRun), num(stats.fePerRun))],
      [tone('dim', 'runs '), tone('accent', String(stats.runs))],
      [tone('dim', 'time '), tone('accent', duration(stats.totalTime))],
      [tone('dim', 'avg '), tone('accent', duration(stats.avgRunTime))],
    ]
    this.statsText.content = new StyledText(this.pack(segments, width))
    this.statsText.width = width

    const tax = this.tracker.taxed ? tone('green', '[tax on]') : tone('dim', '[tax off]')
    const map = this.tracker.mapCosts ? tone('green', '[map cost on]') : tone('dim', '[map cost off]')
    const paused = state.paused ? [tone('default', '  '), tone('paused', '[PAUSED]')] : []
    this.flagsText.content = new StyledText([tax, tone('default', '  '), map, ...paused])
    this.flagsText.width = width

    const message = state.logNote !== '' ? state.logNote : state.message
    if (message === '') {
      this.messageText.content = new StyledText([])
    } else {
      const problem =
        state.logNote !== '' || /could not|cannot|can not|failed|missing|not there|no longer/i.test(message)
      this.messageText.content = new StyledText([
        tone(problem ? 'red' : 'cyan', '› '),
        tone(problem ? 'red' : 'cyan', message),
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
      rows.push({ cells: [{ text: run.name, tone: 'accent' }] })
      rows.push({
        cells: [
          { text: duration(state.now - run.start), tone: 'cyan', width: 9 },
          { text: `${run.loot.size} kinds` },
          { text: fe(worth), tone: worth > 0 ? 'gold' : 'dim', width: valueWidth, align: 'right' },
        ],
      })
      for (const item of loot) {
        rows.push({
          cells: [
            { text: item.name },
            { text: num(item.qty), width: qtyWidth, align: 'right' },
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
    const maxWorth = Math.max(0, ...runs.map((run) => run.worth))
    const rows: Row[] = runs.map((run, index) => {
      const worth = run.worth
      const valueTone =
        worth <= 0 ? 'dim' : worth >= maxWorth * 0.5 ? 'green' : worth >= maxWorth * 0.1 ? 'gold' : 'dim'
      return {
        selected: state.focus === 'runs' && index === state.runsAt,
        cells: [
          { text: `#${run.id}`, tone: 'dim', width: 5, align: 'right' },
          { text: run.name },
          { text: duration(run.took), tone: 'dim', width: durationWidth, align: 'right' },
          { text: fe(worth), tone: valueTone, width: valueWidth, align: 'right' },
        ],
      }
    })
    this.drawList(this.runs, rows)
    this.keepVisible(this.runs, state.focus === 'runs' ? state.runsAt : -1)
  }

  /** The panel of what the player has. */
  private drawBag(state: ViewState): void {
    const bag = bagRows(this.tracker, state.inventorySort)
    if (bag.length === 0) {
      this.drawList(this.bag, [{ cells: [{ text: 'the bag is empty', tone: 'dim' }] }])
      return
    }
    const qtyWidth = Math.max(3, ...bag.map((row) => visibleLength(num(row.qty))))
    const valueWidth = Math.max(13, ...bag.map((row) => visibleLength(fe(row.worth))))
    const rows: Row[] = bag.map((row, index) => ({
      selected: state.focus === 'inventory' && index === state.inventoryAt,
      cells: [
        { text: row.name },
        { text: num(row.qty), width: qtyWidth, align: 'right' },
        { text: fe(row.worth), tone: row.worth > 0 ? 'gold' : 'dim', width: valueWidth, align: 'right' },
      ],
    }))
    this.drawList(this.bag, rows)
    this.keepVisible(this.bag, state.focus === 'inventory' ? state.inventoryAt : -1)
  }

  /** The panel of the prices the tracker knows. */
  private drawPrices(state: ViewState): void {
    const prices = priceRows(this.tracker, state.pricesSort)
    if (prices.length === 0) {
      this.drawList(
        this.prices,
        [{ cells: [{ text: 'no prices yet: look an item up on the exchange', tone: 'dim' }] }],
      )
      return
    }
    const valueWidth = Math.max(13, ...prices.map((row) => visibleLength(price(row.price))))
    const rows: Row[] = prices.map((row, index) => ({
      selected: state.focus === 'prices' && index === state.pricesAt,
      cells: [
        { text: row.name },
        { text: price(row.price), tone: row.price > 0 ? 'gold' : 'dim', width: valueWidth, align: 'right' },
        {
          text: row.source === 'set' ? '*' : '·',
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
      ['t', 'tax'],
      ['c', 'map cost'],
      ['e', 'price'],
      ['u', 'reset price'],
      ['d', 'remove'],
      ['x', 'csv'],
      ['p', 'pause'],
      ['a/v/w', 'window'],
      ['?', 'help'],
      ['q', 'quit'],
    ]
    const segments: TextChunk[][] = hints.map(([key, label]) => [
      tone('accent', key),
      tone('dim', ` ${label}`),
    ])
    this.hintText.content = new StyledText(this.pack(segments, width))
    this.hintText.width = width
    this.hintText.visible = state.editing === null
    this.priceHint.content = new StyledText([tone('dim', 'enter keeps it · empty enter resets · esc leaves it')])
  }

  /** The help, or the detail of a run, over the whole screen. */
  private drawOverlay(state: ViewState, width: number, height: number): void {
    const run = findRun(this.tracker, state.detail)
    if (run === null && !state.help) {
      this.overlay.visible = false
      return
    }

    const boxWidth = Math.max(20, width - 4)
    const boxHeight = Math.max(4, height - 4)
    this.overlayBox.width = boxWidth
    this.overlayBox.height = boxHeight
    const textWidth = Math.max(10, boxWidth - BORDER - SCROLLBAR)

    if (run !== null) {
      const title = `Run #${run.id}: ${run.name}`
      this.overlayText.content = new StyledText([
        tone('accent', title),
        tone('default', '\n'),
        ...this.detailChunks(run, textWidth, state.now),
      ])
    } else {
      this.overlayText.content = new StyledText([
        tone('accent', 'TLI Loot Tracker · Help'),
        tone('default', '\n'),
        ...this.helpChunks(),
      ])
    }
    this.overlayText.width = textWidth
    this.overlay.visible = true
  }

  /** The detail of one run. */
  private detailChunks(run: Run, width: number, now: number): TextChunk[] {
    const worth = this.tracker.valueOfRun(run)
    const end = run.end ?? now
    const chunks: TextChunk[] = []
    const line = (parts: TextChunk[]): void => {
      chunks.push(...parts, tone('default', '\n'))
    }

    line([tone('dim', 'started    '), tone('default', clock(run.start))])
    line([tone('dim', 'ended      '), tone('default', clock(end))])
    line([tone('dim', 'duration   '), tone('accent', duration(end - run.start))])
    line([tone('dim', 'loot value '), tone(worth.gross > 0 ? 'gold' : 'dim', fe(worth.gross))])
    line([])
    line([tone('accent', 'Loot')])

    const loot = lootRows(this.tracker, run.loot)
    if (loot.length === 0) line([tone('dim', 'nothing was picked up')])
    for (const item of loot) {
      line([
        tone('default', `${num(item.qty)} × ${item.name}`),
        ...this.valueChunks(fe(item.worth), width, item.worth > 0 ? 'gold' : 'dim'),
      ])
    }

    if (run.cost.size > 0) {
      line([])
      line([tone('yellow', 'Map cost')])
      for (const item of lootRows(this.tracker, run.cost)) {
        line([
          tone('default', `${num(item.qty)} × ${item.name}`),
          ...this.valueChunks(fe(item.worth), width, item.worth > 0 ? 'gold' : 'dim'),
        ])
      }
    }

    line([])
    line([tone('accent', '⏎'), tone('dim', ' back')])
    return chunks
  }

  /** The value of a line, at the right of it. */
  private valueChunks(value: string, width: number, style: 'gold' | 'dim'): TextChunk[] {
    const gap = Math.max(1, width - visibleLength(value))
    return [tone('default', ' '.repeat(gap)), tone(style, value)]
  }

  /** The help. */
  private helpChunks(): TextChunk[] {
    const chunks: TextChunk[] = []
    const line = (parts: TextChunk[]): void => {
      chunks.push(...parts, tone('default', '\n'))
    }
    line([tone('accent', 'Keys')])
    line([])
    for (const [key, label] of HELP) {
      line([tone('accent', `${key.padEnd(10)}`), tone('dim', label)])
    }
    line([])
    line([tone('dim', 'The tracker only reads the log. It never touches the game.')])
    return chunks
  }
}
