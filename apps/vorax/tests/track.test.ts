import { describe, expect, test } from 'bun:test'
import { confirmPick, newTracker, trackInstruments, type InstrumentTracker } from '@/reader/track'
import type { FieldRead, Reading } from '@/reader/types'
import type { ScreenState } from '@/strategy/advisor'

interface Look {
  phase?: ScreenState['phase']
  round?: number
  hand?: string[]
  instruments?: string[]
  ranks?: [string, number][][]
  fields?: Record<string, FieldRead>
  roundSure?: boolean
}

/** What the reader makes of one picture. */
function reading(l: Look): Reading {
  const fields: Record<string, FieldRead> = { ...(l.fields ?? {}) }
  if (l.roundSure) fields.round = { sure: true }
  return {
    state: {
      tanks: [null, null, null, null, null, null],
      hand: l.hand ?? [],
      instruments: l.instruments ?? [],
      phase: l.phase ?? 'potion',
      round: l.round,
    },
    fields,
    problems: [],
    instrumentRanks: l.ranks,
  }
}

const OFFER = ['Alpha', 'Beta', 'Gamma']
/** The first instrument offer of a game, with an empty panel. */
const firstOffer = (): Look => ({ phase: 'instrument', round: 1, hand: OFFER, instruments: [] })
/** The board after the first pick: one icon in the panel, matching `scores` against the offer. */
const afterPick = (scores: number[]): Look => ({ phase: 'potion', round: 1, instruments: ['icon'], ranks: [OFFER.map((n, i) => [n, scores[i]] as [string, number])] })

function begin(): InstrumentTracker {
  return trackInstruments(newTracker(), reading(firstOffer())).tracker
}

describe('trackInstruments: a new game', () => {
  test('the first offer is remembered and nothing is owned yet', () => {
    const r = trackInstruments(newTracker(), reading(firstOffer()))
    expect(r.instruments).toEqual([])
    expect(r.tracker.offer).toEqual(OFFER)
    expect(r.ask).toBeUndefined()
  })

  test('a starting item in the panel beside the first offer is not a pick', () => {
    const r = trackInstruments(newTracker(), reading({ ...firstOffer(), instruments: ['Flask'] }))
    expect(r.instruments).toEqual([])
    expect(r.tracker.start).toBe(1)
  })

  test('a screen trigger forgets the last game', () => {
    const old: InstrumentTracker = { ...newTracker(), owned: ['Alpha', 'Beta'], maxRound: 9, rounds: [1, 4], fromPanel: [null, null] }
    const r = trackInstruments(old, reading({ phase: 'potion', round: 3, instruments: [] }), 'screen')
    expect(r.instruments).toEqual([])
    expect(r.rounds).toEqual([])
    expect(r.tracker.maxRound).toBe(0)
  })

  test('a clearly read round 1 after a later round is a new game', () => {
    const old: InstrumentTracker = { ...newTracker(), owned: ['Alpha'], maxRound: 5, rounds: [1], fromPanel: [null] }
    const r = trackInstruments(old, reading({ phase: 'potion', round: 1, roundSure: true, instruments: [] }))
    expect(r.instruments).toEqual([])
    expect(r.tracker.maxRound).toBe(1)
  })

  test('the same round 1 read without certainty is not', () => {
    const old: InstrumentTracker = { ...newTracker(), owned: ['Alpha'], maxRound: 5, rounds: [1], fromPanel: [null] }
    const r = trackInstruments(old, reading({ phase: 'potion', round: 1, instruments: ['icon'] }))
    expect(r.instruments).toEqual(['Alpha'])
  })

  test('round 1 after a game that never got past round 1 is not a new game', () => {
    const old: InstrumentTracker = { ...newTracker(), owned: ['Alpha'], maxRound: 1, rounds: [1], fromPanel: [null] }
    const r = trackInstruments(old, reading({ phase: 'potion', round: 1, roundSure: true, instruments: ['icon'] }))
    expect(r.instruments).toEqual(['Alpha'])
  })

  test('the highest round read clearly is kept, and only clear rounds raise it', () => {
    let t = newTracker()
    t = trackInstruments(t, reading({ phase: 'potion', round: 4, roundSure: true })).tracker
    expect(t.maxRound).toBe(4)
    t = trackInstruments(t, reading({ phase: 'potion', round: 7 })).tracker
    expect(t.maxRound).toBe(4)
    t = trackInstruments(t, reading({ phase: 'potion', round: 2, roundSure: true })).tracker
    expect(t.maxRound).toBe(4)
  })
})

describe('trackInstruments: picks', () => {
  test('a new icon is the offered instrument it matches best, taken in round 1 for the first pick', () => {
    const r = trackInstruments(begin(), reading(afterPick([0.2, 0.9, 0.1])))
    expect(r.instruments).toEqual(['Beta'])
    expect(r.rounds).toEqual([1])
    expect(r.fields.instrument0).toMatchObject({ sure: true, guess: 'Beta' })
    expect(r.tracker.offer).toBeNull()
    expect(r.tracker.unsure).toEqual([])
    expect(r.ask).toBeUndefined()
  })

  test('a match that is high but too close to the next is not sure', () => {
    const r = trackInstruments(begin(), reading(afterPick([0.8, 0.75, 0.1])))
    expect(r.instruments).toEqual(['Alpha'])
    expect(r.fields.instrument0.sure).toBe(false)
    expect(r.tracker.unsure).toEqual([{ offer: OFFER, slot: 0, looks: 0 }])
  })

  test('a match below the sure score is not sure however far ahead', () => {
    const r = trackInstruments(begin(), reading(afterPick([0.65, 0.1, 0.1])))
    expect(r.fields.instrument0.sure).toBe(false)
  })

  test('exactly the sure score, with a clear lead, is sure', () => {
    const r = trackInstruments(begin(), reading(afterPick([0.7, 0.5, 0.1])))
    expect(r.fields.instrument0.sure).toBe(true)
  })

  test('an icon matching nothing known is taken to be an offered instrument it has no picture of', () => {
    const t = begin()
    const r = trackInstruments(t, reading({ phase: 'potion', round: 1, instruments: ['icon'], ranks: [[['Alpha', 0.2], ['Beta', 0.1]]] }))
    // Gamma has no picture in the ranks: it is the best guess, shown as unsure
    expect(r.instruments).toEqual(['Gamma'])
    expect(r.fields.instrument0.sure).toBe(false)
  })

  test('the player is asked about an unsure pick on the second board, not the first', () => {
    const first = trackInstruments(begin(), reading(afterPick([0.5, 0.45, 0.1])))
    expect(first.ask).toBeUndefined()
    const second = trackInstruments(first.tracker, reading({ ...afterPick([0.5, 0.45, 0.1]), round: 2 }))
    expect(second.ask).toEqual({ offer: OFFER, slot: 0 })
    expect(second.instruments).toEqual(['Alpha'])
  })

  test('a later board that matches the pick clearly settles it, and nothing is asked', () => {
    const first = trackInstruments(begin(), reading(afterPick([0.5, 0.45, 0.1])))
    const second = trackInstruments(first.tracker, reading({ ...afterPick([0.2, 0.9, 0.1]), round: 2 }))
    expect(second.settled).toEqual([0])
    expect(second.instruments).toEqual(['Beta'])
    expect(second.ask).toBeUndefined()
    expect(second.tracker.unsure).toEqual([])
  })

  test('the player\'s answer replaces the pick, ends the question and marks it as known', () => {
    const first = trackInstruments(begin(), reading(afterPick([0.5, 0.45, 0.1])))
    const said = confirmPick(first.tracker, 0, 'Gamma')
    expect(said.owned).toEqual(['Gamma'])
    expect(said.unsure).toEqual([])
    expect(said.fromPanel).toEqual([null])
    expect(said).not.toBe(first.tracker)
    expect(first.tracker.owned).toEqual(['Alpha'])
    const next = trackInstruments(said, reading({ ...afterPick([0.5, 0.45, 0.1]), round: 2 }))
    expect(next.ask).toBeUndefined()
    expect(next.instruments).toEqual(['Gamma'])
    expect(next.fields.instrument0.sure).toBe(true)
  })

  test('confirming one slot leaves the questions about the others', () => {
    const t: InstrumentTracker = {
      ...newTracker(),
      owned: ['A', 'B'],
      unsure: [{ offer: ['A'], slot: 0, looks: 0 }, { offer: ['B'], slot: 1, looks: 0 }],
      fromPanel: [null, null],
    }
    expect(confirmPick(t, 1, 'C').unsure.map((q) => q.slot)).toEqual([0])
  })

  test('a second pick shown on the potion board is of that round; one beside the next offer is of the round after', () => {
    const t: InstrumentTracker = { ...newTracker(), owned: ['Alpha'], offer: ['Delta', 'Eps', 'Zeta'], rounds: [1], fromPanel: [null] }
    const ranks: [string, number][][] = [[['Alpha', 1]], [['Delta', 0.9], ['Eps', 0.1], ['Zeta', 0.1]]]
    const potion = trackInstruments(t, reading({ phase: 'potion', round: 3, instruments: ['a', 'd'], ranks }))
    expect(potion.instruments).toEqual(['Alpha', 'Delta'])
    expect(potion.rounds).toEqual([1, 3])
    const offerNext = trackInstruments(t, reading({ phase: 'instrument', round: 3, hand: ['G', 'H', 'I'], instruments: ['a', 'd'], ranks }))
    expect(offerNext.rounds).toEqual([1, 4])
    expect(offerNext.tracker.offer).toEqual(['G', 'H', 'I'])
  })

  test('a pick whose round is not known is round 0', () => {
    const t: InstrumentTracker = { ...newTracker(), owned: ['Alpha'], offer: OFFER, rounds: [1], fromPanel: [null] }
    const ranks: [string, number][][] = [[['Alpha', 1]], [['Beta', 0.9], ['Alpha', 0.1]]]
    const r = trackInstruments(t, reading({ phase: 'potion', instruments: ['a', 'b'], ranks }))
    expect(r.rounds).toEqual([1, 0])
  })

  test('the offer is kept as the new offer while the same one is shown', () => {
    const next = trackInstruments(begin(), reading(firstOffer())).tracker
    expect(next.offer).toEqual(OFFER)
  })

  test('boards with no change keep the instruments', () => {
    const picked = trackInstruments(begin(), reading(afterPick([0.2, 0.9, 0.1]))).tracker
    const again = trackInstruments(picked, reading({ phase: 'potion', round: 2, instruments: ['icon'], ranks: [[['Alpha', 0.1]]] }))
    expect(again.instruments).toEqual(['Beta'])
    expect(again.rounds).toEqual([1])
  })
})

describe('trackInstruments: a game joined late', () => {
  test('the panel is taken as read when nothing was seen before', () => {
    const r = trackInstruments(newTracker(), reading({ phase: 'potion', round: 4, instruments: ['P', 'Q'], fields: { instrument0: { sure: true }, instrument1: { sure: false } } }))
    expect(r.instruments).toEqual(['P', 'Q'])
    expect(r.rounds).toEqual([0, 0])
    expect(r.tracker.fromPanel).toEqual([true, false])
    expect(r.fields.instrument1.sure).toBe(false)
  })

  test('a fourth icon is a starting item, so at most three are instruments', () => {
    const r = trackInstruments(newTracker(), reading({ phase: 'potion', round: 5, instruments: ['S', 'A', 'B', 'C'] }))
    expect(r.instruments).toEqual(['A', 'B', 'C'])
    expect(r.tracker.start).toBe(1)
  })

  test('an offer beside three owned is a count gone wrong: only the clear icons stay, at most two', () => {
    const fields = { instrument0: { sure: true }, instrument1: { sure: false }, instrument2: { sure: true } } as Record<string, FieldRead>
    const r = trackInstruments(newTracker(), reading({ phase: 'instrument', round: 5, hand: OFFER, instruments: ['P', 'Q', 'R'], fields }))
    expect(r.instruments).toEqual(['P', 'R'])
    expect(r.tracker.fromPanel).toEqual([false, false])
    expect(Object.values(r.fields).every((f) => !f.sure)).toBe(true)
  })

  test('three owned beside an offer after round 10 is left alone', () => {
    const r = trackInstruments(newTracker(), reading({ phase: 'instrument', round: 11, hand: OFFER, instruments: ['P', 'Q', 'R'] }))
    expect(r.instruments).toEqual(['P', 'Q', 'R'])
  })

  test('a panel read from icons keeps its name against one odd picture and gives it up to steady evidence', () => {
    const t: InstrumentTracker = { ...newTracker(), owned: ['X'], rounds: [0], fromPanel: [false], votes: [{ X: 1 }] }
    const look = (): Reading => reading({ phase: 'potion', round: 2, instruments: ['Y'], fields: { instrument0: { sure: true, score: 1 } } })
    const once = trackInstruments(t, look())
    expect(once.instruments).toEqual(['X'])
    const twice = trackInstruments(once.tracker, look())
    expect(twice.instruments).toEqual(['Y'])
    expect(twice.tracker.fromPanel).toEqual([true])
  })

  test('the icons\' votes do not change a pick the player confirmed', () => {
    const t: InstrumentTracker = { ...newTracker(), owned: ['X'], rounds: [1], fromPanel: [null], votes: [{}] }
    let tracker = t
    for (let i = 0; i < 4; i++) {
      tracker = trackInstruments(tracker, reading({ phase: 'potion', round: 2, instruments: ['Y'], fields: { instrument0: { sure: true, score: 1 } } })).tracker
    }
    expect(tracker.owned).toEqual(['X'])
  })
})

describe('trackInstruments: state in and out', () => {
  test('the tracker given is not changed', () => {
    const t = begin()
    const before = structuredClone(t)
    trackInstruments(t, reading(afterPick([0.5, 0.45, 0.1])))
    expect(t).toEqual(before)
  })

  test('rounds, flags and votes stay as long as the owned list', () => {
    const r = trackInstruments(newTracker(), reading({ phase: 'potion', round: 4, instruments: ['P', 'Q'] }))
    expect(r.tracker.rounds).toHaveLength(2)
    expect(r.tracker.fromPanel).toHaveLength(2)
    expect(r.tracker.votes).toHaveLength(2)
    expect(r.tracker.owned).toEqual(r.instruments)
  })
})
