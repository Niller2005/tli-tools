//! Held-out accuracy of the S16 board reader: templates built from the
//! even-numbered labeled frames are scored on the odd ones, then the reverse.
//! Skips when trainingdata/s16 (git-ignored) is missing.

import { existsSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import { blankModel, cellIvory, type CellModel } from '@/board/board'
import { RUN_DAYS, TIER_CONF, toModel, warningText, type Warning } from '@/reader/model'
import { offBoard, readPanels, screenLabel, type Screen } from '@/reader/panels'
import { tesseractFound } from '@tli/ocr'
import { buildTemplates, cellTruth, CELLS, loadLabeled, readScene, readSceneWith, type Scene } from '@/reader/scene'
import { loadPng, readModel } from '@/reader/mod'
import { frames, Tally } from './common'

const FIELDS = ['locked', 'beast', 'tier', 'event', 'warden', 'jaws', 'glow'] as const

/** The label file of the labeled frames. */
const LABELS = new URL('../../data/scan-truth-s16.json', import.meta.url)

/** The frames folder, or null when it is missing. */
function framesDir(): string | null {
  const dir = frames()
  return existsSync(dir) ? dir : null
}

/** The player's reports folder, trainingdata/reports. */
function reportsDir(): string {
  return new URL('../../trainingdata/reports/', import.meta.url).pathname
}

/** The cells a scene reads as covered. */
function covered(scene: Scene): number[] {
  return CELLS.filter((c) => scene.cell(c).covered)
}

describe('the board reader', () => {
  test('the held-out accuracy', () => {
    const dir = framesDir()
    if (dir === null) {
      console.log(`skipped: ${frames()} is missing`)
      return
    }
    const labeled = loadLabeled(dir, LABELS.pathname)
    expect(labeled.length).toBeGreaterThan(0)
    const tally: Tally[] = FIELDS.map(() => new Tally())
    const confusion = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]]
    const confident = new Tally()
    for (let half = 0; half < 2; half++) {
      const train = labeled.filter((_, i) => i % 2 === half)
      const test = labeled.filter((_, i) => i % 2 !== half)
      const templates = buildTemplates(train)
      for (const [img, t] of test) {
        const scene = readSceneWith(img, templates)
        const f = t.name
        expect(covered(scene).length).toBe(0)
        tally[4].check(scene.warden === t.warden, () => `${f} warden read ${String(scene.warden)} label ${String(t.warden)}`)
        for (const c of CELLS.filter((c) => !t.covered.includes(c))) {
          const r = scene.cell(c)
          const l = cellTruth(t, c)
          if (l.locked !== null) {
            tally[0].check(r.locked === l.locked, () => `${f} cell ${c} locked read ${r.locked} label ${l.locked}`)
            if (l.locked && r.locked) {
              tally[6].check(
                r.glow === l.scratch,
                () => `${f} cell ${c} glow read ${String(r.glow)} label ${String(l.scratch)} (conf ${r.glowConf.toFixed(2)})`
              )
            }
          }
          const beast = r.inmate === null ? null : r.inmate.beast
          const label = l.inmate === null ? undefined : l.inmate.beast
          if (label !== null) {
            tally[1].check(beast === label, () => `${f} cell ${c} beast read ${String(beast)} label ${String(label)}`)
          }
          if (r.inmate !== null && l.inmate !== null) {
            const rt = r.inmate.tier
            const lt = l.inmate.tier
            tally[2].check(rt === lt, () => `${f} cell ${c} tier read ${rt} label ${lt} (conf ${r.tierConf.toFixed(2)})`)
            confusion[lt][rt] += 1
            if (r.tierConf >= TIER_CONF) confident.check(rt === lt, () => '')
          }
          tally[3].check(r.event === l.event, () => `${f} cell ${c} event read ${r.event} label ${l.event}`)
          if (l.inmate !== null && t.screen === 'board') {
            tally[5].check(r.jaws === l.jaws, () => `${f} cell ${c} jaws read ${r.jaws} label ${l.jaws}`)
          }
        }
      }
    }
    for (const [i, name] of FIELDS.entries()) {
      const t = tally[i]
      console.log(`${name.padEnd(7)} ${String(t.ok).padStart(4)}/${String(t.total).padStart(4)} ${t.pct().toFixed(1)}%`)
    }
    console.log('tier confusion (rows label 0-4, columns read 0-4):')
    for (const [lt, row] of confusion.entries()) console.log(`  ${lt}: [${row.join(', ')}]`)
    const coverage = (100 * confident.total) / Math.max(tally[2].total, 1)
    console.log(
      `tier at conf >= ${TIER_CONF}: ${confident.ok}/${confident.total} ${confident.pct().toFixed(1)}%, coverage ${coverage.toFixed(1)}%`
    )
    for (const [i, name] of FIELDS.entries()) {
      for (const m of tally[i].misses) console.log(`miss ${name}: ${m}`)
    }
    expect(tally[0].pct()).toBeGreaterThanOrEqual(98.0)
    expect(tally[1].pct()).toBeGreaterThanOrEqual(95.0)
    expect(confident.pct()).toBeGreaterThanOrEqual(90.0)
    expect(coverage).toBeGreaterThanOrEqual(80.0)
    expect(tally[4].pct()).toBeGreaterThanOrEqual(90.0)
    expect(tally[6].pct()).toBeGreaterThanOrEqual(98.0)
  })

  /// The card under the mouse in rec4-t051 and rec4-t053 ("Go to Cell 11",
  /// raised and dimmed, the cursor on its digits) reads with the other two.
  test('the hovered card reads', async () => {
    const dir = framesDir()
    if (dir === null) return
    for (const name of ['rec4-t051.png', 'rec4-t053.png']) {
      const path = `${dir}/${name}`
      if (!existsSync(path)) {
        console.log(`skipped: ${path} is missing`)
        continue
      }
      expect((await readPanels(loadPng(path))).doors).toEqual([8, 11, 13])
    }
  })

  /// trainingdata/reports/incident-cell8.png (outside s16, whose presence turns
  /// on the labeled-frame tests): a player's screenshot (1911x1072) with the
  /// Prison Incident "!" on the locked cell 8 and none on cell 7, the open
  /// Normal Rat next to it.
  test('the side cell incident reads', () => {
    const path = `${reportsDir()}incident-cell8.png`
    if (!existsSync(path)) {
      console.log(`skipped: ${path} is missing`)
      return
    }
    const scene = readScene(loadPng(path))
    expect(scene.cell(8).event).toBe(true)
    expect(scene.cell(7).event).toBe(false)
  })

  /// trainingdata/reports/incident-cell{8,9}-1080p.png: two 1920x1080 frames of
  /// one recorded run, the "!" on cell 8 in the first and on cell 9 (none on
  /// cell 8) a day earlier.
  test('the cell 8 incident reads at 1080p', () => {
    for (const [name, cell, other] of [
      ['incident-cell8-1080p.png', 8, 9],
      ['incident-cell9-1080p.png', 9, 8],
    ] as [string, number, number][]) {
      const path = `${reportsDir()}${name}`
      if (!existsSync(path)) {
        console.log(`skipped: ${path} is missing`)
        continue
      }
      const scene = readScene(loadPng(path))
      expect(scene.cell(cell).event).toBe(true)
      expect(scene.cell(other).event).toBe(false)
    }
  })

  /// trainingdata/reports/jaws-orange-*.png (outside s16): Legendary inmates
  /// with the jaws crown on cells lit as reachable destinations (14 in the
  /// first frame, 13 and 16 in the second) read Legendary, not Ultimate, like
  /// the unlit ones next to them.
  test('the lit destination tiers', () => {
    const cases: [string, [number, number][]][] = [
      [
        'jaws-orange-cell14.png',
        [
          [2, 4],
          [3, 2],
          [7, 1],
          [8, 4],
          [9, 1],
          [11, 3],
          [12, 0],
          [13, 1],
          [14, 3],
          [15, 3],
        ],
      ],
      [
        'jaws-orange-cells13-16.png',
        [
          [5, 3],
          [6, 3],
          [13, 3],
          [16, 3],
        ],
      ],
    ]
    for (const [name, tiers] of cases) {
      const path = `${reportsDir()}${name}`
      if (!existsSync(path)) {
        console.log(`skipped: ${path} is missing`)
        continue
      }
      const scene = readScene(loadPng(path))
      for (const [c, tier] of tiers) expect(scene.cell(c).inmate?.tier).toBe(tier)
    }
  })

  /// trainingdata/reports/chain-target.png (outside s16): a player's Consume
  /// target pick with the eater, a Magic Lion, on cell 3 and the big red jaws
  /// on its targets 4, 5, 12 and 13, not on the Magic Lion on 8 or the red glow
  /// of the Ultimate on 16.
  test('the consume targets read', () => {
    const path = `${reportsDir()}chain-target.png`
    if (!existsSync(path)) {
      console.log(`skipped: ${path} is missing`)
      return
    }
    const scene = readScene(loadPng(path))
    expect(CELLS.filter((c) => scene.cell(c).target)).toEqual([4, 5, 12, 13])
  })

  /// trainingdata/reports/tusk-cells7-9.png (outside s16): the Tusk of Iron
  /// Tongs of Lust: Mammoth on the Mammoths in cells 7 and 9, not on the
  /// unmarked Mammoth in cell 8. The board model carries it as ivory.
  test('the tusk reads', async () => {
    const path = `${reportsDir()}tusk-cells7-9.png`
    if (!existsSync(path)) {
      console.log(`skipped: ${path} is missing`)
      return
    }
    const scene = readScene(loadPng(path))
    expect(CELLS.filter((c) => scene.cell(c).tusk)).toEqual([7, 9])
    expect(CELLS.filter((c) => scene.cell(c).prey).length).toBe(0)
    const [model] = await readModel(path, [])
    expect(CELLS.filter((c) => cellIvory(model.cells[c - 1]))).toEqual([7, 9])
  })

  /// trainingdata/reports/consume-target-cell2.png (outside s16): a player's
  /// Consume target pick on day 7 with the big jaws on the Ultimate Mammoth
  /// Avenger's Casket let into cell 2: the cell reads open and a target.
  test('the consume target reads open', () => {
    const path = `${reportsDir()}consume-target-cell2.png`
    if (!existsSync(path)) {
      console.log(`skipped: ${path} is missing`)
      return
    }
    const scene = readScene(loadPng(path))
    expect(scene.cell(2).target).toBe(true)
    expect(scene.cell(2).locked).toBe(false)
  })

  /// The big jaws read only on a Consume target pick: every other screen of
  /// trainingdata/s16 has none.
  test('the consume targets only on the target pick', async () => {
    const dir = framesDir()
    if (dir === null) return
    let seen = 0
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.png'))) {
      const img = loadPng(`${dir}/${name}`)
      if ((await readPanels(img)).screen === 'chainTarget') continue
      const scene = readScene(img)
      const targets = CELLS.filter((c) => scene.cell(c).target)
      expect(targets).toEqual([])
      seen += 1
    }
    expect(seen).toBeGreaterThan(0)
  })

  /// rec6-t003: the run theme scroll in the lobby names Opulence; the manage
  /// board of rec6-t181 and the treasure pick of rec6-t191 name no theme.
  test('the theme scroll reads', async () => {
    const dir = framesDir()
    if (dir === null) return
    for (const [name, screen, theme] of [
      ['rec6-t003.png', 'theme', 302],
      ['rec6-t181.png', 'manage', null],
      ['rec6-t191.png', 'treasurePick', null],
    ] as [string, Screen, number | null][]) {
      const path = `${dir}/${name}`
      if (!existsSync(path)) {
        console.log(`skipped: ${path} is missing`)
        continue
      }
      const p = await readPanels(loadPng(path))
      expect([p.screen, p.theme]).toEqual([screen, theme])
    }
  })

  /// The objective panel: Survival of the Fittest "Completed" in
  /// trainingdata/reports/objective-completed.png (a 1911x1072 frame), and
  /// Undercurrents at 0/2 on the rec1-t123 board.
  test('the objective panel reads', async () => {
    const dir = framesDir()
    const cases: [string, { id: number; progress: number }][] = [
      [`${reportsDir()}objective-completed.png`, { id: 2, progress: 4 }],
      [`${dir ?? ''}rec1-t123.png`, { id: 4, progress: 0 }],
    ]
    for (const [path, objective] of cases) {
      if (!existsSync(path)) {
        console.log(`skipped: ${path} is missing`)
        continue
      }
      expect((await readPanels(loadPng(path))).objective).toEqual(objective)
    }
  })

  /// The Rusty Saw tooltip of rec3-t161 lies over cells 15 and 16 (16 empty, 15
  /// a Legendary Rat): both are marked covered and taken from the last board
  /// read when there is one.
  test('the tooltip covers cells', async () => {
    const dir = framesDir()
    if (dir === null) return
    const tip = `${dir}/rec3-t161.png`
    const plain = `${dir}/rec1-t029.png`
    if (!existsSync(tip) || !existsSync(plain)) {
      console.log(`skipped: ${tip} or ${plain} is missing`)
      return
    }
    expect(covered(readScene(loadPng(plain)))).toEqual([])
    const img = loadPng(tip)
    const scene = readScene(img)
    expect(covered(scene)).toEqual([15, 16])
    const panels = await readPanels(img)
    const [, warnings] = toModel(scene, panels, [], null, RUN_DAYS)
    const doubtful = warnings.filter((w) => w.kind === 'cellRead').map((w) => [w.cell, w.detail])
    expect(doubtful).toContainEqual([14, 'tooltip'])
    expect(doubtful).toContainEqual([15, 'tooltip'])
    const under = blankModel()
    under.cells[14] = { kind: 'inmate', beast: 'rat', tier: 3, ivory: false, prey: null, event: null }
    under.cells[15] = { kind: 'empty', event: null }
    const [m, warnings2] = toModel(scene, panels, [], under, RUN_DAYS)
    expect(m.cells.slice(14, 16)).toEqual(under.cells.slice(14, 16))
    const texts2 = warnings2.map(warningText)
    expect(texts2).toContain('A tooltip covers cells 15 and 16: they are kept from the last board read.')
    expect(warnings2.some((w) => w.kind === 'cellRead' && (w.cell === 14 || w.cell === 15))).toBe(false)
  })

  /// trainingdata/reports/reconnect-{0007,0012}.png (outside s16), a player's
  /// 1080p run: the board before the game reconnected (a Rare Mammoth in 4, a
  /// Legendary Mammoth in 8, a Magic Rat in 14) and after it, when the game
  /// draws every portrait with no rarity glow.
  test('the glowless portraits keep their rarity', async () => {
    const before = `${reportsDir()}reconnect-0007.png`
    const after = `${reportsDir()}reconnect-0012.png`
    if (!existsSync(before) || !existsSync(after)) {
      console.log(`skipped: ${before} or ${after} is missing`)
      return
    }
    const read = async (path: string, under: ReturnType<typeof blankModel> | null): Promise<[ReturnType<typeof blankModel>, Warning[]]> => {
      const img = loadPng(path)
      return toModel(readScene(img), await readPanels(img), [], under, RUN_DAYS)
    }
    const tiers = (m: ReturnType<typeof blankModel>): number[] =>
      [4, 5, 6, 7, 8, 14].map((c) => {
        const cell = m.cells[c - 1]
        return cell.kind === 'inmate' ? cell.tier : -1
      })
    const flagged = (warnings: Warning[]): (number | null)[] =>
      warnings.filter((w) => w.kind === 'cellRead' && w.detail === 'glowless').map((w) => w.cell)
    const [board] = await read(before, null)
    expect(tiers(board)).toEqual([2, 0, 0, -1, 3, 1])
    const [m, warnings] = await read(after, board)
    expect(tiers(m)).toEqual([2, 0, 0, 0, 3, 1])
    const texts = warnings.map(warningText)
    expect(texts.some((t) => t.startsWith('The portraits in cells 04, 05, 06, 08 and 14 show no rarity glow'))).toBe(true)
    expect(flagged(warnings)).toEqual([6])
    const [m2, warnings2] = await read(after, null)
    expect(tiers(m2)).toEqual([0, 0, 0, 0, 0, 0])
    expect(flagged(warnings2)).toEqual([3, 4, 5, 6, 7, 13])
  })

  /// rec4-t412: the Raging Beast's Agonizing Muzzle tooltip over the left
  /// column, its flat grey tinted in blocks by the recording's compression,
  /// hides the Lions of cells 15 and 16 and cell 14's portrait above its
  /// padlock.
  test('the tooltip in a recorded frame', async () => {
    const dir = framesDir()
    if (dir === null) return
    const tip = `${dir}/rec4-t412.png`
    if (!existsSync(tip)) {
      console.log(`skipped: ${tip} is missing`)
      return
    }
    const img = loadPng(tip)
    const scene = readScene(img)
    expect(covered(scene)).toEqual([14, 15, 16])
    const lion: CellModel = { kind: 'inmate', beast: 'lion', tier: 0, ivory: false, prey: null, event: null }
    const under = blankModel()
    under.cells[14] = { ...lion }
    under.cells[15] = { ...lion }
    const [m, warnings] = toModel(scene, await readPanels(img), [], under, RUN_DAYS)
    expect(m.cells.slice(13, 16)).toEqual(under.cells.slice(13, 16))
    expect(warnings.map(warningText)).toContain('A tooltip covers cells 14, 15 and 16: they are kept from the last board read.')
  })

  /// The day counts down from the run's length, 30 days for Iron Law
  /// (rec1-t029's board, its counter overridden).
  test('the iron law days', async () => {
    const dir = framesDir()
    if (dir === null) return
    const path = `${dir}/rec1-t029.png`
    if (!existsSync(path)) {
      console.log(`skipped: ${path} is missing`)
      return
    }
    const img = loadPng(path)
    const scene = readScene(img)
    const panels = await readPanels(img)
    for (const [runDays, left, day, maxDays] of [
      [30, 29, 1, 30],
      [30, 25, 5, 30],
      [30, 12, 18, 30],
      [20, 12, 8, 20],
    ]) {
      panels.days = left
      const [m] = toModel(scene, panels, [], null, runDays)
      expect([m.day, m.maxDays]).toEqual([day, maxDays])
    }
  })

  /// Every saved frame: only the loading screen of rec4-t424, the day banners
  /// of rec1-t095 and rec4-t340 and the lobby's objective dialog of
  /// p2560-lobby (a 2560 x 1361 player frame) are off the board, and only the riot
  /// screen of rec4-t422 ends the run.
  test('the off-board frames and the run end', async () => {
    const dir = framesDir()
    if (dir === null) return
    const names = readdirSync(dir).filter((n) => n.endsWith('.png')).sort()
    const off: string[] = []
    const ended: string[] = []
    const status: string[] = []
    for (const name of names) {
      const p = await readPanels(loadPng(`${dir}/${name}`))
      if (offBoard(p)) off.push(name)
      if (p.screen === 'runEnd') ended.push(name)
      if (p.screen === 'prisonStatus') status.push(name)
      if (['rec5-t012.png', 'rec5-t028.png', 'rec5-t045.png'].includes(name)) expect(p.screen).toBe('treasurePick')
      if (['rec4-t110.png', 'rec4-t148.png', 'rec4-t166.png', 'rec4-t258.png', 'rec4-t390.png'].includes(name)) {
        expect(p.screen).toBe('chainTarget')
      }
    }
    console.log(`off the board: ${JSON.stringify(off)}`)
    const present = (list: string[]): string[] => list.filter((n) => names.includes(n))
    expect(off).toEqual(present(['p2560-lobby.png', 'rec1-t095.png', 'rec4-t340.png', 'rec4-t424.png']))
    expect(ended).toEqual(present(['rec4-t422.png']))
    expect(status).toEqual(present(['rec5-t018.png', 'rec5-t047.png', 'rec6-t206.png']))
  })

  /// The Blood-Stained Trap's Hunt card: on the day-2 manage screen of
  /// hunt-run-0005 (2560x1440) it is on offer, beside Consume, Replace and End;
  /// hunt-pierce-d6, at a Lion after a Replace, offers none, and neither does
  /// hunt-tyler-d3, where the Hunt was used.
  test('the hunt card reads', async () => {
    const dir = framesDir()
    if (dir === null) return
    for (const [name, used] of [
      ['hunt-run-0005.png', false],
      ['hunt-pierce-d6.png', true],
      ['hunt-tyler-d3.png', true],
    ] as [string, boolean][]) {
      const path = `${dir}/${name}`
      if (!existsSync(path)) {
        console.log(`skipped: ${path} is missing`)
        continue
      }
      const panels = await readPanels(loadPng(path))
      expect(panels.screen).toBe('manage')
      const [model] = await readModel(path, [])
      expect(model.huntUsed).toBe(used)
      if (!used) expect(panels.decision).toEqual(['Consume', 'Replace', 'Hunt', 'End'])
    }
  })

  /// hunt-tyler-d3: the Prey crosshair on the Magic Wolf in cell 4, marked by
  /// the Magic Lion in the warden's cell 10 (the other Magic Lion is in cell
  /// 7). The crosshair does not read as the Tusk.
  test('the prey mark reads', async () => {
    const dir = framesDir()
    if (dir === null) return
    const path = `${dir}/hunt-tyler-d3.png`
    if (!existsSync(path)) {
      console.log(`skipped: ${path} is missing`)
      return
    }
    const scene = readScene(loadPng(path))
    expect(CELLS.filter((c) => scene.cell(c).prey)).toEqual([4])
    const [model, warnings] = await readModel(path, [])
    expect(cellIvory(model.cells[3])).toBe(false)
    const marks = model.cells
      .map((c, n) => (c.kind === 'inmate' && c.prey !== null ? [n + 1, c.prey] : null))
      .filter((m): m is [number, { cell: number | null; rounds: number }] => m !== null)
    expect(marks).toEqual([[10, { cell: 3, rounds: 3 }]])
    expect(warnings.some((w) => w.kind === 'cellRead' && w.detail === 'prey')).toBe(false)
  })

  /// The Prey crosshair reads only where one is drawn: no other frame of
  /// trainingdata/s16 has one.
  test('the prey marks only where drawn', () => {
    const dir = framesDir()
    if (dir === null) return
    const marked: [string, number[]][] = [
      ['hunt-tyler-d3.png', [4]],
      ['hunt-run-0008.png', [4]],
      ['hunt-run-0012.png', [4]],
      ['hunt-run-0038.png', [6]],
    ]
    let seen = 0
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.png'))) {
      const want = marked.find((m) => m[0] === name)?.[1] ?? []
      const scene = readScene(loadPng(`${dir}/${name}`))
      expect(CELLS.filter((c) => scene.cell(c).prey)).toEqual(want)
      seen += 1
    }
    expect(seen).toBeGreaterThan(0)
  })
})

describe('the reader end to end', () => {
  /// The synthetic frame of tests/fixtures/board-text.png: a board with the
  /// days counter and three destination cards, drawn where the game draws
  /// them. The Rust reader reads the same frame the same way.
  test('a board with cards and a days counter', async () => {
    if (!tesseractFound()) {
      console.log('skipped: tesseract is missing')
      return
    }
    const path = new URL('./fixtures/board-text.png', import.meta.url).pathname
    const p = await readPanels(loadPng(path))
    expect(screenLabel(p.screen)).toBe('board')
    expect(p.days).toBe(12)
    expect(p.doors).toEqual([7, 12, 1])
    const [model, warnings] = await readModel(path, [])
    expect(model.day).toBe(8)
    expect(model.dest).toEqual([6, 11, 0])
    expect(warnings.length).toBeGreaterThan(0)
  })

  /// The synthetic frame of tests/fixtures/pick-text.png: the Select a
  /// Torture Instrument screen with three cards.
  test('an instrument pick over the last board read', async () => {
    if (!tesseractFound()) {
      console.log('skipped: tesseract is missing')
      return
    }
    const path = new URL('./fixtures/pick-text.png', import.meta.url).pathname
    const img = loadPng(path)
    const p = await readPanels(img)
    expect(p.screen).toBe('instrumentPick')
    expect(p.instruments).toEqual(['chains', 'scapegoat', 'coin'])
    // The pick covers the board: the cells come from the last board read.
    const under = blankModel()
    under.cells[3] = { kind: 'inmate', beast: 'lion', tier: 2, ivory: false, prey: null, event: null }
    const [m, warnings] = toModel(readScene(img), p, [], under, RUN_DAYS)
    expect(m.cells[3]).toEqual(under.cells[3])
    expect(warnings.map(warningText)).toContain('The pick covers the board: the cells are from the last board read (day 1).')
    // Without a board read before it, the run start is assumed.
    const [fresh, freshWarnings] = toModel(readScene(img), p, [], null, RUN_DAYS)
    expect(fresh.cells[3]).toEqual({ kind: 'sealed', event: null })
    expect(freshWarnings.map(warningText)).toContain(
      'The pick covers the board and no board was read before it: the run start is assumed (every cell locked). For a pick later in the run, read the board first.'
    )
  })
})
