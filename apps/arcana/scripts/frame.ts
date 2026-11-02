// Writes the arcana screen as an HTML page, so it can be looked at in a browser.
//
//   bun scripts/frame.ts > /tmp/arcana.html
//
// The colours come from the frame the test renderer captured, so the page is what the terminal
// would show.

import { Tracker, emptyHistory, type History } from '@tli/arcana'
import { ItemNames } from '@tli/tracker'
import { createTestRenderer } from '@opentui/core/testing'
import { ArcanaApp } from '../src/app'
import { freshView } from '../src/view'

const names = new ItemNames({
  '3902': { name: 'Test Rune' },
  '100300': { name: 'Flame Elementium' },
  '999999': { name: 'Item #999999' },
})

const history: History = {
  ...emptyHistory(),
  sessions: [
    {
      id: 1,
      openedAt: Date.UTC(2026, 9, 30, 1, 0),
      closedAt: Date.UTC(2026, 9, 30, 1, 3),
      cells: 65,
      moves: [],
      chests: [
        { slot: 1, rarity: 'Blue', at: Date.UTC(2026, 9, 30, 1, 1), upgrades: 0 },
        { slot: 2, rarity: 'Zi', at: Date.UTC(2026, 9, 30, 1, 2), upgrades: 2 },
        { slot: 3, rarity: null, at: Date.UTC(2026, 9, 30, 1, 2), upgrades: 0 },
      ],
      notes: 15,
      chestsSkipped: 1,
      played: 14,
      lifeLost: 3,
      lifeWon: 3,
    },
    {
      id: 2,
      openedAt: Date.UTC(2026, 9, 30, 2, 0),
      closedAt: Date.UTC(2026, 9, 30, 2, 4),
      cells: 80,
      moves: [],
      chests: [{ slot: 1, rarity: 'Hong', at: Date.UTC(2026, 9, 30, 2, 1), upgrades: 0 }],
      notes: 22,
      chestsSkipped: 0,
      played: 19,
      lifeLost: 1,
      lifeWon: 4,
    },
  ],
  contests: [
    {
      askedAt: Date.UTC(2026, 9, 30, 1, 5),
      openedAt: Date.UTC(2026, 9, 30, 1, 5),
      closedAt: Date.UTC(2026, 9, 30, 1, 12),
      chests: [
        { at: Date.UTC(2026, 9, 30, 1, 6), rewards: [{ item: 100300, qty: 3 }, { item: 3902, qty: 1 }] },
        { at: Date.UTC(2026, 9, 30, 1, 8), rewards: [{ item: 3902, qty: 2 }, { item: 999999, qty: 1 }] },
      ],
    },
  ],
  trials: [
    { at: Date.UTC(2026, 9, 30, 1, 1), arcana: 'TheSun' },
    { at: Date.UTC(2026, 9, 30, 1, 2), arcana: 'TheHangedMan' },
  ],
  nextId: 3,
}

const view = process.argv[2] ?? 'history'
const narrow = view === 'narrow'

// a visit that is still going on, with its contest in the fight: what the Now panel shows
if (view === 'open') {
  history.sessions.push({
    id: 3,
    openedAt: Date.UTC(2026, 9, 30, 3, 0),
    closedAt: null,
    cells: 41,
    moves: [],
    chests: [
      { slot: 1, rarity: 'Jin', at: Date.UTC(2026, 9, 30, 3, 1), upgrades: 1 },
      { slot: 2, rarity: 'Cai', at: Date.UTC(2026, 9, 30, 3, 2), upgrades: 0 },
    ],
    notes: 9,
    chestsSkipped: 2,
    played: 7,
    lifeLost: 2,
    lifeWon: 1,
  })
  history.contests.push({
    askedAt: Date.UTC(2026, 9, 30, 3, 4),
    openedAt: Date.UTC(2026, 9, 30, 3, 5),
    closedAt: null,
    chests: [{ at: Date.UTC(2026, 9, 30, 3, 6), rewards: [{ item: 3902, qty: 4 }] }],
  })
  history.nextId = 4
}

const tracker = new Tracker(history)
tracker.prices.setOverride(3902, 10)

const test = await createTestRenderer({ width: narrow ? 62 : 120, height: narrow ? 22 : 30, kittyKeyboard: true })
const state = freshView('/home/niller/games/Torchlight Infinite/UE_game/TorchLight/Saved/Logs/UE_game.log')
state.path = view === 'open' ? 'open' : 'closed'
if (view === 'totals') state.focus = 'totals'
if (view === 'detail') {
  state.detail = true
  state.cursor = 1
}
if (view === 'help') state.help = true
if (view === 'message') state.message = 'the log was read again: 2 visits, 1 contest'
const app = new ArcanaApp(test.renderer, tracker, names, state, {
  onQuit: () => {},
  onRead: () => {},
})
app.draw()
await test.renderOnce()
const frame = test.captureSpans()
test.renderer.destroy()

const rgb = (rgba: { r: number; g: number; b: number; a: number }): string => {
  if (rgba.a === 0) return 'transparent'
  const part = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255)
  return `rgb(${part(rgba.r)},${part(rgba.g)},${part(rgba.b)})`
}

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;')

const lines = frame.lines
  .map((line) => {
    const spans = line.spans
      .map((span) => {
        const style = `color:${rgb(span.fg as never)};background:${rgb(span.bg as never)}`
        const bold = (span.attributes & 1) !== 0 ? ';font-weight:bold' : ''
        return `<span style="${style}${bold}">${escape(span.text)}</span>`
      })
      .join('')
    return `<div class="row">${spans || '&nbsp;'}</div>`
  })
  .join('\n')

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { background: #0c0c0c; margin: 0; padding: 16px; }
  .frame { font-family: "DejaVu Sans Mono", monospace; font-size: 14px; line-height: 1.25; color: #d4d4d4; }
  .row { white-space: pre; height: 17.5px; }
</style></head>
<body><div class="frame">${lines}</div></body></html>
`

process.stdout.write(html)
