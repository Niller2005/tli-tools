import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ItemNames } from '../src/items'
import { addWiki, displayName, normalize } from '../scripts/generate-items'
import { parseCard, parsePage, slugName } from '../scripts/scrape-tlidb'

/** A piece of the upstream data, as the TITrack project writes it. */
const UPSTREAM = {
  items: [
    { id: 1001, name_en: 'Sparks of Moth Fire', name_cn: '星星蛾火', type_cn: '传奇装备' },
    { id: 5140, name_en: 'Memory Scrap', name_cn: '追忆碎絮', type_cn: '追忆碎絮' },
    { id: 5142, name_en: '', name_cn: '追忆游丝', type_cn: '追忆游丝' },
  ],
}

/** A piece of a wiki page, as the wiki writes it. */
const PAGE = `
<div class="page-content container" role="main">
<h1>All Magic Shoes</h1>
<div class="card ui_item popupItem">
  <div class="item_ver">SS14Season</div>
  <img src="https://cdn.tlidb.com/UIV2/Common/Icon/UI/Textures/EquipCommon/NoAtlas_112_160/Icon_Equip_Shoes_Int_Norm_003_02_112.webp" class="ui_item_base ui_item_quality1"/>
  <h5 class="card-title" style="margin-top: 0.5rem">All Magic Shoes</h5>
  <span class="border p-1 mb-1 tag tlborder">INT Boots</span>
  <span class="border p-1 mb-1 tag tlborder">Require lv 76</span>
  <div data-block="description2">Feet</div>
</div>
<div class="card ui_item">
  <div class="card-header">Info</div>
  <div class="card-body"><div>id: 4110</div></div>
</div>
</div>`

/** The card the wiki shows for one id. */
const CARD = `
<div class="card ui_item popupItem">
  <div class="item_ver">SS14Season</div>
  <img src="https://cdn.tlidb.com/UIV2/Common/Icon/UI/Textures/EquipCommon/NoAtlas_112_160/Icon_Equip_Shoes_Int_Norm_003_02_112.webp" class="ui_item_base ui_item_quality1"/>
  <h5 class="card-title" style="margin-top: 0.5rem">Imperishable Feet</h5>
  <span class="border p-1 mb-1 tag tlborder">INT Boots</span>
  <span class="border p-1 mb-1 tag tlborder">Require lv 70</span>
  <div data-block="description2">Feet</div>
</div>`

describe('the item table', () => {
  test('the upstream data becomes a table that says where every entry came from', () => {
    const table = normalize(UPSTREAM)
    expect(table.items['1001']).toEqual({
      name: 'Sparks of Moth Fire',
      nameCn: '星星蛾火',
      type: '传奇装备',
      sources: ['titrack'],
    })
    expect(table.meta.count).toBe(3)
    expect(table.meta.sources).toEqual([])
  })

  test('the wiki fills in the ids the upstream data leaves out', () => {
    const table = normalize(UPSTREAM)
    const merged = addWiki(table, {
      items: {
        '4109': { name: 'Imperishable Feet', family: 'INT Boots', from: 'card' },
        '4110': { name: 'All Magic Shoes', family: 'INT Boots', from: 'card' },
      },
    })
    expect(merged.items['4109']).toEqual({
      name: 'Imperishable Feet (Int)',
      type: 'INT Boots',
      typeEn: 'INT Boots',
      sources: ['tlidb'],
    })
    expect(merged.items['5142']?.name).toBeUndefined()
    expect(merged.meta.count).toBe(5)
  })

  test('the names the upstream data has are kept', () => {
    const table = normalize(UPSTREAM)
    const merged = addWiki(table, {
      items: { '1001': { name: 'Hardrock Mallet', family: 'Two-Handed Hammer', from: 'card' } },
    })
    expect(merged.items['1001']?.name).toBe('Sparks of Moth Fire')
    expect(merged.items['1001']?.sources).toEqual(['titrack', 'tlidb'])
    expect(merged.items['1001']?.typeEn).toBe('Two-Handed Hammer')
  })

  test('the name of a gear base says which attribute it rolls', () => {
    expect(displayName({ name: 'All Magic Shoes', family: 'INT Boots', from: 'card' })).toBe(
      'Magic Shoes (Int)',
    )
    expect(displayName({ name: 'Imperishable Feet', family: 'INT Boots', from: 'card' })).toBe(
      'Imperishable Feet (Int)',
    )
    expect(displayName({ name: 'Thorn Sea Scepter', family: 'Scepter', from: 'card' })).toBe(
      'Thorn Sea Scepter',
    )
    expect(displayName({ name: 'Int Boots', family: 'INT Boots', from: 'card' })).toBe('Int Boots')
  })

  test('two items with the same name are told apart', () => {
    const table = normalize(UPSTREAM)
    const merged = addWiki(table, {
      items: {
        '3007': {
          name: 'Divine Arbiter\'s Defense',
          family: 'STR Chest Armor',
          level: 62,
          from: 'card',
        },
        '3012': {
          name: 'Divine Arbiter\'s Defense',
          family: 'STR Chest Armor',
          level: 61,
          from: 'card',
        },
        '260003': { name: 'Goddess of Hunting\'s Divinity', from: 'card' },
        '260004': { name: 'Goddess of Hunting\'s Divinity', from: 'card' },
      },
    })
    expect(merged.items['3007']?.name).toBe("Divine Arbiter's Defense (Str) (lv 62)")
    expect(merged.items['3012']?.name).toBe("Divine Arbiter's Defense (Str) (lv 61)")
    expect(merged.items['260003']?.name).toBe("Goddess of Hunting's Divinity (#260003)")
    expect(merged.items['260004']?.name).toBe("Goddess of Hunting's Divinity (#260004)")
  })
})

describe('the wiki pages', () => {
  test('a page says which id the game knows the item by', () => {
    const page = parsePage(PAGE)
    expect(page.ids).toEqual([4110])
    expect(page.name).toBe('All Magic Shoes')
    expect(page.family).toBe('INT Boots')
    expect(page.season).toBe('SS14Season')
    expect(page.slot).toBe('Feet')
    expect(page.level).toBe(76)
  })

  test('a card says the name of the item', () => {
    const card = parseCard(CARD)
    expect(card.name).toBe('Imperishable Feet')
    expect(card.family).toBe('INT Boots')
    expect(card.level).toBe(70)
  })

  test('the name of a page is the name in its address', () => {
    expect(slugName('All_Magic_Shoes')).toBe('All Magic Shoes')
    expect(slugName('Vorax_Limb_Head')).toBe('Vorax Limb Head')
    expect(slugName('Memory_Thread_-_Magic')).toBe('Memory Thread - Magic')
    expect(slugName('%22Banker%22')).toBe('"Banker"')
  })
})

describe('the table the tracker ships', () => {
  test('every item has a name and a source', async () => {
    const table = JSON.parse(
      await readFile(join(import.meta.dir, '..', 'data', 'items.json'), 'utf8'),
    ) as { meta: { count: number; sources: { id: string; count: number }[] }; items: Record<string, { name?: string; sources?: string[] }> }
    expect(Object.keys(table.items).length).toBe(table.meta.count)
    for (const [id, entry] of Object.entries(table.items)) {
      expect(id).toMatch(/^\d+$/)
      expect(entry.name, `the name of ${id}`).toBeTruthy()
      expect(entry.sources?.length ?? 0).toBeGreaterThan(0)
    }
    const named = Object.values(table.items).filter((e) => e.sources?.includes('titrack') === true).length
    const fromWiki = Object.values(table.items).filter((e) => e.sources?.includes('tlidb') === true).length
    expect(named).toBe(table.meta.sources.find((s) => s.id === 'titrack')?.count ?? -1)
    expect(fromWiki).toBe(table.meta.sources.find((s) => s.id === 'tlidb')?.count ?? -1)
  })

  test('the names of the table are the ones the tracker shows', async () => {
    const names = await ItemNames.load()
    expect(names.name(1001)).toBe('Sparks of Moth Fire')
    expect(names.knows(1001)).toBe(true)
    expect(names.name(999999)).toBe('Item #999999')
    expect(names.knows(999999)).toBe(false)
  })

  test('every item in the table has its own name', async () => {
    const table = JSON.parse(
      await readFile(join(import.meta.dir, '..', 'data', 'items.json'), 'utf8'),
    ) as { items: Record<string, { name?: string }> }
    const names = Object.values(table.items).map((entry) => entry.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
