import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve } from 'node:path'
import { logHealth } from '../src/index'

const dir = mkdtempSync(join(tmpdir(), 'tli-gamelog-health-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** A log file in the temp folder with the text given. */
const log = (name: string, text: string): string => {
  const file = join(dir, name)
  writeFileSync(file, text)
  return file
}

const DETAIL_LINE = '[2026.10.17-14.24.11:563][590]TLLua: PageName = S16BoardMain , PageRunState = Run\n'
const PLAIN_LINE = '[2026.10.17-14.24.11:563][590]LogWorld: Bringing World up\n'

test('a log with the game\'s own lines is ok, with its size and mtime', () => {
  const file = log('detail.log', DETAIL_LINE + PLAIN_LINE)
  const health = logHealth(file)
  expect(health).toEqual({
    path: resolve(file),
    size: statSync(file).size,
    modifiedAt: statSync(file).mtimeMs,
    detail: 'ok',
  })
})

test('a log without the game\'s own lines has no detail', () => {
  const file = log('plain.log', PLAIN_LINE)
  const health = logHealth(file)
  expect(health.path).toBe(resolve(file))
  expect(health.detail).toBe('no-detail')
  expect(health.size).toBe(statSync(file).size)
  expect(health.modifiedAt).toBe(statSync(file).mtimeMs)
})

test('an empty log has no detail', () => {
  const file = log('empty.log', '')
  expect(logHealth(file).detail).toBe('no-detail')
})

test('a missing log is missing, with its would-be path', () => {
  const file = join(dir, 'gone.log')
  expect(logHealth(file)).toEqual({ path: resolve(file), size: 0, modifiedAt: null, detail: 'missing' })
})

test('the game\'s own lines are looked for in the tail, not in the whole file', () => {
  // 128 KiB of plain lines, then the game's own one at the very end.
  const filler = PLAIN_LINE.repeat(2048)
  const file = log('tail.log', filler + DETAIL_LINE)
  expect(filler.length).toBeGreaterThan(64 * 1024)
  expect(logHealth(file).detail).toBe('ok')

  // The same lines with the game's own one long before the end: the probe
  // reads only the last 64 KiB, which has none of them.
  const early = log('early.log', DETAIL_LINE + filler)
  expect(logHealth(early).detail).toBe('no-detail')
})

test('a folder where the log should be is missing', () => {
  expect(logHealth(join(dir, 'not-a-log'))).toEqual({
    path: resolve(join(dir, 'not-a-log')),
    size: 0,
    modifiedAt: null,
    detail: 'missing',
  })
})
