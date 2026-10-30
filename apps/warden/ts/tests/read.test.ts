//! The S16 panel reader (OCR) on the labeled frames: screen, doors,
//! decision buttons, days and offers against data/scan-truth-s16.json, then
//! every board frame with cards or buttons through `toModel` and
//! `buildState`. Skips when trainingdata/s16 (git-ignored) is missing.

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { buildState } from '@/board/board'
import { data, toolFromKey, type Tool } from '@/engine/data'
import { loadPng, readModel } from '@/reader/mod'
import { RUN_DAYS, toModel } from '@/reader/model'
import { readPanels, screenLabel } from '@/reader/panels'
import { readScene } from '@/reader/scene'
import { frames, Tally } from './common'

/** The label file of the labeled frames. */
const LABELS = new URL('../../data/scan-truth-s16.json', import.meta.url)

/** The strings of a label field. */
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

describe('the panel reader', () => {
  test('the panels against the labels', async () => {
    const dir = frames()
    if (!existsSync(dir)) {
      console.log(`skipped: ${dir} is missing`)
      return
    }
    const labels = JSON.parse(readFileSync(LABELS, 'utf8')) as Record<string, Record<string, unknown>>
    const names = ['screen', 'doors', 'decision', 'days', 'offers', 'chromatic', 'board days', 'board doors']
    const tally: Tally[] = names.map(() => new Tally())
    let solved = 0
    for (const [f, l] of Object.entries(labels).filter(([k]) => k.endsWith('.png'))) {
      const img = loadPng(`${dir}/${f}`)
      const p = await readPanels(img)
      const screen = l['screen'] as string
      const board = screen === 'board'
      tally[0].check(screenLabel(p.screen) === screen, () => `${f} screen read ${screenLabel(p.screen)} label ${screen}`)
      const doors = l['doors'] as number[]
      const readDoors = p.doors
      const ok = readDoors.length === doors.length && readDoors.every((d, i) => d === doors[i])
      tally[1].check(ok, () => `${f} doors read ${JSON.stringify(readDoors)} label ${JSON.stringify(doors)}`)
      if (board && doors.length > 0) tally[7].check(ok, () => '')
      const decision = strings(l['decision'])
      tally[2].check(
        p.decision.length === decision.length && p.decision.every((d, i) => d === decision[i]),
        () => `${f} decision read ${JSON.stringify(p.decision)} label ${JSON.stringify(decision)}`
      )
      const days = l['days']
      if (typeof days === 'number') {
        const daysOk = p.days === days
        tally[3].check(daysOk, () => `${f} days read ${String(p.days)} label ${days}`)
        if (board) tally[6].check(daysOk, () => `${f} days read ${String(p.days)} label ${days}`)
      }
      // A treasure pick always offers the four gifts, so only instrument picks are read.
      if (screen !== 'treasurePick') {
        const offers = strings(l['offers'])
        const read = p.instruments.map((t) => data().toolNames[data().toolIds.indexOf(t)])
        tally[4].check(
          read.length === offers.length && read.every((o, i) => o === offers[i]),
          () => `${f} offers read ${JSON.stringify(read)} label ${JSON.stringify(offers)}`
        )
      }
      const chromatic = l['chromatic'] as number
      tally[5].check(p.vault.length === chromatic, () => `${f} chromatic read ${p.vault.length} label ${chromatic}`)
      // End to end: a board frame with cards or buttons, or a Sewer Ratway
      // cell pick, builds a state without problems.
      const phase = l['phase'] as string
      const cellPick = screen === 'cellPick'
      if ((board && (phase === 'manage' || doors.length > 0)) || cellPick) {
        const held: Tool[] = strings(l['tools'])
          .map((t) => toolFromKey(t))
          .filter((t): t is Tool => t !== null)
        const [model] = toModel(readScene(img), p, held, null, RUN_DAYS)
        const [, problems] = buildState(model, 1)
        expect(problems).toEqual([])
        solved += 1
      }
    }
    for (const [i, name] of names.entries()) {
      const t = tally[i]
      console.log(`${name.padEnd(12)} ${String(t.ok).padStart(3)}/${String(t.total).padStart(3)} ${t.pct().toFixed(1)}%`)
    }
    for (const t of tally.slice(0, 6)) {
      for (const m of t.misses) console.log(`  miss: ${m}`)
    }
    console.log(`end to end: ${solved} board frames read, built and solved`)
    expect(tally[6].ok).toBe(tally[6].total)
    expect(tally[7].ok).toBe(tally[7].total)
    expect(tally[0].pct()).toBeGreaterThanOrEqual(95.0)
    expect(solved).toBeGreaterThan(0)
  })

  /// The instrument pick's "Remaining attempts N": reroll-2000x837 (a player's
  /// 3440 x 1440 frame scaled down) offers three instruments with one re-roll
  /// left; rec1-t031 shows no Re-roll button.
  test('the re-rolls read', async () => {
    const dir = frames()
    if (!existsSync(dir)) return
    for (const [name, rerolls, offers] of [
      ['reroll-2000x837.png', 1, ["Felon's Dog Tag", 'Searing Branding Iron', "Executioner's Blacklist"]],
      ['rec1-t031.png', 0, ["Ferocious Beast's Ravenous Chains", "Scapegoat's Guillotine", "Kin's Coin of Fate"]],
    ] as [string, number, string[]][]) {
      const path = `${dir}/${name}`
      if (!existsSync(path)) {
        console.log(`skipped: ${path} is missing`)
        continue
      }
      const p = await readPanels(loadPng(path))
      expect(p.screen).toBe('instrumentPick')
      const [model] = await readModel(path, [])
      const read = model.choice.options.map((t) => data().toolNames[data().toolIds.indexOf(t)])
      expect(read).toEqual(offers)
      expect(model.choice.rerolls).toBe(rerolls)
      const [st, problems] = buildState(model, 1)
      expect(problems).toEqual([])
      expect(st.rerolls).toBe(rerolls)
    }
  })
})
