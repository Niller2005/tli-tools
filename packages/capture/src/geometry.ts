// Where the game window is on the screen, and how to take its picture without
// waking Niri's "Screenshot captured" notification.
//
// Niri (26.04) says where a window is only for the floating ones: a tiled window
// gets the size of its tile but no position (`layout.tile_pos_in_workspace_view`
// is null), so a tiled window can only be taken silently when it fills its output.
// Every position here is in logical pixels, in the layout's coordinates: the same
// ones `grim -g` takes, and the ones `niri msg --json outputs` gives for an
// output (`logical.x`, `logical.y`).

/** A rectangle in logical pixels. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** What `niri msg --json windows` says about one window. */
export interface NiriWindow {
  id: number
  title: string | null
  app_id: string | null
  workspace_id: number | null
  is_focused: boolean
  is_floating: boolean
  layout: {
    /** the window's own size, without Niri's decorations */
    window_size: [number, number]
    /** where the window sits inside its tile */
    window_offset_in_tile: [number, number]
    /** where the tile sits in the workspace view; null when Niri does not say */
    tile_pos_in_workspace_view: [number, number] | null
  }
}

/** What `niri msg --json workspaces` says about one workspace. */
export interface NiriWorkspace {
  id: number
  output: string
  is_active: boolean
  active_window_id: number | null
}

/** What `niri msg --json outputs` says about one output. */
export interface NiriOutput {
  logical: { x: number; y: number; width: number; height: number; scale: number }
}

/** How to take the picture of the game window. */
export type Plan =
  /** no silent picture is possible; Niri's own picture needs an explicit opt-in */
  | { kind: 'none'; reason: string }
  /** Niri's own window picture: it works for any window, but Niri announces it */
  | { kind: 'window' }
  /** the whole output, through grim: silent */
  | { kind: 'output'; output: string }
  /** a part of the output, through grim: silent */
  | { kind: 'region'; output: string; region: Rect }

/** A logical pixel is this close to another one. */
const EPS = 1

/** The whole output, as a rectangle. */
export function outputRect(output: NiriOutput): Rect {
  const l = output.logical
  return { x: l.x, y: l.y, width: l.width, height: l.height }
}

/** Where the window is on the screen, or null when Niri does not say. */
export function windowRect(w: NiriWindow): Rect | null {
  const pos = w.layout.tile_pos_in_workspace_view
  if (!pos) return null
  const [dx, dy] = w.layout.window_offset_in_tile
  const [width, height] = w.layout.window_size
  return { x: pos[0] + dx, y: pos[1] + dy, width, height }
}

/** Do the two rectangles share any ground? */
export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** The part of the rectangle that is on the output, or null when there is none. */
export function clipToOutput(rect: Rect, output: NiriOutput): Rect | null {
  const l = output.logical
  const x = Math.max(rect.x, l.x)
  const y = Math.max(rect.y, l.y)
  const right = Math.min(rect.x + rect.width, l.x + l.width)
  const bottom = Math.min(rect.y + rect.height, l.y + l.height)
  if (right <= x || bottom <= y) return null
  return { x, y, width: right - x, height: bottom - y }
}

/** Does the rectangle cover the whole output? */
export function coversOutput(rect: Rect, output: NiriOutput): boolean {
  const l = output.logical
  return (
    rect.x <= l.x + EPS &&
    rect.y <= l.y + EPS &&
    rect.x + rect.width >= l.x + l.width - EPS &&
    rect.y + rect.height >= l.y + l.height - EPS
  )
}

/** Is the window as big as the whole output? */
export function fillsOutput(w: NiriWindow, output: NiriOutput): boolean {
  const l = output.logical
  const [dx, dy] = w.layout.window_offset_in_tile
  return dx === 0 && dy === 0 && w.layout.window_size[0] === l.width && w.layout.window_size[1] === l.height
}

/** The region as `grim -g` wants it: whole logical pixels, from the left top. */
export function grimGeometry(rect: Rect): string {
  const x = Math.floor(rect.x)
  const y = Math.floor(rect.y)
  const right = Math.ceil(rect.x + rect.width)
  const bottom = Math.ceil(rect.y + rect.height)
  return `${x},${y} ${right - x}x${bottom - y}`
}

/**
 * Is the game window hidden behind another window?
 *
 * Niri draws the floating windows over the tiled ones, and the focused floating
 * window over the other floating ones, so only those can hide the game.
 */
export function obscured(windows: NiriWindow[], game: NiriWindow, rect: Rect): boolean {
  for (const other of windows) {
    if (other.id === game.id) continue
    if (other.workspace_id !== game.workspace_id) continue
    if (!other.is_floating) continue
    // A floating window that is not the focused one lies under the focused one.
    if (game.is_floating && !other.is_focused) continue
    const otherRect = windowRect(other)
    if (!otherRect) continue
    if (intersects(otherRect, rect)) return true
  }
  return false
}

/**
 * How to take the picture of the game window.
 *
 * The silent ways need the game to be on the screen: a window on a workspace
 * that is not the active one on its output is not on the screen at all, and only
 * Niri can take a picture of it.
 */
export function planCapture(o: {
  /** the game window */
  window: NiriWindow
  /** every window Niri knows about */
  windows: NiriWindow[]
  workspaces: NiriWorkspace[]
  outputs: Record<string, NiriOutput | undefined>
  /** Niri's overview is open: the screen shows the workspaces, not the game */
  overviewOpen: boolean
  /** whether Niri's announced window screenshot may be used */
  niriScreenshot?: boolean
}): Plan {
  const game = o.window
  const unavailable = (why: string): Plan =>
    o.niriScreenshot === true
      ? { kind: 'window' }
      : {
          kind: 'none',
          reason: `the game is not on screen (${why}); no picture taken so that niri does not notify`,
        }

  // The overview draws the whole workspace small: the game is not on the screen.
  if (o.overviewOpen) return unavailable('the niri overview is open')
  const workspace = o.workspaces.find(s => s.id === game.workspace_id)
  if (!workspace) return unavailable('niri does not know its workspace')
  const output = o.outputs[workspace.output]
  if (!output) return unavailable('niri does not know its output')
  // The workspace is not the one on the screen: the game is not on the screen.
  if (!workspace.is_active) return unavailable('its workspace is not showing')

  const rect = windowRect(game)
  if (!rect) {
    // Niri does not say where a tiled window is. It fills its output when it is
    // the only window of the workspace, and then the whole output is the game.
    if (!fillsOutput(game, output)) return unavailable('niri cannot see the position of this tiled window')
    if (workspace.active_window_id !== game.id) return unavailable('it is not the active window')
    if (obscured(o.windows, game, outputRect(output))) return unavailable('another window is over it')
    return { kind: 'output', output: workspace.output }
  }

  if (obscured(o.windows, game, rect)) return unavailable('another window is over it')
  if (coversOutput(rect, output)) return { kind: 'output', output: workspace.output }
  const region = clipToOutput(rect, output)
  if (!region) return unavailable('it is outside the output')
  return { kind: 'region', output: workspace.output, region }
}
