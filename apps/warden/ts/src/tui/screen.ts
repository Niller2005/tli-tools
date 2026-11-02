// The OpenTUI screen Warden draws.
//
// The screen is a tree of renderables built once. The state is plain data, so every update only
// changes the text of the renderables and leaves the layout to OpenTUI.
//
// The colours are the palette the tools share, each with its job: the name of the tool and the
// section headings brand, the advice and the advised cell accent, the loot of the board and of the
// ranking gold, the beasts and the objective blue, the rare things and the theme purple, the day
// counter and the reads and solves in flight orange, the countdowns teal, the warnings yellow and
// the problems red. With the colours off every mark still tells its meaning on its own: the
// advised cell is "›06", the warden's cell "@04", a near miss "~", a doubt "?" and an incident "!".

import {
  BoxRenderable,
  ScrollBoxRenderable,
  StyledText,
  TextRenderable,
  type CliRenderer,
  type TextChunk,
} from '@opentui/core'
import {
  backgroundColor,
  borderColor,
  brandChunks,
  chip,
  chunksWidth,
  color,
  colorEnabled,
  defaultBackground,
  defaultForeground,
  fit,
  hintChunks,
  meter,
  panelBorderStyle,
  panelTitle,
  surfaceColor,
  textColor,
  theme,
  titleColor,
  tone,
  toneOn,
  type Tone,
} from '@tli/tui'
import { moveName, type CellView, type DayView, type HeldView, type RingView, type ViewState } from './view'

/** The width of one cell of the ring. */
const CELL_WIDTH = 12

/** The gap between two cells of the ring. */
const CELL_GAP = 1

/** The columns the board panel's border takes up. */
const BORDER = 2

/** The column the scrollbar of the board panel takes up. */
const SCROLLBAR = 1

/** The marks of the board the footer explains: the mark, the tone it is drawn in, and its meaning. */
const LEGEND: readonly (readonly [string, Tone, string])[] = [
  ['›', 'accent', 'advised cell'],
  ['@', 'orange', 'warden'],
  ['~', 'teal', 'nearly as good'],
  ['?', 'yellow', 'check this cell'],
]

/** The screen Warden draws. */
export class WardenScreen {
  /** the tree that is drawn */
  readonly root: BoxRenderable

  private readonly renderer: CliRenderer
  private readonly header: BoxRenderable
  private readonly headerText: TextRenderable
  private readonly message: TextRenderable
  private readonly board: BoxRenderable
  private readonly body: ScrollBoxRenderable
  private readonly content: TextRenderable
  private readonly spacer: BoxRenderable
  private readonly footer: BoxRenderable
  private readonly footerText: TextRenderable

  constructor(renderer: CliRenderer) {
    this.renderer = renderer
    this.root = new BoxRenderable(renderer, {
      id: 'warden',
      width: '100%',
      height: '100%',
      flexDirection: 'column',
      backgroundColor: backgroundColor(),
    })

    this.header = new BoxRenderable(renderer, {
      id: 'header',
      width: '100%',
      height: 1,
      flexShrink: 0,
      backgroundColor: surfaceColor(),
    })
    this.headerText = new TextRenderable(renderer, {
      id: 'header-text',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    this.header.add(this.headerText)

    this.message = new TextRenderable(renderer, {
      id: 'message',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
      flexShrink: 0,
    })

    this.board = new BoxRenderable(renderer, {
      id: 'board',
      width: '100%',
      flexGrow: 1,
      flexBasis: 0,
      border: true,
      borderStyle: panelBorderStyle(true),
      title: panelTitle('Board', true),
      flexDirection: 'column',
      overflow: 'hidden',
    })
    this.body = new ScrollBoxRenderable(renderer, {
      id: 'body',
      width: '100%',
      height: '100%',
      scrollbarOptions: {
        trackOptions: {
          foregroundColor: colorEnabled() ? color(theme.scrollThumb) : defaultForeground(),
          backgroundColor: colorEnabled() ? color(theme.scrollTrack) : defaultBackground(),
        },
      },
    })
    this.content = new TextRenderable(renderer, {
      id: 'content',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    this.body.add(this.content)
    this.board.add(this.body)

    this.spacer = new BoxRenderable(renderer, {
      id: 'footer-spacer',
      width: '100%',
      height: 1,
      flexShrink: 0,
    })
    this.footer = new BoxRenderable(renderer, {
      id: 'footer',
      width: '100%',
      height: 1,
      flexShrink: 0,
      backgroundColor: surfaceColor(),
    })
    this.footerText = new TextRenderable(renderer, {
      id: 'footer-text',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    this.footer.add(this.footerText)

    this.root.add(this.header)
    this.root.add(this.message)
    this.root.add(this.board)
    this.root.add(this.spacer)
    this.root.add(this.footer)
  }

  /** Draws the state. */
  draw(state: ViewState): void {
    const width = Math.max(40, this.renderer.width || this.root.width || 80)
    const inner = Math.max(24, width - BORDER - SCROLLBAR)
    this.drawHeader(width, state)
    this.drawMessage(width, state)
    this.board.borderColor = borderColor(true)
    this.board.titleColor = titleColor(true)
    this.board.borderStyle = panelBorderStyle(true)
    this.board.title = panelTitle('Board', true)

    const lines: TextChunk[][] = [[]]
    this.addAdvice(lines, state, inner)
    if (state.runOver === null) {
      this.addBoard(lines, state, inner)
      this.addRanking(lines, state)
    }
    this.content.content = new StyledText(
      lines.flatMap((line, index) => (index === 0 ? line : [tone('default', '\n'), ...line])),
    )
    this.drawFooter(width)
  }

  /** The bar along the top: the name of the tool, and the state of the read as chips. */
  private drawHeader(width: number, state: ViewState): void {
    const chunks = brandChunks('Warden', 'Tartarus prison board, Linux terminal')
    if (chunksWidth(chunks) > width) chunks.length = 2
    for (const [text, style] of this.stateChips(state)) {
      const piece: TextChunk[] = [tone('default', '  '), chip(text, style)]
      if (chunksWidth(chunks) + chunksWidth(piece) > width) break
      chunks.push(...piece)
    }
    this.headerText.content = new StyledText(chunks)
    this.headerText.width = width
  }

  /** The chips of the state of the read, in the order they are worth showing. */
  private stateChips(state: ViewState): [string, Tone][] {
    const chips: [string, Tone][] = []
    if (state.runOver !== null) chips.push(['run over', 'purple'])
    if (state.reading) chips.push(['reading', 'orange'])
    else if (state.model === null) chips.push(['no board', 'dim'])
    if (state.model !== null) chips.push(['board', 'green'])
    if (state.solving) chips.push(['solving', 'orange'])
    if (state.ocrProblem !== null) chips.push(['no OCR', 'red'])
    return chips
  }

  /** The line under the bar: which game the reads come from. */
  private drawMessage(width: number, state: ViewState): void {
    this.message.content = new StyledText([
      tone('dim', 'game: '),
      tone('default', fit(state.captureNote, Math.max(10, width - 6))),
    ])
    this.message.width = width
  }

  /** The bar along the bottom: the keys on caps, then the marks of the board as a legend. */
  private drawFooter(width: number): void {
    const chunks = hintChunks([
      ['r', 'read now'],
      ['q', 'quit'],
    ])
    for (const [mark, style, label] of LEGEND) {
      const piece: TextChunk[] = [
        tone('default', colorEnabled() ? '   ' : '  '),
        mark === '›' ? toneOn('accent', ` ${mark} `, theme.selection) : tone(style, ` ${mark} `),
        tone('dim', ` ${label}`),
      ]
      if (chunksWidth(chunks) + chunksWidth(piece) > width) break
      chunks.push(...piece)
    }
    this.footerText.content = new StyledText(chunks)
    this.footerText.width = width
  }

  /** The advice, or the message that there is none. */
  private addAdvice(lines: TextChunk[][], state: ViewState, inner: number): void {
    if (state.runOver !== null) {
      lines.push([this.runOverChunk(state.runOver)])
      return
    }
    lines.push(this.heldChunks(state.held))
    if (state.model === null) {
      lines.push([
        tone(state.reading ? 'orange' : 'dim', state.reading ? 'Reading the board…' : 'No board read yet.'),
      ])
      if (!state.reading && state.ocrProblem !== null) lines.push([tone('red', state.ocrProblem)])
      if (state.missed !== null) lines.push([tone('dim', state.missed)])
      return
    }
    for (const problem of state.problems) lines.push([tone('red', problem)])
    for (const warning of state.warnings) lines.push([tone('yellow', warning)])
    if (state.day !== null) lines.push(this.dayChunks(state.day))
    for (const line of state.keptLines) lines.push([tone('yellow', line)])
    lines.push([])
    if (state.advice !== null) {
      const head: TextChunk[] = [tone('brand', 'NEXT MOVE')]
      if (state.solving) {
        head.push(
          tone('dim', '  (playing it out: '),
          tone('orange', String(state.rounds)),
          tone('dim', ` of ${state.rollouts} playouts)`),
        )
      }
      lines.push(head)
      lines.push([tone('default', '  '), tone('accent', moveName(state.advice.action, state.advice.label))])
      if (state.advice.why !== null) lines.push([tone('dim', `  ${state.advice.why}`)])
      if (state.solving) lines.push(this.solvingMeter(state, inner))
    } else if (state.solving) {
      lines.push([tone('dim', 'Solving…')])
      lines.push(this.solvingMeter(state, inner))
    }
  }

  /** The instruments held and the theme of the run. */
  private heldChunks(held: HeldView): TextChunk[] {
    const chunks: TextChunk[] = [tone('dim', 'Instruments: ')]
    if (held.instruments.length === 0) chunks.push(tone('dim', 'none known'))
    else
      held.instruments.forEach((name, index) => {
        if (index > 0) chunks.push(tone('default', ', '))
        chunks.push(tone('blue', name))
      })
    if (held.theme !== null) chunks.push(tone('dim', ' · Theme: '), tone('purple', held.theme))
    return chunks
  }

  /** The day, the countdown to the Riot and the objective the advice plays toward. */
  private dayChunks(day: DayView): TextChunk[] {
    const chunks: TextChunk[] = [tone('orange', `Day ${day.day}`), tone('dim', ' · ')]
    chunks.push(day.toRiot !== null ? tone('teal', `${day.toRiot} to Riot`) : tone('yellow', 'Riot not read'))
    if (day.kept) chunks.push(tone('dim', ' · last reading'))
    if (day.objective !== null) {
      chunks.push(tone('dim', ' · '), tone('blue', day.objective.name), tone('dim', ' '))
      chunks.push(day.objective.done ? tone('green', 'done') : tone('purple', day.objective.progress))
    }
    return chunks
  }

  /** The playouts of the solve as a bar of heat, filling as they are played. */
  private solvingMeter(state: ViewState, inner: number): TextChunk[] {
    return [
      tone('default', '  '),
      ...meter(state.rounds / Math.max(1, state.rollouts), Math.min(24, Math.max(8, inner - 4)), 'orange'),
    ]
  }

  /** The run-over line: the take of the run in gold, an empty vault in red. */
  private runOverChunk(text: string): TextChunk {
    const vaulted = /^The run is over: (\d+)/.exec(text)
    if (vaulted === null) return tone('bold', text)
    return Number(vaulted[1]) === 0 ? tone('red', text) : tone('gold', text)
  }

  /** The board and the warnings that point at its cells. */
  private addBoard(lines: TextChunk[][], state: ViewState, inner: number): void {
    if (state.model === null) return
    lines.push([])
    for (const row of state.ring) {
      lines.push(...this.ringLines(row, inner))
      lines.push([])
    }
    for (const warning of state.cellWarnings) lines.push([tone('yellow', `? ${warning}`)])
  }

  /** The two lines of one row of the ring. */
  private ringLines(row: RingView, inner: number): TextChunk[][] {
    const cellWidth = Math.max(6, Math.min(CELL_WIDTH, Math.floor((inner - CELL_GAP * 5) / 6)))
    const top: TextChunk[] = []
    const body: TextChunk[] = []
    row.cells.forEach((cell, index) => {
      if (index > 0) {
        top.push(tone('default', ' '.repeat(CELL_GAP)))
        body.push(tone('default', ' '.repeat(CELL_GAP)))
      }
      top.push(...this.cellLine(this.topChunks(cell), cell, cellWidth))
      body.push(...this.cellLine(this.bodyChunks(cell), cell, cellWidth))
    })
    return [top, body]
  }

  /** The marks and the number of one cell, in the tones the footer explains. */
  private topChunks(cell: CellView): TextChunk[] {
    const chunks: TextChunk[] = []
    if (cell.advised) chunks.push(tone('accent', '›'))
    if (cell.warden) chunks.push(tone('orange', '@'))
    chunks.push(tone(cell.advised ? 'accent' : 'dim', cell.label))
    if (cell.near) chunks.push(tone('teal', '~'))
    if (cell.warned) chunks.push(tone('yellow', '?'))
    return chunks
  }

  /** What one cell holds, and its incident mark in pink when it carries one. */
  private bodyChunks(cell: CellView): TextChunk[] {
    const text = cell.event && cell.body.endsWith('!') ? cell.body.slice(0, -1) : cell.body
    const chunks: TextChunk[] = [tone(cell.bodyTone, text)]
    if (cell.event) chunks.push(tone('pink', '!'))
    return chunks
  }

  /** One line of one cell, padded out, and picked out by a background when it is advised. */
  private cellLine(chunks: TextChunk[], cell: CellView, cellWidth: number): TextChunk[] {
    const pad = ' '.repeat(Math.max(0, cellWidth - chunksWidth(chunks)))
    if (!cell.advised || !colorEnabled()) return [...chunks, tone('default', pad)]
    const on = (chunk: TextChunk): TextChunk => ({ ...chunk, bg: color(theme.selection) })
    return [...chunks.map(on), on(tone('accent', pad))]
  }

  /** The moves ranked by Riot loot. */
  private addRanking(lines: TextChunk[][], state: ViewState): void {
    if (state.ranking.length > 0) {
      lines.push([
        tone('brand', 'Moves by Riot loot per run'),
        tone('dim', '  (Chromatic 1, Ultimate 0.2, Legendary 0.05)'),
      ])
      for (const row of state.ranking) {
        lines.push([
          tone('dim', `  ${String(row.rank).padStart(2)}  `),
          tone('gold', row.mean),
          tone('dim', '  '),
          row.chosen ? tone('accent', `▶ ${row.label}`) : tone('default', `  ${row.label}`),
        ])
      }
    }
    for (const note of state.notes) lines.push([tone('dim', note)])
  }
}
