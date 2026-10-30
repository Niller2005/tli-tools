//! Where the player clicks for an advised move: the board cell, destination
//! card, button or pick card the move needs on the screen read, on the
//! reference frame and on the game's frame.

import { framePoint, type Layout } from './layout'
import type { Screen, Spot } from './panels'
import { portrait } from './scene'
import type { Action } from '@/engine/actions'

/** Target boxes in reference px, width by height: a cell portrait
 * (portraits at a 175 px pitch, scene.ts PORTRAIT), a destination or
 * Interrogation card (rec1-t049), an instrument card (y 187-870,
 * reroll-2000x837), a Warden's Treasure card (rec1-t085), a decision or
 * round Cancel button (rec1-t055 and rec1-t057) and the Re-roll button. */
const CELL: [number, number] = [130.0, 130.0]
const DOOR: [number, number] = [330.0, 170.0]
const PICK: [number, number] = [457.0, 683.0]
const TREASURE: [number, number] = [420.0, 665.0]
const BUTTON: [number, number] = [140.0, 140.0]
const REROLL: [number, number] = [270.0, 65.0]

/** A place to click: its centre on the reference frame, the layout it was
 * read from, and its half width and half height in reference px. */
export interface Click {
  at: [number, number]
  layout: Layout
  half: [number, number]
}

/** What the player clicks for `action` on `screen`, given the screen's
 * [`./panels::Panels.spots`]; null for a move with nothing to click
 * on that screen or whose card or button was not read. */
export function target(screen: Screen, spots: [Spot, Layout, [number, number]][], action: Action): Click | null {
  const half = (size: [number, number]): [number, number] => [size[0] / 2.0, size[1] / 2.0]
  const spot = (want: Spot, size: [number, number]): Click | null => {
    const found = spots.find((s) => sameSpot(s[0], want))
    return found === undefined ? null : { at: found[2], layout: found[1], half: half(size) }
  }
  // Actions name model cells; the screen numbers them from 1.
  const cell = (n: number): Click => ({ at: portrait(n + 1), layout: 'board', half: half(CELL) })
  const card = (key: string, size: [number, number]): Click | null => spot({ kind: 'card', card: key }, size)
  switch (screen) {
    case 'patrol':
      if (action.type === 'patrol') return spot({ kind: 'door', door: action.cell + 1 }, DOOR)
      return null
    case 'manage':
      if (action.type === 'devour') return spot({ kind: 'button', button: 'Consume' }, BUTTON)
      if (action.type === 'swap') return spot({ kind: 'button', button: 'Replace' }, BUTTON)
      if (action.type === 'hunt') return spot({ kind: 'button', button: 'Hunt' }, BUTTON)
      if (action.type === 'end') return spot({ kind: 'button', button: 'End' }, BUTTON)
      return null
    case 'chainTarget':
      if (action.type === 'devour' || action.type === 'chain') return cell(action.to)
      if (action.type === 'choose' && typeof action.id === 'number') return cell(action.id)
      if (action.type === 'endChain') return spot({ kind: 'button', button: 'Cancel' }, BUTTON)
      return null
    case 'cellPick':
      if (action.type === 'choose' && typeof action.id === 'number') return cell(action.id)
      return null
    case 'instrumentPick':
      if (action.type === 'choose' && typeof action.id === 'string') return card(action.id, PICK)
      if (action.type === 'reroll') return spot({ kind: 'button', button: 'Re-roll' }, REROLL)
      return null
    case 'treasurePick':
      if (action.type === 'choose' && typeof action.id === 'string') return card(action.id, TREASURE)
      return null
    case 'interrogation':
      if (action.type === 'choose' && typeof action.id === 'string') return card(action.id, DOOR)
      return null
    default:
      return null
  }
}

/** Whether two spots are the same one. */
function sameSpot(a: Spot, b: Spot): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'door' && b.kind === 'door') return a.door === b.door
  if (a.kind === 'button' && b.kind === 'button') return a.button === b.button
  if (a.kind === 'card' && b.kind === 'card') return a.card === b.card
  return false
}

/** Where `click` sits on a `w` x `h` frame at interface scale `u`: its
 * centre, half width and half height in frame px. */
export function toFrame(click: Click, w: number, h: number, u: number): [number, number, number, number] {
  const [[x, y], scale] = framePoint([click.at[0], click.at[1]], click.layout, w, h, u)
  return [x, y, click.half[0] * scale, click.half[1] * scale]
}
