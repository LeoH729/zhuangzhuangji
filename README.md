# AI生图小程序

一款极简风格的复合 AI 生图工具平台。前端提供灵活的瀑布流分组与配置化的生图流程，后端基于 **微信云开发** 构建，所有模型能力（文生图、图生图）和首页功能卡片均可通过云数据库动态配置。

## 核心特性

- **极简 UI/UX**：采用优雅黑白灰极简风格，流畅微动画，强调沉浸式的生图体验。
- **后台驱动的瀑布流卡片**：首页功能入口完全由云端数据库控制，随时上下架生图功能，无需频繁发布小程序。
- **灵活的模型调度**：集成 `aiGenerate` 核心代理云函数，支持对接不同的 AI 绘画平台（如 Coze 图像流、Midjourney API 等），解耦客户端和模型层。
- **完善的积分体系**：内置积分管理（`points`），每次调用扣除相应点数，提供充值入口和交易流水。

## 技术栈

- 微信小程序原生框架（WXML / WXSS / JS / JSON）
- 微信云开发（云函数、云数据库、云存储）

## 项目结构
```text
zhuangzhuangji-main/
├── miniprogram/                    # 微信开发者工具唯一编译根目录
│   ├── app.js / app.json / app.wxss
│   ├── components/
│   ├── config/
│   ├── images/
│   ├── utils/
│   └── pages/
│   ├── index/                      # 首页：动态瀑布流卡片
│   ├── feature/                    # 功能详情页：上传图片及参数配置
│   ├── analyzing/                  # 生图中等待页
│   ├── result/                     # 生图结果页
│   ├── profile/                    # 我的：个人中心
│   ├── points/                     # 积分充值与说明
│   ├── generation-history/         # 生成记录
│   └── feedback/ / feedback-list/  # 意见反馈
├── admin-web/                      # 运营后台，位于小程序编译根之外
├── cloudfunctions/                 # 云函数目录
├── cloudbase/                      # 云开发配置与静态托管资源
├── tests/ / scripts/ / docs/       # 测试、运维脚本和文档
├── project.config.json             # miniprogramRoot=miniprogram/
└── README_CLOUD_SETUP.md

zhuangzhuangji-web/                 # 同级独立Next.js网站项目
```

## 本地运行指南

1. 下载或 Clone 本项目。
2. 使用微信开发者工具打开 `zhuangzhuangji-main`；工具会按 `miniprogramRoot` 只编译 `miniprogram/`。
3. 替换/填入自己的 `AppID`。
4. 开通云开发，在开发者工具顶部选择对应的云环境。
5. 参考 **`README_CLOUD_SETUP.md`** 创建相应的云数据库集合，并上传部署所有云函数。
6. 编译运行。

网站请单独进入同级 `zhuangzhuangji-web` 目录执行 `npm run dev`，不要再把网站源码或构建产物放回小程序项目。

## 许可证
暂未提供开源许可证，仅供参考或内部使用。
