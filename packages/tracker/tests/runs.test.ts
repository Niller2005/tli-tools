import { describe, expect, test } from 'bun:test'
import { RunSegmenter } from '../src/runs'
import { zoneName } from '../src/zones'

const AT = Date.UTC(2026, 9, 29, 21, 28, 6, 33)
const LATER = Date.UTC(2026, 9, 29, 21, 29, 4, 345)
const BOARD = Date.UTC(2026, 9, 31, 2, 57, 37, 312)
const PRISON = Date.UTC(2026, 9, 31, 3, 10, 6, 155)
const OUT = Date.UTC(2026, 9, 31, 3, 28, 23, 262)

describe('the runs', () => {
  test('a map is a run that ends when the player leaves it', () => {
    const runs = new RunSegmenter()
    runs.level(3, 4708, AT)
    runs.path('SD_GeBuLinShanZhai')
    const ended = runs.level(0, 110, LATER)
    expect(ended).not.toBeNull()
    expect(ended?.zone).toBe('SD_GeBuLinShanZhai')
    expect(ended?.name).toBe('Glacial Abyss - Shadow Outpost')
    expect(ended?.start).toBe(AT)
    expect(ended?.end).toBe(LATER)
  })

  test('the hideout is not a run', () => {
    const runs = new RunSegmenter()
    expect(runs.level(0, 110, AT)).toBeNull()
    expect(runs.currentRun).toBeNull()
  })

  test('the run that is going on is there', () => {
    const runs = new RunSegmenter()
    runs.level(3, 4708, AT)
    expect(runs.currentRun?.id).toBe(1)
  })

  test('every run gets its own number', () => {
    const runs = new RunSegmenter()
    runs.level(3, 4708, AT)
    runs.level(0, 110, LATER)
    runs.level(3, 4704, LATER + 1000)
    expect(runs.currentRun?.id).toBe(2)
  })

  test('what is picked up goes in the run that is going on', () => {
    const runs = new RunSegmenter()
    runs.level(3, 4708, AT)
    runs.loot(100200, 15)
    runs.loot(100200, 3)
    runs.loot(4654, 1)
    expect(runs.currentRun?.loot.get(100200)).toBe(18)
    expect(runs.currentRun?.loot.get(4654)).toBe(1)
  })

  test('the cost of a map waits for the run', () => {
    const runs = new RunSegmenter()
    runs.cost(400006, 1)
    runs.cost(5028, 1)
    runs.level(3, 4708, AT)
    expect(runs.currentRun?.cost.get(400006)).toBe(1)
    expect(runs.currentRun?.cost.get(5028)).toBe(1)
  })

  test('the FE that is picked up is counted', () => {
    const runs = new RunSegmenter()
    runs.level(3, 4708, AT)
    runs.fe(5)
    runs.fe(2)
    expect(runs.currentRun?.fe).toBe(7)
  })

  test('a run that was going on can be put back', () => {
    const runs = new RunSegmenter()
    runs.level(3, 4708, AT)
    runs.loot(100200, 15)
    const run = runs.currentRun
    expect(run).not.toBeNull()
    if (run === null) throw new Error('no run')

    const other = new RunSegmenter()
    other.restoreCurrent(run)
    expect(other.currentRun?.loot.get(100200)).toBe(15)
    expect(other.currentRun?.id).toBe(1)
  })

  test('a trip into a map is a map run', () => {
    const runs = new RunSegmenter()
    runs.level(3, 4708, AT)
    expect(runs.currentRun?.kind).toBe('map')
  })
})

describe('the Tartarus prison', () => {
  test('the visit begins when the board opens', () => {
    const runs = new RunSegmenter()
    runs.screen('S16BoardMain', 'run', BOARD)
    expect(runs.currentRun?.kind).toBe('prison')
    expect(runs.currentRun?.name).toBe('Tartarus Prison')
    expect(runs.currentRun?.start).toBe(BOARD)
  })

  test('the level of the prison goes on in the visit', () => {
    const runs = new RunSegmenter()
    runs.screen('S16BoardMain', 'run', BOARD)
    runs.level(28, 235501, PRISON)
    runs.screen('S16BoardMain', 'destory', PRISON + 77)
    const run = runs.currentRun
    expect(run?.id).toBe(1)
    expect(run?.levelId).toBe(235501)
    expect(run?.start).toBe(BOARD)
  })

  test('the visit ends when the player leaves the prison', () => {
    const runs = new RunSegmenter()
    runs.screen('S16BoardMain', 'run', BOARD)
    runs.level(28, 235501, PRISON)
    const ended = runs.level(0, 110, OUT)
    expect(ended?.kind).toBe('prison')
    expect(ended?.start).toBe(BOARD)
    expect(ended?.end).toBe(OUT)
  })

  test('the prison without the board is a run of its own', () => {
    const runs = new RunSegmenter()
    runs.level(28, 235501, PRISON)
    expect(runs.currentRun?.kind).toBe('prison')
    expect(runs.currentRun?.start).toBe(PRISON)
  })

  test('a visit without a challenge is not a run', () => {
    const runs = new RunSegmenter()
    runs.screen('S16BoardMain', 'run', BOARD)
    runs.screen('S16BoardMain', 'destory', BOARD + 3000)
    expect(runs.currentRun).toBeNull()
  })

  test('the number of a visit that never was is free again', () => {
    const runs = new RunSegmenter()
    runs.screen('S16BoardMain', 'run', BOARD)
    runs.screen('S16BoardMain', 'destory', BOARD + 3000)
    runs.level(3, 4708, PRISON)
    expect(runs.currentRun?.id).toBe(1)
  })

  test('the pages of the other games are left alone', () => {
    const runs = new RunSegmenter()
    runs.screen('PCBag', 'run', BOARD)
    runs.screen('Mystery', 'destory', BOARD)
    expect(runs.currentRun).toBeNull()
  })
})

describe('the names of the maps', () => {
  test('are the ones the community uses', () => {
    expect(zoneName('SD_GeBuLinShanZhai')).toBe('Glacial Abyss - Shadow Outpost')
    expect(zoneName('XZ_YuJinZhiXiBiNanSuo')).toBe("Hideout - Ember's Rest")
    expect(zoneName('ZhongZuiDiYu')).toBe('Tartarus Prison')
  })

  test('a map that is not known keeps its own name', () => {
    expect(zoneName('SD_SomeNewMap')).toBe('SD_SomeNewMap')
  })

  test('a map with a tier number is still known', () => {
    expect(zoneName('SD_YuanGuTongDao101')).toBe('Steel Forge - Beast Plains')
  })
})
