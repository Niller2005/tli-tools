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
  brandChunks,
  chip,
  chunksWidth,
  color,
  colorEnabled,
  defaultBackground,
  defaultForeground,
  fitEnd,
  hintChunks,
  meter,
  num,
  panelBorderStyle,
  panelTitle,
  rowChunks,
  surfaceColor,
  theme,
  textColor,
  titleColor,
  tone,
  type Tone,
  visibleLength,
} from '@tli/tui'
import { boardOf, moveOf, optionBlocks, phaseName, type ViewState } from './view'

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
  private readonly brandText: TextRenderable
  private readonly chipsText: TextRenderable
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
    const brandBar = new BoxRenderable(renderer, {
      id: 'brand-bar',
      width: '100%',
      height: 1,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexShrink: 0,
      backgroundColor: surfaceColor(),
    })
    this.brandText = new TextRenderable(renderer, {
      id: 'brand',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    this.chipsText = new TextRenderable(renderer, {
      id: 'chips',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    brandBar.add(this.brandText)
    brandBar.add(this.chipsText)
    this.header.add(brandBar)

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
      backgroundColor: surfaceColor(),
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

  /** The border and the title of every panel: the move panel is the one to look at, so it is the one that stands out. */
  private borders(): void {
    const panels: [BoxRenderable, string, boolean][] = [
      [this.moveBox, panelTitle('Next move', true), true],
      [this.optionsBox, panelTitle('Options'), false],
      [this.boardBox, panelTitle('Board'), false],
    ]
    for (const [panel, title, focused] of panels) {
      panel.borderStyle = panelBorderStyle(focused)
      panel.borderColor = borderColor(focused)
      panel.titleColor = titleColor(focused)
      panel.title = title
    }
  }

  /** The bar along the top, and the two lines under it: the game and the log. */
  private drawHeader(state: ViewState, width: number): void {
    const brand = brandChunks('Vorax Helper', 'terminal')
    this.brandText.content = new StyledText(brand)
    this.brandText.width = chunksWidth(brand)

    // the state of the helper, most important first; the ones that do not fit are left out
    const b = state.board
    const candidates: TextChunk[] = [
      chip(`target ${num(state.target)}`, 'gold'),
      b
        ? chip('board open', 'green')
        : chip(state.capture.includes('closed') ? 'board closed' : 'looking', 'dim'),
    ]
    if (b) candidates.push(chip(`round ${b.round} · ${phaseName(b.phase)}`, 'purple'))
    candidates.push(chip(state.deepOn ? 'deep on' : 'deep off', state.deepOn ? 'green' : 'dim'))

    const room = width - chunksWidth(brand) - 1
    const chips: TextChunk[] = []
    let used = 0
    for (const candidate of candidates) {
      const gap = chips.length > 0 ? 1 : 0
      const candidateWidth = chunksWidth([candidate])
      if (used + gap + candidateWidth > room) break
      if (gap > 0) chips.push(tone('default', ' '))
      chips.push(candidate)
      used += gap + candidateWidth
    }
    this.chipsText.content = new StyledText(chips)
    this.chipsText.width = used

    const game = 'game: '
    this.gameText.content = new StyledText([
      tone('dim', game),
      tone('default', fitEnd(state.capture, Math.max(10, width - visibleLength(game)))),
    ])
    this.gameText.width = width

    const label = 'log:  '
    const lines = state.logLines > 0 ? ` (${state.logLines} lines read)` : ''
    const pictures = ` · ${state.pictures} pictures read`
    const logRoom = Math.max(10, width - visibleLength(label) - visibleLength(lines) - visibleLength(pictures))
    this.logText.content = new StyledText([
      tone('dim', label),
      tone('dim', fitEnd(state.log, logRoom)),
      tone('orange', lines),
      tone('orange', pictures),
    ])
    this.logText.width = width
  }

  /** The round, the move the helper advises, and why it is that one. */
  private drawMove(state: ViewState, width: number): void {
    const board = boardOf(state)
    const move = moveOf(state)
    const inner = Math.max(10, width - BORDER)
    const lines: TextChunk[][] = []
    if (board.heading !== '') {
      // the round out of the whole run, as a bar: the run is underway, so it is drawn in the colour of effort
      const heading = [tone('dim', board.heading)]
      const meterWidth = inner - visibleLength(board.heading) - 2
      if (meterWidth >= 8) heading.push(tone('default', '  '), ...meter(board.progress, meterWidth, 'orange'))
      lines.push(heading)
    }
    // the answer is the headline; a notice is still bold; while it is worked out it is shown as busy
    const headline =
      move.tone === 'green'
        ? boldTone('accent', move.text)
        : move.tone === 'yellow'
          ? boldTone('yellow', move.text)
          : state.board !== null
            ? tone('orange', move.text)
            : tone(move.tone, move.text)
    lines.push([headline])
    if (move.basis !== '') lines.push([tone('dim', move.basis)])
    this.moveText.content = new StyledText(this.join(lines))
    this.moveText.width = inner
  }

  /** The options the helper worked out. */
  private drawOptions(state: ViewState, width: number): void {
    const inner = Math.max(10, width - BORDER - SCROLLBAR)
    const blocks = optionBlocks(state)
    this.optionsBox.visible = blocks.length > 0
    if (!this.optionsBox.visible) return
    const lines: TextChunk[][] = []
    for (const block of blocks) {
      if (block.heading !== '') {
        const heading = [tone('dim', block.heading)]
        if (block.meter) {
          const meterWidth = inner - visibleLength(block.heading) - 2
          if (meterWidth >= 8) heading.push(tone('default', '  '), ...meter(block.meter.fraction, meterWidth, block.meter.tone))
        }
        lines.push(heading)
      }
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
    const chunks = hintChunks(hints)
    if (state.status !== '' && state.board !== null) {
      chunks.push(tone('default', '   '), tone('yellow', state.status))
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
