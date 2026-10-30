// The names of the places the player goes.
//
// The game names its maps after the Chinese map names in pinyin (`SD_GeBuLinShanZhai` is
// 哥布林山寨, the goblin camp). The names below are the English ones the community uses; they follow
// the naming the game wiki (tlidb.com) and the other trackers use. A map that is not in here keeps
// its own name, so a new season's maps show up as they are.

/** The English name of each map, by the folder the game calls it. */
export const ZONE_NAMES: Record<string, string> = {
  // Hideouts
  XZ_YuJinZhiXiBiNanSuo: "Hideout - Ember's Rest",
  DD_ShengTingZhuangYuan: "Hideout - Sacred Court Manor",

  // Blistering Lava Sea
  KD_YuanSuKuangDong: 'Blistering Lava Sea - Elemental Mine',
  DD_ChaoBaiZhiLu: 'Blistering Lava Sea - Path of Sacrifice',
  SD_ShouGuSiDi: 'Blistering Lava Sea - Dragonrest Cavern',
  JH_ZuiRenMiDian: 'Blistering Lava Sea - Where Lies Confession',
  YJ_LuoRiQiongDi: 'Blistering Lava Sea - Sunset Dome Bottom',
  SQ_BianChuiZhiDi: 'Blistering Lava Sea - Savage Grasslands',
  JH_MengZhongShengDi: 'Blistering Lava Sea - Shimmering Hall',
  KD_AiRenDiSanCeng: 'Blistering Lava Sea - Heart of the Mountains',
  JH_ShengDeLanXiuDaoYuan: 'Blistering Lava Sea - Confession Chapel',
  SD_ShouGuLinDi: 'Blistering Lava Sea - Twisted Valley',
  DD_DiDuTingYuan: 'Blistering Lava Sea - Court of Darkness',
  KD_RongHuoHeXin: 'Blistering Lava Sea - Smelting Plant',
  YanYuZhiGu: 'Blistering Lava Sea - Hellfire Chasm',

  // Glacial Abyss
  DD_TingYuanMiGong: 'Glacial Abyss - High Court Maze',
  YJ_XieDuYuZuo: 'Glacial Abyss - Defiled Side Chamber',
  DD_ZaWuJieQu: 'Glacial Abyss - Deserted District',
  SQ_MingShaJuLuo: 'Glacial Abyss - Singing Sand',
  SD_GeBuLinShanZhai: 'Glacial Abyss - Shadow Outpost',
  GeBuLinCunLuo: 'Glacial Abyss - Demiman Village',
  KD_AiRenKuangDong: 'Glacial Abyss - Abandoned Mines',
  YL_YinYiZhiDi: 'Glacial Abyss - Rainforest of Divine Legacy',
  KD_WeiJiKuangDong: 'Glacial Abyss - Swirling Mines',
  YL_BeiFengLinDi: 'Glacial Abyss - Grimwind Woods',
  SD_ZhongXiGaoQiang: 'Glacial Abyss - Wall of the Last Breath',
  SD_GeBuLinYingDi: 'Glacial Abyss - Blustery Canyon',
  YongShuangBingPo: 'Glacial Abyss - Throne of Winter',

  // Steel Forge
  JH_JueXingMiDian: 'Steel Forge - Shrine of Despair',
  JH_TongKuMiDian: 'Steel Forge - Shrine of Punishment',
  SD_YuanGuTongDao: 'Steel Forge - Beast Plains',
  SQ_JingJiHuiTu: 'Steel Forge - Thorny Filth',
  KD_AiRenDiErCeng: 'Steel Forge - Weeping Mines',
  SD_DuiLongJuQiang: 'Steel Forge - Cloud Walls',
  DD_YinYanJieXiang: 'Steel Forge - Alleys of the Lost',
  YJ_TaiYangWangTing: 'Steel Forge - City of Eternal Fire',
  DD_JueWangZhiQiang: 'Steel Forge - Wall of the Pure',
  YJ_RiXiShenMiao: 'Steel Forge - Sun Temple',
  YJ_YingLingShenDian: 'Steel Forge - Corona Shrine',
  SQ_ZheFengBiZhang: 'Steel Forge - Windbreath Cliff',
  ChiGuiWuShi: 'Steel Forge - Imaginary Monument',

  // Thunder Wastes
  DD_TanXiZhiQiang: 'Thunder Wastes - Wall of Sorrows',
  DD_XinTuJieXiang: 'Thunder Wastes - Alleys of Pilgrims',
  SQ_EWuHuangCun: 'Thunder Wastes - Desolate Village',
  YJ_ShuXiDaTing: 'Thunder Wastes - Hall in the Mirror',
  SQ_NvShenQunBai: 'Thunder Wastes - Defiled Oasis',
  SQ_XiongShiZhiXin: "Thunder Wastes - King's Hub",
  KD_CangBaoDongKu: 'Thunder Wastes - Thirsty Mines',
  SD_ShengHuoLing: 'Thunder Wastes - Rainmist Jungle',
  JH_JiaoTangDaTing: 'Thunder Wastes - Prayer Sanctuary',
  YJ_LiuJinJieQu: 'Thunder Wastes - Gallery of Moon',
  LeiYingJiDian: 'Thunder Wastes - Summit of Thunder',
  JH_YWMD_00003: 'Thunder Wastes - Chamber of Confusion',
  JH_YWMD_00004: 'Thunder Wastes - Place of Repentance',
  JH_YWMD_00005: 'Thunder Wastes - Ascetic Gallery',
  JH_YWMD_00007: 'Thunder Wastes - Ascension Testing Ground',

  // Voidlands
  DD_QunLangJieXiang: 'Voidlands - Grim Alleys',
  YL_MaNeiLaYuLin: 'Voidlands - Filthy Forest',
  YL_MiWuYuLin: 'Voidlands - Dreamless Thicket',
  JH_ShenHeJuSuo: 'Voidlands - Luminescent Throne',
  JH_YiWangMiDian: 'Voidlands - Shrine of Agony',
  YL_KuangReYuLin: 'Voidlands - Shimmering Swamp',
  YL_XiDiChongGu: 'Voidlands - Jungle of the Brood',
  YJ_YongZhouHuiLang: 'Voidlands - Gallery of Stars',
  JH_YinNiShengTang: 'Voidlands - Yesterday Chamber',
  DiaoLingWangYu: 'Voidlands - Dreamless Abyss',
  JH_YWMD_00001: 'Voidlands - Yesterday Chamber',
  JH_YWMD_00002: 'Voidlands - Road of Purgation',
  JH_YWMD_00006: 'Voidlands - Corridor of Disorder',

  // Deep Space
  SD_GuangMaoLieChang: 'Deep Space - Boundless Hunting Ground',
  KD_DiXinKuangChang: 'Deep Space - Core Mine',
  SQ_ShaZhongMuYuan: 'Deep Space - Desert Pasture',
  SD_DaHuangZhiYe: 'Deep Space - Barren Wilderness',
  YL_WanQingHuangLin: 'Deep Space - Vast Wasteland',

  // Other places
  YJ_XiuShiShenYuan: 'Rusted Abyss',
  ZhongZuiDiYu: 'Tartarus in Riot',
  CC1_SiWangMiCheng: 'Ruins of Aeterna: Boundless',
  XueYuRongLu: 'The Frozen Canvas',
  DiXiaZhenSuo: "Vorax - Shelly's Operating Theater",
  SuMingTaLuo: 'Fateful Contest',
  MuBiaoTiaoZhan: 'Supreme Showdown',
  LieXiKongJing: 'Rift of Dimensions',
  YunDuanLvZhou: 'Cloud Oasis',
  WuDuYiZhi: 'Mistville',
  XuHaiZhongGang: 'Void Sea Terminal',
  LiMingShengSuo: 'Dawn Sanctuary',
  HD_YingGuangDianTang: 'Secret Realm - Invaluable Time',
  HD_EMengZhiXia: 'Secret Realm - Sea of Rites',
  BZ_NaGouZhiXi: 'Secret Realm - Unholy Pedestal',
  BZ_JiangShengChao: 'Secret Realm - Abyssal Vault',
}

/** The English name of a map, or its own name when it is not one we know. */
export function zoneName(zone: string): string {
  if (zone.length === 0) return 'Unknown'
  const direct = ZONE_NAMES[zone]
  if (direct !== undefined) return direct
  // The game adds a tier number to some maps (SD_YuanGuTongDao101); the name is without it.
  const stripped = zone.replace(/\d+$/, '')
  const loose = ZONE_NAMES[stripped]
  if (loose !== undefined) return loose
  return zone
}
