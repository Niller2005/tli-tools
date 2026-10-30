//! Plays games 0 to 19 of seed 1 with the strategy alone, as the bench plays
//! them, and requires every decided action, the final vault and the run's
//! stats recorded in tests/fixtures/strategy-games.jsonl, so an accidental
//! change of the strategy fails. After a deliberate change, re-record the
//! fixture with `WARDEN_RECORD=1 cargo test --profile fast-test --test decide --test solve`
//! and review its diff; `WARDEN_RECORD=1 bun test tests/decide.test.ts` records
//! the same fixture from this port.

import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { buildBoard, recorded, strategyGame } from './common'
import { TUNED, context } from '@/solver/mod'
import { playStrategy } from '@/solver/bench'
import { swapDist } from '@/solver/chain'
import { swapGainHere } from '@/solver/scores'
import type { State, Stats } from '@/engine/state'

/** The recorded fixture of the strategy's games. */
const GAMES = 'strategy-games.jsonl'

/** One recorded game. */
interface RecordedGame {
  k: number
  actions: unknown[]
  vault: number
  stats: Stats
}

/** The value as compact JSON with its keys sorted, as serde_json prints it;
 * a missing value shows as "none". */
function canon(value: unknown): string {
  if (value === undefined) return 'none'
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canon(obj[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

test('decides as recorded', () => {
  const games: { k: number; actions: unknown[]; vault: number; stats: Stats }[] = []
  for (let k = 0; k < 20; k++) {
    const [actions, st] = strategyGame(k, () => {})
    // The test's game loop must stay the bench's.
    expect(playStrategy(1, k, [], 0, TUNED), `game ${k}`).toEqual({
      chromatics: st.vault.length,
      loot: st.loot(),
      stats: st.stats,
      objective: st.objective !== null && st.objective.done,
    })
    games.push({
      k,
      actions: actions.map((action): unknown => JSON.parse(JSON.stringify(action))),
      vault: st.vault.length,
      stats: st.stats,
    })
  }

  if (process.env.WARDEN_RECORD !== undefined) {
    const text = games.map((game) => `${canon(game)}\n`).join('')
    writeFileSync(new URL(`../../tests/fixtures/${GAMES}`, import.meta.url), text)
    console.log(`recorded ${games.length} lines to tests/fixtures/${GAMES}`)
    return
  }

  const want = recorded(GAMES) as RecordedGame[]
  const mismatches: string[] = []
  if (want.length !== games.length) {
    mismatches.push(`games: now ${games.length} / recorded ${want.length}`)
  }
  for (let i = 0; i < Math.min(games.length, want.length); i++) {
    const now = games[i]
    const was = want[i]
    const a = now.actions
    const b = was.actions
    let step = -1
    for (let j = 0; j < Math.max(a.length, b.length); j++) {
      if (canon(a[j]) !== canon(b[j])) {
        step = j
        break
      }
    }
    if (step >= 0) {
      mismatches.push(`game ${now.k} step ${step}: now ${canon(a[step])} / recorded ${canon(b[step])}`)
    } else if (canon(now.vault) !== canon(was.vault) || canon(now.stats) !== canon(was.stats)) {
      mismatches.push(
        `game ${now.k} end: now vault ${canon(now.vault)} ${canon(now.stats)} / recorded vault ${canon(was.vault)} ${canon(was.stats)}`,
      )
    }
  }

  console.log(`games: ${games.length}, mismatches: ${mismatches.length}`)
  for (const m of mismatches.slice(0, 10)) console.log(`  ${m}`)
  expect(mismatches, `${mismatches.length} games differ from ${GAMES}`).toEqual([])
})

test('axe doors count toward a swap', () => {
  // The warden stands on a Rare Lion with a Replace left and 7 sealed cells
  // (scratch cells and the nest count); with the Noose the new inmate is Rare
  // or rarer, and a rarer one opens min(2, sealed) of them.
  const [st, problems] = buildBoard('manage.json')
  expect(problems, `manage.json: ${problems.join('; ')}`).toEqual([])
  st.used.swap = 0
  const axeTerm = (state: State): number => {
    state.tools = ['rope']
    const rope = swapGainHere(context(state, TUNED))
    state.tools.push('axe')
    const ctx = context(state, TUNED)
    const rise = 1.0 - swapDist(ctx)[2]
    return (swapGainHere(ctx) - rope) / (rise * TUNED.wOpen * ctx.openValue)
  }
  expect(st.sealedCells().length).toBe(7)
  expect(Math.abs(axeTerm(st) - 2.0)).toBeLessThan(1e-9)
  for (const n of st.sealedCells().slice(1)) {
    st.cells[n].sealed = false
  }
  expect(Math.abs(axeTerm(st) - 1.0)).toBeLessThan(1e-9)
})
