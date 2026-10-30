//! The Interrogation Room cards and the Warden's Treasure rewards
//! (js/engine.js interrogationRoomStop and interrogate 1094-1131, applyGift 1729-1765).

import { BEAST_KEYS, CARD_KEYS, RAINBOW, TYRANNY, data, type Card, type Gift } from './data'
import { bites, canEat, doDevour, eaterMask } from './devour'
import { pickOne, shuffle } from './rng'
import { addMarker, checkPrey, openCell } from './rules'
import type { Pending, State } from './state'
import { boardInmates, promote } from './tools'

/** A stop in the Interrogation Room offers Instigate or Bestow. Tyranny runs
 * both cards its stated number of extra times first. */
export function interrogationRoomStop(s: State): void {
  const extra = s.theme === TYRANNY ? (data().theme(TYRANNY)?.value ?? 0) : 0
  for (let i = 0; i < extra; i++) {
    interrogate(s, 'instigate')
    interrogate(s, 'bestow')
  }
  const pending: Pending = { kind: 'interrogation', options: [...CARD_KEYS] }
  s.pending.push(pending)
}

/** Instigate: a drawn incident marker goes on a fitting free cell. Bestow: a
 * random inmate on the block below Chromatic rises a tier. */
export function interrogate(s: State, card: Card): void {
  if (card === 'instigate') {
    addMarker(s, null)
    return
  }
  const board = boardInmates(s).filter((i) => i.tier < RAINBOW)
  if (board.length === 0) return
  const lucky = board[pickOne(s, board.length)]
  promote(s, lucky, 1, false)
}

/** No target for inmate `id`, read from an `eater_mask` of the board. */
function hungry(s: State, eaters: number, id: number): boolean {
  const n = s.cellOf(id)
  return n === null || (eaters & (1 << n)) === 0
}

/** The Warden's Treasure reward. */
export function applyGift(s: State, gift: Gift): void {
  switch (gift) {
    // Three random doors open with no other effect.
    case 'ring': {
      const doors = s.sealedCells()
      shuffle(s, doors)
      if (doors.length > 3) doors.length = 3
      for (const n of doors) openCell(s, n, 'side', null)
      break
    }
    // Every inmate with a target consumes a random open one.
    case 'horn': {
      const mask = eaterMask(s)
      const eaters = boardInmates(s)
        .filter((i) => !hungry(s, mask, i.id))
        .map((i) => i.id)
      for (const id of eaters) {
        const n = s.boardCellOf(id)
        if (n === null) continue
        const options = bites(s, n).filter((o) => !o.scratch)
        if (options.length === 0) continue
        const option = options[pickOne(s, options.length)]
        doDevour(s, n, option, false)
      }
      break
    }
    // Everyone below Epic rises a tier.
    case 'wine': {
      const low = boardInmates(s).filter((i) => i.tier < 3)
      for (const inmate of low) {
        if (s.boardCellOf(inmate.id) !== null) promote(s, inmate, 1, false)
      }
      break
    }
    // Up to four inmates without a target become a beast that has one.
    case 'brand': {
      const mask = eaterMask(s)
      const picks = boardInmates(s)
        .filter((i) => hungry(s, mask, i.id))
        .map((i) => i.id)
      shuffle(s, picks)
      if (picks.length > 4) picks.length = 4
      for (const id of picks) {
        const n = s.boardCellOf(id)
        if (n === null) continue
        const me = s.cells[n].inmate
        if (me === null) continue
        if (bites(s, n).length > 0) continue
        const board = boardInmates(s)
        const possible = BEAST_KEYS.filter((beast) => board.some((other) => canEat(s, { ...me, beast }, other)))
        if (possible.length > 0) {
          const beast = possible[pickOne(s, possible.length)]
          s.cells[n].inmate = { ...me, beast }
        }
      }
      checkPrey(s)
      break
    }
  }
}
