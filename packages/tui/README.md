# @tli/tui

The parts the terminal tools share: the colours, the way the numbers are written, the way a row of
a table is laid out, and the helper that starts a renderer and always puts the terminal back.

The tools in this repo are drawn with [OpenTUI](https://opentui.com/docs): the native core does
the painting, the layout is flexbox, and the keyboard, the mouse and the resize come from the
terminal.

## What is in here

| Part | What it is |
|------|------------|
| `theme.ts` | the palette, the tones, and the switch that turns the colours off |
| `format.ts` | the numbers (`num`, `fe`, `duration`, `clock`) and the width of plain text |
| `rows.ts` | the cells of a row of a table and how they are laid out |
| `app.ts` | `startApp`: a renderer, and a way out that always puts the terminal back |

## The colours

Everything is drawn in one of the tones, so the tools look the same:

```typescript
import { theme, tone } from '@tli/tui'

tone('accent', 'TLI Loot Tracker')
tone('gold', fe(1234.5))
tone('dim', 'a quiet label')
```

The tones are `default`, `dim`, `bold`, `accent` (and its plain twin `cyan`), `brand`, `gold`,
`green`, `yellow`, `red`, `blue`, `purple`, `orange`, `teal`, `pink`, `key` and `paused`. The
colours themselves are in `theme`, so a tool can use `theme.text` or `theme.dim` directly when it
needs a colour of its own.

Each colour has a job, so the same thing has the same colour in every tool:

| Colour | For |
|--------|-----|
| `brand` (ember orange) | the name of the tool in the bar along the top |
| `accent` (cyan) | the focus: the focused panel, the picked row, the keys that can be pressed |
| `gold` | money: FE amounts |
| `green` / `red` | a gain and a loss, what is on and what is wrong |
| `yellow` | a warning |
| `blue` | names: items, maps, things that can be opened |
| `purple` | rare things: experience, special states |
| `orange` | effort and heat: a run in progress, a count that grows |
| `teal` | times and durations, a quiet success |
| `pink` | a mark that should not be missed |
| `dim` | labels, hints and paths |

Colours are turned off with `--no-color` or with the `NO_COLOR` environment variable. When they
are off, `tone` gives plain text, the borders use the terminal's own colour and the scrollbars use
it too: nothing is coloured.

## The chrome

`chrome.ts` has the small pieces of design the tools share. Every one of them turns plain when the
colours are off:

```typescript
import { brandChunks, chip, hintChunks, meter, panelBorderStyle, panelTitle, stat } from '@tli/tui'

brandChunks('TLI Loot Tracker', 'v1')                      // ◆ TLI Loot Tracker  v1
hintChunks([['q', 'quit'], ['?', 'help']])                 // the keys on caps, the labels quiet
chip('tax on', 'green')                                    // a label on a tinted background, [tax on] without colours
stat('FE/h', '1,204', 'gold')                              // a quiet label and a value in a tone
meter(0.4, 20, 'purple')                                   // ━━━━━━━━────────────
panelTitle('Runs', true)                                   // " ● Runs "
panelBorderStyle(true)                                     // 'heavy' for the focused panel, 'rounded' for the others
```

The bars along the top and the bottom are drawn on `surfaceColor()`. A panel that has the focus
gets the heavy border and the accent colour, so the focus can be told even by someone who cannot
see the colour.

## The rows of a table

A row is a list of cells. A cell with a width keeps it; the others share what is left:

```typescript
import { type Row, rowChunks } from '@tli/tui'

const row: Row = {
  cells: [
    { text: 'Ember Core' },
    { text: '12', width: 4, align: 'right' },
    { text: '60 FE', tone: 'gold', width: 12, align: 'right' },
  ],
}

const chunks = rowChunks(row, 40)
```

`rowChunks` gives back the pieces of the row, each with its colour. `rowText` gives the same row
as plain text, which is what the tests look at.

The width of the row is the width of the panel it is in. Give the row the width of the text area,
not the width of the panel: a panel has a border, and a scrollbar takes a column of its own.

## The overlay

A screen that opens over the others (the help, the detail of a run) needs a background of its own,
or what is behind it shows through the gaps in the text:

```typescript
import { backgroundColor } from '@tli/tui'

const overlay = new BoxRenderable(renderer, {
  position: 'absolute',
  left: 0,
  top: 0,
  width: '100%',
  height: '100%',
  backgroundColor: backgroundColor(),
})
```

`backgroundColor()` is the background of the theme, or the terminal's own background when the
colours are off. The box that holds the text needs it too, and so does the scroll box inside it.

## Starting and stopping

```typescript
import { startApp } from '@tli/tui'

const app = await startApp({
  onShutdown: () => save(),
})

app.renderer.root.add(screen.root)

app.renderer.keyInput.on('keypress', (key) => {
  if (key.name === 'q') {
    void app.stop()
    return
  }
  key.preventDefault()
})

await app.done
```

`startApp` makes the renderer, turns the colours off when `--no-color` or `NO_COLOR` is there, and
puts the terminal back on every way out: the key that quits, `SIGINT`, `SIGTERM` and `SIGHUP`. It
also handles `ctrl+c`, so the app does not have to.

`stop()` runs `onShutdown` first, so the app can save what it knows before the terminal is put
back. `done` resolves when the app has stopped.

## The conventions

The tools follow the same shape, so they are ported the same way:

1. **The state is plain data.** A `ViewState` holds what the screen is showing: which panel has the
   focus, what is picked out, what the tracker says. It has no terminal in it.
2. **The rows are plain data too.** The screen turns the state into rows of cells and draws them.
   The numbers can be looked at without a terminal.
3. **The screen is a tree of renderables.** It is built once and updated from the state. The layout
   is flexbox: the panels share the space and a resize is the renderer's business.
4. **The keys are read in one place.** A global `keypress` listener handles everything and calls
   `key.preventDefault()`, so nothing else sees the key. While a text field has the focus, the
   keys it needs are let through.
5. **The screen is drawn from the state.** `draw(state)` puts the state on the screen. It is called
   when something changes and once a second, so the clock keeps going.
6. **The tests use the test renderer.** `createTestRenderer` from `@opentui/core/testing` draws the
   screen without a terminal: `captureCharFrame()` gives the text and `captureSpans()` gives the
   colours. `mockInput` presses the keys and `mockMouse` clicks.

## The other tools

`apps/tracker` and `apps/arcana` have been ported. The others (`apps/warden`, `apps/vorax` and
`apps/dashboard`) still draw their own text; they can be ported the same way.
