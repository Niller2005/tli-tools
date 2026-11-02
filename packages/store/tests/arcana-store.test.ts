// The contract suite, run against the Arcana tracker's store.
//
// The states and the comparisons come from the Arcana package's own test fixtures; the old state
// file is what its JSON predecessor wrote. The suite itself is `contract.ts`, shared with the
// loot tracker's store. The Arcana tracker's schema has only the one version, so there is no old
// database to carry over yet.

import { describe } from 'bun:test'

import { SCHEMA_VERSION, emptyHistory, loadArcana, saveArcana, type SavedArcana } from '@tli/arcana'

import { expectSameSaved, theRest, trackerPartway } from '../../arcana/tests/helpers'
import { theStoreContract } from './contract'

/** A saved state of everything the tracker keeps, with nothing left open. */
function fullState(): SavedArcana {
  const tracker = trackerPartway()
  tracker.feed(theRest())
  return { version: SCHEMA_VERSION, log: { file: 'UE_game.log', offset: 4321 }, history: tracker.state, snapshot: tracker.snapshot() }
}

/** The same state before the rest of it: the visit and the contest are still open, so the next
 * save has something to do. */
function partwayState(): SavedArcana {
  const tracker = trackerPartway()
  return { version: SCHEMA_VERSION, log: { file: 'UE_game.log', offset: 100 }, history: tracker.state, snapshot: tracker.snapshot() }
}

/** The old state file's content: what the JSON tracker wrote for the whole replay. */
const replayed = fullState()
const legacyState = JSON.parse(
  JSON.stringify({ version: 2, log: { file: 'UE_game.log', offset: 9999 }, history: replayed.history, snapshot: replayed.snapshot }),
) as SavedArcana

describe('the Arcana store', () => {
  theStoreContract<SavedArcana>({
    name: 'the Arcana tracker',
    schemaVersion: SCHEMA_VERSION,
    load: loadArcana,
    save: saveArcana,
    full: replayed,
    changed: partwayState(),
    expectSame: expectSameSaved,
    legacy: `${JSON.stringify(legacyState)}\n`,
    expectImported: (loaded) => expectSameSaved(loaded, { ...legacyState, version: SCHEMA_VERSION }),
    refused: [
      '{not json',
      JSON.stringify({ version: 1, history: emptyHistory() }), // the version before the one this code reads
      JSON.stringify({ version: 2, log: { file: 'a', offset: 0 } }), // half a state
    ],
  })
})
