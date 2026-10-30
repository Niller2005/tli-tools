# Dashboard

A terminal launcher for the tools in this repo. Pick one or more tools and start them from one place.

```
bun run start          # from the repo root
bun src/main.ts        # from apps/dashboard
```

| Key | Action |
|-----|--------|
| `↑` / `↓` (or `k` / `j`) | Move |
| `space` | Select or unselect the tool under the cursor |
| `a` | Select all |
| `enter` | Run the selected tools (the one under the cursor if none is selected) |
| `q` | Quit |

## How tools start

- **One tool** takes over the terminal. When it exits you are back at the dashboard.
- **Several tools** need `tmux`, since two full-screen programs cannot share a terminal. They open as tiled panes in a
  new window if you are already inside tmux, or in a new tmux session otherwise. A pane stays open after its tool exits
  so you can read any error.
- A tool whose required programs (`bun`, `tesseract`, ...) are not installed shows what is missing and does not start.

## Adding a tool

Add an entry to `TOOLS` in [`src/tools.ts`](src/tools.ts): an id, a name, a description, the command and its working
directory, and the programs it needs on `PATH`. It then shows up in the list.

No dependencies: the interface is plain ANSI.
