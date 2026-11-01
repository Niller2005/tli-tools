// The OpenTUI screen Warden draws.
//
// The screen is a tree of renderables built once. The state is plain data, so every update only
// changes the text of the renderables and leaves the layout to OpenTUI.

import {
  BoxRenderable,
  ScrollBoxRenderable,
  StyledText,
  TextRenderable,
  type CliRenderer,
  type TextChunk,
} from '@opentui/core'
import { color, colorEnabled, defaultBackground, defaultForeground, theme, tone, toneOn } from '@tli/tui'
import { moveName, type RingView, type ViewState } from './view'

/** The width of one cell of the ring. */
const CELL_WIDTH = 12

/** The gap between two cells of the ring. */
const CELL_GAP = 1

/** The keys the footer lists. */
const HINTS = 'r read now · q quit · @ warden · [highlight] advised cell · ~ nearly as good · ? check this cell'

/** The screen Warden draws. */
export class WardenScreen {
  /** the tree that is drawn */
  readonly root: BoxRenderable

  private readonly header: TextRenderable
  private readonly message: TextRenderable
  private readonly body: ScrollBoxRenderable
  private readonly content: TextRenderable
  private readonly spacer: BoxRenderable
  private readonly footer: TextRenderable

  constructor(renderer: CliRenderer) {
    this.root = new BoxRenderable(renderer, {
      id: 'warden',
      width: '100%',
      height: '100%',
      flexDirection: 'column',
    })

    this.header = new TextRenderable(renderer, {
      id: 'header',
      content: '',
      selectable: false,
      fg: colorEnabled() ? color(theme.text) : defaultForeground(),
      wrapMode: 'none',
      flexShrink: 0,
    })
    this.message = new TextRenderable(renderer, {
      id: 'message',
      content: '',
      selectable: false,
      fg: colorEnabled() ? color(theme.text) : defaultForeground(),
      wrapMode: 'none',
      flexShrink: 0,
    })
    this.body = new ScrollBoxRenderable(renderer, {
      id: 'body',
      width: '100%',
      flexGrow: 1,
      flexBasis: 0,
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
      fg: colorEnabled() ? color(theme.text) : defaultForeground(),
      wrapMode: 'none',
    })
    this.body.add(this.content)
    this.spacer = new BoxRenderable(renderer, {
      id: 'footer-spacer',
      width: '100%',
      height: 1,
      flexShrink: 0,
    })
    this.footer = new TextRenderable(renderer, {
      id: 'footer',
      content: '',
      selectable: false,
      fg: colorEnabled() ? color(theme.dim) : defaultForeground(),
      wrapMode: 'none',
      flexShrink: 0,
    })

    this.root.add(this.header)
    this.root.add(this.message)
    this.root.add(this.body)
    this.root.add(this.spacer)
    this.root.add(this.footer)
  }

  /** Draws the state. */
  draw(state: ViewState): void {
    const width = Math.max(40, this.root.width || 80)
    this.header.content = new StyledText([
      tone('bold', 'Warden'),
      tone('dim', ' Tartarus prison board, Linux terminal'),
    ])
    this.message.content = new StyledText([
      tone('dim', 'game:'),
      tone('default', ` ${state.captureNote}`),
    ])

    const lines: TextChunk[][] = [[]]
    this.addAdvice(lines, state)
    if (state.runOver === null) {
      this.addBoard(lines, state, width)
      this.addRanking(lines, state)
    }
    this.content.content = new StyledText(lines.flatMap((line, index) => (index === 0 ? line : [tone('default', '\n'), ...line])))
    this.footer.content = new StyledText([tone('dim', HINTS)])
  }

  /** The advice, or the message that there is none. */
  private addAdvice(lines: TextChunk[][], state: ViewState): void {
    if (state.runOver !== null) {
      lines.push([tone('bold', state.runOver)])
      return
    }
    lines.push([tone(state.held.includes('none known') ? 'dim' : 'accent', state.held)])
    if (state.model === null) {
      lines.push([tone('default', state.reading ? 'Reading the board…' : 'No board read yet.')])
      if (!state.reading && state.ocrProblem !== null) lines.push([tone('yellow', state.ocrProblem)])
      if (state.missed !== null) lines.push([tone('dim', state.missed)])
      return
    }
    for (const problem of state.problems) lines.push([tone('red', problem)])
    for (const warning of state.warnings) lines.push([tone('yellow', warning)])
    if (state.day !== null) lines.push([tone('default', state.day)])
    for (const line of state.keptLines) lines.push([tone('yellow', line)])
    lines.push([])
    if (state.advice !== null) {
      if (state.solving) {
        lines.push([tone('dim', 'NEXT MOVE'), tone('dim', `  (playing it out: ${state.rounds} of ${state.rollouts} playouts)`)])
      } else {
        lines.push([tone('dim', 'NEXT MOVE')])
      }
      lines.push([tone('green', `  ${moveName(state.advice.action, state.advice.label)}`)])
      if (state.advice.why !== null) lines.push([tone('dim', `  ${state.advice.why}`)])
    } else if (state.solving) {
      lines.push([tone('dim', 'Solving…')])
    }
  }

  /** The board and the warnings that point at its cells. */
  private addBoard(lines: TextChunk[][], state: ViewState, width: number): void {
    if (state.model === null) return
    lines.push([])
    for (const row of state.ring) {
      lines.push(...this.ringLines(row, width))
      lines.push([])
    }
    for (const warning of state.cellWarnings) lines.push([tone('yellow', `? ${warning}`)])
  }

  /** The two lines of one row of the ring. */
  private ringLines(row: RingView, width: number): TextChunk[][] {
    const cellWidth = Math.max(6, Math.min(CELL_WIDTH, Math.floor((width - CELL_GAP * 5) / 6)))
    const top: TextChunk[] = []
    const body: TextChunk[] = []
    row.cells.forEach((cell, index) => {
      if (index > 0) {
        top.push(tone('default', ' '.repeat(CELL_GAP)))
        body.push(tone('default', ' '.repeat(CELL_GAP)))
      }
      const style = cell.advised ? 'accent' : cell.warden ? 'yellow' : 'default'
      top.push(cell.advised ? toneOn(style, cell.top.padEnd(cellWidth), theme.selection) : tone(style, cell.top.padEnd(cellWidth)))
      body.push(cell.advised ? toneOn(style, cell.body.padEnd(cellWidth), theme.selection) : tone(style, cell.body.padEnd(cellWidth)))
    })
    return [top, body]
  }

  /** The moves ranked by Riot loot. */
  private addRanking(lines: TextChunk[][], state: ViewState): void {
    if (state.ranking.length > 0) {
      lines.push([tone('dim', 'Moves by Riot loot per run (Chromatic 1, Ultimate 0.2, Legendary 0.05)')])
      for (const row of state.ranking) {
        lines.push([tone(row.chosen ? 'green' : 'default', `  ${String(row.rank).padStart(2)}  ${row.mean}  ${row.label}`)])
      }
    }
    for (const note of state.notes) lines.push([tone('dim', note)])
  }
}
