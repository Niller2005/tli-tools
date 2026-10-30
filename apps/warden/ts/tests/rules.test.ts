//! The engine's own tests, ported from the Rust crate's src/engine modules.

import { expect, test } from 'bun:test'
import { apply } from '@/engine/actions'
import { RAINBOW, data } from '@/engine/data'
import { addMarker, beginDay, drawTools, makeInmate, newGame, newGameWith, rollDice, syncMarkers } from '@/engine/rules'
import { Params, type State } from '@/engine/state'
import { promote } from '@/engine/tools'

/** Rolls `mornings` seeded mornings and counts each pip, checking every roll is `count` distinct pips. */
function rollMany(s: State, mornings: number, count: number): number[] {
  const seen = [0, 0, 0, 0, 0, 0, 0]
  for (let i = 0; i < mornings; i++) {
    rollDice(s)
    const dice = [...s.dice].sort((a, b) => a - b).filter((p, i, all) => i === 0 || p !== all[i - 1])
    expect(dice.length).toBe(count)
    for (const p of dice) {
      expect(p).toBeGreaterThanOrEqual(1)
      expect(p).toBeLessThanOrEqual(6)
      seen[p] += 1
    }
  }
  return seen
}

test('dice are distinct and uniform', () => {
  const s = newGame('DISTINCT-DICE')
  s.params.fewerDoorsChance = 0
  s.tools = []
  const seen = rollMany(s, 6000, 3)
  // Each pip shows on half the mornings: 3000 expected, sd about 39.
  for (let pip = 1; pip <= 6; pip++) {
    expect(seen[pip]).toBeGreaterThanOrEqual(2800)
    expect(seen[pip]).toBeLessThanOrEqual(3200)
  }
  s.tools.push('whip')
  rollMany(s, 2000, 2)
})

test('loot counts the vault and the open board', () => {
  const s = newGame('LOOT')
  for (const c of s.cells) c.inmate = null
  s.vault = [0, 1].map((id) => ({ id: 1000 + id, beast: 'mammoth' as const, day: 1 }))
  const room = data().room
  const cells: number[] = []
  for (let n = 0; n < s.cells.length && cells.length < 3; n++) {
    if (n !== room) cells.push(n)
  }
  const setup: [number, boolean][] = [
    [RAINBOW - 1, false],
    [RAINBOW - 2, false],
    [RAINBOW - 1, true],
  ]
  cells.forEach((n, i) => {
    const [tier, sealed] = setup[i]
    const inmate = makeInmate(s, 'mammoth', tier)
    s.cells[n].sealed = sealed
    s.cells[n].inmate = inmate
  })
  expect(Math.abs(s.loot() - 2.25)).toBeLessThan(1e-9)
})

/** Promotes an Ultimate on a board whose vault already holds `vaulted` Chromatics. */
function promoteUltimate(vaulted: number): State {
  const s = newGame('VAULT-CAP')
  s.pending = []
  s.vault = Array.from({ length: vaulted }, (_, id) => ({ id: 1000 + id, beast: 'mammoth' as const, day: 1 }))
  s.cells[0].sealed = false
  const ultimate = makeInmate(s, 'mammoth', RAINBOW - 1)
  s.cells[0].inmate = ultimate
  promote(s, ultimate, 1, false)
  return s
}

test('a full vault stops inmates at ultimate', () => {
  const hasGift = (s: State): boolean => s.pending.some((p) => p.kind === 'gift')
  const full = promoteUltimate(10)
  expect(full.cells[0].inmate?.tier).toBe(RAINBOW - 1)
  expect(full.vault.length).toBe(10)
  expect(hasGift(full)).toBe(false)
  const room = promoteUltimate(9)
  expect(room.cells[0].inmate).toBe(null)
  expect(room.vault.length).toBe(10)
  expect(hasGift(room)).toBe(true)
})

test('new markers avoid the warden and mornings add none', () => {
  const markers = (s: State): number => s.cells.filter((c) => c.event !== null).length
  const room = data().room
  for (let seed = 0; seed < 300; seed++) {
    const s = newGame(`MARKERS-${seed}`)
    s.position = (room + 1 + (seed % (s.cells.length - 1))) % s.cells.length
    for (const c of s.cells) c.event = null
    syncMarkers(s)
    for (let i = 0; i < 3; i++) addMarker(s, null)
    expect(markers(s)).toBeGreaterThan(0)
    expect(s.cells[s.position].event).toBe(null)
    for (const c of s.cells) c.event = null
    syncMarkers(s)
    expect(markers(s)).toBe(1)
    beginDay(s)
    expect(markers(s)).toBe(1)
  }
})

function offer(s: State): { options: string[]; reason: string } {
  const first = s.pending[0]
  if (first === undefined || first.kind !== 'tool') throw new Error('no instrument pick')
  return { options: first.options, reason: first.reason }
}

test('reroll redraws the offer and spends one', () => {
  const s = newGameWith('REROLL', new Params())
  s.rerolls = 2
  for (const left of [1, 0]) {
    const before = offer(s)
    // The draw comes from a copy of the state, so it shares the reroll's stream.
    const expected = drawTools(s.clone(), before.options.length)
    expect(apply(s, { type: 'reroll' }).ok).toBe(true)
    expect(s.rerolls).toBe(left)
    expect(offer(s).options).toEqual(expected)
    expect(offer(s).reason).toBe(before.reason)
  }
  const atZero = offer(s)
  expect(apply(s, { type: 'reroll' }).ok).toBe(false)
  expect(offer(s)).toEqual(atZero)
})

test('reroll needs an instrument pick', () => {
  const s = newGameWith('REROLL', new Params())
  s.rerolls = 1
  s.pending = []
  expect(apply(s, { type: 'reroll' }).ok).toBe(false)
  expect(s.rerolls).toBe(1)
})
