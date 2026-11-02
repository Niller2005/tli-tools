# @tli/store

The life of a saved state's database file, kept the same way for every tool that saves itself.

Right now this package holds the **contract suite**: the things that must be true of the file any
tool keeps its saved state in — the loot tracker's (`@tli/tracker`) and the Arcana tracker's
(`@tli/arcana`) — because the algorithm behind them is one and the same, and is being moved here
(plan item 1 of `docs/plan-architecture.md`). Each tool's entry file (`tests/tracker-store.test.ts`
and, later, `tests/arcana-store.test.ts`) supplies its saved state, its comparisons and the shape
of what its own earlier versions left on disk; the suite (`tests/contract.ts`) says the file is
kept the same way:

- nothing on disk is nothing saved, and nothing is made of it;
- a database of an older schema version is carried to the current one with what it held;
- a file that is not a database reads as nothing, and the next save starts a fresh one beside it,
  keeping the broken one as `<db>.corrupt`;
- a database of a newer schema is left alone, and nothing is written to it;
- the old `state.json` is brought in once, and kept as `state.json.imported`;
- a state file that cannot be used is left where it is, with nothing written;
- a save with nothing changed writes nothing.

## Tests

```sh
bun test            # the contract suite, against every tool's store
bun run typecheck
```
