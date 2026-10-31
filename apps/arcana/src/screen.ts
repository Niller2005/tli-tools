// The screen the app draws.
//
// The screen is a tree of OpenTUI renderables: the header, the panels and the footer. It is
// built once and then updated from the state, so the layout is flexbox all the way and a resize is
// the renderer's business, not the app's.
//
// Nothing here reads the log or writes a file: the screen only draws what it is given.

import {
  BoxRenderable,
  ScrollBoxRenderable,
  StyledText,
  TextRenderable,
  type CliRenderer,
  type TextChunk,
} from '@opentui/core'
import {
  type Row,
  borderColor,
  clip,
  color,
  colorEnabled,
  defaultBackground,
  defaultForeground,
  rowChunks,
  textColor,
  theme,
  titleColor,
  tone,
} from '@tli/tui'
import type { Tracker } from '@tli/arcana'
import type { ItemNames } from '@tli/tracker'
import {
  type ViewState,
  currentRows,
  detailRows,
  historyRows,
  pathText,
  selectedEntry,
  totalsRows,
} from './view'

/** The columns a panel's border takes up. */
const BORDER = 2

/** The column the scrollbar takes up. */
const SCROLLBAR = 1

/** What the screen tells the app when the player uses the mouse. */
export interface ScreenHooks {
  /** the player clicked a row of the history */
  onPick?: (index: number) => void
}

/** A panel with a list in it. */
interface ListPanel {
  box: BoxRenderable
  scroll: ScrollBoxRenderable
  text: TextRenderable
  /** the offset the app put in the box, so that the mouse may move it */
  applied: number
}

/** The keys the help lists. */
const HELP: [string, string][] = [
  ['up/down, j/k', 'move in the history; scroll in the detail and the totals'],
  ['page up/down', 'move ten rows'],
  ['tab', 'switch between the history and the lifetime totals'],
  ['enter', 'the detail of the visit under the pointer; enter or esc goes back'],
  ['t', "count the exchange's trade tax against the value of the rewards, or not"],
  ['r', 'read the log again now'],
  ['?', 'this help (any key goes back)'],
  ['q', 'quit; what was tracked is saved'],
]

/** The help, in the words the arcana README uses. */
const HELP_TEXT: string[] = [
  "What the log carries is what is tracked: the visits to the Tarot Path, the moves the marker made, the cards played, the notes gained, the chests taken and raised, the life lost, the trials fought, and what the Fateful Contest's chests gave. The board itself (which tile is where, which notes are in hand) is not in the log, so there is no solver here.",
  '',
  'Times are the log\'s own clock. Rewards are valued with the prices the game\'s exchange searches put in the log; an item nobody searched for shows "no price".',
]

/** The screen of the arcana app. */
export class ArcanaScreen {
  /** the tree that is drawn */
  readonly root: BoxRenderable

  private readonly renderer: CliRenderer
  private readonly tracker: Tracker
  private readonly names: ItemNames
  private readonly hooks: ScreenHooks

  private readonly header: BoxRenderable
  private readonly titleText: TextRenderable
  private readonly logText: TextRenderable

  private readonly body: BoxRenderable
  private readonly nowBox: BoxRenderable
  private readonly nowText: TextRenderable
  private readonly history: ListPanel
  private readonly totals: ListPanel
  private readonly detail: ListPanel

  private readonly footer: BoxRenderable
  private readonly footerText: TextRenderable

  private readonly overlay: BoxRenderable
  private readonly overlayBox: BoxRenderable
  private readonly overlayScroll: ScrollBoxRenderable
  private readonly overlayText: TextRenderable

  /** what was on the screen last time, so it is only drawn again when it changed */
  private lastTitle = ''
  private lastLog = ''
  private lastFooter = ''
  private lastNow = ''
  private lastHistory = ''
  private lastTotals = ''
  private lastDetail = ''
  private lastHelp = ''

  constructor(renderer: CliRenderer, tracker: Tracker, names: ItemNames, hooks: ScreenHooks = {}) {
    this.renderer = renderer
    this.tracker = tracker
    this.names = names
    this.hooks = hooks

    this.root = new BoxRenderable(renderer, {
      id: 'arcana',
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
    this.titleText = new TextRenderable(renderer, {
      id: 'title',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    this.logText = new TextRenderable(renderer, {
      id: 'log',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    this.header.add(this.titleText)
    this.header.add(this.logText)

    this.body = new BoxRenderable(renderer, {
      id: 'body',
      width: '100%',
      flexGrow: 1,
      flexBasis: 0,
      flexDirection: 'column',
    })
    this.nowBox = new BoxRenderable(renderer, {
      id: 'now',
      border: true,
      borderStyle: 'rounded',
      title: 'Now',
      flexDirection: 'column',
      flexShrink: 0,
      overflow: 'hidden',
    })
    this.nowText = new TextRenderable(renderer, {
      id: 'now-text',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    this.nowBox.add(this.nowText)
    this.history = this.makePanel('history', 'History', true)
    this.totals = this.makePanel('totals', 'Lifetime totals')
    this.detail = this.makePanel('detail', 'Detail')
    this.body.add(this.nowBox)
    this.body.add(this.history.box)
    this.body.add(this.totals.box)
    this.body.add(this.detail.box)

    this.footer = new BoxRenderable(renderer, {
      id: 'footer',
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 0,
    })
    this.footerText = new TextRenderable(renderer, {
      id: 'footer-text',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    this.footer.add(this.footerText)

    this.overlay = new BoxRenderable(renderer, {
      id: 'overlay',
      position: 'absolute',
      left: 0,
      top: 0,
      width: '100%',
      height: '100%',
      justifyContent: 'center',
      alignItems: 'center',
      visible: false,
    })
    this.overlayBox = new BoxRenderable(renderer, {
      id: 'overlay-box',
      border: true,
      borderStyle: 'rounded',
      title: 'Arcana',
      flexDirection: 'column',
      overflow: 'hidden',
    })
    this.overlayScroll = new ScrollBoxRenderable(renderer, {
      id: 'overlay-scroll',
      width: '100%',
      height: '100%',
      scrollbarOptions: {
        trackOptions: {
          foregroundColor: colorEnabled() ? color(theme.scrollThumb) : defaultForeground(),
          backgroundColor: colorEnabled() ? color(theme.scrollTrack) : defaultBackground(),
        },
      },
    })
    this.overlayText = new TextRenderable(renderer, {
      id: 'overlay-text',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'word',
    })
    this.overlayScroll.add(this.overlayText)
    this.overlayBox.add(this.overlayScroll)
    this.overlay.add(this.overlayBox)

    this.root.add(this.header)
    this.root.add(this.body)
    this.root.add(this.footer)
    this.root.add(this.overlay)
  }

  /** A panel with a list in it. */
  private makePanel(id: string, title: string, pickable = false): ListPanel {
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
    if (pickable) {
      text.onMouseDown = (event) => {
        const row = event.y - scroll.viewport.y + scroll.scrollTop
        if (row < 0) return
        this.hooks.onPick?.(row)
      }
    }
    return { box, scroll, text, applied: -1 }
  }

  /** Draws the state. */
  draw(state: ViewState): void {
    const width = this.renderer.width
    const height = this.renderer.height
    const inner = Math.max(4, width - BORDER - SCROLLBAR)

    this.drawHeader(state, width)
    this.drawNow(state, inner)
    this.drawHistory(state, inner)
    this.drawTotals(state, inner)
    this.drawDetail(state, inner)
    this.drawFooter(state, width)
    this.drawOverlay(state, width, height)
  }

  /** The title, the state of the Tarot Path and the log that is read. */
  private drawHeader(state: ViewState, width: number): void {
    const path = pathText(this.tracker, state)
    const title = `Arcana  ${path.text}${state.taxed ? '' : '  (no tax)'}`
    if (title !== this.lastTitle) {
      this.lastTitle = title
      this.titleText.content = new StyledText([
        tone('bold', 'Arcana'),
        tone('default', '  '),
        tone(path.tone, path.text),
        ...(state.taxed ? [] : [tone('default', '  (no tax)')]),
      ])
    }
    this.titleText.width = width

    const note = state.logNote === '' ? state.logFile : state.logNote
    if (note !== this.lastLog) {
      this.lastLog = note
      this.logText.content = new StyledText([
        state.logNote === '' ? tone('dim', note) : tone('yellow', note),
      ])
    }
    this.logText.width = width
  }

  /** The panel of what is going on now. */
  private drawNow(state: ViewState, inner: number): void {
    this.nowBox.visible = !state.detail
    this.nowBox.borderColor = borderColor(false)
    this.nowBox.titleColor = titleColor(false)
    const rows = currentRows(this.tracker, state)
    this.lastNow = this.drawRows(this.nowText, rows, inner, this.lastNow)
    this.nowBox.height = rows.length + BORDER
  }

  /** The panel of the visits that were played. */
  private drawHistory(state: ViewState, inner: number): void {
    const shown = !state.detail && state.focus === 'history'
    this.history.box.visible = shown
    this.history.box.borderColor = borderColor(state.focus === 'history')
    this.history.box.titleColor = titleColor(state.focus === 'history')
    if (!shown) return
    const rows = historyRows(this.tracker, state)
    this.lastHistory = this.drawRows(this.history.text, rows, inner, this.lastHistory)
    this.keepVisible(this.history, state.cursor)
  }

  /** The panel of everything the player did. */
  private drawTotals(state: ViewState, inner: number): void {
    const shown = !state.detail && state.focus === 'totals'
    this.totals.box.visible = shown
    this.totals.box.borderColor = borderColor(state.focus === 'totals')
    this.totals.box.titleColor = titleColor(state.focus === 'totals')
    if (!shown) {
      this.totals.applied = -1
      return
    }
    const rows = totalsRows(this.tracker, state, this.names)
    this.lastTotals = this.drawRows(this.totals.text, rows, inner, this.lastTotals)
    this.place(this.totals, state.scroll)
  }

  /** The panel of the detail of the visit that is picked out. */
  private drawDetail(state: ViewState, inner: number): void {
    const shown = state.detail
    this.detail.box.visible = shown
    this.detail.box.borderColor = borderColor(true)
    this.detail.box.titleColor = titleColor(true)
    if (!shown) {
      this.detail.applied = -1
      return
    }
    const entry = selectedEntry(this.tracker.state, state.cursor)
    const rows =
      entry === null
        ? [{ cells: [{ text: 'nothing selected', tone: 'dim' as const }] }]
        : detailRows(entry, this.tracker, this.names, state.taxed)
    this.lastDetail = this.drawRows(this.detail.text, rows, inner, this.lastDetail)
    this.place(this.detail, state.scroll)
  }

  /** Puts the rows on a text, when they changed; gives back the key they have now. */
  private drawRows(text: TextRenderable, rows: Row[], inner: number, last: string): string {
    const key = `${inner}\n${rowsKey(rows)}`
    if (key !== last) text.content = new StyledText(chunksOf(rows, inner))
    text.width = inner
    return key
  }

  /** The keys at the bottom, or the message of the last key. */
  private drawFooter(state: ViewState, width: number): void {
    const footer = state.detail
      ? '↑↓ scroll  esc back  q quit'
      : state.message !== ''
        ? state.message
        : '↑↓ move  enter detail  tab panel  t tax  r reread  ? help  q quit'
    if (footer !== this.lastFooter) {
      this.lastFooter = footer
      this.footerText.content = new StyledText([tone('dim', clip(footer, width))])
    }
    this.footerText.width = width
  }

  /** The help, over the whole screen. */
  private drawOverlay(state: ViewState, width: number, height: number): void {
    if (!state.help) {
      this.overlay.visible = false
      return
    }
    // The overlay has to be filled: without a background of its own the panels behind the help
    // show through the gaps in its text.
    this.overlay.backgroundColor = defaultBackground()
    this.overlayBox.backgroundColor = defaultBackground()
    const boxWidth = Math.max(20, width - 4)
    const boxHeight = Math.max(4, height - 4)
    this.overlayBox.width = boxWidth
    this.overlayBox.height = boxHeight
    const textWidth = Math.max(10, boxWidth - BORDER - SCROLLBAR)

    const key = `${textWidth}`
    if (key !== this.lastHelp) {
      this.lastHelp = key
      this.overlayText.content = new StyledText(helpChunks())
    }
    this.overlayText.width = textWidth
    this.overlay.visible = true
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

  /** Puts the offset the app wants in the box. */
  private place(panel: ListPanel, offset: number): void {
    if (panel.applied === offset) return
    panel.applied = offset
    panel.scroll.scrollTop = offset
  }
}

/** The pieces of the rows, one after the other, with a line between them. */
function chunksOf(rows: Row[], inner: number): TextChunk[] {
  const chunks: TextChunk[] = []
  for (let index = 0; index < rows.length; index += 1) {
    if (index > 0) chunks.push(tone('default', '\n'))
    const row = rows[index]
    if (row !== undefined) chunks.push(...rowChunks(row, inner))
  }
  return chunks
}

/** What the rows say, and which of them is picked out: what the screen has to show. */
function rowsKey(rows: Row[]): string {
  const parts: string[] = []
  for (const row of rows) {
    parts.push(`${row.selected === true ? '>' : '-'}${row.cells.map((cell) => cell.text).join('')}`)
  }
  return parts.join('\n')
}

/** The help, in pieces. */
function helpChunks(): TextChunk[] {
  const chunks: TextChunk[] = []
  const line = (parts: TextChunk[]): void => {
    chunks.push(...parts)
    chunks.push(tone('default', '\n'))
  }
  line([tone('accent', "Arcana: the Tarot Path and the Fateful Contest, from the game's log")])
  line([])
  for (const [key, label] of HELP) {
    line([tone('accent', `${key.padEnd(16)}`), tone('dim', label)])
  }
  line([])
  for (const text of HELP_TEXT) line([tone('dim', text)])
  return chunks
}

