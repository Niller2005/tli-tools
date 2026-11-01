import { describe, expect, test } from 'bun:test'
import { ItemNames, Tracker } from '@tli/tracker'
import { lootReport } from '../src/report'

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0)

function names(): ItemNames {
  return new ItemNames({
    '100': { name: 'Ember Core' },
    '300': { name: 'Ancient Relic' },
  })
}

function tracker(): Tracker {
  const tracker = new Tracker({ names: names() })
  tracker.prices.setOverride(300, 25)
  tracker.runs.push({
    id: 1,
    kind: 'map',
    zone: 'SD_GeBuLinShanZhai',
    name: 'Glacial Abyss - Shadow Outpost',
    levelId: 4708,
    start: NOW - 300_000,
    end: NOW - 120_000,
    loot: new Map([[300, 1]]),
    cost: new Map(),
    fe: 0,
    xp: 0,
    affixes: [],
    session: 0,
  })
  tracker.runs.push({
    id: 2,
    kind: 'prison',
    zone: 'ZhongZuiDiYu',
    name: 'Tartarus Prison',
    levelId: 235501,
    start: NOW - 900_000,
    end: NOW - 500_000,
    loot: new Map([
      [300, 2],
      [100, 9],
    ]),
    cost: new Map(),
    fe: 0,
    xp: 0,
    affixes: [],
    session: 0,
  })
  return tracker
}

describe('the loot report', () => {
  test('says what kind of run every line is about', () => {
    const report = lootReport(tracker(), names())
    const lines = report.split('\n')
    expect(lines[0]).toBe(
      'run,kind,zone,name,started,ended,seconds,item_id,item,qty,price,value',
    )
    expect(lines[1]).toContain('1,map,SD_GeBuLinShanZhai,Glacial Abyss - Shadow Outpost')
    expect(lines[2]).toContain('2,prison,ZhongZuiDiYu,Tartarus Prison')
  })

  test('the loot of the prison is in the report', () => {
    const report = lootReport(tracker(), names())
    expect(report).toContain('Ancient Relic,2,25,50.00')
    expect(report).toContain('Ember Core,9,0,0.00')
  })
})
