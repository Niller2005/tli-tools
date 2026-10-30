//! Replays seeded runs recorded from the earlier JS engine through this engine and compares the
//! state after every move (tests/fixtures/traces.jsonl, 20 games).

import { expect, test } from 'bun:test'
import { actionFromJson, apply, newGameWith, type Action, type State } from '@/engine/mod'
import { firstDiff, followJsRepeat, noCap, normalize, traces } from './common'

function stateDiff(state: State, js: unknown): string | null {
  const rust = normalize(JSON.parse(JSON.stringify(state)))
  return firstDiff('state', rust, normalize(js))
}

test('replays js traces', () => {
  const games = traces()
  let full = 0
  let stepsMatched = 0
  let startsMatched = 0
  const mismatches: string[] = []
  for (const game of games) {
    const seed = game.seed
    let state = newGameWith(seed, noCap())
    state = followJsRepeat(state, game.start)
    const startDiff = stateDiff(state, game.start)
    if (startDiff !== null) {
      mismatches.push(`${seed} newGame: ${startDiff}`)
      continue
    }
    startsMatched += 1
    let complete = true
    for (let i = 0; i < game.steps.length; i++) {
      const step = game.steps[i]
      const action: Action = actionFromJson(step.action)
      const out = apply(state, action)
      if (out.ok !== step.ok) {
        mismatches.push(`${seed} step ${i} ${JSON.stringify(step.action)}: ok: rust ${out.ok} / js ${step.ok}`)
        complete = false
        break
      }
      state = followJsRepeat(state, step.state)
      const diff = stateDiff(state, step.state)
      if (diff !== null) {
        mismatches.push(`${seed} step ${i} ${JSON.stringify(step.action)}: ${diff}`)
        complete = false
        break
      }
      stepsMatched += 1
    }
    if (complete) full += 1
  }

  console.log(
    `games: ${games.length}, start states matched: ${startsMatched}, fully matched: ${full}, steps matched: ${stepsMatched}`,
  )
  console.log(`mismatches: ${mismatches.length}`)
  for (const m of mismatches.slice(0, 5)) console.log(`  ${m}`)
  expect(mismatches).toEqual([])
})
