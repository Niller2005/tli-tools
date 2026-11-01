// The screen the dashboard draws.
//
// The screen is a tree of OpenTUI renderables. It is built once and then updated from the state,
// so the layout is flexbox and a resize is the renderer's business.
//
// Nothing here starts a tool or reads the log: the screen only draws what it is given. The rows of
// the panels are plain data, worked out by functions that never touch a terminal, so the tests can
// look at them without a screen being anywhere near.

import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  StyledText,
  TextRenderable,
  type CliRenderer,
  type TextChunk,
} from '@opentui/core'
import type { CaptureStatus } from '@tli/capture'
import { logHint, type LogHealth, type MinigameState, type ToolStatus } from '@tli/gamelog'
import { missing, toolSettings, TOOLS, type RunningEntry, type Tool } from '@tli/launch'
import type { SessionSummary } from '@tli/tracker'
import {
  backgroundColor,
  duration,
  fe,
  fit,
  num,
  pad,
  tone,
  textColor,
  toneOn,
  theme,
  visibleLength,
  type Tone,
} from '@tli/tui'
import type { DashboardState } from './app'
import type { StatusData } from './status'

/** Below this many columns the panels are stacked under the list, one at a time. */
export const NARROW = 100

/** How a minigame's state is shown. */
const BADGE: Record<MinigameState, [string, Tone]> = {
  open: ['● open', 'green'],
  closed: ['○ closed', 'dim'],
  unknown: ['? unknown', 'dim'],
}

/** How a status line's tone is drawn. */
const LINE_TONE: Record<ToolStatus['tone'], Tone> = { ok: 'green', dim: 'dim', warn: 'yellow' }

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
  /** whether the tool opens by itself when its minigame opens */
  auto: boolean
  /** the tool's status line, when it says something the badge does not */
  line: { text: string; tone: Tone } | null
}

/**
 * The status line a row shows.
 *
 * The line is left out when the tool has nothing to say, and when it says only what the badge next
 * to it says already: the Vorax and the Warden lines are the minigame's state and nothing more, so
 * the badge says them and the line would say them twice.
 */
export function statusLineText(badge: MinigameState | null, status: ToolStatus | undefined): string {
  if (status === undefined || status.line === '') return ''
  if (badge !== null && status.line === badge) return ''
  return status.line
}

/** The tools as the list shows them. */
export function toolRows(state: DashboardState): ToolRow[] {
  return TOOLS.map((tool, index) => {
    let badge: ToolRow['badge'] = null
    if (tool.game !== undefined && state.view !== null) {
      badge = [state.view[tool.game], logHint(state.view.log)]
    }
    const status = state.status.lines[tool.id]
    const text = statusLineText(badge === null ? null : badge[0], status)
    return {
      tool,
      current: index === state.cursor,
      selected: state.picked.has(tool.id),
      missing: missing(tool),
      badge,
      auto: tool.game !== undefined && toolSettings(state.settings, tool.id).autoLaunch,
      line: text === '' || status === undefined ? null : { text, tone: LINE_TONE[status.tone] },
    }
  })
}

/** One row of a panel: a label and what it says. */
export interface PanelRow {
  /** what the value is about; '' for a blank line */
  label: string
  /** the value itself */
  value: string
  /** how the value is drawn */
  tone?: Tone
}

/** A size in bytes, as a person reads it: "412 MB". */
export function bytes(size: number): string {
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size
  let unit = -1
  do {
    value /= 1024
    unit += 1
  } while (value >= 1024 && unit < units.length - 1)
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`
}

/** What the player has been doing, as the session panel shows it. */
export function sessionRows(summary: SessionSummary): PanelRow[] {
  const run = (r: SessionSummary['bestRun']): string =>
    r === null ? '—' : `${r.name}${r.endedAt === null ? ' (going)' : ''} · ${fe(r.worth)}`
  return [
    { label: 'runs today', value: num(summary.runsToday) },
    { label: 'FE today', value: fe(summary.feToday) },
    { label: 'FE per hour', value: `${summary.fePerHour.toFixed(1)} FE/h` },
    { label: 'best run', value: run(summary.bestRun) },
    { label: 'last run', value: run(summary.lastRun) },
    { label: 'FE total', value: fe(summary.feTotal) },
  ]
}

/** The log's health, as the log panel shows it. */
export function healthRows(health: LogHealth, now: number): PanelRow[] {
  let log: PanelRow['value']
  if (health.detail === 'missing') {
    log = health.path === null ? 'missing (the game is not installed)' : 'missing'
  } else if (health.detail === 'no-detail') {
    log = 'no game lines (Esc → Account Related → Enable Log)'
  } else {
    const age = health.modifiedAt === null ? '' : ` · written ${duration(Math.max(0, now - health.modifiedAt))} ago`
    log = `ok · ${bytes(health.size)}${age}`
  }
  return [
    { label: 'log', value: log, tone: health.detail === 'ok' ? 'green' : 'yellow' },
    { label: 'log file', value: health.path ?? '—', tone: 'dim' },
  ]
}

/** What a capture would do, as the capture panel shows it. */
export function captureRows(capture: CaptureStatus): PanelRow[] {
  const way = capture.noCapture
    ? 'off (TLI_NO_CAPTURE)'
    : {
        grim: 'grim (the whole output)',
        niri: 'niri (the window alone, announced)',
        command: 'the given command',
        none: 'none: install grim',
      }[capture.path]
  const tools = capture.tools.map(t => `${t.name} ${t.found ? '✓' : '✗'}`).join('  ')
  return [
    { label: 'capture', value: way, tone: capture.noCapture || capture.path === 'none' ? 'yellow' : 'green' },
    { label: 'tools', value: tools, tone: 'dim' },
  ]
}

/** The tools the launcher has opened, as the running panel shows them. */
export function runningRows(running: RunningEntry[], now: number): PanelRow[] {
  if (running.length === 0) return [{ label: 'running', value: 'nothing is running', tone: 'dim' }]
  return running.map(entry => ({
    label: entry.id,
    value: `${entry.via} · ${duration(Math.max(0, now - entry.since))} · ${
      entry.running ? 'running' : entry.exitCode === null ? 'gone' : `exited ${entry.exitCode}`
    }`,
    tone: entry.running ? 'green' : 'dim',
  }))
}

/** How old the data the tools read is, as the freshness rows show it. */
export function freshnessRows(status: StatusData): PanelRow[] {
  return [
    {
      label: 'prices',
      value: status.baselineAge === null ? 'not on disk yet' : `${duration(Math.max(0, status.baselineAge))} old`,
      tone: 'dim',
    },
    { label: 'item names', value: status.itemAge === null ? 'unknown' : `${duration(status.itemAge)} old`, tone: 'dim' },
  ]
}

/** One row of the options dialog: a setting the tool's own command takes. */
export interface OptionRow {
  /** the setting in the settings file */
  key: 'noColor' | 'noLog' | 'niriScreenshot' | 'captureCmd'
  /** what the dialog calls it */
  label: string
}

/**
 * The options a tool takes, as the dialog lists them: only the ones its command understands, each
 * spelled the way its entry in the tool table says. A tool that takes none has an empty list.
 */
export function optionRows(tool: Tool): OptionRow[] {
  const rows: OptionRow[] = []
  if (tool.accepts?.noColor !== undefined) rows.push({ key: 'noColor', label: 'colours off' })
  if (tool.accepts?.noLog !== undefined) rows.push({ key: 'noLog', label: 'does not read the game log' })
  if (tool.accepts?.niriScreenshot !== undefined) {
    rows.push({ key: 'niriScreenshot', label: "niri's own window screenshot (announced)" })
  }
  if (tool.accepts?.captureCmd !== undefined) rows.push({ key: 'captureCmd', label: 'capture command' })
  return rows
}

/** The keys the help lists. */
const HELP: [string, string][] = [
  ['↑/↓ j/k', 'move'],
  ['space', 'pick a tool'],
  ['A', 'pick every tool'],
  ['enter', 'run the picked tools here'],
  ['w', 'open the tool in a window of its own'],
  ['o', 'the tool’s options'],
  ['a', 'open the tool by itself when its minigame opens'],
  ['x', 'stop the running tool'],
  ['f', 'bring the tool’s window to the front (tmux panes only)'],
  ['b', 'fetch the community prices again'],
  ['tab', 'the next detail pane, on a narrow screen'],
  ['?', 'this help'],
  ['q', 'quit'],
]

/** The keys the footer lists. */
const HINTS =
  '↑/↓ move  space select  A all  ⏎ run  w window  o options  a auto  x close  f focus  b prices  tab pane  ? help  q quit'

/** What the screen needs from the program around it. */
export interface ScreenHooks {
  /** a capture command was typed in and finished with enter */
  onCommand: (text: string) => void
}

/** A tool and the description under it. */
interface ToolLine {
  row: TextRenderable
  description: TextRenderable
}

/** One of the panels on the right. */
interface Panel {
  box: BoxRenderable
  text: TextRenderable
}

/** The dashboard's screen. */
export class DashboardScreen {
  /** the tree that is drawn */
  readonly root: BoxRenderable

  private readonly renderer: CliRenderer
  private readonly hooks: ScreenHooks
  private readonly lines = new Map<string, ToolLine>()
  private readonly messageText: TextRenderable

  private readonly body: BoxRenderable
  private readonly listColumn: BoxRenderable
  private readonly rightColumn: BoxRenderable
  private readonly session: Panel
  private readonly health: Panel
  private readonly toolsPanel: Panel

  private readonly overlay: BoxRenderable
  private readonly overlayBox: BoxRenderable
  private readonly overlayText: TextRenderable
  private readonly commandRow: BoxRenderable
  private readonly commandInput: InputRenderable

  /** whether the panels are stacked under the list */
  private narrow = false
  /** the width of the list, and of the panels beside it */
  private listWidth = 0
  private panelWidth = 0

  constructor(renderer: CliRenderer, hooks: ScreenHooks = { onCommand: () => {} }) {
    this.renderer = renderer
    this.hooks = hooks

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

    this.body = new BoxRenderable(renderer, {
      id: 'body',
      width: '100%',
      flexDirection: 'row',
      flexGrow: 1,
      flexBasis: 0,
    })

    this.listColumn = new BoxRenderable(renderer, {
      id: 'list',
      flexDirection: 'column',
      flexShrink: 0,
    })
    for (const tool of TOOLS) this.listColumn.add(this.toolLine(tool))
    this.body.add(this.listColumn)

    this.rightColumn = new BoxRenderable(renderer, {
      id: 'panels',
      flexDirection: 'column',
      flexGrow: 1,
      flexBasis: 0,
    })
    this.session = this.panel('session', 'Session')
    this.health = this.panel('health', 'Log and capture')
    this.toolsPanel = this.panel('tools', 'Running tools and data')
    this.rightColumn.add(this.session.box)
    this.rightColumn.add(this.health.box)
    this.rightColumn.add(this.toolsPanel.box)
    this.body.add(this.rightColumn)
    this.root.add(this.body)

    const footer = new TextRenderable(renderer, {
      id: 'footer',
      content: new StyledText([tone('dim', HINTS)]),
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

    this.overlay = new BoxRenderable(renderer, {
      id: 'overlay',
      position: 'absolute',
      left: 0,
      top: 0,
      width: '100%',
      height: '100%',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: backgroundColor(),
      visible: false,
    })
    this.overlayBox = new BoxRenderable(renderer, {
      id: 'overlay-box',
      border: true,
      borderStyle: 'rounded',
      title: '',
      flexDirection: 'column',
    })
    this.overlayText = new TextRenderable(renderer, {
      id: 'overlay-text',
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    this.overlayBox.add(this.overlayText)
    this.commandRow = new BoxRenderable(renderer, {
      id: 'command-row',
      flexDirection: 'row',
      visible: false,
    })
    const commandLabel = new TextRenderable(renderer, {
      id: 'command-label',
      content: new StyledText([tone('dim', 'command ')]),
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    this.commandInput = new InputRenderable(renderer, {
      id: 'command-input',
      width: 40,
      textColor: textColor(),
      cursorColor: textColor(),
    })
    this.commandRow.add(commandLabel)
    this.commandRow.add(this.commandInput)
    this.overlayBox.add(this.commandRow)
    this.overlay.add(this.overlayBox)
    this.root.add(this.overlay)

    this.commandInput.on(InputRenderableEvents.ENTER, (value: string) => {
      this.hooks.onCommand(value)
    })
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

  /** One of the panels on the right. */
  private panel(id: string, title: string): Panel {
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
    const text = new TextRenderable(this.renderer, {
      id: `${id}-text`,
      content: '',
      selectable: false,
      fg: textColor(),
      wrapMode: 'none',
    })
    box.add(text)
    return { box, text }
  }

  /** Draws the state. */
  draw(state: DashboardState): void {
    this.layout(this.renderer.width, state)
    this.drawList(state)
    this.drawPanels(state)
    this.drawMessage(state)
    this.drawOverlay(state)
  }

  /** Works out how the list and the panels are put on the screen. */
  private layout(width: number, state: DashboardState): void {
    this.narrow = width < NARROW
    this.listWidth = this.narrow ? width : Math.floor(width * 0.55)
    this.panelWidth = this.narrow ? width : width - this.listWidth

    this.body.flexDirection = this.narrow ? 'column' : 'row'
    this.listColumn.width = this.listWidth
    this.rightColumn.width = this.panelWidth
    // a narrow screen gives the rest to the one pane that is shown; a wide one shares it out
    this.rightColumn.flexGrow = 1

    // a narrow screen shows one detail pane at a time, and tab says which
    this.session.box.visible = !this.narrow || state.pane === 0
    this.health.box.visible = !this.narrow || state.pane === 1
    this.toolsPanel.box.visible = !this.narrow || state.pane === 2
  }

  /** The tool list. */
  private drawList(state: DashboardState): void {
    for (const row of toolRows(state)) {
      const line = this.lines.get(row.tool.id)
      if (line === undefined) continue
      line.row.content = new StyledText(this.rowChunks(row, this.listWidth))
      line.description.visible = row.current
    }
  }

  /** The panels on the right: the session, the log and the capture, the tools and the data. */
  private drawPanels(state: DashboardState): void {
    const now = state.status.at === 0 ? Date.now() : state.status.at
    const width = Math.max(4, this.panelWidth - 2)
    this.session.text.content = new StyledText(this.panelChunks(sessionRows(state.status.summary), width))
    this.health.text.content = new StyledText(
      this.panelChunks([...healthRows(state.status.health, now), ...captureRows(state.status.capture)], width),
    )
    this.toolsPanel.text.content = new StyledText(
      this.panelChunks(
        [...runningRows(state.status.running, now), { label: '', value: '' }, ...freshnessRows(state.status)],
        width,
      ),
    )
  }

  /** The message under the list. */
  private drawMessage(state: DashboardState): void {
    if (state.message === '') {
      this.messageText.visible = false
      this.messageText.content = new StyledText([])
    } else {
      this.messageText.visible = true
      this.messageText.content = new StyledText([tone('yellow', state.message)])
    }
  }

  /** The options dialog, or the help, over the whole screen. */
  private drawOverlay(state: DashboardState): void {
    if (state.options !== null) {
      this.drawOptions(state)
      return
    }
    if (state.help) {
      this.drawHelp()
      return
    }
    this.overlay.visible = false
  }

  /** The options of one tool: the settings its own command takes. */
  private drawOptions(state: DashboardState): void {
    const tool = TOOLS.find(t => t.id === state.options?.tool)
    if (tool === undefined) {
      this.overlay.visible = false
      return
    }
    const rows = optionRows(tool)
    const settings = state.settings.tools[tool.id] ?? {}

    const chunks: TextChunk[] = [
      tone('dim', '↑↓ move · space toggles · ⏎ edit · esc close'),
      tone('default', '\n'),
    ]
    rows.forEach((row, index) => {
      const at = state.options?.at ?? 0
      const picked = index === at
      let text: string
      if (row.key === 'captureCmd') {
        const value = settings.captureCmd
        text = ` capture command: ${value === null || value === undefined ? 'none' : value}`
      } else {
        const on = settings[row.key] === true
        text = ` ${on ? '[x]' : '[ ]'} ${row.label}`
      }
      chunks.push(
        picked ? toneOn('accent', `▸${text}`, theme.selection) : tone('default', ` ${text}`),
        tone('default', '\n'),
      )
    })

    const inner = Math.max(30, ...rows.map(row => visibleLength(row.label) + 24))
    this.overlayBox.title = `${tool.name} · options`
    this.overlayBox.width = Math.min(this.renderer.width - 2, inner + 2)
    this.overlayBox.height = rows.length + 3 + (state.editing ? 1 : 0)
    this.overlayText.content = new StyledText(chunks)
    this.overlayText.width = inner
    this.overlay.visible = true

    this.commandRow.visible = state.editing
    if (state.editing) this.commandInput.width = Math.max(10, inner - 10)
  }

  /** The help. */
  private drawHelp(): void {
    const chunks: TextChunk[] = [tone('accent', 'Keys'), tone('default', '\n')]
    for (const [key, label] of HELP) {
      chunks.push(tone('accent', pad(key, 12)), tone('dim', label), tone('default', '\n'))
    }
    const inner = Math.max(36, ...HELP.map(([key, label]) => visibleLength(key) + 2 + visibleLength(label)))
    this.overlayBox.title = 'Help'
    this.overlayBox.width = Math.min(this.renderer.width - 2, inner + 4)
    this.overlayBox.height = HELP.length + 3
    this.overlayText.content = new StyledText(chunks)
    this.overlayText.width = inner
    this.overlay.visible = true
    this.commandRow.visible = false
  }

  /** Starts typing a capture command in, from the value it has. */
  beginCommand(value: string): void {
    this.commandInput.value = value
    this.commandRow.visible = true
    this.commandInput.focus()
  }

  /** Stops typing, and puts the input away. */
  endCommand(): void {
    this.commandInput.blur()
    this.commandRow.visible = false
  }

  /** The pieces of one tool's line. */
  private rowChunks(row: ToolRow, width: number): TextChunk[] {
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

    if (row.auto) {
      chunks.push(tone('default', '  '), tone('cyan', '⟳ auto'))
    }

    if (row.line !== null) {
      const used = chunks.reduce((sum, chunk) => sum + visibleLength(chunk.text), 0)
      chunks.push(tone('default', '  '), tone(row.line.tone, fit(row.line.text, Math.max(0, width - used - 2))))
    }

    return chunks
  }

  /** The lines of one panel. */
  private panelChunks(rows: PanelRow[], width: number): TextChunk[] {
    const labelWidth = Math.min(14, Math.max(0, ...rows.map(row => visibleLength(row.label))))
    const chunks: TextChunk[] = []
    for (const row of rows) {
      if (row.label === '') {
        chunks.push(tone('default', '\n'))
        continue
      }
      chunks.push(
        tone('dim', pad(row.label, labelWidth + 2)),
        tone(row.tone ?? 'default', fit(row.value, Math.max(0, width - labelWidth - 2))),
        tone('default', '\n'),
      )
    }
    return chunks
  }
}
