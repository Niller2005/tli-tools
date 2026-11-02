# Glossary

- **@tli/store** — the persistence module: the life of a tool's saved-state database file (opening it, migrations, refusing a newer schema, quarantining a bad file as `.corrupt`, importing the old `state.json` once, the data directory). A tool supplies a `StoreSpec`: its migrations, row mapping and legacy state file.
- **adapter** — a tool's implementation of a shared module's spec at a seam: the loot tracker and the Arcana tracker are both adapters over `@tli/store`.
- **contract suite** — one parameterised test suite run against every adapter of a module (`packages/store/tests/contract.ts`), saying the behaviour is the same whichever tool owns it.
- **retry policy** (`retryCapture` in @tli/gamelog) — the back-off window around the capture seam: a failed grab is remembered for 2 s and the next automatic grab is refused with the same message; a manual read (`force`) goes through. `heldUp(gate)` gives the header note while nothing may be captured — the closed gate's status or the last failure, never both.
