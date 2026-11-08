import { describe, expect, test } from 'bun:test'
import type { Advice } from '@/strategy/advisor'
import { cardOf } from '../scripts/tui/card'
import type { Place } from '../scripts/tui/steps'
import { freshView, type ViewState } from '../scripts/tui/view'

/** A picture the way a 2560x1440 game window on the screen's right half gives it. */
const PLACE: Place = { width: 2560, height: 1440, crop: { top: 0, bottom: 0 }, hand: 3 }
const AREA = { x: 1000, y: 0, width: 1280, height: 720 }

function view(best: Advice['best'], phase: 'potion' | 'instrument' = 'potion'): ViewState {
  const v = freshView(925_000, false)
  v.board = {
    x: { tanks: [{ archetype: 'pest', rarity: 'normal', activity: 1000, quantity: 36 }, null, null, null, null, null], hand: ['A', 'B', 'C'], instruments: [], instrumentRounds: [], phase, round: 4, potionRefreshes: 2, instrumentRefreshes: 1 },
    round: 4, phase, warnings: [], place: PLACE,
  }
  v.quick = { best, ranking: [], board: 0, plan: false, final: true, ms: 0, unknown: [] }
  return v
}

describe('the outline of the advised move', () => {
  test('a card on a tank is outlined with the card, the tank and Confirm, on the screen the picture came from', () => {
    const marks = cardOf(view({ index: 1, targets: [0], value: 1 }), AREA)?.marks ?? []
    expect(marks).toHaveLength(3)
    // everything lies inside the part of the screen the picture was taken from
    for (const m of marks) {
      expect(m.x).toBeGreaterThanOrEqual(AREA.x)
      expect(m.y).toBeGreaterThanOrEqual(AREA.y)
      expect(m.x + m.width).toBeLessThanOrEqual(AREA.x + AREA.width)
      expect(m.y + m.height).toBeLessThanOrEqual(AREA.y + AREA.height)
    }
    // the tank is in the top half, the card and Confirm in the bottom half, Confirm under the card
    const [card, tank, confirm] = marks
    expect(tank.y).toBeLessThan(AREA.height / 2)
    expect(card.y).toBeGreaterThan(AREA.height / 2)
    expect(confirm.y).toBeGreaterThan(card.y + card.height)
  })

  test('a refresh is outlined by its button alone', () => {
    expect(cardOf(view('refresh'), AREA)?.marks).toHaveLength(1)
  })

  test('an instrument pick has no tank to outline', () => {
    expect(cardOf(view({ index: 2, targets: [0], value: 1 }, 'instrument'), AREA)?.marks).toHaveLength(2)
  })

  test('there is no outline without the screen position or a picture that still matches the screen', () => {
    const v = view({ index: 1, targets: [0], value: 1 })
    expect(cardOf(v, null)?.marks).toBeUndefined()
    v.board!.place = undefined
    expect(cardOf(v, AREA)?.marks).toBeUndefined()
  })
})
