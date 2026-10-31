// The screen the helper draws.
//
// The screen is a tree of OpenTUI renderables: the header, the three panels and the footer. It is
// built once and then updated from the state, so the layout is flexbox all the way and a resize is
// the renderer's business, not the helper's.
//
// Nothing here reads the log or takes a picture: the screen only draws what it is given.

import {
  BoxRenderable,
  ScrollBoxRenderable,
  StyledText,
  TextAttributes,
  TextRenderable,
  type CliRenderer,
  type TextChunk,
} from '@opentui/core'
import {
  borderColor,
  color,
  colorEnabled,
  defaultBackground,
  defaultForeground,
  fitEnd,
  num,
  rowChunks,
  theme,
  textColor,
  titleColor,
  tone,
  type Tone,
  visibleLength,
} from '@tli/tui'
import { boardOf, moveOf, optionBlocks, type ViewState } from './view'

/** The columns a panel's border takes up. */
const BORDER = 2

/** The column the scrollbar takes up. */
const SCROLLBAR = 1

/** A piece of text in a tone, in bold: the answer on the screen. */
function boldTone(style: Tone, text: string): TextChunk {
  const piece = tone(style, text)
  if (!colorEnabled() || piece.attributes !== undefined) return piece
  return { ...piece, attributes: TextAttributes.BOLD }
}

/** The helper's screen. */
export class VoraxScreen {
  /** the tree that is drawn */
  readonly root: BoxRenderable

  private readonly renderer: CliRenderer

  private readonly header: BoxRenderable
  private readonly titleText: TextRenderable
  private readonly targetText: TextRenderable
  private readonly gameText: TextRenderable
  private readonly logText: TextRenderable

  private readonly moveBox: BoxRenderable
  private readonly moveText: TextRenderable

  private readonly optionsBox: BoxRenderable
  private readonly optionsScroll: ScrollBoxRenderable
  private readonly optionsText: TextRenderable

  private readonly boardBox: BoxRenderable
  private readonly boardScroll: ScrollBoxRenderable
  private readonly boardText: TextRenderable

  private readonly footer: BoxRenderable
  private readonly hintText: TextRenderable

  constructor(renderer: CliRenderer) {
    this.renderer = renderer

    this.root = new BoxRenderable(renderer, {
      id: 'vorax',
      width: '100%',
      height: '100%',
      flexDirection: 'column',
    })

    /* ---------- the header ---------- */

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
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    this.targetText = new TextRenderable(renderer, {
      id: 'target',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    titleRow.add(this.titleText)
    titleRow.add(this.targetText)
    this.header.add(titleRow)

    this.gameText = new TextRenderable(renderer, {
      id: 'game',
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
    this.header.add(this.gameText)
    this.header.add(this.logText)

    /* ---------- the move ---------- */

    this.moveBox = new BoxRenderable(renderer, {
      id: 'move',
      border: true,
      borderStyle: 'rounded',
      title: 'Next move',
      flexDirection: 'column',
      flexShrink: 0,
      overflow: 'hidden',
    })
    this.moveText = new TextRenderable(renderer, {
      id: 'move-text',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'word',
    })
    this.moveBox.add(this.moveText)

    /* ---------- the options ---------- */

    this.optionsBox = new BoxRenderable(renderer, {
      id: 'options',
      border: true,
      borderStyle: 'rounded',
      title: 'Options',
      flexDirection: 'column',
      flexGrow: 1,
      flexBasis: 0,
      overflow: 'hidden',
    })
    this.optionsScroll = new ScrollBoxRenderable(renderer, {
      id: 'options-scroll',
      width: '100%',
      height: '100%',
      scrollbarOptions: {
        trackOptions: {
          foregroundColor: colorEnabled() ? color(theme.scrollThumb) : defaultForeground(),
          backgroundColor: colorEnabled() ? color(theme.scrollTrack) : defaultBackground(),
        },
      },
    })
    this.optionsText = new TextRenderable(renderer, {
      id: 'options-text',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    this.optionsScroll.add(this.optionsText)
    this.optionsBox.add(this.optionsScroll)

    /* ---------- the board ---------- */

    this.boardBox = new BoxRenderable(renderer, {
      id: 'board',
      border: true,
      borderStyle: 'rounded',
      title: 'Board',
      flexDirection: 'column',
      flexGrow: 2,
      flexBasis: 0,
      overflow: 'hidden',
    })
    this.boardScroll = new ScrollBoxRenderable(renderer, {
      id: 'board-scroll',
      width: '100%',
      height: '100%',
      scrollbarOptions: {
        trackOptions: {
          foregroundColor: colorEnabled() ? color(theme.scrollThumb) : defaultForeground(),
          backgroundColor: colorEnabled() ? color(theme.scrollTrack) : defaultBackground(),
        },
      },
    })
    this.boardText = new TextRenderable(renderer, {
      id: 'board-text',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    this.boardScroll.add(this.boardText)
    this.boardBox.add(this.boardScroll)

    /* ---------- the footer ---------- */

    this.footer = new BoxRenderable(renderer, {
      id: 'footer',
      width: '100%',
      height: 1,
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
    this.footer.add(this.hintText)

    this.root.add(this.header)
    this.root.add(this.moveBox)
    this.root.add(this.optionsBox)
    this.root.add(this.boardBox)
    this.root.add(this.footer)
  }

  /** Draws the state. */
  draw(state: ViewState): void {
    const width = this.renderer.width
    this.borders()
    this.drawHeader(state, width)
    this.drawMove(state, width)
    this.drawOptions(state, width)
    this.drawBoard(state, width)
    this.drawFooter(state, width)
  }

  /** The border and the title of every panel, in the colour of the panels. */
  private borders(): void {
    for (const panel of [this.moveBox, this.optionsBox, this.boardBox]) {
      panel.borderColor = borderColor(false)
      panel.titleColor = titleColor(false)
    }
  }

  /** The title, the target and what the program is reading. */
  private drawHeader(state: ViewState, width: number): void {
    const title = 'Vorax Helper'
    const sub = ' · Linux terminal'
    this.titleText.content = new StyledText([tone('accent', title), tone('dim', sub)])
    this.titleText.width = visibleLength(title) + visibleLength(sub)

    const target = `target ${num(state.target)}`
    this.targetText.content = new StyledText([tone('gold', target)])
    this.targetText.width = visibleLength(target)

    const game = 'game: '
    this.gameText.content = new StyledText([
      tone('dim', game),
      tone('default', fitEnd(state.capture, Math.max(10, width - visibleLength(game)))),
    ])
    this.gameText.width = width

    const label = 'log:  '
    const lines = state.logLines > 0 ? ` (${state.logLines} lines read)` : ''
    const pictures = ` · ${state.pictures} pictures read`
    const room = Math.max(10, width - visibleLength(label) - visibleLength(lines) - visibleLength(pictures))
    this.logText.content = new StyledText([
      tone('dim', label),
      tone('default', fitEnd(state.log, room)),
      tone('dim', lines),
      tone('dim', pictures),
    ])
    this.logText.width = width
  }

  /** The round, the move the helper advises, and why it is that one. */
  private drawMove(state: ViewState, width: number): void {
    const board = boardOf(state)
    const move = moveOf(state)
    const lines: TextChunk[][] = []
    if (board.heading !== '') lines.push([tone('dim', board.heading)])
    lines.push([move.tone === 'green' ? boldTone('green', move.text) : tone(move.tone, move.text)])
    if (move.basis !== '') lines.push([tone('dim', move.basis)])
    this.moveText.content = new StyledText(this.join(lines))
    this.moveText.width = Math.max(10, width - BORDER)
  }

  /** The options the helper worked out. */
  private drawOptions(state: ViewState, width: number): void {
    const inner = Math.max(10, width - BORDER - SCROLLBAR)
    const blocks = optionBlocks(state)
    this.optionsBox.visible = blocks.length > 0
    if (!this.optionsBox.visible) return
    const lines: TextChunk[][] = []
    for (const block of blocks) {
      if (block.heading !== '') lines.push([tone('dim', block.heading)])
      for (const row of block.rows) lines.push(rowChunks(row, inner))
    }
    this.optionsText.content = new StyledText(this.join(lines))
    this.optionsText.width = inner
  }

  /** The board that was read. */
  private drawBoard(state: ViewState, width: number): void {
    const inner = Math.max(10, width - BORDER - SCROLLBAR)
    const board = boardOf(state)
    this.boardBox.visible = state.board !== null
    if (!this.boardBox.visible) return
    const lines: TextChunk[][] = []
    for (const warning of board.warnings) lines.push([tone('yellow', `! ${warning}`)])
    for (const row of board.rows) lines.push(rowChunks(row, inner))
    this.boardText.content = new StyledText(this.join(lines))
    this.boardText.width = inner
  }

  /** The keys at the bottom, and what is wrong when something is. */
  private drawFooter(state: ViewState, width: number): void {
    const hints: [string, string][] = [
      ['r', 'read now'],
      ['t', 'target'],
      ['d', `deep check ${state.deepOn ? 'on' : 'off'}`],
      ['q', 'quit'],
    ]
    const chunks: TextChunk[] = []
    hints.forEach(([key, label], index) => {
      if (index > 0) chunks.push(tone('dim', ' · '))
      chunks.push(tone('accent', key), tone('dim', ` ${label}`))
    })
    if (state.status !== '' && state.board !== null) {
      chunks.push(tone('dim', '   '), tone('yellow', state.status))
    }
    this.hintText.content = new StyledText(chunks)
    this.hintText.width = width
  }

  /** The lines of a panel, one after the other. */
  private join(lines: TextChunk[][]): TextChunk[] {
    const chunks: TextChunk[] = []
    lines.forEach((line, index) => {
      if (index > 0) chunks.push(tone('default', '\n'))
      chunks.push(...line)
    })
    return chunks
  }
}
