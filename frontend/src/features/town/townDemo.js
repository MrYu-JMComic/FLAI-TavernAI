export const TOWN_WORLD = {
  id: 'bianjing-night-market',
  name: '汴京夜肆',
  description: '华灯初上，居民在夜市里工作、闲逛、交换消息，也悄悄推动各自的故事。',
  startMinute: (19 * 60) + 15,
  tickMinutes: 15,
  mapUrl: '/assets/town/bianjing-night-market.webp'
};

export const TOWN_AGENTS = [
  {
    id: 'constable-su',
    name: '苏捕头',
    role: '片区捕快',
    summary: '巡查夜市、处理纠纷，正在追查当铺失窃案。',
    x: 57,
    y: 52,
    sprite: { column: 1, row: 2 },
    mood: '警觉',
    goal: '在打烊前找到失窃玉佩的线索',
    activities: ['沿街巡查', '询问摊贩', '与王掌柜核对证词', '观察可疑行人'],
    dialogue: [
      '今夜人多，别让小偷钻了空子。',
      '王掌柜说的时间对不上，我得再问一遍。',
      '那边的布摊老板，好像看见了什么。'
    ],
    memories: ['傍晚接到当铺报案', '陈阿狗曾在当铺门口逗留', '林小夏对现代物件非常熟悉']
  },
  {
    id: 'shopkeeper-wang',
    name: '王掌柜',
    role: '当铺经营者',
    summary: '精于算账，表面镇定，其实非常担心丢失的玉佩。',
    x: 22,
    y: 31,
    sprite: { column: 4, row: 2 },
    mood: '焦虑',
    goal: '找回玉佩，同时保住当铺声誉',
    activities: ['整理柜台', '盘点典当品', '回忆案发经过', '招呼客人'],
    dialogue: [
      '那块玉佩一直锁在柜里，怎么会凭空消失？',
      '客官随便看，贵重物件可别碰。',
      '苏捕头若再问，我就把账册给她。'
    ],
    memories: ['玉佩在酉时前仍在柜中', '昨夜换过一次柜门钥匙', '陈阿狗来典当过一把旧剪刀']
  },
  {
    id: 'fortune-li',
    name: '李半仙',
    role: '算命摊主',
    summary: '消息灵通，喜欢把市井观察包装成玄妙卦象。',
    x: 69,
    y: 37,
    sprite: { column: 7, row: 2 },
    mood: '从容',
    goal: '从今晚的热闹中赚够三日摊钱',
    activities: ['摇签解卦', '观察行人', '与酒客闲谈', '整理铜钱'],
    dialogue: [
      '客官眉间带风，今夜怕是要撞见奇事。',
      '卦不说尽，话也不可听全。',
      '失物向东，人心却向西。'
    ],
    memories: ['看见有人从当铺侧门离开', '林小夏手里的发光方块很稀奇', '张老醉欠了两次卦钱']
  },
  {
    id: 'thief-chen',
    name: '陈阿狗',
    role: '街头闲汉',
    summary: '熟悉夜市每条巷口，遇见捕快时总显得格外健谈。',
    x: 45,
    y: 56,
    sprite: { column: 10, row: 2 },
    mood: '心虚',
    goal: '在不引起怀疑的情况下离开主街',
    activities: ['混在人群里', '打听巡逻路线', '假装挑选小吃', '寻找僻静巷口'],
    dialogue: [
      '我就是随便逛逛，可什么都没看见。',
      '捕头大人忙案子，哪会在意我这种小人物。',
      '这夜市这么大，丢点东西也不稀奇。'
    ],
    memories: ['知道当铺侧门门闩松动', '捡到一块刻着云纹的布片', '苏捕头开始注意自己']
  },
  {
    id: 'traveler-lin',
    name: '林小夏',
    role: '异乡旅人',
    summary: '误入汴京夜市的现代人，正在努力掩饰手机和来历。',
    x: 38,
    y: 54,
    sprite: { column: 4, row: 6 },
    mood: '好奇',
    goal: '弄清所处年代，并找到安全落脚处',
    activities: ['记录夜市见闻', '寻找充电线索', '向摊主问路', '观察古代生活'],
    dialogue: [
      '现在到底是哪一年？这里连路灯都没有。',
      '手机只剩百分之十二，得省着点用。',
      '如果我说自己来自未来，他们会信吗？'
    ],
    memories: ['在一阵白光后出现在城门口', '苏捕头没有没收自己的手机', '李半仙似乎并不惊讶自己的来历']
  },
  {
    id: 'drunk-zhang',
    name: '张老醉',
    role: '夜市常客',
    summary: '嘴上含糊，记性却出奇地好，常在无意间说出关键细节。',
    x: 61,
    y: 57,
    sprite: { column: 7, row: 6 },
    mood: '微醺',
    goal: '找到赊酒的摊子，再听一轮热闹',
    activities: ['寻找酒摊', '靠树歇脚', '听人争论', '回忆昨夜见闻'],
    dialogue: [
      '我可没醉，谁从哪儿跑过去都看得清。',
      '那人影快得很，腰上还挂着个布包。',
      '再来一壶，我就想起来了。'
    ],
    memories: ['案发时听见当铺侧门响动', '看见一个灰衣人往东边走', '欠李半仙两次卦钱']
  }
];

export const TOWN_SEED_EVENTS = [
  { id: 'seed-1', minute: 19 * 60, type: 'world', text: '夜市开张，主街灯笼依次点亮。' },
  { id: 'seed-2', minute: (19 * 60) + 15, type: 'dialogue', text: '王掌柜向苏捕头报案：柜中的云纹玉佩不见了。' },
  { id: 'seed-3', minute: (19 * 60) + 15, type: 'clue', text: '陈阿狗在当铺附近徘徊，引起了林小夏的注意。' }
];
