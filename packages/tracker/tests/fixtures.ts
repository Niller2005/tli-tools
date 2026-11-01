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

/** A legendary dropped in a map: the log says the base of the gear and nothing more. */
export const PICK_LEGENDARY = [
  '[2026.10.31-02.33.08:973][413]TLLua: Display: [Game] ItemChange@ ProtoName=PickItem start',
  '[2026.10.31-02.33.08:973][413]TLLua: Display: [Game] ItemChange@ Add Id=3010_68f93dc1-d4d3-11f1-a1ef-000000000066 BagNum=1 in PageId=100 SlotId=6',
  '[2026.10.31-02.33.08:973][413]TLLua: Display: [Game] ItemChange@ ProtoName=PickItem end',
]

/** The player puts the legendary on: the block names the item, the line names the legendary. */
export const PUT_ON_LEGENDARY = [
  '[2026.10.31-02.33.15:333][788]TLLua: Display: [Game] ItemChange@ ProtoName=EvaluateOneKey start',
  '[2026.10.31-02.33.15:334][788]TLLua: Display: [Game] ItemChange@ Update Id=3010_68f93dc1-d4d3-11f1-a1ef-000000000066 BagNum=1 in PageId=100 SlotId=6',
  '[2026.10.31-02.33.15:334][788]TLLua: Display: [Game] ItemChange@ ProtoName=EvaluateOneKey end',
  '[2026.10.31-02.33.16:299][969]TLLua: Display: [Game] AttributeMgr:SetPlayerEquipment(BaseId=3010, GoldId=112151, 4)',
]

/** The gear on the character: the log says which slot it is in. */
export const WORN_GEAR = [
  '[2026.10.31-03.36.36:292][922]TLLua: Display: [Game] ItemChange@ ProtoName=Push2 start',
  '[2026.10.31-03.36.36:292][922]TLLua: Display: [Game] ItemChange@ Add Id=4520_9db6087b-cf4d-11f1-8f75-000000000051 BagNum=1 in PageId=-1 SlotId=5',
  '[2026.10.31-03.36.36:292][922]TLLua: Display: [Game] ItemChange@ ProtoName=Push2 end',
  '[2026.10.31-03.36.37:101][924]TLLua: Display: [Game] AttributeMgr:SetPlayerEquipment(BaseId=4520, GoldId=113201, 5)',
]

/** Something ordinary put on: the log says there is no legendary. */
export const PUT_ON_PLAIN = [
  '[2026.10.31-02.24.12:536][  6]TLLua: Display: [Game] AttributeMgr:SetPlayerEquipment(BaseId=4642, GoldId=0, 6)',
]

/** The game dumps the bag: the fields of one item, with the legendary it is. */
export const BAG_DUMP = [
  '|     | +Index [32]',
  '|     | +Item+Evalued [true]',
  '|     | |    +DreamAffixExclusive',
  '|     | |    +DropSource [4]',
  '|     | |    +BaseId [4533]',
  '|     | |    +Num [1]',
  '|     | |    +Id [4533_dcdff642-ca92-11f1-b19f-00000000007a]',
  '|     | |    +Level [78]',
  '|     | |    +UniqueItmId [113286]',
]

/** The same dump for an item that is not a legendary. */
export const BAG_DUMP_PLAIN = [
  '|   |    | |        | +Index [26]',
  '|   |    | |        | +Item+UniqueItmId [0]',
  '|   |    | |        | |    +Evalued [true]',
  '|   |    | |        | |    +BaseId [382239]',
  '|   |    | |        | |    +RareValue [1]',
  '|   |    | |        | |    +Id [382239_adbf38a9-ce75-11f1-bfac-000000000020]',
]

/** The experience bar moving inside a level. */
export const EXP_MOVES = [
  '[2026.10.31-02.21.44:746][899]TLLua: Display: [Game] ExpMgr@UpdateExp Percent:6257480 94',
  '[2026.10.31-02.21.46:547][260]TLLua: Display: [Game] ExpMgr@UpdateExp Percent:6308774 94',
  '[2026.10.31-02.21.48:347][601]TLLua: Display: [Game] ExpMgr@UpdateExp Percent:6432736 94',
]

/** The experience bar crossing from level 94 into level 95: the number starts again. */
export const EXP_LEVEL_UP = [
  '[2026.10.31-07.57.43:195][588]TLLua: Display: [Game] ExpMgr@UpdateExp Percent:175072587 94',
  '[2026.10.31-07.57.44:997][ 15]TLLua: Display: [Game] ExpMgr@UpdateExp Percent:46928 95',
]

/** What the game says when a map opens: the modifiers are put on one by one (0 is turned away), then the text of the readable ones. */
export const MAP_MODIFIERS = [
  '[2026.10.31-02.21.38:964][701]TLGame: Display: [Game] UCLevelSingleton::AddMapModifier(7000000) success 1 ',
  '[2026.10.31-02.21.38:964][701]TLGame: Display: [Game] UCLevelSingleton::AddMapModifier(5112006) success 2 ',
  '[2026.10.31-02.21.38:965][701]TLGame: Display: [Game] UCLevelSingleton::AddMapModifier(101) success 7 ',
  '[2026.10.31-02.21.38:965][701]TLGame: Display: [Game] UCLevelSingleton::AddMapModifier(2060000) success 0 ',
  '[2026.10.31-02.21.38:965][701]TLGame: Display: [Game] UCLevelSingleton::AddMapModifier(2060000) success 0 ',
  '[2026.10.31-02.21.38:965][701]TLGame: Display: [Game] UCLevelSingleton::AddMapModifier(200006) success 5 ',
  '[2026.10.31-02.21.38:965][701]TLGame: Display: [Game] UCLevelSingleton::AddMapModifier(5112006) success 2 ',
]

/** The dump of the modifiers a map has, as the game writes it. */
export const AFFIX_DUMP = [
  '[2026.10.31-02.21.38:969][701]TLLua: Display: [Game] AffixInfos',
  '[2026.10.31-02.21.38:970][701]TLLua: Display: [Game] ',
  '+SuffixInfoList',
  '+PreNum [0]',
  '+BAffixInfoList+1+Description [<p>-30</p>% additional Physical Damage for you]',
  '|              | +DangerNumbers',
  '|              | +Tier [0]',
  '|              | +Id [5112006]',
  '|              | +FId [1141]',
  '|              +2+Description [affix_class|description|1001200000]',
  '|              | +DangerNumbers',
  '|              | +Tier [0]',
  '|              | +Id [200006]',
  '|              | +FId [1141]',
  '|              +3+Description [<p>+10</p>% additional <e id=507>Drop Quantity</e>]',
  '|              | +DangerNumbers',
  '|              | +Tier [0]',
  '|              | +Id [101]',
  '|              | +FId [1141]',
  '|              +4+Description [map_modifier|description|2340018]',
  '|              | +DangerNumbers',
  '|              | +Tier [0]',
  '|              | +Id [2340018]',
  '|              | +FId [1141]',
  '[2026.10.31-02.21.38:969][701]TLLua: Display: [Game] BattleMgr:CheckJoinFailed()',
  '+Description [text that follows the dump and is not a modifier]',
  '| +Id [999]',
]

/** The player logs in: the game says which character it is. */
export const LOGIN = [
  '[2026.10.31-01.46.41:626][866]TLShipping: Display: [Game] PlayerIdTrace@LoginDataMgr:SetPlayerId old=980032478075064320 new=980032478075064320',
]

/** Another character logs in. */
export const LOGIN_OTHER = [
  '[2026.10.31-09.00.00:000][866]TLShipping: Display: [Game] PlayerIdTrace@LoginDataMgr:SetPlayerId old=980032478075064320 new=980032478075064321',
]

/** A small id the game uses for something else in a fight: not a character. */
export const SMALL_PLAYER_ID = [
  '[2026.10.31-03.31.05:233][194]TLLua: Display: [Game] AttrUtils:SetPlayerId = 1',
]

/** Listing an item on the exchange: it leaves the bag. */
export const XCHG_LIST = [
  '[2026.10.31-02.35.05:252][702]TLLua: Display: [Game] ItemChange@ ProtoName=XchgForSale start',
  '[2026.10.31-02.35.05:252][702]TLLua: Display: [Game] ItemChange@ Delete Id=3010_68f93dc1-d4d3-11f1-a1ef-000000000066 in PageId=100 SlotId=6',
  '[2026.10.31-02.35.05:252][702]TLLua: Display: [Game] BagMgr@:RemoveBagItem PageId = 100 SlotId = 6',
  '[2026.10.31-02.35.05:252][702]TLLua: Display: [Game] ItemChange@ ProtoName=XchgForSale end',
]

/** Buying: the FE goes down. */
export const XCHG_BUY = [
  '[2026.10.31-03.34.32:605][666]TLLua: Display: [Game] ItemChange@ ProtoName=XchgBuy start',
  '[2026.10.31-03.34.32:605][666]TLLua: Display: [Game] ItemChange@ Update Id=100300_b33727d9-ca7e-11f1-b19f-00000000007a BagNum=294 in PageId=102 SlotId=0',
  '[2026.10.31-03.34.32:605][666]TLLua: Display: [Game] BagMgr@:Modfy BagItem PageId = 102 SlotId = 0 ConfigBaseId = 100300 Num = 294',
  '[2026.10.31-03.34.32:605][666]TLLua: Display: [Game] ItemChange@ ProtoName=XchgBuy end',
]

/** Collecting what was bought: the item arrives. */
export const XCHG_RECEIVE = [
  '[2026.10.31-03.34.37:533][838]TLLua: Display: [Game] ItemChange@ ProtoName=XchgReceive start',
  '[2026.10.31-03.34.37:533][838]TLLua: Display: [Game] ItemChange@ Add Id=4520_9db6087b-cf4d-11f1-8f75-000000000051 BagNum=1 in PageId=100 SlotId=5',
  '[2026.10.31-03.34.37:533][838]TLLua: Display: [Game] BagMgr@:Modfy BagItem PageId = 100 SlotId = 5 ConfigBaseId = 4520 Num = 1',
  '[2026.10.31-03.34.37:533][838]TLLua: Display: [Game] ItemChange@ ProtoName=XchgReceive end',
]

/** Taking a listing back: the item returns to the bag. */
export const XCHG_RECALL = [
  '[2026.10.31-03.27.28:084][ 13]TLLua: Display: [Game] ItemChange@ ProtoName=XchgRecall start',
  '[2026.10.31-03.27.28:084][ 13]TLLua: Display: [Game] ItemChange@ Add Id=4533_dcdff642-ca92-11f1-b19f-00000000007a BagNum=1 in PageId=100 SlotId=12',
  '[2026.10.31-03.27.28:084][ 13]TLLua: Display: [Game] BagMgr@:Modfy BagItem PageId = 100 SlotId = 12 ConfigBaseId = 4533 Num = 1',
  '[2026.10.31-03.27.28:084][ 13]TLLua: Display: [Game] ItemChange@ ProtoName=XchgRecall end',
]
