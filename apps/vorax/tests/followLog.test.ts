import { describe, expect, test } from 'bun:test'
import { createFollower, type FileLike } from '@/reader/live/logFollower'

/** A log file that can grow, be cut short, or fail to open. */
function fakeFile(initial = '') {
  let data = new TextEncoder().encode(initial)
  const state = { failing: false }
  const handle: FileLike = {
    async getFile() {
      if (state.failing) throw new Error('gone')
      const snapshot = data
      return {
        size: snapshot.length,
        slice: (a, b) => ({ arrayBuffer: async () => snapshot.slice(a, b).buffer as ArrayBuffer }),
      }
    },
  }
  return {
    handle,
    state,
    append(text: string | Uint8Array) {
      const add = typeof text === 'string' ? new TextEncoder().encode(text) : text
      const next = new Uint8Array(data.length + add.length)
      next.set(data)
      next.set(add, data.length)
      data = next
    },
    replace(text: string) {
      data = new TextEncoder().encode(text)
    },
  }
}

describe('the log follower', () => {
  test('the first poll gives nothing, however much the log holds', async () => {
    const f = fakeFile('old 1\nold 2\n')
    const follower = createFollower(f.handle)
    expect(await follower.poll()).toEqual([])
    expect(await follower.poll()).toEqual([])
  })

  test('later polls give the complete lines written since the last', async () => {
    const f = fakeFile('old\n')
    const follower = createFollower(f.handle)
    await follower.poll()
    f.append('a\nb\n')
    expect(await follower.poll()).toEqual(['a', 'b'])
    f.append('c\n')
    expect(await follower.poll()).toEqual(['c'])
    expect(await follower.poll()).toEqual([])
  })

  test('a line still being written waits for its end', async () => {
    const f = fakeFile()
    const follower = createFollower(f.handle)
    await follower.poll()
    f.append('whole\npart')
    expect(await follower.poll()).toEqual(['whole'])
    f.append('ial\nnext')
    expect(await follower.poll()).toEqual(['partial'])
    f.append('\n')
    expect(await follower.poll()).toEqual(['next'])
  })

  test('carriage returns before the line ends are dropped', async () => {
    const f = fakeFile()
    const follower = createFollower(f.handle)
    await follower.poll()
    f.append('a\r\nb\r\n\r\n')
    expect(await follower.poll()).toEqual(['a', 'b', ''])
  })

  test('a character split between two polls arrives whole', async () => {
    const f = fakeFile()
    const follower = createFollower(f.handle)
    await follower.poll()
    const bytes = new TextEncoder().encode('é€\n')
    f.append(bytes.slice(0, 2))
    expect(await follower.poll()).toEqual([])
    f.append(bytes.slice(2))
    expect(await follower.poll()).toEqual(['é€'])
  })

  test('a log that starts over is read from its beginning', async () => {
    const f = fakeFile('a long old log\nwith lines\n')
    const follower = createFollower(f.handle)
    await follower.poll()
    f.replace('new\n')
    expect(await follower.poll()).toEqual(['new'])
  })

  test('a line cut off before the log started over is not joined to the new log', async () => {
    const f = fakeFile('')
    const follower = createFollower(f.handle)
    await follower.poll()
    f.append('cut off midway through a li')
    expect(await follower.poll()).toEqual([])
    f.replace('fresh\n')
    expect(await follower.poll()).toEqual(['fresh'])
  })

  test('when the log cannot be opened the poll is empty and the next one carries on', async () => {
    const f = fakeFile('x\n')
    const follower = createFollower(f.handle)
    await follower.poll()
    f.append('a\n')
    f.state.failing = true
    expect(await follower.poll()).toEqual([])
    f.state.failing = false
    expect(await follower.poll()).toEqual(['a'])
  })

  test('a log that cannot be opened at first is still noted at its end when it can', async () => {
    const f = fakeFile('history\n')
    f.state.failing = true
    const follower = createFollower(f.handle)
    expect(await follower.poll()).toEqual([])
    f.state.failing = false
    expect(await follower.poll()).toEqual([])
    f.append('a\n')
    expect(await follower.poll()).toEqual(['a'])
  })

  test('more than the most it reads at once skips ahead and drops the line it lands in', async () => {
    const f = fakeFile('x\n')
    const follower = createFollower(f.handle, { maxRead: 20 })
    await follower.poll()
    f.append('line1\nline2\nline3\nline4\n')
    const lines = await follower.poll()
    expect(lines).toEqual(['line2', 'line3', 'line4'])
  })

  test('exactly the most it reads is read in full', async () => {
    const f = fakeFile('x\n')
    const follower = createFollower(f.handle, { maxRead: 12 })
    await follower.poll()
    f.append('line1\nline2\n')
    expect(await follower.poll()).toEqual(['line1', 'line2'])
  })

  test('the game\'s detail lines are noticed, and stay noticed', async () => {
    const f = fakeFile()
    const follower = createFollower(f.handle)
    await follower.poll()
    expect(follower.detailSeen).toBe(false)
    f.append('LogTemp: Display: nothing of interest\n')
    await follower.poll()
    expect(follower.detailSeen).toBe(false)
    f.append('[2026.10.17-14.23.45:703][837]TLLua: Display: [Game] hello\n')
    await follower.poll()
    expect(follower.detailSeen).toBe(true)
    f.append('plain\n')
    await follower.poll()
    expect(follower.detailSeen).toBe(true)
  })
})
