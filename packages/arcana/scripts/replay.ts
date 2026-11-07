#!/usr/bin/env bun
// Replays the game's log through the tracker and prints what it found.
//
//   bun scripts/replay.ts [--log=<UE_game.log>]
//
// The log is read in pieces, so a log of any size can be replayed.

import { openSync, readSync, closeSync, statSync } from 'node:fs'
import { arg } from '@tli/tui'
import { Tracker } from '../src/index'

const file = arg('log') ?? process.argv[2]
if (file === undefined || file === '') {
  process.stderr.write('usage: bun scripts/replay.ts --log=<UE_game.log>\n')
  process.exit(1)
}

const CHUNK = 1 << 20

const tracker = new Tracker()
const started = Date.now()

const fd = openSync(file, 'r')
try {
  const size = statSync(file).size
  let offset = 0
  let rest = ''
  while (offset < size) {
    const want = Math.min(CHUNK, size - offset)
    const buf = Buffer.allocUnsafe(want)
    const got = readSync(fd, buf, 0, want, offset)
    if (got <= 0) break
    offset += got
    const parts = (rest + buf.subarray(0, got).toString('utf8')).split('\n')
    rest = parts.pop() ?? ''
    tracker.feed(parts)
  }
  if (rest !== '') tracker.feed([rest])
} finally {
  closeSync(fd)
}

const took = Date.now() - started
const state = tracker.state

console.log(`read ${file} in ${took} ms`)
console.log(`sessions: ${state.sessions.length}`)
for (const s of state.sessions) {
  console.log(
    `  #${s.id} ${new Date(s.openedAt).toISOString()} → ${s.closedAt === null ? 'open' : new Date(s.closedAt).toISOString()}`,
  )
  console.log(
    `     moves=${s.moves.length} cells=${s.cells} notes=${s.notes} played=${s.played} chests=${s.chests.length} life -${s.lifeLost}/+${s.lifeWon}`,
  )
  for (const chest of s.chests) {
    console.log(`     chest slot=${chest.slot} rarity=${chest.rarity ?? '?'} upgrades=${chest.upgrades}`)
  }
  for (const move of s.moves) {
    const landed = move.landed === null ? '?' : `${move.landed.kind}${move.landed.rarity === null ? '' : `:${move.landed.rarity}`}`
    console.log(
      `     move ${new Date(move.at).toISOString()} steps=${move.steps.join('>')} cells=${move.cells} L${move.left}/R${move.right} landed=${landed} life=${move.life} gained=${move.gained} played=${move.played}`,
    )
  }
}
console.log(`contests: ${state.contests.length}`)
for (const c of state.contests) {
  console.log(
    `  asked=${c.askedAt === null ? '-' : new Date(c.askedAt).toISOString()} opened=${c.openedAt === null ? '-' : new Date(c.openedAt).toISOString()} closed=${c.closedAt === null ? '-' : new Date(c.closedAt).toISOString()} chests=${c.chests.length}`,
  )
  for (const chest of c.chests) {
    console.log(`     chest ${new Date(chest.at).toISOString()} rewards=${chest.rewards.map((r) => `${r.item}x${r.qty}`).join(' ')}`)
  }
}
console.log(`trials: ${state.trials.length}`)
for (const t of state.trials) {
  console.log(`  ${new Date(t.at).toISOString()} ${t.arcana === '' ? '(unnamed)' : t.arcana}`)
}
