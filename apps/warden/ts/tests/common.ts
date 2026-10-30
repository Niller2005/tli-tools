//! Helpers shared by the tests: the recorded JS traces, the fixture files and
//! the JSON comparison of the engine's and the JS's states.

import { readFileSync } from 'node:fs'
import { asArray, asNumber, asObject } from '@/engine/data'
import { Params, stateFromJson, type State } from '@/engine/state'

/** The recorded fixtures of apps/warden/tests/fixtures. */
const fixtures = new URL('../../tests/fixtures/', import.meta.url)

/** One recorded JS move. */
export interface TraceStep {
  action: unknown
  ok: boolean
  state: unknown
}

/** One recorded JS game. */
export interface TraceGame {
  seed: string
  start: unknown
  steps: TraceStep[]
}

/** The lines of the recorded fixture of that name. */
export function recorded(name: string): unknown[] {
  const text = readFileSync(new URL(name, fixtures), 'utf8')
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown)
}

/** The game traces recorded from the earlier JS engine
 * (seeds TRACE-0001 to TRACE-0020), one JSON value per game, from
 * tests/fixtures/traces.jsonl. */
export function traces(): TraceGame[] {
  return recorded('traces.jsonl') as TraceGame[]
}

/** Params for replaying a JS trace: the JS engine had no vault cap, spawned
 * markers each morning at 117 in 10000 per free cell, and let a new marker
 * land on the warden's cell. */
export function noCap(): Params {
  return new Params({ vaultCap: null, incidentSpawnChance: 117, markersAvoidWarden: false })
}

/** Continues a replay from the traced JS state `js` where the JS rolled a repeated step and the
 * engine rolled other dice. The JS engine rolled independent dice; this engine draws
 * distinct steps, as the game does (docs/s16-screen.md). The dice check skips the later steps of
 * a day already copied. */
export function followJsRepeat(state: State, js: unknown): State {
  const dice = asArray(asObject(js, 'state')['dice'], 'dice').map((d) => asNumber(d))
  const distinct = [...dice].sort((a, b) => a - b).filter((d, i, all) => i === 0 || d !== all[i - 1])
  const same = state.dice.length === dice.length && state.dice.every((d, i) => d === dice[i])
  if (distinct.length < dice.length && !same) return stateFromJson(js)
  return state
}

/** JS numbers are all doubles: compare every number as f64. */
export function normalize(value: unknown): unknown {
  if (typeof value === 'number') return Number(value)
  if (Array.isArray(value)) return value.map(normalize)
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) out[key] = normalize(v)
    return out
  }
  return value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  }
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a)
    if (keys.length !== Object.keys(b).length) return false
    return keys.every((key) => key in b && deepEqual(a[key], b[key]))
  }
  return false
}

function show(value: unknown): string {
  return value === undefined ? 'None' : JSON.stringify(value)
}

/** The first JSON path where `a` (the engine) and `b` (JS) differ, with both values. */
export function firstDiff(path: string, a: unknown, b: unknown): string | null {
  if (isObject(a) && isObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
    for (const key of keys) {
      if (key in a && key in b) {
        const diff = firstDiff(`${path}.${key}`, a[key], b[key])
        if (diff !== null) return diff
      } else {
        return `${path}.${key}: rust ${show(a[key])} / js ${show(b[key])}`
      }
    }
    return null
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    for (let i = 0; i < a.length; i++) {
      const diff = firstDiff(`${path}[${i}]`, a[i], b[i])
      if (diff !== null) return diff
    }
    return null
  }
  if (deepEqual(a, b)) return null
  return `${path}: rust ${show(a)} / js ${show(b)}`
}
