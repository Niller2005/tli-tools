// The names of the items.
//
// The tracker ships a table of the names it knows (see `data/items.json` and the script that
// builds it). The player can add names of their own in a file next to their settings; those names
// win over the ones in the table. An item nobody knows is shown as "Item #<id>".

import { join } from 'node:path'
import { readFile } from 'node:fs/promises'

/** What one item is. */
export interface ItemEntry {
  /** the English name */
  name?: string
  /** the Chinese name */
  nameCn?: string
  /** the kind of item */
  type?: string
  /** the kind of item, in English */
  typeEn?: string
  /** where the entry's data came from */
  sources?: string[]
}

/** The table the tracker ships. */
export const ITEM_TABLE_PATH = join(import.meta.dir, '..', 'data', 'items.json')

/** What the shipped table says about itself, in the `meta` at its top. */
export interface ItemTableMeta {
  /** when the table was built, as an ISO time */
  generatedAt?: string
  /** where the table's data came from */
  source?: string
  /** how many items the table has */
  count?: number
}


/** The names of the items, from the shipped table and the player's own file. */
export class ItemNames {
  private readonly known: Record<string, ItemEntry>
  private readonly own: Record<string, string>

  constructor(known: Record<string, ItemEntry>, own: Record<string, string> = {}) {
    this.known = known
    this.own = own
  }

  /** Reads the shipped table and, if it is there, the player's own names. */
  static async load(tablePath = ITEM_TABLE_PATH, ownPath?: string): Promise<ItemNames> {
    let known: Record<string, ItemEntry> = {}
    try {
      const raw = JSON.parse(await readFile(tablePath, 'utf8')) as { items?: Record<string, ItemEntry> }
      known = raw.items ?? {}
    } catch {
      known = {}
    }
    let own: Record<string, string> = {}
    if (ownPath !== undefined) {
      try {
        const raw = JSON.parse(await readFile(ownPath, 'utf8')) as Record<string, unknown>
        for (const [id, name] of Object.entries(raw)) {
          if (typeof name === 'string' && name !== '') own[id] = name
        }
      } catch {
        own = {}
      }
    }
    return new ItemNames(known, own)
  }

  /** The name of an item. */
  name(item: number): string {
    const own = this.own[String(item)]
    if (own !== undefined) return own
    const entry = this.known[String(item)]
    if (entry?.name !== undefined && entry.name !== '') return entry.name
    return `Item #${item}`
  }

  /** The Chinese name of an item, when the table has one. */
  nameCn(item: number): string | null {
    return this.own[String(item)] ?? this.known[String(item)]?.nameCn ?? null
  }

  /** The kind of an item, when the table has one. */
  type(item: number): string | null {
    return this.known[String(item)]?.type ?? null
  }

  /** The kind of an item in English, when the table has one. */
  typeEn(item: number): string | null {
    return this.known[String(item)]?.typeEn ?? null
  }

  /** Where the table's data about an item came from. */
  sources(item: number): string[] {
    return this.known[String(item)]?.sources ?? []
  }

  /** Whether the tracker knows what this item is. */
  knows(item: number): boolean {
    return this.own[String(item)] !== undefined || this.known[String(item)]?.name !== undefined
  }

  /** The path the player's own names are read from. */
  static ownPath(configDir: string): string {
    return join(configDir, 'items.json')
  }

  /** The directory the player's own names live in. */
  static defaultConfigDir(): string {
    const xdg = process.env.XDG_CONFIG_HOME
    if (xdg !== undefined && xdg !== '') return join(xdg, 'tli-tracker')
    return join(process.env.HOME ?? '.', '.config', 'tli-tracker')
  }
}

/** The directory the player's own names live in, and where they are written. */
export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg !== undefined && xdg !== '') return join(xdg, 'tli-tracker')
  return join(process.env.HOME ?? '.', '.config', 'tli-tracker')
}

/** The directory the tracker's own files live in. */
export function dataDir(): string {
  const xdg = process.env.XDG_DATA_HOME
  if (xdg !== undefined && xdg !== '') return join(xdg, 'tli-tracker')
  return join(process.env.HOME ?? '.', '.local', 'share', 'tli-tracker')
}

/** Where the player's own item names are read from. */
export function userItemsPath(): string {
  return join(configDir(), 'items.json')
}

/** The path of a file in the tracker's data directory. */
export function dataPath(name: string): string {
  return join(dataDir(), name)
}

/** Reads the shipped table's meta, the small print at its top; null when the table cannot be read. */
export async function readItemTableMeta(tablePath = ITEM_TABLE_PATH): Promise<ItemTableMeta | null> {
  try {
    const raw = JSON.parse(await readFile(tablePath, 'utf8')) as { meta?: ItemTableMeta }
    return raw.meta ?? null
  } catch {
    return null
  }
}

/**
 * How old the shipped item-name table is, from the time its own meta says it was built; null when
 * the table cannot be read or does not say.
 */
export async function itemTableAge(tablePath = ITEM_TABLE_PATH, now = Date.now()): Promise<number | null> {
  const meta = await readItemTableMeta(tablePath)
  const generatedAt = meta?.generatedAt
  if (generatedAt === undefined) return null
  const at = Date.parse(generatedAt)
  return Number.isNaN(at) ? null : Math.max(0, now - at)
}
