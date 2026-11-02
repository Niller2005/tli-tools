# @tli/store

The life of a saved state's database file, kept the same way for every tool that saves itself.

```ts
import { defineStore } from '@tli/store'

const store = defineStore({
  tool: 'the tracker',
  dir: 'tli-tracker',
  dbFile: 'tracker.db',
  migrations, // one SQL entry per schema version
  parseLegacyState, // the old state.json, before there was a database
  read, // the saved state out of the tool's own tables
  write, // what changed into them, in one transaction
})

const saved = await store.load() // null when there is nothing, or it cannot be read
await store.save(saved)
const rows = store.look(path, (db) => db.query('…').all())
```

The module owns everything every saved state needs: opening the database, bringing its schema up
to date, refusing one a newer version wrote, setting a file that is not a usable database aside
(as `<db>.corrupt`, kept, never deleted), bringing the old `state.json` in once (kept as
`state.json.imported`), and finding the data directory (`$XDG_DATA_HOME/<tool>`, or
`~/.local/share/<tool>`). What a tool supplies is its own: the schema's migrations, the mapping
between its saved state and its tables' rows, and how the state file it kept before the database
is read. Two tools are adapters over it — the loot tracker (`@tli/tracker`) and the Arcana tracker
(`@tli/arcana`) — which is what makes the seam real.

## The contract suite

`tests/contract.ts` is one suite, run against every adapter (`tests/tracker-store.test.ts`,
`tests/arcana-store.test.ts`): the file is kept the same way whichever tool owns it. Each entry
file supplies its tool's saved state, its comparisons and the shape of what its own earlier
versions left on disk; the suite says:

- nothing on disk is nothing saved, and nothing is made of it;
- a database of an older schema version is carried to the current one with what it held;
- a file that is not a database reads as nothing, and the next save starts a fresh one beside it,
  keeping the broken one as `<db>.corrupt`;
- a database of a newer schema is left alone, and nothing is written to it;
- the old `state.json` is brought in once, and kept as `state.json.imported`;
- a state file that cannot be used is left where it is, with nothing written;
- a save with nothing changed writes nothing, and a change does write.

## Tests

```sh
bun test            # the contract suite, against every tool's store
bun run typecheck
```
