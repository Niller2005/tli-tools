//! The engine's own tests, ported from the Rust crate's src/engine modules.

import { expect, test } from 'bun:test'
import { hashSeed, rand } from '@/engine/rng'

test('hash and stream match js', () => {
  // Values from the JS hashSeed and rng32 under Node.
  const s = { rng: hashSeed('TRACE-0001|empty') }
  expect(s.rng).toBe(3278519699)
  expect(rand(s)).toBe(0.18879732862114906)
  expect(rand(s)).toBe(0.5664459567051381)
  expect(rand(s)).toBe(0.7377160913310945)
})
