// How the times are written.
//
// The game writes its log in the player's local time, and the tracker keeps those times as
// they are written (as if they were UTC). So the times are shown with the UTC getters: they
// read exactly as they do in the log, whatever the time zone of this computer is.
//
// The numbers and the durations come from `@tli/tui`, so every tool in the repo writes them
// the same way.

const pad = (n: number): string => String(n).padStart(2, '0')

/** A time of day on the log's clock: "21:28:06". */
export function clock(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

/** A date and a time on the log's clock: "10-30 01:32". */
export function stamp(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** "The Hanged Man" from the game's "TheHangedMan". */
export function arcanaName(raw: string): string {
  return raw.replace(/([a-z])([A-Z])/g, '$1 $2')
}
