// The life of a saved state's database file, kept the same way for every tool that saves itself.
//
//   import { defineStore } from '@tli/store'
//
//   const store = defineStore({
//     tool: 'the tracker',
//     dir: 'tli-tracker',
//     dbFile: 'tracker.db',
//     migrations,
//     parseLegacyState,
//     read,
//     write,
//   })
//   const saved = await store.load()
//   await store.save(state)

export { defineStore, dataDir, type Store, type StoreSpec } from './store'
