// The screen: what the helper reads, the move to make, and how good it is. Plain ANSI, no dependencies.
import type { Advice, Ranked } from '@/strategy/advisor'
import type { HelperInput, InstrumentAdvice, Row } from '@/web/helper'

export interface Board {
  x: HelperInput
  round: number
  phase: 'potion' | 'instrument' | 'protocol'
  /** what the reader wasn't sure of, and other things to check on screen */
  warnings: string[]
}

export interface View {
  capture: string
  log: string
  logLines: number
  pictures: number
  status: string
  target: number
  deepOn: boolean
  board: Board | null
  quick: Advice | null
  ahead: Advice | null
  aheadPending: boolean
  table: InstrumentAdvice | null
  deep: { rows: Row[]; done: number; total: number; finished: boolean; error?: string } | null
}

export const TARGETS = [600_000, 700_000, 925_000, 1_120_000]

const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', green: '\x1b[32m', amber: '\x1b[33m', cyan: '\x1b[36m', red: '\x1b[31m' }
export const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1000)}k`)

const tanksOf = (t: number[]) => (t.length ? ` → tank ${t.map(i => i + 1).join(' + ')}` : '')
const cardMove = (x: HelperInput, r: { index: number; targets: number[] }) => `${x.hand[r.index] ?? '?'}${tanksOf(r.targets)}`
const instrumentMove = (x: HelperInput, i: number) => `Take ${x.hand[i] ?? '?'}`

/** The move to play, in words, and how sure the helper is of it. */
export function recommendation(v: View): { move: string; basis: string } | null {
  const b = v.board
  if (!b) return null
  const x = b.x
  const potion = b.phase === 'potion'
  const name = (r: Ranked | 'refresh' | null) => (r === 'refresh' ? 'Refresh the hand' : r ? (potion ? cardMove(x, r) : instrumentMove(x, r.index)) : potion ? 'Any card' : 'Take any instrument')
  const top = v.deep?.rows[0]
  if (top && v.deep!.finished && !top.out) {
    const move = top.refresh ? 'Refresh the hand' : potion ? cardMove(x, { index: top.index!, targets: top.targets }) : instrumentMove(x, top.index!)
    return { move, basis: `${Math.round(top.p * 100)}% to reach ${fmt(v.target)} · deep check, ${top.n} playouts` }
  }
  const a = v.ahead
  if (a) {
    const e = a.best === 'refresh' ? a.refreshEnd : a.best?.end
    return { move: a.allEven ? `${name(a.best)} (any is as good)` : name(a.best), basis: e ? `ends around ${short(e.activity)} · ${Math.round(e.reached * 100)}% of runs reach 950k · look-ahead` : a.note ?? 'look-ahead' }
  }
  if (b.phase === 'instrument' && v.table) {
    const t = v.table
    return { move: t.action === 'refresh' ? 'Refresh the offer' : instrumentMove(x, t.best ?? 0), basis: `${t.why} (sweep tables; looking ahead…)` }
  }
  const q = v.quick
  if (q) return { move: name(q.best), basis: q.note ?? 'best for this round alone; looking ahead…' }
  return null
}

export function render(v: View, columns: number): string[] {
  const out: string[] = []
  const line = (s = '') => out.push(s)
  const rule = () => line(C.dim + '─'.repeat(Math.max(10, columns - 1)) + C.reset)
  line(`${C.bold}Vorax Helper${C.reset} ${C.dim}· Linux terminal${C.reset}   target ${C.cyan}${fmt(v.target)}${C.reset}`)
  line(`${C.dim}game:${C.reset} ${v.capture}`)
  line(`${C.dim}log:${C.reset}  ${v.log}${v.logLines ? ` (${v.logLines} lines read)` : ''} ${C.dim}· ${v.pictures} pictures read${C.reset}`)
  rule()

  const b = v.board
  if (!b) {
    line(v.status ? `${C.amber}${v.status}${C.reset}` : 'Open Surgical Preparation in the game. The board is read after every move.')
  } else {
    const x = b.x
    line(`${C.bold}Round ${b.round}${C.reset} · ${b.phase === 'potion' ? 'potion' : b.phase === 'protocol' ? 'protocol' : 'instrument'} pick · refreshes: ${x.potionRefreshes ?? '?'} potion, ${x.instrumentRefreshes ?? '?'} instrument`)
    line()
    if (b.phase === 'protocol' || (b.phase === 'potion' && b.round > 10)) {
      line(`${C.amber}Protocol pick (rounds 11-13): it doesn't change your Ultimate Activity, so there is nothing to work out. Play it yourself.${C.reset}`)
    } else if (b.phase === 'instrument' && x.instruments.length >= 3) {
      line(`${C.amber}Already three instruments equipped: no pick needed.${C.reset}`)
    } else {
      const rec = recommendation(v)
      if (rec) {
        line(`${C.dim}NEXT MOVE${C.reset}`)
        line(`  ${C.bold}${C.green}${rec.move}${C.reset}`)
        line(`  ${C.dim}${rec.basis}${C.reset}`)
      }
      line()
      optionList(v, line)
      if (v.quick?.unknown.length) line(`${C.red}Unknown card: ${v.quick.unknown.join(', ')}${C.reset}`)
    }
    for (const w of b.warnings) line(`${C.amber}! ${w}${C.reset}`)
    line()
    line(`${C.dim}Board${C.reset}`)
    x.tanks.forEach((t, i) => line(`  ${i + 1}  ${t ? `${t.archetype} ${t.rarity}  ${fmt(t.activity)} × ${fmt(t.quantity)}` : `${C.dim}empty${C.reset}`}`))
    line(`  ${C.dim}hand:${C.reset} ${x.hand.join(' | ') || '-'}`)
    line(`  ${C.dim}instruments:${C.reset} ${x.instruments.join(' | ') || '-'}`)
  }
  line()
  rule()
  line(`${C.dim}r read now · t target · d deep check ${v.deepOn ? 'on' : 'off'} · q quit${C.reset}${v.status && b ? `   ${C.amber}${v.status}${C.reset}` : ''}`)
  return out
}

function optionList(v: View, line: (s?: string) => void) {
  const b = v.board!
  const x = b.x
  const potion = b.phase === 'potion'
  const label = (r: { index: number | null; targets: number[]; refresh?: boolean }) => (r.refresh ? 'Refresh the hand' : potion ? cardMove(x, { index: r.index!, targets: r.targets }) : (x.hand[r.index!] ?? '?'))
  const d = v.deep
  if (d?.rows.length) {
    line(`${C.dim}Chance to reach ${fmt(v.target)}${d.finished ? '' : ` · checking ${d.done}/${d.total}`}${C.reset}`)
    for (const r of d.rows.slice(0, 5)) line(`  ${r.out ? C.dim : ''}${String(Math.round(r.p * 100)).padStart(3)}%  ${label(r)}${r.out ? ' (ruled out)' : ''} ${C.dim}avg ${short(r.mean)}${C.reset}`)
    return
  }
  if (d?.error) line(`${C.red}deep check failed: ${d.error}${C.reset}`)
  const a = v.ahead
  if (a?.ranking.length) {
    line(`${C.dim}Played to the end of the run${C.reset}`)
    const rows = a.ranking.slice(0, 4).map(r => ({ text: label({ index: r.index, targets: r.targets }), end: r.end, noEffect: r.noEffect }))
    if (a.refreshEnd) rows.push({ text: 'Refresh the hand', end: a.refreshEnd, noEffect: undefined })
    rows.sort((p, q) => (q.end?.activity ?? 0) - (p.end?.activity ?? 0))
    for (const r of rows) line(`  ${r.end ? `${short(r.end.activity).padStart(6)}  ${String(Math.round(r.end.reached * 100)).padStart(3)}%` : '      -     '}  ${r.text}${r.noEffect ? ` ${C.dim}(does nothing here)${C.reset}` : ''}`)
    return
  }
  if (v.aheadPending) line(`${C.dim}Looking ahead to the end of the run…${C.reset}`)
  const q = v.quick
  if (q?.ranking.length && potion) {
    line(`${C.dim}This round only · expected Ultimate Activity after it${C.reset}`)
    for (const r of q.ranking.slice(0, 5)) line(`  ${short(r.value).padStart(6)}  ${cardMove(x, r)}`)
  } else if (v.table) {
    line(`${C.dim}Sweep tables${C.reset}`)
    for (const r of v.table.rows.slice().sort((p, q2) => (q2.value ?? 0) - (p.value ?? 0))) line(`  ${r.value === null ? '  -' : `${String(Math.round(r.value * 100)).padStart(3)}%`}  ${r.name}`)
  }
}
