/**
 * 中文英雄名称（以及常见数据源中的别名）到项目内部 id 的映射。
 *
 * 维护策略：
 * 1. 以 `HEROES` 数组作为唯一数据源，集中维护英雄 id、标准名、别名。
 * 2. 生成 `NAME_TO_ID` 平铺映射表，供外部直接导入使用。
 * 3. `mapNameToId` 会做规范化处理：去空格、忽略大小写、去掉常见后缀（如“·XXX”）。
 */

const HEROES = [
  // 坦克
  {
    id: 'xiangyu',
    roles: ['TANK', 'WARRIOR'],
    names: ['项羽', '霸王', '西楚霸王'],
  },
  {
    id: 'lianpo',
    roles: ['TANK'],
    names: ['廉颇', '正义爆轰'],
  },
  {
    id: 'baiqi',
    roles: ['TANK'],
    names: ['白起', '最终兵器'],
  },
  {
    id: 'chengyaojin',
    roles: ['TANK', 'WARRIOR'],
    names: ['程咬金', '热烈之斧', '金金', '咬金'],
  },
  {
    id: 'zhangfei',
    roles: ['TANK', 'SUPPORT'],
    names: ['张飞', '禁血狂兽'],
  },
  {
    id: 'niumo',
    roles: ['TANK', 'SUPPORT'],
    names: ['牛魔', '精英酋长'],
  },
  {
    id: 'donghuangtaiyi',
    roles: ['TANK'],
    names: ['东皇太一', '东皇', '噬灭日蚀'],
  },
  {
    id: 'zhuangzhou',
    roles: ['TANK', 'SUPPORT'],
    names: ['庄周', '鱼', '辅助鱼', '逍遥梦幻'],
  },
  {
    id: 'dunshan',
    roles: ['SUPPORT', 'TANK'],
    names: ['盾山', '无尽之盾', '山山'],
  },
  {
    id: 'lubandashi',
    roles: ['SUPPORT'],
    names: ['鲁班大师', '鲁大', '神匠'],
  },

  // 战士
  {
    id: 'yase',
    roles: ['WARRIOR', 'TANK'],
    names: ['亚瑟', '圣骑之力', '亚瑟王'],
  },
  {
    id: 'lvbu',
    roles: ['WARRIOR'],
    names: ['吕布', '无双之魔', '奉先'],
  },
  {
    id: 'kai',
    roles: ['WARRIOR'],
    names: ['铠', '破灭刃锋', '铠爹', '凯', '凯爹'],
  },
  {
    id: 'huamulan',
    roles: ['WARRIOR', 'ASSASSIN'],
    names: ['花木兰', '传说之刃', '木兰'],
  },
  {
    id: 'laofuzi',
    roles: ['WARRIOR'],
    names: ['老夫子', '万古长明', '夫子'],
  },
  {
    id: 'caocao',
    roles: ['WARRIOR'],
    names: ['曹操', '鲜血枭雄', '曹老板'],
  },
  {
    id: 'sunce',
    roles: ['WARRIOR'],
    names: ['孙策', '光明之海'],
  },
  {
    id: 'kuangtie',
    roles: ['WARRIOR'],
    names: ['狂铁', '战车意志'],
  },

  // 刺客
  {
    id: 'hanxin',
    roles: ['ASSASSIN'],
    names: ['韩信', '国士无双', '韩跳跳'],
  },
  {
    id: 'libai',
    roles: ['ASSASSIN'],
    names: ['李白', '青莲剑仙'],
  },
  {
    id: 'lanlingwang',
    roles: ['ASSASSIN'],
    names: ['兰陵王', '暗影刀锋', '老六'],
  },
  {
    id: 'ake',
    roles: ['ASSASSIN'],
    names: ['阿轲', '信念之刃', '荆轲'],
  },
  {
    id: 'nakelulu',
    roles: ['ASSASSIN'],
    names: ['娜可露露', '鹰之守护', '娜可', '露露'],
  },
  {
    id: 'sunwukong',
    roles: ['ASSASSIN', 'WARRIOR'],
    names: ['孙悟空', '齐天大圣', '猴子', '猴哥', '猴三棒'],
  },
  {
    id: 'jing',
    roles: ['ASSASSIN'],
    names: ['镜', '破镜之刃'],
  },
  {
    id: 'shangguanwaner',
    roles: ['MAGE', 'ASSASSIN'],
    names: ['上官婉儿', '惊鸿之笔', '婉儿'],
  },

  // 法师
  {
    id: 'diaochan',
    roles: ['MAGE'],
    names: ['貂蝉', '绝世舞姬', '蝉妹'],
  },
  {
    id: 'zhugeliang',
    roles: ['MAGE'],
    names: ['诸葛亮', '绝代智谋', '诸葛', '亮亮'],
  },
  {
    id: 'wangzhaojun',
    roles: ['MAGE'],
    names: ['王昭君', '冰雪之华', '昭君'],
  },
  {
    id: 'xiaoqiao',
    roles: ['MAGE'],
    names: ['小乔', '恋之微风'],
  },
  {
    id: 'anqila',
    roles: ['MAGE'],
    names: ['安琪拉', '暗夜萝莉'],
  },
  {
    id: 'daji',
    roles: ['MAGE'],
    names: ['妲己', '魅力之狐', '小妲己'],
  },
  {
    id: 'ganjiangmoxie',
    roles: ['MAGE'],
    names: ['干将莫邪', '淬命双剑', '干将', '莫邪'],
  },

  // 射手
  {
    id: 'houyi',
    roles: ['MARKSMAN'],
    names: ['后羿', '半神之弓'],
  },
  {
    id: 'lubanqihao',
    roles: ['MARKSMAN'],
    names: ['鲁班七号', '机关造物', '鲁班', '小鲁班', '卤蛋'],
  },
  {
    id: 'direnjie',
    roles: ['MARKSMAN'],
    names: ['狄仁杰', '断案大师'],
  },
  {
    id: 'sunshangxiang',
    roles: ['MARKSMAN'],
    names: ['孙尚香', '千金重弩', '香香', '大小姐'],
  },
  {
    id: 'makeboluo',
    roles: ['MARKSMAN'],
    names: ['马可波罗', '远游之枪', '马可', '马克', '菠萝'],
  },
  {
    id: 'gongsunli',
    roles: ['MARKSMAN'],
    names: ['公孙离', '幻舞玲珑', '阿离'],
  },
  {
    id: 'jialuo',
    roles: ['MARKSMAN'],
    names: ['伽罗', '破魔之箭'],
  },
  {
    id: 'bailishouyue',
    roles: ['MARKSMAN', 'ASSASSIN'],
    names: ['百里守约', '静谧之眼', '守约', '百里'],
  },

  // 辅助
  {
    id: 'caiwenji',
    roles: ['SUPPORT'],
    names: ['蔡文姬', '天籁弦音', '菜菜', '奶妈'],
  },
  {
    id: 'sunbin',
    roles: ['SUPPORT'],
    names: ['孙膑', '逆流之时'],
  },
  {
    id: 'daqiao',
    roles: ['SUPPORT'],
    names: ['大乔', '沧海之曜'],
  },
  {
    id: 'yao',
    roles: ['SUPPORT'],
    names: ['瑶', '鹿灵守心', '小鹿'],
  },
  {
    id: 'mingzhiyin',
    roles: ['SUPPORT'],
    names: ['明世隐', '灵魂劫卜', '小明', '明世'],
  },

  // 项目当前 heroes.json 未包含、但数据源中可能出现的常见英雄
  // 提前配置好，便于后续扩展英雄池时直接使用。
  {
    id: 'zhaoyun',
    roles: ['WARRIOR', 'ASSASSIN'],
    names: ['赵云', '苍天翔龙'],
  },
  {
    id: 'gongbenwucang',
    roles: ['WARRIOR', 'ASSASSIN'],
    names: ['宫本武藏', '宫本', '超级兵'],
  },
  {
    id: 'bailixuance',
    roles: ['ASSASSIN'],
    names: ['百里玄策', '玄策', '电光耗子'],
  },
  {
    id: 'peiqinhu',
    roles: ['ASSASSIN', 'WARRIOR'],
    names: ['裴擒虎', '虎', '老虎'],
  },
  {
    id: 'yunzhongjun',
    roles: ['ASSASSIN'],
    names: ['云中君', '云中'],
  },
  {
    id: 'yuanlan',
    roles: ['ASSASSIN'],
    names: ['澜', '鲨之猎刃', '澜朋友'],
  },
  {
    id: 'dianwei',
    roles: ['WARRIOR'],
    names: ['典韦', '狂战士'],
  },
  {
    id: 'xiahoudun',
    roles: ['TANK', 'WARRIOR'],
    names: ['夏侯惇', '不羁之风'],
  },
  {
    id: 'liubei',
    roles: ['WARRIOR'],
    names: ['刘备', '仁德义枪'],
  },
  {
    id: 'sunquan',
    roles: ['WARRIOR'],
    names: ['孙权'],
  },
  {
    id: 'zhouyu',
    roles: ['MAGE'],
    names: ['周瑜', '铁血都督'],
  },
  {
    id: 'zhenji',
    roles: ['MAGE'],
    names: ['甄姬', '洛神降临'],
  },
  {
    id: 'wuzetian',
    roles: ['MAGE'],
    names: ['武则天', '女帝'],
  },
  {
    id: 'yingzheng',
    roles: ['MAGE'],
    names: ['嬴政'],
  },
  {
    id: 'buzhihuowu',
    roles: ['MAGE', 'ASSASSIN'],
    names: ['不知火舞', '火舞'],
  },
  {
    id: 'miyue',
    roles: ['MAGE', 'TANK'],
    names: ['芈月', '永恒之月'],
  },
  {
    id: 'gaojianli',
    roles: ['MAGE'],
    names: ['高渐离'],
  },
  {
    id: 'zhangliang',
    roles: ['MAGE', 'SUPPORT'],
    names: ['张良', '言灵之书'],
  },
  {
    id: 'nvwa',
    roles: ['MAGE'],
    names: ['女娲'],
  },
  {
    id: 'yangyuhuan',
    roles: ['MAGE', 'SUPPORT'],
    names: ['杨玉环', '霓裳风华', '李华'],
  },
  {
    id: 'xishi',
    roles: ['MAGE', 'SUPPORT'],
    names: ['西施', '沉鱼'],
  },
  {
    id: 'change',
    roles: ['MAGE', 'TANK'],
    names: ['嫦娥'],
  },
  {
    id: 'huangzhong',
    roles: ['MARKSMAN'],
    names: ['黄忠', '燃魂重炮'],
  },
  {
    id: 'liyuanfang',
    roles: ['MARKSMAN', 'ASSASSIN'],
    names: ['李元芳'],
  },
  {
    id: 'yuji',
    roles: ['MARKSMAN'],
    names: ['虞姬', '森之风灵'],
  },
  {
    id: 'ailin',
    roles: ['MARKSMAN', 'MAGE'],
    names: ['艾琳'],
  },
  {
    id: 'mengya',
    roles: ['MARKSMAN'],
    names: ['蒙犽'],
  },
  {
    id: 'geya',
    roles: ['MARKSMAN'],
    names: ['戈娅'],
  },
  {
    id: 'guiguzi',
    roles: ['SUPPORT'],
    names: ['鬼谷子'],
  },
  {
    id: 'taiyizhenren',
    roles: ['SUPPORT'],
    names: ['太乙真人', '太乙'],
  },
  {
    id: 'liushan',
    roles: ['TANK', 'SUPPORT'],
    names: ['刘禅', '暴走机关'],
  },
  {
    id: 'zhongkui',
    roles: ['SUPPORT', 'MAGE'],
    names: ['钟馗'],
  },
  {
    id: 'sangqi',
    roles: ['SUPPORT', 'MAGE'],
    names: ['桑启'],
  },
  {
    id: 'duoliya',
    roles: ['SUPPORT', 'MAGE'],
    names: ['朵莉亚', '朵朵'],
  },
  {
    id: 'shaosiyuan',
    roles: ['SUPPORT'],
    names: ['少司缘'],
  },
  {
    id: 'aoyin',
    roles: ['MARKSMAN'],
    names: ['敖隐'],
  },
  {
    id: 'laixiao',
    roles: ['MARKSMAN'],
    names: ['莱西奥'],
  },
  {
    id: 'jixiaoman',
    roles: ['WARRIOR', 'ASSASSIN'],
    names: ['姬小满', '小满'],
  },
  {
    id: 'zhaohuaizhen',
    roles: ['WARRIOR'],
    names: ['赵怀真'],
  },
  {
    id: 'yunyao',
    roles: ['WARRIOR', 'ASSASSIN'],
    names: ['云缨'],
  },
  {
    id: 'machao',
    roles: ['WARRIOR', 'ASSASSIN'],
    names: ['马超'],
  },
  {
    id: 'guanyu',
    roles: ['WARRIOR'],
    names: ['关羽', '一骑当千'],
  },
  {
    id: 'yaoao',
    roles: ['WARRIOR', 'ASSASSIN'],
    names: ['曜'],
  },
  {
    id: 'pangu',
    roles: ['WARRIOR'],
    names: ['盘古'],
  },
  {
    id: 'lixin',
    roles: ['WARRIOR'],
    names: ['李信'],
  },
  {
    id: 'damo',
    roles: ['WARRIOR'],
    names: ['达摩'],
  },
  {
    id: 'nezha',
    roles: ['WARRIOR', 'ASSASSIN'],
    names: ['哪吒'],
  },
  {
    id: 'yangjian',
    roles: ['WARRIOR'],
    names: ['杨戬'],
  },
  {
    id: 'yadianna',
    roles: ['WARRIOR', 'ASSASSIN'],
    names: ['雅典娜'],
  },
  {
    id: 'liubang',
    roles: ['TANK', 'SUPPORT'],
    names: ['刘邦'],
  },
  {
    id: 'sulie',
    roles: ['TANK', 'WARRIOR'],
    names: ['苏烈'],
  },
  {
    id: 'zhuwujing',
    roles: ['TANK', 'WARRIOR'],
    names: ['猪八戒', '八戒', '猪'],
  },
  {
    id: 'mengqi',
    roles: ['TANK'],
    names: ['梦奇', '梦琪'],
  },
  {
    id: 'zhongwuyan',
    roles: ['WARRIOR', 'TANK'],
    names: ['钟无艳'],
  },
  {
    id: 'mozi',
    roles: ['MAGE', 'WARRIOR'],
    names: ['墨子'],
  },

  // 2024-2026 新英雄及遗漏英雄
  // 元流之子：五路全能英雄，数据源按形态分别返回，拆分为5个独立条目
  {
    id: 'yuanliuzhizi_mage',
    roles: ['MAGE'],
    names: ['元流之子_法师', '元流之子(法师)', '元流之子法师'],
  },
  {
    id: 'yuanliuzhizi_tank',
    roles: ['TANK'],
    names: ['元流之子_坦克', '元流之子(坦克)', '元流之子坦克'],
  },
  {
    id: 'yuanliuzhizi_marksman',
    roles: ['MARKSMAN'],
    names: ['元流之子_射手', '元流之子(射手)', '元流之子射手'],
  },
  {
    id: 'yuanliuzhizi_support',
    roles: ['SUPPORT'],
    names: ['元流之子_辅助', '元流之子(辅助)', '元流之子辅助'],
  },
  {
    id: 'yuanliuzhizi_assassin',
    roles: ['ASSASSIN'],
    names: ['元流之子_刺客', '元流之子(刺客)', '元流之子刺客'],
  },
  {
    id: 'ying',
    roles: ['ASSASSIN'],
    names: ['影'],
  },
  {
    id: 'haiyue',
    roles: ['MAGE'],
    names: ['海月'],
  },
  {
    id: 'sikongzhen',
    roles: ['WARRIOR', 'MAGE'],
    names: ['司空震', '司空'],
  },
  {
    id: 'jinchan',
    roles: ['MAGE', 'SUPPORT'],
    names: ['金蝉'],
  },
  {
    id: 'fei',
    roles: ['ASSASSIN'],
    names: ['暃'],
  },
  {
    id: 'yalian',
    roles: ['WARRIOR', 'ASSASSIN'],
    names: ['亚连'],
  },
  {
    id: 'hainuo',
    roles: ['MAGE'],
    names: ['海诺'],
  },
  {
    id: 'dasiming',
    roles: ['ASSASSIN', 'WARRIOR'],
    names: ['大司命'],
  },
  {
    id: 'mengtian',
    roles: ['WARRIOR', 'TANK'],
    names: ['蒙恬'],
  },
  {
    id: 'xialuote',
    roles: ['WARRIOR'],
    names: ['夏洛特'],
  },
  {
    id: 'aguduo',
    roles: ['TANK', 'MARKSMAN'],
    names: ['阿古朵', '古朵'],
  },
  {
    id: 'cang',
    roles: ['MARKSMAN'],
    names: ['苍', '成吉思汗'],
  },
  {
    id: 'milaidi',
    roles: ['MAGE'],
    names: ['米莱狄', '米莱迪'],
  },
  {
    id: 'yixing',
    roles: ['MAGE'],
    names: ['弈星', '奕星'],
  },
  {
    id: 'simayi',
    roles: ['MAGE', 'ASSASSIN'],
    names: ['司马懿', '司马'],
  },
  {
    id: 'yuange',
    roles: ['ASSASSIN'],
    names: ['元歌'],
  },
  {
    id: 'juyoujing',
    roles: ['WARRIOR', 'ASSASSIN'],
    names: ['橘右京', '橘子'],
  },
  {
    id: 'shenmengxi',
    roles: ['MAGE'],
    names: ['沈梦溪', '炸弹猫'],
  },
  {
    id: 'luna',
    roles: ['MAGE', 'ASSASSIN'],
    names: ['露娜'],
  },
  {
    id: 'jiangziya',
    roles: ['MAGE', 'SUPPORT'],
    names: ['姜子牙', '子牙'],
  },
  {
    id: 'bianque',
    roles: ['MAGE', 'SUPPORT'],
    names: ['扁鹊', '神医'],
  },
  {
    id: 'xinmoliuer',
    roles: ['ASSASSIN', 'WARRIOR'],
    names: ['心魔六耳', '六耳'],
  },
  {
    id: 'dayu',
    roles: ['SUPPORT'],
    names: ['大禹'],
  },
  {
    id: 'chicha',
    roles: ['MARKSMAN'],
    names: ['蚩奼', '蚩姹', '媸姹'],
  },
  {
    id: 'kongkonger',
    roles: ['SUPPORT'],
    names: ['空空儿'],
  },
];

/**
 * 规范化名称：去首尾空格、统一半角、去掉「·」及之后的内容（如“百里守约·静谧之眼”）。
 * @param {string} name
 * @returns {string}
 */
function normalizeName(name) {
  if (!name) return '';
  return (
    String(name)
      .trim()
      // 全角空格/不间断空格
      .replace(/[\s\u3000\u00A0]+/g, '')
      // 称号分隔符
      .replace(/[·•].*$/, '')
      // 英文大小写统一
      .toLowerCase()
  );
}

/**
 * 构建映射表：每个别名 -> id。
 */
export const NAME_TO_ID = {};
for (const hero of HEROES) {
  for (const name of hero.names) {
    NAME_TO_ID[normalizeName(name)] = hero.id;
  }
}

/**
 * 将中文名映射为项目 id，支持别名、简称、称号后缀。
 * @param {string} name
 * @returns {string | null}
 */
export function mapNameToId(name) {
  if (!name) return null;
  const normalized = normalizeName(name);
  if (!normalized) return null;
  return NAME_TO_ID[normalized] || null;
}

/**
 * 返回所有已配置的 id 列表，便于检查覆盖范围。
 */
export function getConfiguredIds() {
  return [...new Set(HEROES.map((h) => h.id))];
}

/**
 * 根据项目 id 返回英雄元数据（含 roles、标准名等）。
 * @param {string} id
 * @returns {{ id: string; names: string[]; roles: string[] } | undefined}
 */
export function getHeroMetaById(id) {
  return HEROES.find((h) => h.id === id);
}

export { HEROES };
