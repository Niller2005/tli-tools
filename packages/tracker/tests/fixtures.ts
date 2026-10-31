// Lines from a real game log, as they are written. They are the yardstick for the parsers.

/**
 * What the community prices API answered, trimmed down to five items.
 *
 * It is the answer of the public API of [TLI Companion](https://tlicompanion.com/api), the site
 * that collects the prices players saw on the auction house.
 */
export const COMMUNITY_PRICES = {
  source: 'TLI Companion',
  sourceUrl: 'https://tlicompanion.com',
  attribution: 'Prices: tlicompanion.com',
  currency: 'FE',
  minPlayers: 3,
  updatedAt: '2026-10-31T07:42:20.813Z',
  count: 1691,
  items: [
    {
      id: 5030,
      name: 'Twin Reflection',
      icon: 'https://tlicompanion.com/icons/items/5030.webp',
      category: 'materials',
      price: 68900,
      players7d: 29,
      updatedAt: '2026-10-31T02:26:16.098Z',
      change24h: -0.3574,
      change7d: -0.005,
    },
    {
      id: 100200,
      name: 'Flame Sand',
      icon: 'https://cdn.tlidb.com/UI/Textures/Common/Icon/Item/128/UI_Item_chuhuolingshaV3_Icon_128.webp',
      category: 'materials',
      price: 0.0006,
      players7d: 171,
      updatedAt: '2026-10-31T07:35:55.287Z',
      change24h: 0.5,
      change7d: -0.5714,
    },
    {
      id: 5028,
      name: 'Netherrealm resonance',
      icon: 'https://cdn.tlidb.com/UI/Textures/Common/Icon/Item/128/UI_Item_Echo_01_Icon_128.webp',
      category: 'materials',
      price: 0.1097,
      players7d: 475,
      updatedAt: '2026-10-31T07:39:58.772Z',
      change24h: 0.0645,
      change7d: -0.0161,
    },
    {
      id: 5210,
      name: 'Divinity Stone',
      icon: 'https://cdn.tlidb.com/UI/Textures/Common/Icon/Item/128/UI_Item_SixGodsChallenge_PowerStone_Icon_128.webp',
      category: 'divinity',
      price: 0.0192,
      players7d: 200,
      updatedAt: '2026-10-31T07:24:10.662Z',
      change24h: 0.0075,
      change7d: -0.0446,
    },
    {
      id: 110306,
      name: 'Will',
      icon: 'https://tlicompanion.com/icons/unique_items/Will.webp',
      category: 'gear',
      price: 1,
      players7d: 16,
      updatedAt: '2026-10-30T18:13:51.182Z',
      change24h: 0,
      change7d: 0,
    },
  ],
}

/** The lines the game writes when the player is in the hideout. */
export const IN_HIDEOUT = [
  '[2026.10.29-21.09.59:736][368]TLShipping: Display: [Game] LevelMgr@ LevelUid, LevelType, LevelId = 111000 0 110',
  '[2026.10.29-21.09.59:759][368]TLLua: Display: [Game] PageApplyBase@ EnterScene ScenePath = World\'/Game/Art/Maps/01SD/XZ_YuJinZhiXiBiNanSuo200/XZ_YuJinZhiXiBiNanSuo200.XZ_YuJinZhiXiBiNanSuo200\'',
]

/** The lines the game writes when the player enters a map. */
export const ENTER_MAP = [
  '[2026.10.29-21.28.06:033][676]TLShipping: Display: [Game] LevelMgr@ LevelUid, LevelType, LevelId = 1071008 3 4708',
  '[2026.10.29-21.28.06:033][676]TLLua: Display: [Game] LevelMgr@:LevelPath, Model = Content/Art/Maps/01SD/SD_GeBuLinShanZhai/SD_GeBuLinShanZhai.umap World\'/Game/Art/Maps/01SD/SD_GeBuLinShanZhai/SD_GeBuLinShanZhai.SD_GeBuLinShanZhai\'',
  '[2026.10.29-21.28.06:034][676]TLLua: Display: [Game] PageApplyBase@ EnterScene ScenePath = World\'/Game/Art/Maps/01SD/SD_GeBuLinShanZhai/SD_GeBuLinShanZhai.SD_GeBuLinShanZhai\'',
]

/** The lines the game writes when the player goes back to the hideout. */
export const BACK_TO_HIDEOUT = [
  '[2026.10.29-21.29.04:345][272]TLShipping: Display: [Game] LevelMgr@ LevelUid, LevelType, LevelId = 111000 0 110',
]

/** The lines the game writes when the Tartarus prison board opens in the town. */
export const PRISON_BOARD = [
  '[2026.10.31-02.57.37:312][681]TLLua: Display: [Game] S16BoardMain Run',
]

/** The lines the game writes when the player enters the prison. */
export const ENTER_PRISON = [
  '[2026.10.31-03.10.06:155][500]TLShipping: Display: [Game] LevelMgr@ LevelUid, LevelType, LevelId = 344 28 235501',
  '[2026.10.31-03.10.06:156][500]TLLua: Display: [Game] LevelMgr@:LevelPath, Model = Content/Art/Season/S16/Maps/ZhongZuiDiYu/ZhongZuiDiYu.umap World\'/Game/Art/Season/S16/Maps/ZhongZuiDiYu/ZhongZuiDiYu.ZhongZuiDiYu\'',
]

/** The lines the game writes when the board closes as the prison opens. */
export const PRISON_BOARD_CLOSED = [
  '[2026.10.31-03.10.06:232][500]TLLua: Display: [Game] S16BoardMain Destory',
]

/** A pick-up in the prison: a new item lands in an empty slot. */
export const PICK_IN_PRISON = [
  '[2026.10.31-03.10.13:663][869]TLLua: Display: [Game] ItemChange@ ProtoName=PickItem start',
  '[2026.10.31-03.10.13:663][869]TLLua: Display: [Game] ItemChange@ Add Id=2218_96fd953b-d4d8-11f1-a1ef-000000000066 BagNum=1 in PageId=100 SlotId=4',
  '[2026.10.31-03.10.13:663][869]TLLua: Display: [Game] ItemChange@ ProtoName=PickItem end',
]

/**
 * A stack of flame sand that was already in the bag grows in the prison.
 *
 * The first line is the bag as the game sent it when the player logged in; the second one is
 * the stack in the prison, and the difference between the two is what was picked up.
 */
export const PICK_SAND_IN_PRISON = [
  '[2026.10.31-01.46.45:167][522]TLLua: Display: [Game] ItemChange@ Add Id=100200_59e3c7c1-d41c-11f1-9c35-000000000079 BagNum=39 in PageId=102 SlotId=2',
  '[2026.10.31-03.14.28:923][845]TLLua: Display: [Game] ItemChange@ ProtoName=PickItems start',
  '[2026.10.31-03.14.28:923][845]TLLua: Display: [Game] ItemChange@ Update Id=100200_88c30687-d4c0-11f1-a1ef-000000000066 BagNum=234 in PageId=102 SlotId=2',
  '[2026.10.31-03.14.28:923][845]TLLua: Display: [Game] ItemChange@ ProtoName=PickItems end',
]

/** The whole bag, as the game sends it when the player logs in. */
export const BAG_SNAPSHOT = [
  '[2026.10.29-21.10.01:859][815]TLLua: Display: [Game] BagMgr@:InitBagData PageId = 100 SlotId = 1 ConfigBaseId = 3810 Num = 1',
  '[2026.10.29-21.10.01:860][815]TLLua: Display: [Game] BagMgr@:InitBagData PageId = 102 SlotId = 1 ConfigBaseId = 100200 Num = 3858',
  '[2026.10.29-21.10.01:860][815]TLLua: Display: [Game] BagMgr@:InitBagData PageId = 102 SlotId = 2 ConfigBaseId = 100400 Num = 999',
  '[2026.10.29-21.10.01:862][815]TLLua: Display: [Game] BagMgr@:InitBagData PageId = 102 SlotId = 0 ConfigBaseId = 100300 Num = 90',
  '[2026.10.29-21.10.01:862][815]TLLua: Display: [Game] BagMgr@:InitBagData PageId = 102 SlotId = 11 ConfigBaseId = 5028 Num = 1132',
  '[2026.10.29-21.10.01:862][815]TLLua: Display: [Game] BagMgr@:InitBagData PageId = 103 SlotId = 7 ConfigBaseId = 400006 Num = 13',
]

/** The cost of opening a map: the beacon and the resonance go down. */
export const MAP_COST = [
  '[2026.10.29-21.28.05:987][665]TLLua: Display: [Game] ItemChange@ ProtoName=Spv3Open start',
  '[2026.10.29-21.28.05:987][665]TLLua: Display: [Game] ItemChange@ Update Id=5028_b9457e46-c9c7-11f1-95cf-00000000015f BagNum=1131 in PageId=102 SlotId=11',
  '[2026.10.29-21.28.05:987][665]TLLua: Display: [Game] BagMgr@:Modfy BagItem PageId = 102 SlotId = 11 ConfigBaseId = 5028 Num = 1131',
  '[2026.10.29-21.28.05:987][665]TLLua: Display: [Game] ItemChange@ Update Id=400006_a866a970-ccd8-11f1-9a5a-000000000070 BagNum=12 in PageId=103 SlotId=7',
  '[2026.10.29-21.28.05:987][665]TLLua: Display: [Game] BagMgr@:Modfy BagItem PageId = 103 SlotId = 7 ConfigBaseId = 400006 Num = 12',
  '[2026.10.29-21.28.05:987][665]TLLua: Display: [Game] ItemChange@ ProtoName=Spv3Open end',
]

/** A pick-up: the stack of flame sand grows. */
export const PICK_MATERIAL = [
  '[2026.10.29-22.40.05:080][655]TLLua: Display: [Game] ItemChange@ ProtoName=PickItems start',
  '[2026.10.29-22.40.05:080][655]TLLua: Display: [Game] ItemChange@ Update Id=100200_ff207782-c98d-11f1-8d7e-000000000033 BagNum=4329 in PageId=102 SlotId=1',
  '[2026.10.29-22.40.05:080][655]TLLua: Display: [Game] BagMgr@:Modfy BagItem PageId = 102 SlotId = 1 ConfigBaseId = 100200 Num = 4329',
  '[2026.10.29-22.40.05:080][655]TLLua: Display: [Game] ItemChange@ ProtoName=PickItems end',
]

/** A pick-up of gear: a new item lands in an empty slot. */
export const PICK_GEAR = [
  '[2026.10.29-22.40.16:702][135]TLLua: Display: [Game] ItemChange@ ProtoName=PickItem start',
  '[2026.10.29-22.40.16:702][135]TLLua: Display: [Game] ItemChange@ Add Id=4654_b670268c-d3e9-11f1-9c35-000000000079 BagNum=1 in PageId=100 SlotId=15',
  '[2026.10.29-22.40.16:702][135]TLLua: Display: [Game] BagMgr@:Modfy BagItem PageId = 100 SlotId = 15 ConfigBaseId = 4654 Num = 1',
  '[2026.10.29-22.40.16:702][135]TLLua: Display: [Game] ItemChange@ ProtoName=PickItem end',
]

/** The server taking an item away: the player sold it. */
export const SELL = [
  '[2026.10.29-21.19.26:761][720]TLLua: Display: [Game] ItemChange@ ProtoName=Push2 start',
  '[2026.10.29-21.19.26:761][720]TLLua: Display: [Game] ItemChange@ Delete Id=4109_14f5076b-ce83-11f1-bfac-000000000020 in PageId=100 SlotId=4',
  '[2026.10.29-21.19.26:761][720]TLLua: Display: [Game] BagMgr@:RemoveBagItem PageId = 100 SlotId = 4',
  '[2026.10.29-21.19.26:762][720]TLLua: Display: [Game] ItemChange@ ProtoName=Push2 end',
]

/** The bag being sorted: the page is emptied and filled again. */
export const SORT_BAG = [
  '[2026.10.29-21.36.29:595][635]TLLua: Display: [Game] ItemChange@ ProtoName=ResetItemsLayout start',
  '[2026.10.29-21.36.29:595][635]TLLua: Display: [Game] ItemChange@ Reset PageId=101',
  '[2026.10.29-21.36.29:595][635]TLLua: Display: [Game] ItemChange@ Add Id=7032_e3ec575e-c984-11f1-8d7e-000000000033 BagNum=1 in PageId=101 SlotId=47',
  '[2026.10.29-21.36.29:595][635]TLLua: Display: [Game] ItemChange@ ProtoName=ResetItemsLayout end',
]

/** A search of the exchange and the prices that came back. */
export const EXCHANGE_SEARCH = [
  '[2026.10.29-21.30.24:436][425]TLNetGame: Display: [Game] ----Socket SendMessage STT----XchgSearchPrice----SynId = 3720',
  '[2026.10.29-21.30.24:436][425]TLNetGame: Display: [Game] ',
  '[2026.10.29-21.30.24:436][425]TLNetGame: Display: [Game] +filters+1+key [4]',
  '[2026.10.29-21.30.24:436][425]TLNetGame: Display: [Game] |       | +refer [8312]',
  '[2026.10.29-21.30.24:436][425]TLNetGame: Display: [Game] +typ3 [58]',
  '[2026.10.29-21.30.24:436][425]TLNetGame: Display: [Game] ----Socket SendMessage End----',
  '[2026.10.29-21.30.24:585][461]TLNetGame: Display: [Game] ----Socket RecvMessage STT----XchgSearchPrice----SynId = 3720',
  '[2026.10.29-21.30.24:586][461]TLNetGame: Display: [Game] ',
  '[2026.10.29-21.30.24:586][461]TLNetGame: Display: [Game] +prices+1+currency [100300]',
  '[2026.10.29-21.30.24:586][461]TLNetGame: Display: [Game] |      | +unitPrices+1 [5.0]',
  '[2026.10.29-21.30.24:586][461]TLNetGame: Display: [Game] |      | |          +2 [5.0]',
  '[2026.10.29-21.30.24:586][461]TLNetGame: Display: [Game] |      | |          +3 [6.0]',
  '[2026.10.29-21.30.24:586][461]TLNetGame: Display: [Game] +errCode',
  '[2026.10.29-21.30.24:586][461]TLNetGame: Display: [Game] +itemGoldId [8312]',
  '[2026.10.29-21.30.24:586][461]TLNetGame: Display: [Game] ----Socket RecvMessage End----',
]

/** A line that is not the game's own. */
export const ENGINE_NOISE = [
  '[2026.10.29-21.10.01:826][815]LogDataTable: Warning: UDataTable::FindRow : \'Play_UI_Gen_Card_Select\' requested row not in DataTable.',
]
