import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, truncateSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LogReader, readTail } from '../src/log'

const dirs: string[] = []

/** A file with the given lines in it. */
function fileWith(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'tli-tracker-'))
  dirs.push(dir)
  const path = join(dir, 'UE_game.log')
  writeFileSync(path, `${lines.join('\n')}\n`)
  return path
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('reading the log', () => {
  test('the lines are read', () => {
    const path = fileWith(['one', 'two', 'three'])
    const reader = new LogReader(path, 0)
    const batch = reader.read()
    expect(batch.lines).toEqual(['one', 'two', 'three'])
    expect(batch.offset).toBeGreaterThan(0)
  })

  test('only the new lines are read the second time', () => {
    const path = fileWith(['one', 'two'])
    const reader = new LogReader(path, 0)
    reader.read()
    writeFileSync(path, 'one\ntwo\nthree\n')
    const batch = reader.read()
    expect(batch.lines).toEqual(['three'])
  })

  test('a log that was truncated is read from its start again', () => {
    const path = fileWith(['one', 'two', 'three'])
    const reader = new LogReader(path, 0)
    reader.read()
    truncateSync(path, 0)
    writeFileSync(path, 'new\n')
    const batch = reader.read()
    expect(batch.restarted).toBe(true)
    expect(batch.lines).toEqual(['new'])
  })

  test('a saved offset past the end of a shorter log starts again from the top', () => {
    const path = fileWith(['new', 'log'])
    const reader = new LogReader(path, 1_000_000)
    const batch = reader.read()
    expect(batch.restarted).toBe(true)
    expect(batch.lines).toEqual(['new', 'log'])
  })

  test('a log that is not there gives nothing', () => {
    const reader = new LogReader('/nowhere/at/all/UE_game.log', 0)
    const batch = reader.read()
    expect(batch.lines).toEqual([])
    expect(batch.size).toBe(0)
  })

  test('the tail of the log is read as whole lines', () => {
    const path = fileWith(['one', 'two', 'three'])
    expect(readTail(path, 1024)).toEqual(['one', 'two', 'three'])
  })
})
