import { describe, expect, test } from 'bun:test'
import { Tracker } from '../src/engine'
import { parseLine } from '../src/parse'
import { XpMeter, expToNext } from '../src/xp'
import { BACK_TO_HIDEOUT, ENTER_MAP, EXP_LEVEL_UP, EXP_MOVES, IN_HIDEOUT, LOGIN } from './fixtures'

describe('the experience bar', () => {
  test('a line of the log says the experience in the level and the level', () => {
    expect(parseLine(EXP_MOVES[0] as string)).toMatchObject({ t: 'exp', exp: 6257480, level: 94 })
  })

  test('the first move only says where the bar is; the moves after it are gains', () => {
    const meter = new XpMeter()
    expect(meter.update(94, 6257480)).toBe(0)
    expect(meter.update(94, 6308774)).toBe(51294)
    expect(meter.update(94, 6432736)).toBe(123962)
  })

  test('crossing a level adds what was left of the old level to what is in the new one', () => {
    const meter = new XpMeter()
    meter.update(94, 175072587)
    const gained = meter.update(95, 46928)
    expect(gained).toBe(expToNext(94) - 175072587 + 46928)
    expect(meter.now).toEqual({ level: 95, exp: 46928 })
  })

  test('dying takes experience away, and a bar that goes back is not a gain', () => {
    const meter = new XpMeter()
    meter.update(94, 1000)
    expect(meter.update(94, 400)).toBe(0)
    // and the gains after it count from where it fell to
    expect(meter.update(94, 450)).toBe(50)
  })

  test('a jump of more than one level is not trusted', () => {
    const meter = new XpMeter()
    meter.update(90, 10)
    expect(meter.update(93, 10)).toBe(0)
  })

  test('how far through the level the bar is', () => {
    const meter = new XpMeter()
    expect(meter.progress).toBeNull()
    meter.update(94, expToNext(94) / 2)
    expect(meter.progress).toBeCloseTo(0.5, 5)
    meter.update(200, 1)
    expect(meter.progress).toBeNull()
  })
})

describe('the experience in the tracker', () => {
  test('what is gained in a map is the map\'s, and it comes to an hourly rate and the time to the next level', () => {
    const t = new Tracker()
    t.feed(IN_HIDEOUT)
    t.feed(ENTER_MAP)
    t.feed(EXP_MOVES)
    expect(t.currentRun?.xp).toBe(51294 + 123962)
    t.feed(BACK_TO_HIDEOUT)
    expect(t.runs[0]?.xp).toBe(51294 + 123962)

    const hour = 3_600_000
    const stats = t.stats(Date.parse('2026-10-29T21:28:06.033Z') + 58_312)
    expect(stats.xp).toBe(51294 + 123962)
    expect(stats.level).toBe(94)
    expect(stats.xpPerHour).toBeCloseTo(((51294 + 123962) * hour) / 58_312, 3)
    const left = expToNext(94) - 6432736
    expect(stats.levelEta).toBeCloseTo((left / stats.xpPerHour) * hour, 3)
  })

  test('experience gained outside a map is no run\'s', () => {
    const t = new Tracker()
    t.feed(IN_HIDEOUT)
    t.feed(EXP_MOVES)
    expect(t.stats().xp).toBe(0)
    expect(t.stats().level).toBe(94)
  })

  test('logging in starts the bar over, so a gap in the log is not counted as a gain', () => {
    const t = new Tracker()
    t.feed(IN_HIDEOUT)
    t.feed(ENTER_MAP)
    t.feed([EXP_MOVES[0] as string])
    t.feed(LOGIN)
    t.feed([EXP_MOVES[2] as string])
    expect(t.currentRun?.xp).toBe(0)
  })

  test('a level-up inside a map is counted whole', () => {
    const t = new Tracker()
    t.feed(IN_HIDEOUT)
    t.feed(ENTER_MAP)
    t.feed(EXP_LEVEL_UP)
    expect(t.currentRun?.xp).toBe(expToNext(94) - 175072587 + 46928)
  })
})
