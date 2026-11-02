import { describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { RunningEntry } from '@tli/launch'
import { saveArcana, SCHEMA_VERSION } from '@tli/arcana'
import { saveTracker } from '@tli/tracker'
import { readStatus } from '../src/status'

const NOW = Date.parse('2026-11-01T12:00:00')

/** A place with the files the tools keep, as the tests want them. */
function work(): string {
  return mkdtempSync(join(tmpdir(), 'tli-dashboard-status-'))
}

/** A tracker database with one run of 120 FE, done an hour ago. */
async function writeTrackerState(path: string, now: number): Promise<void> {
  await saveTracker(
    {
      version: 1,
      log: { file: '/game/UE_game.log', offset: 0 },
      tracker: {
        version: 2,
        runs: [
          {
            id: 1,
            kind: 'map',
            zone: 'The Frozen Fjord',
            name: 'The Frozen Fjord',
            levelId: 1,
            start: now - 7200_000,
            end: now - 3600_000,
            loot: [],
            cost: [],
            fe: 120,
          },
        ],
        current: null,
        slots: [],
        instances: [],
        prices: [],
        overrides: [],
        gear: [],
        nextRunId: 2,
        taxed: true,
        mapCosts: true,
      },
    },
    path,
  )
}

/** An Arcana database with one visit to the Tarot Path, still going on. */
async function writeArcanaState(path: string, now: number): Promise<void> {
  await saveArcana({
    version: SCHEMA_VERSION,
    log: { file: '/game/UE_game.log', offset: 0 },
    history: {
      sessions: [
        {
          id: 1,
          openedAt: now - 60_000,
          closedAt: null,
          cells: 3,
          moves: [],
          chests: [],
          chestsSkipped: 0,
          notes: 0,
          played: 0,
          lifeLost: 2,
          lifeWon: 1,
        },
      ],
      contests: [],
      trials: [],
      nextId: 2,
    },
    snapshot: { bag: { slots: [], instances: [] }, prices: [], overrides: [] },
  },
  path,)
}

/** A launcher that has one tool open in a tmux pane. */
const RUNNING: RunningEntry[] = [{ id: 'vorax', pid: 4321, since: NOW - 30_000, via: 'tmux', running: true, exitCode: null }]
const launcher = { list: (): RunningEntry[] => RUNNING }

describe('reading the status', () => {
  test('the saved states, the log and the prices become the panels', async () => {
    const dir = work()
    const trackerDb = join(dir, 'tracker.db')
    const arcanaDb = join(dir, 'arcana.db')
    const baselineFile = join(dir, 'baseline.json')
    const log = join(dir, 'UE_game.log')
    await writeTrackerState(trackerDb, NOW)
    await writeArcanaState(arcanaDb, NOW)
    writeFileSync(baselineFile, `${JSON.stringify({ fetchedAt: NOW - 60_000, source: 'test', prices: [[1, 2]] })}\n`)
    writeFileSync(log, '[2026.11.01-11.59.00:000][1]TLLua: Display: [Game] something\n')

    const status = await readStatus(
      {
        view: { warden: 'closed', vorax: 'open', arcana: 'open', log: 'ok' },
        launcher,
        log,
        itemAge: 5000,
        paths: { tracker: trackerDb, arcana: arcanaDb, baseline: baselineFile },
      },
      NOW,
    )

    expect(status.lines.tracker?.line).toContain('1 runs today')
    expect(status.lines.tracker?.line).toContain('The Frozen Fjord')
    expect(status.lines.arcana?.line).toBe('Tarot Path open · life -2 +1 · 0 chests held · 0 trials')
    expect(status.lines.vorax?.line).toBe('open')
    expect(status.lines.warden?.line).toBe('closed')

    expect(status.summary.runsToday).toBe(1)
    // the loot was never sold, so the day honestly has no best run
    expect(status.summary.bestRun).toBeNull()
    expect(status.summary.lastRun?.name).toBe('The Frozen Fjord')
    expect(status.summary.feTotal).toBe(120)

    expect(status.health.detail).toBe('ok')
    expect(status.health.path).toBe(log)
    expect(status.health.size).toBeGreaterThan(0)

    expect(status.baselineAge).toBe(60_000)
    expect(status.itemAge).toBe(5000)
    expect(status.running).toEqual(RUNNING)
    expect(status.at).toBe(NOW)
  })

  test('a capture that is turned off says so, and nothing is run to find it out', async () => {
    const dir = work()
    const bin = join(dir, 'bin')
    mkdirSync(bin, { recursive: true })
    const grim = join(bin, 'grim')
    writeFileSync(grim, '#!/bin/sh\n')
    chmodSync(grim, 0o755)

    const status = await readStatus(
      {
        view: null,
        launcher,
        capture: { env: { PATH: `${bin}:${process.env.PATH ?? ''}`, TLI_NO_CAPTURE: '1' } },
        // the saved states are read from paths that are not there, so this test never touches
        // the real ones (reading them brings the old state file in, which writes)
        paths: { tracker: join(dir, 'no-tracker.db'), arcana: join(dir, 'no-arcana.db') },
      },
      NOW,
    )
    expect(status.capture.noCapture).toBe(true)
    expect(status.capture.path).toBe('none')
    expect(status.capture.tools.find(tool => tool.name === 'grim')?.found).toBe(true)
    expect(status.lines.vorax).toBeUndefined()
    expect(status.lines.warden).toBeUndefined()
  })

  test('nothing on disk and no view still give a status, with nothing to say', async () => {
    const dir = work()
    const status = await readStatus(
      {
        view: null,
        launcher: { list: () => [] },
        log: join(dir, 'nowhere.log'),
        paths: {
          tracker: join(dir, 'no-tracker.db'),
          arcana: join(dir, 'no-arcana.db'),
          baseline: join(dir, 'no-baseline.json'),
        },
      },
      NOW,
    )
    expect(status.lines.tracker?.line).toBe('')
    expect(status.lines.arcana?.line).toBe('')
    expect(status.summary.runsToday).toBe(0)
    expect(status.summary.feTotal).toBe(0)
    expect(status.health.detail).toBe('missing')
    expect(status.baselineAge).toBeNull()
    expect(status.running).toEqual([])
  })
})
