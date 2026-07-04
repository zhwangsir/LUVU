/**
 * IP 知识库 — 用户 Live2d-model-master 收藏的所有作品简介（由 Claude 撰写，无需调用外部 LLM）。
 *
 * 用法：matchIp(modelDir) → 返回该模型所属 IP 的简介对象。
 * 匹配走 dir 名的前缀 / contains（用户的目录名可能含中英 / 标点）。
 */

export interface IpInfo {
  /** 显示名（中文优先 + 原文） */
  name: string
  /** 作品类型 — 手游/galgame/动漫/小说改编 */
  kind: string
  /** 开发/出品方 */
  by?: string
  /** 1-2 句介绍 */
  intro: string
  /** 美术/角色风格关键词 */
  style?: string
}

/** 用户 Live2d-model-master 目录下的 IP（已对照 ls 全集） */
const IPS: Array<{ keywords: string[]; info: IpInfo }> = [
  {
    keywords: ['bang dream', 'bangdream', 'bandori'],
    info: {
      name: 'BanG Dream! 邦多利',
      kind: '日系少女乐队手游 + 动画 + 漫画跨媒体企划',
      by: 'Bushiroad / Craft Egg',
      intro: '少女乐队题材综合 IP，以 Poppin\'Party、Roselia、Afterglow 等队伍为核心展开校园音乐故事。Live2D 模型多取自手游《Girls Band Party!》卡牌立绘。',
      style: '日系明亮二次元，制服 / 演出服 / 私服多套，配色鲜明',
    },
  },
  {
    keywords: ['destiny_child', 'destiny child', '天命之子'],
    info: {
      name: 'Destiny Child 天命之子',
      kind: '韩系手游',
      by: 'Shift Up / Line Games',
      intro: '韩国 Shift Up 出品的角色养成手游，由原 Nikke 团队制作，以高质量 2D 立绘与 Live2D 动态著称，角色多为神话改编的女性形象。',
      style: '韩系成熟唯美，细腻笔触，强调身材曲线和 idle 律动',
    },
  },
  {
    keywords: ['galgame live2d', 'galgame'],
    info: {
      name: 'Galgame 立绘合集',
      kind: '日系视觉小说（gal game）拆包资源',
      intro: '来自各类日系 PC 视觉小说的 Live2D 立绘合集（如 UnHolY ToRturEr 等），多为成人 / 半成人向作品中的女主角动态立绘。',
      style: '日系视觉小说画风，单角色多表情多差分',
    },
  },
  {
    keywords: ['hutao', 'hu-tao', 'hu_tao'],
    info: {
      name: '胡桃（原神 Genshin Impact）',
      kind: '开放世界 RPG 手游',
      by: 'miHoYo / HoYoverse',
      intro: '《原神》璃月七星之一，往生堂第七十七代堂主，火属性长柄武器角色。该模型为社区基于原神素材二创的 Live2D 版本。',
      style: 'miHoYo 二次元立绘，活泼俏皮，红黑撞色，梅花元素',
    },
  },
  {
    keywords: ['live2d', 'cubism'],
    info: {
      name: 'Live2D 官方 / 通用样本',
      kind: 'Cubism SDK 官方示例 + 社区通用模型',
      by: 'Live2D Inc.',
      intro: 'Cubism SDK 自带的示例模型（如 Haru、Hiyori、Mark、Wanko），用于演示 Live2D 各项功能特性。',
      style: 'Live2D 官方风格，结构标准，参数完整',
    },
  },
  {
    keywords: ['sacred sword', 'sacredsword', '圣剑公主'],
    info: {
      name: 'Sacred Sword Princesses 圣剑公主',
      kind: '韩系成人向手游',
      intro: '韩国出品的成人向 RPG 手游，以神话史诗的女武神 / 女骑士为题材，立绘走唯美 + 露出向画风。',
      style: '韩系唯美，重金属铠甲 + 神话奇幻',
    },
  },
  {
    keywords: ['sin', '七大罪', '魔王崇拜'],
    info: {
      name: 'sin 七大罪 ～魔王崇拜～',
      kind: '日系成人向 PC galgame',
      by: 'Ascii Media Works / 改编自轻小说',
      intro: '基于轻小说《七大罪》改编的 18+ 游戏，以拟人化七位魔王（七宗罪）的女角色为主，剧情走神魔奇幻路线。',
      style: '日系华丽派，奇幻服饰 + 魔界元素',
    },
  },
  {
    keywords: ['アンノウンブライド', 'unknow brige', 'unknown bride'],
    info: {
      name: 'アンノウンブライド (Unknown Bride)',
      kind: '日系手游 / galgame',
      intro: '日本「ユニフィニ」推出的策略养成手游，融合婚姻 + 战斗题材，角色多为奇幻新娘形象。',
      style: '日系华丽，婚纱礼服 + 奇幻装饰',
    },
  },
  {
    keywords: ['venusscramble', 'venus scramble'],
    info: {
      name: 'VenusScramble ヴィーナススクランブル',
      kind: '日系手游',
      intro: '日本「Cybird」运营的 RPG 手游，神话女神拟人化题材，立绘风格甜美。',
      style: '日系少女系，神话奇幻',
    },
  },
  {
    keywords: ['宝石研物语', 'jewel'],
    info: {
      name: '宝石研物语',
      kind: '中文 RPG 手游',
      intro: '以宝石拟人化为主题的中文 RPG 手游，角色对应不同宝石属性，国创二次元画风。',
      style: '国创二次元，华丽宝石 + 仙侠服饰',
    },
  },
  {
    keywords: ['崩坏学园', '崩坏学园2', 'honkai school'],
    info: {
      name: '崩坏学园 2',
      kind: '横版动作手游',
      by: 'miHoYo',
      intro: 'miHoYo「崩坏」系列起点作品，校园 + 末世题材的横版 ACT 手游，是后来《崩坏3》《崩坏：星穹铁道》的世界观源头。',
      style: 'miHoYo 早期校园二次元，制服 + 武器多样',
    },
  },
  {
    keywords: ['碧蓝航线', 'azur lane', 'azue lane', 'azuelane'],
    info: {
      name: '碧蓝航线 Azur Lane',
      kind: '中日合作舰娘手游',
      by: 'Yostar / 蛮啾网络',
      intro: '以二战军舰拟人化为题材的射击养成手游，舰娘众多、立绘画师阵容豪华，是国内二次元手游代表作之一。',
      style: '舰娘拟人化，制服 / 礼服 / 泳装多套，画师个人风格强',
    },
  },
  {
    keywords: ['凍京', '凍京nerco', 'toukyo nerco'],
    info: {
      name: '凍京 NECRO',
      kind: '日系视觉小说 / 动画',
      by: 'Nitro+',
      intro: 'Nitro+ 出品的传奇视觉小说《凍京 NECRO》，赛博朋克 + 黑色幽默基调，角色个性强烈。',
      style: 'Nitro+ 暗黑赛博朋克，机械 + 哥特元素',
    },
  },
  {
    keywords: ['方舟指令', 'ark order'],
    info: {
      name: '方舟指令',
      kind: '日系卡牌手游',
      by: 'GREE / 飞流',
      intro: '日系神魔大乱斗题材的卡牌 RPG，神话英雄拟人化登场，画师阵容来自日本插画圈。',
      style: '日系卡牌，神话奇幻服饰',
    },
  },
  {
    keywords: ['魂器学院', '炼铜学院'],
    info: {
      name: '魂器学院',
      kind: '中文校园 + 末世手游',
      intro: '国创魂器拟人化校园战斗手游，原名因 G 部内容浓度被戏称为「炼铜学院」。Live2D 立绘动态较高质量。',
      style: '国创二次元，校园制服 + 战斗装备',
    },
  },
  {
    keywords: ['机动战队', 'kantai'],
    info: {
      name: '机动战队 / Mecha Team',
      kind: '机娘拟人化手游',
      intro: '机甲娘 + 战术编队题材手游，立绘多为军武少女风格。',
      style: '军武机娘，金属质感装备',
    },
  },
  {
    keywords: ['イモコネ', 'imocone', '届けたい恋心'],
    info: {
      name: 'イモコネ ～届けたい恋心～',
      kind: '日系 galgame',
      intro: '日系恋爱视觉小说，纯爱 / 校园 / 妹系题材的立绘动态展示。',
      style: '日系治愈纯爱，校园制服系',
    },
  },
  {
    keywords: ['诺亚幻想', 'noah'],
    info: {
      name: '诺亚幻想',
      kind: '中文卡牌手游',
      intro: '幻想风卡牌养成手游，国创日系混合画风，角色多为奇幻种族（精灵、龙女等）。',
      style: '国创奇幻，欧洲幻想风',
    },
  },
  {
    keywords: ['少女次元', '少女次元'],
    info: {
      name: '少女次元 / Girls X Battle',
      kind: '中文校园放置手游',
      by: '酷睿数据',
      intro: '校园题材放置养成手游，立绘风格甜美，强调萌系养成与战斗。',
      style: '甜美萌系，校园制服多套',
    },
  },
  {
    keywords: ['少女咖啡枪', 'girls cafe gun'],
    info: {
      name: '少女咖啡枪 Girls Cafe Gun',
      kind: '中文枪娘养成手游',
      by: '七煌互娱',
      intro: '咖啡店 + 枪娘 + 校园题材的国创二次元手游，画风清新，强调日常 + 战斗双线。',
      style: '清新二次元，校园 + 制服 + 武器',
    },
  },
  {
    keywords: ['少女前线', 'girls frontline', '少女前線'],
    info: {
      name: '少女前线 Girls\' Frontline',
      kind: '中文军武枪娘策略手游',
      by: '云母组 / 数字天空',
      intro: '武器拟人化（人形）题材的策略 RPG 手游，世界观硬核（核战末日），人形阵营复杂，是国创军武娘代表作。',
      style: '军武枪娘，制服 / 装甲 / 战术装备',
    },
  },
  {
    keywords: ['食物语'],
    info: {
      name: '食物语',
      kind: '中文食物拟人化手游',
      by: '心动网络',
      intro: '以中华美食拟人化为题材的国创卡牌 RPG，角色立绘融合古风与餐饮元素。',
      style: '古风国创，汉服 + 美食元素',
    },
  },
  {
    keywords: ['为美好的世界', '献上祝福', 'konosuba', 'fantastic days'],
    info: {
      name: '为美好的世界献上祝福！Fantastic Days',
      kind: '日系手游（动画改编）',
      by: 'Sumzap',
      intro: '人气轻小说 / 动画《为美好的世界献上祝福！》（Konosuba）的官方手游，原作搞笑奇幻冒险风，角色阿库娅、惠惠、达克妮丝齐登场。',
      style: '日系轻松奇幻，原作还原',
    },
  },
  {
    keywords: ['战舰少女', 'warship girls'],
    info: {
      name: '战舰少女 R',
      kind: '中文舰娘手游',
      by: '幻萌网络',
      intro: '国内早期舰娘拟人化养成手游，比《碧蓝航线》更早，舰种丰富，玩家社群粘性高。',
      style: '舰娘拟人化，制服 / 礼服 / 装甲',
    },
  },
]

/** 模型 dir 路径里找 IP — 用 IP 关键词在路径上 contains 匹配 */
export function matchIp(modelDir: string): IpInfo | null {
  const norm = modelDir.toLowerCase().replace(/[\\/]/g, '/')
  for (const { keywords, info } of IPS) {
    for (const kw of keywords) {
      if (norm.includes(kw.toLowerCase())) return info
    }
  }
  return null
}

/** 列出所有 IP（供 settings / debug 使用） */
export function listIps(): IpInfo[] {
  return IPS.map((x) => x.info)
}
