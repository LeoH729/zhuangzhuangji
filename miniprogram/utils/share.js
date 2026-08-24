const HOME_PATH = '/pages/boss-zone/boss-zone'

const HOME_SHARE_TITLE = 'Ai造梦 - 上传照片，一键生成梦图'

const DEFAULT_TIMELINE_TITLES = [
  '上传照片，一键生成梦图',
  '用 AI 做一张属于你的梦图',
  '试试 Ai造梦，让照片变得更神奇',
  '一张照片，生成另一种可能',
  '让 AI 把照片变成新故事',
  '这里有很多好玩的 AI 生图魔法'
]

const ROUTE_SHARE_MAP = {
  'pages/index/index': {
    title: HOME_SHARE_TITLE,
    path: HOME_PATH,
    timelineTitles: DEFAULT_TIMELINE_TITLES
  },
  'pages/boss-zone/boss-zone': {
    title: HOME_SHARE_TITLE,
    path: HOME_PATH,
    timelineTitles: DEFAULT_TIMELINE_TITLES
  },
  'pages/play-zone/play-zone': {
    title: HOME_SHARE_TITLE,
    path: HOME_PATH,
    timelineTitles: DEFAULT_TIMELINE_TITLES
  },
  'pages/points/points': {
    title: '星光造梦，限时特惠！',
    path: HOME_PATH,
    timelineTitles: DEFAULT_TIMELINE_TITLES,
    timelineRedirectHome: true
  },
  'pages/profile/profile': {
    title: '我的 Ai造梦空间，查看星光与作品记录',
    path: HOME_PATH,
    timelineTitles: DEFAULT_TIMELINE_TITLES,
    timelineRedirectHome: true
  },
  'pages/generation-history/generation-history': {
    title: 'Ai造梦生成列表，随时查看我的生成作品',
    path: HOME_PATH,
    timelineTitles: DEFAULT_TIMELINE_TITLES,
    timelineRedirectHome: true
  },
  'pages/feedback/feedback': {
    title: '给 Ai造梦提建议，让魔法更好用',
    path: HOME_PATH,
    timelineTitles: DEFAULT_TIMELINE_TITLES,
    timelineRedirectHome: true
  },
  'pages/feedback-list/feedback-list': {
    title: 'Ai造梦反馈管理，处理用户建议',
    path: HOME_PATH,
    timelineTitles: DEFAULT_TIMELINE_TITLES,
    timelineRedirectHome: true
  },
  'pages/analyzing/analyzing': {
    title: 'Ai造梦正在绘制神奇图片',
    path: HOME_PATH,
    timelineTitles: DEFAULT_TIMELINE_TITLES,
    timelineRedirectHome: true
  },
  'pages/feature-unavailable/feature-unavailable': {
    title: '该功能已下架，去逛逛其他的吧',
    path: HOME_PATH,
    timelineTitles: DEFAULT_TIMELINE_TITLES,
    timelineRedirectHome: true
  }
}

const FEATURE_TIMELINE_TITLES = [
  '我发现了一个好玩的AI生图玩法：{name}',
  '这个{name}魔法有点上头',
  '上传照片试试{name}，看看 AI 会怎么改造你',
  '想看看你在{name}里会变成什么样吗'
]

const RESULT_TIMELINE_TITLES = [
  '我用 Ai造梦生成了一张神奇的图片',
  '这张 AI 梦图有点像另一个世界的我',
  '刚生成了一张梦图，来试试同款魔法',
  'AI 把我的照片变成了另一种可能'
]

const lastPickedTitleMap = {}

function pickRandom(list = []) {
  if (!list.length) return ''
  if (list.length === 1) return list[0]

  const key = list.join('|')
  const lastPickedTitle = lastPickedTitleMap[key]
  let title = list[Math.floor(Math.random() * list.length)]
  let guard = 0
  while (title === lastPickedTitle && guard < 5) {
    title = list[Math.floor(Math.random() * list.length)]
    guard += 1
  }
  lastPickedTitleMap[key] = title
  return title
}

function fillTemplate(template, values = {}) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) => values[key] || '')
}

function getCurrentRoute() {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
  const current = pages[pages.length - 1]
  return current && current.route ? current.route : 'pages/boss-zone/boss-zone'
}

function getDefaultShareConfig(route = getCurrentRoute()) {
  return ROUTE_SHARE_MAP[route] || {
    title: HOME_SHARE_TITLE,
    path: HOME_PATH,
    timelineTitle: HOME_SHARE_TITLE
  }
}

module.exports = {
  HOME_PATH,
  HOME_SHARE_TITLE,
  DEFAULT_TIMELINE_TITLES,
  FEATURE_TIMELINE_TITLES,
  RESULT_TIMELINE_TITLES,
  pickRandom,
  fillTemplate,
  getDefaultShareConfig
}
