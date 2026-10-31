// The screen the dashboard draws.
//
// The screen is a tree of OpenTUI renderables. It is built once and then updated from the state,
// so the layout is flexbox and a resize is the renderer's business.
//
// Nothing here starts a tool or reads the log: the screen only draws what it is given.

import { BoxRenderable, StyledText, TextRenderable, type CliRenderer, type TextChunk } from '@opentui/core'
import { logHint, type MinigameState } from '@tli/gamelog'
import { missing, TOOLS, type Tool } from '@tli/launch'
import { textColor, tone, type Tone } from '@tli/tui'
import type { DashboardState } from './app'

/** How a minigame's state is shown. */
const BADGE: Record<MinigameState, [string, Tone]> = {
  open: ['● open', 'green'],
  closed: ['○ closed', 'dim'],
  unknown: ['? unknown', 'dim'],
}

/** One tool, as the list shows it. */
export interface ToolRow {
  /** the tool itself */
  tool: Tool
  /** whether the cursor is on it */
  current: boolean
  /** whether it is picked */
  selected: boolean
  /** the programs it needs that are not installed */
  missing: string[]
  /** the minigame's state, when the tool has one */
  badge: [MinigameState, string | null] | null
}

/** The tools as the list shows them. */
export function toolRows(state: DashboardState): ToolRow[] {
  return TOOLS.map((tool, index) => {
    let badge: ToolRow['badge'] = null
    if (tool.game !== undefined && state.view !== null) {
      badge = [state.view[tool.game], logHint(state.view.log)]
    }
    return {
      tool,
      current: index === state.cursor,
      selected: state.picked.has(tool.id),
      missing: missing(tool),
      badge,
    }
  })
}

/** A tool and the description under it. */
interface ToolLine {
  row: TextRenderable
  description: TextRenderable
}

/** The dashboard's screen. */
export class DashboardScreen {
  /** the tree that is drawn */
  readonly root: BoxRenderable

  private readonly renderer: CliRenderer
  private readonly lines = new Map<string, ToolLine>()
  private readonly messageText: TextRenderable

  constructor(renderer: CliRenderer) {
    this.renderer = renderer

    this.root = new BoxRenderable(renderer, {
      id: 'dashboard',
      width: '100%',
      height: '100%',
      flexDirection: 'column',
      overflow: 'hidden',
    })

    const title = new TextRenderable(renderer, {
      id: 'title',
      content: new StyledText([tone('bold', 'Torchlight: Infinite tools')]),
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
      width: '100%',
      flexShrink: 0,
    })
    this.root.add(title)
    this.root.add(this.spacer('title-gap'))

    const list = new BoxRenderable(renderer, {
      id: 'tools',
      width: '100%',
      flexDirection: 'column',
      flexShrink: 0,
    })
    for (const tool of TOOLS) list.add(this.toolLine(tool))
    this.root.add(list)
    this.root.add(this.spacer('list-gap'))

    const footer = new TextRenderable(renderer, {
      id: 'footer',
      content: new StyledText([tone('dim', '↑/↓ move   space select   a all   enter run   w window   q quit')]),
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
      width: '100%',
      flexShrink: 0,
    })
    this.root.add(footer)
    this.root.add(this.spacer('footer-gap'))

    this.messageText = new TextRenderable(renderer, {
      id: 'message',
      content: new StyledText([]),
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
      width: '100%',
      flexShrink: 0,
      visible: false,
    })
    this.root.add(this.messageText)
  }

  /** A blank line. */
  private spacer(id: string): TextRenderable {
    return new TextRenderable(this.renderer, {
      id,
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
      width: '100%',
      height: 1,
      flexShrink: 0,
    })
  }

  /** A tool's line and the description under it. */
  private toolLine(tool: Tool): BoxRenderable {
    const group = new BoxRenderable(this.renderer, {
      id: `tool-${tool.id}`,
      width: '100%',
      flexDirection: 'column',
      flexShrink: 0,
    })
    const row = new TextRenderable(this.renderer, {
      id: `tool-${tool.id}-row`,
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
      width: '100%',
      flexShrink: 0,
    })
    const description = new TextRenderable(this.renderer, {
      id: `tool-${tool.id}-description`,
      content: new StyledText([tone('dim', `      ${tool.description}`)]),
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
      width: '100%',
      flexShrink: 0,
      visible: false,
    })
    group.add(row)
    group.add(description)
    this.lines.set(tool.id, { row, description })
    return group
  }

  /** Draws the state. */
  draw(state: DashboardState): void {
    for (const row of toolRows(state)) {
      const line = this.lines.get(row.tool.id)
      if (line === undefined) continue
      line.row.content = new StyledText(this.rowChunks(row))
      line.description.visible = row.current
    }

    if (state.message === '') {
      this.messageText.visible = false
      this.messageText.content = new StyledText([])
    } else {
      this.messageText.visible = true
      this.messageText.content = new StyledText([tone('yellow', state.message)])
    }
  }

  /** The pieces of one tool's line. */
  private rowChunks(row: ToolRow): TextChunk[] {
    const chunks = [
      tone(row.current ? 'cyan' : 'default', row.current ? '>' : ' '),
      tone('default', ' '),
      tone(row.selected ? 'green' : 'default', row.selected ? '[x]' : '[ ]'),
      tone('default', ' '),
      tone('bold', row.tool.name),
    ]

    if (row.missing.length > 0) {
      chunks.push(tone('red', `  needs ${row.missing.join(', ')}`))
    }

    if (row.badge !== null) {
      const [state, hint] = row.badge
      const badge = BADGE[state]
      chunks.push(tone('default', '  '), tone(badge[1], badge[0]))
      if (hint !== null) chunks.push(tone('dim', `  ${hint}`))
    }

    return chunks
  }
}
