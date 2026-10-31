# AGENTS.md

Terminal tools for Torchlight: Infinite on Linux. Bun workspaces (`apps/*`, `packages/*`), TypeScript, screens drawn
with `@opentui/core`. The README has the overview; this file has the rules for changing the code.

## Commands

| Command | Does |
|---------|------|
| `bun install` | Install the workspaces |
| `bun run test` | Every suite (listed one by one in the root `package.json`) |
| `bun run typecheck` | `tsc` for every app and package that has a `tsconfig` |
| `bun run --cwd apps/<name> test` | One app's suite |

A new app or package with tests or a `tsconfig` MUST be added to the `test` / `typecheck` scripts in the root
`package.json`. They are explicit chains, not workspace globs.

## Layout

- `apps/*`: the tools (`dashboard`, `vorax`, `warden`, `tracker`, `arcana`). Each has its own README.
- `packages/*`: code shared by the apps. `tui` (theme, formatting, start-up), `png`, `capture`, `ocr`, `gamelog`,
  `launch` (tool list, terminals, tmux), `tracker` and `arcana` (log parsing).
- Apps depend on packages as `workspace:*`. Packages MUST NOT import from apps.
- Adding a tool to the dashboard is one entry in `packages/launch/src/tools.ts`.

## Rules

- **Never touch the game.** Read pixels (`grim`, a custom capture command) and the log file only. No memory reading,
  no network traffic, no clicks or keystrokes sent to the game.
- **Warden:** `apps/warden/ts` is the maintained version. The Rust source in `apps/warden/src` is deprecated: do not
  change it, and the TypeScript tests need not match its output.
- **Licences:** `apps/warden` is GPL-3.0-only, `apps/vorax` is MIT, and the root has none. Do not copy code between
  the two apps. Shared code goes into `packages/*`. Third-party data and its terms are in
  `docs/third-party-data.md`; keep it current when a source is added.
- **Tests:** `TLI_NO_CAPTURE=1` keeps Warden's tests from capturing the real screen. Real-frame fixtures are fine;
  do not test wording or incidental output.
- **Docs:** a user-visible change updates the README of its app and, where one exists, the matching page in `docs/`.
- **Commits:** Conventional Commits (`feat(tracker): …`, `fix(warden): …`, `docs: …`), one logical change each.
  Scopes seen in history: `warden`, `tracker`, `capture`.
- **Scratch files:** keep probes and screenshots in `/tmp`, not in the repo.
