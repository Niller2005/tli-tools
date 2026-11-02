// What the screen shows, worked out from what the tracker knows, and the state of the screen.
//
// Everything here is plain data in, plain data out, so it can be tested without a terminal: the
// rows are the cells of a table, and the screen in `screen.ts` draws them.

import type { TextChunk } from '@opentui/core'
import {
  RARITIES,
  RARITY_NAMES,
  type Contest,
  type History,
  type Move,
  type Rarity,
  type Session,
  type Tracker,
} from '@tli/arcana'
import type { MinigameState } from '@tli/gamelog'
import { valueOf, type ItemNames, type Value } from '@tli/tracker'
import { chunksWidth, clip, meter, stat, type Cell, type Row, type Tone, duration, fe, num, pad, padStart, tone, visibleLength } from '@tli/tui'
import { arcanaName, clock, stamp } from './format'

/** The lists the player can move about in. */
export type Panel = 'history' | 'totals'

/** The panels, in the order the tab key goes through them. */
export const PANELS: Panel[] = ['history', 'totals']

/** The state of the screen. */
export interface ViewState {
  /** the log being read */
  logFile: string
  /** what to tell the player about the log; empty when there is nothing to say */
  logNote: string
  /** whether the log says the Tarot Path is open right now */
  path: MinigameState
  /** a one-off message, shown until the next key */
  message: string
  /** the panel the keys move about in */
  focus: Panel
  /** the row the pointer is on in the history */
  cursor: number
  /** whether the detail of the entry under the pointer is shown over the screen */
  detail: boolean
  /** how far the detail (or the totals) is scrolled */
  scroll: number
  /** whether the trade tax counts against the value of the rewards */
  taxed: boolean
  /** whether the help is open */
  help: boolean
}

/** A screen at its start. */
export function freshView(logFile: string): ViewState {
  return {
    logFile,
    logNote: '',
    path: 'unknown',
    message: '',
    focus: 'history',
    cursor: 0,
    detail: false,
    scroll: 0,
    taxed: true,
    help: false,
  }
}

/** One row of the history: a visit to the Tarot Path, and the Fateful Contest that followed it. */
export interface Entry {
  /** when it began, on the log's clock */
  at: number
  /** the visit to the Tarot Path; null for a contest the log began in the middle of */
  session: Session | null
  /** the Fateful Contest that followed the visit; null when there was none */
  contest: Contest | null
}

/** When a contest began: when the game asked, else when its page opened, else its first chest. */
function contestAt(contest: Contest): number {
  return contest.askedAt ?? contest.openedAt ?? contest.chests[0]?.at ?? 0
}

/** The history as rows, newest first. A contest belongs to the last visit that began before it. */
export function entriesOf(history: History): Entry[] {
  const entries: Entry[] = history.sessions.map((session) => ({ at: session.openedAt, session, contest: null }))
  for (const contest of history.contests) {
    const at = contestAt(contest)
    let owner: Entry | null = null
    for (const entry of entries) {
      if (entry.session !== null && entry.session.openedAt <= at) owner = entry
    }
    if (owner !== null && owner.contest === null) owner.contest = contest
    else entries.push({ at, session: null, contest })
  }
  return entries.sort((a, b) => b.at - a.at)
}

/** The entry the pointer is on, or null when the history is empty. */
export function selectedEntry(history: History, cursor: number): Entry | null {
  const entries = entriesOf(history)
  if (entries.length === 0) return null
  return entries[Math.min(cursor, entries.length - 1)] ?? null
}

/** What a contest's chests gave, all together: the item and how many. */
export function rewardsOf(contest: Contest): Map<number, number> {
  const out = new Map<number, number>()
  for (const chest of contest.chests) {
    for (const reward of chest.rewards) out.set(reward.item, (out.get(reward.item) ?? 0) + reward.qty)
  }
  return out
}

/** What a pile of rewards is worth. */
export function valueOfRewards(rewards: Map<number, number>, price: (item: number) => number, taxed: boolean): Value {
  return valueOf(rewards, price, taxed)
}

/** The chests the player took, by rarity; the ones the log did not show the rarity of are "unknown". */
export function chestsByRarity(sessions: Session[]): Map<Rarity | 'unknown', number> {
  const out = new Map<Rarity | 'unknown', number>()
  for (const r of RARITIES) out.set(r, 0)
  out.set('unknown', 0)
  for (const session of sessions) {
    for (const chest of session.chests) {
      const key = chest.rarity ?? 'unknown'
      out.set(key, (out.get(key) ?? 0) + 1)
    }
  }
  return out
}

/** Everything the player did, all together. */
export interface Totals {
  sessions: number
  moves: number
  cells: number
  notes: number
  played: number
  lifeLost: number
  lifeWon: number
  /** the chests taken, by rarity */
  chests: Map<Rarity | 'unknown', number>
  /** the cells that held a chest that was not taken */
  chestsSkipped: number
  /** how many times a chest's rarity was raised */
  upgrades: number
  /** the trials fought, by arcana, the most often first */
  trials: [string, number][]
  contests: number
  /** the chests opened in the contests */
  opened: number
  /** the rewards of all the contests: the item and how many */
  rewards: Map<number, number>
  /** what the rewards are worth */
  value: Value
}

/** Adds it all up. */
export function totalsOf(history: History, price: (item: number) => number, taxed: boolean): Totals {
  const rewards = new Map<number, number>()
  let opened = 0
  for (const contest of history.contests) {
    opened += contest.chests.length
    for (const [item, qty] of rewardsOf(contest)) rewards.set(item, (rewards.get(item) ?? 0) + qty)
  }
  const arcana = new Map<string, number>()
  for (const trial of history.trials) arcana.set(trial.arcana, (arcana.get(trial.arcana) ?? 0) + 1)

  const sum = (pick: (s: Session) => number): number => history.sessions.reduce((a, s) => a + pick(s), 0)
  return {
    sessions: history.sessions.length,
    moves: sum((s) => s.moves.length),
    cells: sum((s) => s.cells),
    notes: sum((s) => s.notes),
    played: sum((s) => s.played),
    lifeLost: sum((s) => s.lifeLost),
    lifeWon: sum((s) => s.lifeWon),
    chests: chestsByRarity(history.sessions),
    chestsSkipped: sum((s) => s.chestsSkipped ?? 0),
    upgrades: sum((s) => s.chests.reduce((a, c) => a + c.upgrades, 0)),
    trials: [...arcana].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    contests: history.contests.length,
    opened,
    rewards,
    value: valueOfRewards(rewards, price, taxed),
  }
}

/* ---------- the rows ---------- */

/** A row of plain text. */
function line(text: string, style?: Tone): Row {
  return { cells: [{ text, tone: style }] }
}

/** A row built of pieces, each its own colour, with the row's own gap between them. */
function pieces(parts: readonly (readonly [string, Tone | undefined])[]): Row {
  return { cells: parts.map(([text, style]) => ({ text, tone: style, width: visibleLength(text) })) }
}

/** A line of pieces, cut to `inner` columns so it never runs past the panel it is drawn in. */
export function cutChunks(parts: readonly TextChunk[], inner: number): TextChunk[] {
  if (chunksWidth(parts) <= inner) return [...parts]
  const out: TextChunk[] = []
  let left = inner
  for (const part of parts) {
    if (left <= 0) break
    const width = visibleLength(part.text)
    if (width <= left) {
      out.push(part)
      left -= width
    } else {
      out.push({ ...part, text: clip(part.text, left) })
      left = 0
    }
  }
  return out
}

/** The chests as "Blue 4, Purple 2"; "none" when there are none. */
export function chestText(sessions: Session[]): string {
  const counts = chestsByRarity(sessions)
  const parts: string[] = []
  for (const r of RARITIES) {
    const n = counts.get(r) ?? 0
    if (n > 0) parts.push(`${RARITY_NAMES[r]} ${n}`)
  }
  const unknown = counts.get('unknown') ?? 0
  if (unknown > 0) parts.push(`unknown ${unknown}`)
  return parts.length === 0 ? 'none' : parts.join(', ')
}

/** What the log says about the Tarot Path, in words. */
export function pathText(tracker: Tracker, state: ViewState): { text: string; tone: Tone } {
  if (state.path === 'open') return { text: 'Tarot Path: open', tone: 'green' }
  if (state.path === 'closed') return { text: 'Tarot Path: closed', tone: 'dim' }
  return tracker.state.sessions.length > 0
    ? { text: 'Tarot Path: closed', tone: 'dim' }
    : { text: 'Tarot Path: not seen in the log yet', tone: 'dim' }
}

/** The pieces of the panel that says what is going on now, each line cut to the panel's width. */
export function nowChunks(tracker: Tracker, state: ViewState, inner: number): TextChunk[] {
  const chunks: TextChunk[] = []
  const line = (parts: readonly TextChunk[]): void => {
    if (chunks.length > 0) chunks.push(tone('default', '\n'))
    chunks.push(...cutChunks(parts, inner))
  }
  const session = tracker.current
  const contest = tracker.currentContest
  if (session !== null) {
    line([
      tone('blue', `Session #${session.id}`),
      tone('dim', '  open '),
      tone('teal', duration(tracker.at - session.openedAt)),
      tone('dim', '  since '),
      tone('teal', clock(session.openedAt)),
    ])
    line(effortChunks(session.moves.length, session.cells, session.played, session.notes, session.lifeLost, session.lifeWon))
    line([
      tone('dim', 'chests of destiny '),
      tone('purple', chestText([session])),
      tone('dim', '  ('),
      tone('orange', `${session.chests.length} taken`),
      ...(session.chestsSkipped > 0
        ? [tone('dim', ', '), tone('yellow', `${session.chestsSkipped} left behind`)]
        : []),
      tone('dim', ')'),
    ])
    // the carried bar the game shows holds seven chests
    line([
      tone('dim', 'carried '),
      ...meter(Math.min(1, session.chests.length / 7), Math.max(4, inner - 14), 'purple'),
      tone('dim', ` ${session.chests.length}/7`),
    ])
  } else if (state.path === 'open') {
    line([tone('yellow', 'The Tarot Path is open, but the tracker started after it opened:')])
    line([tone('yellow', 'what happens from now on is not counted until the next visit.')])
  } else {
    line([tone('dim', 'Open the Tarot Path in the game to start a session.')])
  }
  if (contest !== null) {
    const rewards = rewardsOf(contest)
    const value = valueOfRewards(rewards, (i) => tracker.prices.price(i), state.taxed)
    const fight = contest.openedAt === null ? 'asked' : `in the fight since ${clock(contest.openedAt)}`
    line([
      tone('orange', 'Fateful Contest'),
      tone('dim', `: ${fight}  chests `),
      tone('orange', String(contest.chests.length)),
      tone('dim', '  rewards '),
      tone('gold', fe(value.net)),
      tone('dim', ' ('),
      tone('purple', String(rewards.size)),
      tone('dim', ' kinds)'),
    ])
  }
  return chunks
}

/** The effort of one visit: the counts in orange, the notes purple, the life lost and won. */
function effortChunks(moves: number, cells: number, played: number, notes: number, lifeLost: number, lifeWon: number): TextChunk[] {
  return [
    ...stat('moves', String(moves), 'orange'),
    tone('dim', '   '),
    ...stat('cells', String(cells), 'orange'),
    tone('dim', '   '),
    ...stat('cards', String(played), 'orange'),
    tone('dim', '   '),
    ...stat('notes', String(notes), 'purple'),
    tone('dim', '   life '),
    tone('red', `-${lifeLost}`),
    tone('default', ' '),
    tone('green', `+${lifeWon}`),
  ]
}

/** The cells of one row of the history. */
function historyCells(entry: Entry, tracker: Tracker, state: ViewState): Cell[] {
  const { session, contest } = entry
  // the contest's chests are a count (orange) and its value is money (gold)
  const contestCells: Cell[] =
    contest === null
      ? [{ text: '-', tone: 'dim' }]
      : [
          { text: `${contest.chests.length} chests,`, tone: 'orange', width: visibleLength(`${contest.chests.length} chests,`) },
          { text: fe(valueOfRewards(rewardsOf(contest), (i) => tracker.prices.price(i), state.taxed).net), tone: 'gold' },
        ]
  if (session === null) {
    return [
      { text: '-', tone: 'dim', width: 4, align: 'right' },
      { text: stamp(entry.at), tone: 'teal', width: 11 },
      { text: '-', tone: 'dim', width: 8, align: 'right' },
      { text: '(the log began mid-contest)', tone: 'dim', width: 34 },
      ...contestCells,
    ]
  }
  const length = duration((session.closedAt ?? tracker.at) - session.openedAt)
  const chests = session.chestsSkipped > 0 ? `${session.chests.length}+${session.chestsSkipped}` : String(session.chests.length)
  return [
    { text: `#${session.id}`, tone: 'blue', width: 4, align: 'right' },
    { text: stamp(session.openedAt), tone: 'teal', width: 11 },
    { text: length, tone: 'teal', width: 8, align: 'right' },
    { text: `moves ${padStart(String(session.moves.length), 3)}`, tone: 'orange', width: 9 },
    { text: `notes ${padStart(String(session.notes), 3)}`, tone: 'orange', width: 9 },
    { text: pad(`chests ${padStart(chests, 3)}`, 10), tone: 'orange', width: 10 },
    { text: 'life', tone: 'dim', width: 5 },
    { text: `-${session.lifeLost}`, tone: 'red', width: 4, align: 'right' },
    { text: `+${session.lifeWon}`, tone: 'green', width: 4, align: 'right' },
    ...contestCells,
  ]
}

/** The rows of the history list, with the pointer's row picked out. */
export function historyRows(tracker: Tracker, state: ViewState): Row[] {
  const entries = entriesOf(tracker.state)
  if (entries.length === 0) {
    return [line('No visits to the Tarot Path in the log yet.', 'dim')]
  }
  const cursor = Math.min(state.cursor, entries.length - 1)
  return entries.map((entry, index) => ({
    selected: state.focus === 'history' && index === cursor,
    cells: historyCells(entry, tracker, state),
  }))
}

/** The rows of the lifetime totals. */
export function totalsRows(tracker: Tracker, state: ViewState, names: ItemNames): Row[] {
  const price = (i: number): number => tracker.prices.price(i)
  const t = totalsOf(tracker.state, price, state.taxed)
  const rows: Row[] = [
    pieces([
      ['visits', 'dim'],
      [String(t.sessions), 'orange'],
      ['moves', 'dim'],
      [num(t.moves), 'orange'],
      ['cells walked', 'dim'],
      [num(t.cells), 'orange'],
      ['cards played', 'dim'],
      [num(t.played), 'orange'],
      ['notes gained', 'dim'],
      [num(t.notes), 'purple'],
    ]),
    pieces([
      ['life lost', 'dim'],
      [String(t.lifeLost), 'red'],
      ['life won', 'dim'],
      [String(t.lifeWon), 'green'],
    ]),
    pieces([
      ['chests of destiny taken:', 'dim'],
      [chestText(tracker.state.sessions), 'purple'],
      [
        `(rarity raised ${t.upgrades} times${t.chestsSkipped > 0 ? `, ${t.chestsSkipped} left on the board` : ''})`,
        'dim',
      ],
    ]),
    pieces([
      ['trials fought', 'dim'],
      [String(tracker.state.trials.length), 'orange'],
      ...t.trials.map(([a, n]): readonly [string, Tone | undefined] => [`${arcanaName(a)} ${n}`, 'purple']),
    ]),
    pieces([
      ['Fateful Contests', 'dim'],
      [String(t.contests), 'orange'],
      ['chests opened', 'dim'],
      [String(t.opened), 'orange'],
    ]),
    pieces([
      ['rewards worth', 'dim'],
      [fe(t.value.net), 'gold'],
      ...(state.taxed
        ? ([
            ['after the', 'dim'],
            [`${num(t.value.tax)} FE trade tax`, 'dim'],
            ['(', 'dim'],
            [fe(t.value.gross), 'gold'],
            ['before)', 'dim'],
          ] as const)
        : ([['(no tax)', 'dim']] as const)),
    ]),
  ]
  const unpriced = [...t.rewards.keys()].filter((i) => price(i) <= 0).length
  if (unpriced > 0) {
    rows.push(
      line(`${unpriced} kinds of reward have no price yet: look them up on the exchange in the game to value them`, 'dim'),
    )
  }
  rows.push(line(''))
  rows.push(line('Rewards, by value', 'bold'))
  const sorted = [...t.rewards].sort((a, b) => price(b[0]) * b[1] - price(a[0]) * a[1] || b[1] - a[1])
  for (const [item, qty] of sorted) {
    const worth = price(item) * qty
    rows.push({
      cells: [
        { text: num(qty), tone: 'orange', width: 9, align: 'right' },
        { text: pad(names.name(item), 40), tone: 'blue', width: 40 },
        { text: worth > 0 ? fe(worth) : 'no price', tone: worth > 0 ? 'gold' : 'dim' },
      ],
    })
  }
  if (sorted.length === 0) rows.push(line('No Fateful Contest rewards in the log yet.', 'dim'))
  return rows
}

/** What a move did, in a few words. */
function moveText(move: Move): string {
  const parts: string[] = []
  if (move.played > 0) parts.push(`played ${move.played}`)
  if (move.cells > 0) parts.push(`walked ${move.cells} (${move.left}L/${move.right}R)`)
  if (move.landed !== null) {
    const what =
      move.landed.kind === 'chest'
        ? `chest ${move.landed.rarity === null ? '' : RARITY_NAMES[move.landed.rarity]}`.trim()
        : move.landed.kind
    parts.push(`on ${what}`)
  }
  if (move.gained > 0) parts.push(`+${move.gained} notes`)
  if (move.upgraded.length > 0) parts.push(`raised ${move.upgraded.length} chest${move.upgraded.length === 1 ? '' : 's'}`)
  if (move.life !== 0) parts.push(`life ${move.life > 0 ? '+' : ''}${move.life}`)
  if (move.shuffled) parts.push('shuffled')
  return parts.length === 0 ? move.steps.join(' > ') : parts.join(', ')
}

/** The rows of the detail of a contest. */
function contestRows(contest: Contest, tracker: Tracker, names: ItemNames, taxed: boolean): Row[] {
  const price = (i: number): number => tracker.prices.price(i)
  const rows: Row[] = [line('Fateful Contest', 'bold')]
  const when = (ms: number | null): string => (ms === null ? '-' : clock(ms))
  rows.push(
    pieces([
      ['asked', 'dim'],
      [when(contest.askedAt), 'teal'],
      ['page opened', 'dim'],
      [when(contest.openedAt), 'teal'],
      ['fight ended', 'dim'],
      [contest.closedAt === null ? 'not yet' : clock(contest.closedAt), contest.closedAt === null ? 'yellow' : 'teal'],
    ]),
  )
  const total = valueOfRewards(rewardsOf(contest), price, taxed)
  rows.push(
    pieces([
      [String(contest.chests.length), 'orange'],
      ['chests opened, worth', 'dim'],
      [fe(total.net), 'gold'],
      ...(taxed
        ? ([['after tax', 'dim'], ['(', 'dim'], [fe(total.gross), 'gold'], ['before)', 'dim']] as const)
        : ([] as const)),
    ]),
  )
  contest.chests.forEach((chest, index) => {
    const value = valueOfRewards(new Map(chest.rewards.map((r) => [r.item, r.qty])), price, taxed)
    rows.push(pieces([[`  chest ${index + 1}`, 'blue'], ['opened', 'dim'], [clock(chest.at), 'teal'], [fe(value.net), 'gold']]))
    if (chest.rewards.length === 0) rows.push(line('    the log shows nothing picked up', 'dim'))
    for (const reward of chest.rewards) {
      const worth = price(reward.item) * reward.qty
      rows.push({
        cells: [
          { text: `    ${padStart(num(reward.qty), 7)}`, tone: 'orange', width: 11 },
          { text: pad(names.name(reward.item), 38), tone: 'blue', width: 38 },
          { text: worth > 0 ? fe(worth) : 'no price', tone: worth > 0 ? 'gold' : 'dim' },
        ],
      })
    }
  })
  return rows
}

/** The rows of the detail of one history entry: all of it, for the caller to scroll. */
export function detailRows(entry: Entry, tracker: Tracker, names: ItemNames, taxed: boolean): Row[] {
  const rows: Row[] = []
  const { session, contest } = entry
  if (session !== null) {
    const length = duration((session.closedAt ?? tracker.at) - session.openedAt)
    rows.push(
      pieces([
        [`Session #${session.id}`, 'blue'],
        [stamp(session.openedAt), 'teal'],
        [session.closedAt === null ? 'still open' : `closed ${clock(session.closedAt)}`, session.closedAt === null ? 'green' : 'teal'],
        [`(${length})`, 'dim'],
      ]),
    )
    rows.push(
      pieces([
        ['moves', 'dim'],
        [String(session.moves.length), 'orange'],
        ['cells walked', 'dim'],
        [String(session.cells), 'orange'],
        ['cards played', 'dim'],
        [String(session.played), 'orange'],
        ['notes gained', 'dim'],
        [String(session.notes), 'purple'],
        ['life', 'dim'],
        [`-${session.lifeLost}`, 'red'],
        [`+${session.lifeWon}`, 'green'],
      ]),
    )
    rows.push(
      pieces([
        ['chests of destiny:', 'dim'],
        [chestText([session]), 'purple'],
        ...(session.chestsSkipped > 0
          ? ([[`(${session.chestsSkipped} left behind: a cell held a chest that was not taken)`, 'dim']] as const)
          : ([] as const)),
      ]),
    )
    for (const chest of session.chests) {
      rows.push(
        pieces([
          ['  ' + clock(chest.at), 'teal'],
          [chest.rarity === null ? 'unknown rarity' : RARITY_NAMES[chest.rarity], 'purple'],
          ...(chest.upgrades > 0 ? ([[`, raised ${chest.upgrades}x`, 'dim']] as const) : ([] as const)),
        ]),
      )
    }
  }
  // the contest comes before the moves: what its chests gave is the headline, and a long visit
  // would push it off the screen
  if (contest !== null) {
    if (rows.length > 0) rows.push(line(''))
    rows.push(...contestRows(contest, tracker, names, taxed))
  }
  if (session !== null) {
    if (rows.length > 0) rows.push(line(''))
    rows.push(line('Moves (what the log shows; the board itself is not in the log)', 'bold'))
    session.moves.forEach((move, index) => {
      rows.push({
        cells: [
          { text: padStart(String(index + 1), 3), tone: 'dim', width: 3, align: 'right' },
          { text: clock(move.at), tone: 'teal', width: 8 },
          { text: moveText(move) },
        ],
      })
    })
    if (session.moves.length === 0) rows.push(line('no moves were made', 'dim'))
  }
  return rows
}
