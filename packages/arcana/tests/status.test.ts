import { describe, expect, test } from 'bun:test'
import { arcanaStatus, emptyHistory, type Chest, type Contest, type History, type Session } from '../src/index'

/** A chest of destiny, as the tracker keeps it. */
const chest = (at: number, rarity: Chest['rarity'] = 'Blue'): Chest => ({ slot: 1, rarity, at, upgrades: 0 })

/** A visit to the Tarot Path, as the tracker keeps it. */
const visit = (over: Partial<Session> & Pick<Session, 'id' | 'openedAt'>): Session => ({
  closedAt: null,
  cells: 2,
  moves: [],
  chests: [],
  chestsSkipped: 0,
  notes: 0,
  played: 0,
  lifeLost: 0,
  lifeWon: 0,
  ...over,
})

/** A Fateful Contest that opened one chest. */
const contestWith = (chests: number, at: number): Contest => ({
  askedAt: null,
  openedAt: at,
  closedAt: at + 60_000,
  chests: Array.from({ length: chests }, (_, i) => ({ at: at + i * 1000, rewards: [] })),
})

describe('arcanaStatus', () => {
  test('a log that never showed a visit leaves the tool with nothing to say', () => {
    expect(arcanaStatus(emptyHistory())).toEqual({ id: 'arcana', line: '', tone: 'dim', at: 0 })
  })

  test('a visit that is going on is open, with its life and its chests', () => {
    const history: History = {
      sessions: [
        visit({
          id: 1,
          openedAt: 1000,
          chests: [chest(2000), chest(3000), chest(4000)],
          lifeLost: 2,
          lifeWon: 1,
        }),
      ],
      contests: [contestWith(1, 5000)],
      trials: [{ at: 600, arcana: 'TheSun' }],
      nextId: 2,
    }
    const status = arcanaStatus(history)
    expect(status.id).toBe('arcana')
    expect(status.tone).toBe('ok')
    expect(status.line).toBe('Tarot Path open · life -2 +1 · 2 chests held · 1 trials')
  })

  test('a visit that ended is closed, and quieter for it', () => {
    const history: History = {
      sessions: [visit({ id: 1, openedAt: 1000, closedAt: 9000, chests: [chest(2000)] })],
      contests: [],
      trials: [{ at: 700, arcana: 'TheHermit' }, { at: 800, arcana: 'TheHermit' }],
      nextId: 2,
    }
    const status = arcanaStatus(history)
    expect(status.tone).toBe('dim')
    expect(status.line).toBe('Tarot Path closed · 1 chests held · 2 trials')
    expect(status.at).toBe(9000)
  })

  test('the chests a contest opened more than were taken are not owed back', () => {
    const history: History = {
      sessions: [visit({ id: 1, openedAt: 1000, closedAt: 9000 })],
      contests: [contestWith(3, 5000)],
      trials: [],
      nextId: 2,
    }
    expect(arcanaStatus(history).line).toContain('0 chests held')
  })

  test('the time is that of the last thing that changed', () => {
    const history: History = {
      sessions: [visit({ id: 1, openedAt: 1000, closedAt: 9000 })],
      contests: [],
      trials: [{ at: 12_000, arcana: 'TheChariot' }],
      nextId: 2,
    }
    expect(arcanaStatus(history).at).toBe(12_000)
  })
})
