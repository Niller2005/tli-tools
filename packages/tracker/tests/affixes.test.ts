import { describe, expect, test } from 'bun:test'
import { AffixDumpReader, cleanDescription } from '../src/affixes'
import { Tracker } from '../src/engine'
import { parseLine } from '../src/parse'
import type { Run } from '../src/runs'
import { AFFIX_DUMP, BACK_TO_HIDEOUT, ENTER_MAP, IN_HIDEOUT, MAP_MODIFIERS } from './fixtures'

describe('the modifiers of a map', () => {
  test('a line says the modifier and whether the game put it on', () => {
    expect(parseLine(MAP_MODIFIERS[1] as string)).toMatchObject({ t: 'modifier', id: 5112006, ok: true })
    expect(parseLine(MAP_MODIFIERS[3] as string)).toMatchObject({ t: 'modifier', id: 2060000, ok: false })
  })

  test('the game\'s markup is taken out of the words', () => {
    expect(cleanDescription('<p>+10</p>% additional <e id=507>Drop Quantity</e>')).toBe('+10% additional Drop Quantity')
  })

  test('the dump names the modifiers that have words, and leaves out the keys of the text table and what comes after it', () => {
    const reader = new AffixDumpReader()
    const named = AFFIX_DUMP.map((line) => reader.feed(line)).filter((entry) => entry !== null)
    expect(named).toEqual([
      { id: 5112006, text: '-30% additional Physical Damage for you' },
      { id: 101, text: '+10% additional Drop Quantity' },
    ])
  })

  test('the tracker puts the modifiers the game applied on the run, once each', () => {
    const t = new Tracker()
    t.feed(IN_HIDEOUT)
    t.feed(ENTER_MAP)
    t.feed(MAP_MODIFIERS)
    expect(t.currentRun?.affixes).toEqual([7000000, 5112006, 101, 200006])
    t.feed(AFFIX_DUMP)
    expect(t.affixNames.get(5112006)).toBe('-30% additional Physical Damage for you')
    expect(t.affixNames.has(200006)).toBe(false)
    t.feed(BACK_TO_HIDEOUT)
    expect(t.runs[0]?.affixes).toEqual([7000000, 5112006, 101, 200006])
  })

  test('modifiers said outside a run belong to none', () => {
    const t = new Tracker()
    t.feed(IN_HIDEOUT)
    t.feed(MAP_MODIFIERS)
    expect(t.currentRun).toBeNull()
    expect(t.runs).toHaveLength(0)
  })
})

/** A finished map with these modifiers and this much FE. */
function run(id: number, affixes: number[], fe: number): Run {
  return {
    id,
    kind: 'map',
    zone: 'z',
    name: 'n',
    levelId: 1,
    start: id * 1000,
    end: id * 1000 + 500,
    loot: new Map(fe === 0 ? [] : [[100300, fe]]),
    cost: new Map(),
    fe,
    xp: 0,
    affixes,
    session: 0,
  }
}

describe('which modifiers paid', () => {
  test('a modifier is compared with the average of all the maps, the better ones first, and one that was too rarely seen is left out', () => {
    const t = new Tracker()
    t.affixNames.set(1, 'rich')
    t.affixNames.set(2, 'poor')
    t.affixNames.set(3, 'rare')
    t.affixNames.set(4, 'unnamed-in-the-dump is never on this list')
    t.runs.push(run(1, [1, 2], 100), run(2, [1, 2], 80), run(3, [1, 2], 90), run(4, [2, 3], 0), run(5, [2, 99], 0))
    // the average of all five maps is 54; `99` has no words and is not listed
    const rows = t.affixReport(3)
    expect(rows.map((row) => row.id)).toEqual([1, 2])
    expect(rows[0]).toMatchObject({ text: 'rich', runs: 3, avgWorth: 90, avgFe: 90 })
    expect(rows[0]?.versus).toBeCloseTo(90 - 54, 5)
    expect(rows[1]?.versus).toBeCloseTo((100 + 80 + 90) / 5 - 54, 5)
  })

  test('nothing is said without finished maps', () => {
    expect(new Tracker().affixReport()).toEqual([])
  })
})
