//! The stage timings of the app, for the player who wants to know where
//! the time goes: the environment variable `WARDEN_PROFILE` names the file
//! the timings are written to, one JSON line each. Nothing is written when
//! it is not set.

import { appendFileSync } from 'node:fs'

/** The file the timings go to, when the player asks for them. */
const file = process.env.WARDEN_PROFILE ?? null

/** Whether the timings are written. */
export const on = file !== null

/** The time a stage took, in milliseconds, written to the file. */
export function timed(stage: string, ms: number): void {
  if (file === null) return
  appendFileSync(file, `${JSON.stringify({ at: Date.now(), stage, ms: Math.round(ms * 10) / 10 })}\n`)
}
