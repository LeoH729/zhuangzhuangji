# AI 生图小程序项目交接说明

更新时间：2026-06-05 18:10 左右  
当前 Git 分支：`main`  
远端仓库：`https://github.com/LeoH729/zhuangzhuangji.git`  
CloudBase 环境：`cloudbase-5gmfinom29f48930`  
小程序 AppID：`wx2e1dbc56f270e910`

## 当前版本状态

GitHub `main` 最新提交：

```text
732f896 V1.4.1 优化等待页体验并新增文生图功能
```

当前本地工作区不是完全干净，存在以下重要状态：

- `cloudfunctions/aiGenerate/generationExecutor.js` 已做线上热修：`gpt-image-2` 请求 `size` 统一传 `auto`。
- `cloudfunctions/generationWorker/generationExecutor.js` 已做同样热修。
- `cloudfunctions/notification/` 是订阅消息最低目标方案的实验代码，目前未提交，不属于 GitHub V1.4.1 基线。
- `tmp/v1.4.1-rollback-backup.patch` 是 2026-06-05 回滚前的差异备份。
- `.agents/`、`skills-lock.json` 是本地 AI/技能相关文件，不属于小程序线上核心代码。

线上已部署状态：

- `aiGenerate`：已部署热修版，Active，更新时间约 `2026-06-05 18:03:21`。
- `generationWorker`：已部署热修版，Active，更新时间约 `2026-06-05 18:03:43`。
- `adminApi`：已重新部署为 V1.4.1 代码，Active，更新时间约 `2026-06-05 17:56:02`。
- 后台 Web 前端线上资源与本地 `admin-web/dist` 一致：
  - `assets/index-D7BGGWxI.js`
  - `assets/index-BdI9w66V.css`

重要数据库热修：

- `ai_models` 中所有 `model_id = "gpt-image-2"` 的记录已更新为 `size: "auto"`。
- 目前 4 条相关模型：
  - `sololong-gpt-image-2`，provider `supersolo_async`
  - `toapis_gpt_image_2`，provider `toapis`
  - `solo-gpt-image-2`，provider `supersolo`
  - `jiucan-gpt-image-2`，provider `jiucan`

## 项目概览

这是一个微信小程序 + CloudBase 云开发项目，用于 AI 生图模板配置、用户上传/填写信息生成图片、积分扣除/退款、历史记录、分享、反馈、后台管理。

主要组成：

- 小程序端：根目录 `app.js`、`app.json`、`pages/`、`utils/`、`images/`
- 云函数：`cloudfunctions/`
- 管理后台 Web：`admin-web/`
- 静态和运维文档：`docs/`
- 支付 SDK：`wxPaymentSDK/`

小程序全局版本号：

```js
// app.js
globalData.version = '1.4.1'
```

## 目录结构

核心目录：

```text
pages/
  index/                 首页模板列表
  feature/               生图模板详情页，图生图/文生图表单都在这里
  analyzing/             生成等待页，含像素风贪吃蛇等待体验
  result/                生成结果页，支持分享访客态和“生成同款图片”
  profile/               我的页
  points/                星光/积分页
  feedback/              意见反馈提交
  feedback-list/         管理员反馈列表
  generation-history/    生成列表

cloudfunctions/
  aiGenerate/            生图主入口，创建任务、同步生成、查任务状态、评价
  generationWorker/      异步任务实际执行器，轮询/调用上游模型/写历史
  adminApi/              管理后台 Web 调用的主接口
  points/                星光积分配置、初始化、扣除、充值
  login/                 获取 OPENID
  share/                 分享激励相关
  feedback/              用户反馈
  createPayment/         微信支付下单
  paymentNotify/         支付回调
  virtualPayment/        虚拟支付/测试支付
  imageSizeProbe/        图片尺寸探测
  notification/          订阅消息实验代码，当前未提交

admin-web/
  src/main.jsx           后台管理主界面
  src/cloudbase.js       后台 CloudBase JS SDK 初始化
  dist/                  当前线上后台前端构建产物
```

## 小程序主要流程

1. 启动时 `app.js` 初始化 `wx.cloud`，调用 `login` 获取 `OPENID`。
2. 调用 `points.ensureUserPoints` 初始化/读取用户星光。
3. 首页 `pages/index` 展示 `ai_features` 模板。
4. 用户进入 `pages/feature`：
   - `template_type = image_to_image` 时展示上传区。
   - `template_type = text_to_image` 时展示动态字段表单。
5. 提交生成后调用 `aiGenerate`：
   - 多数模板走 `createTask` 异步任务。
   - 任务写入 `generation_tasks`。
   - 前端进入 `pages/analyzing` 等待页。
6. `generationWorker` 执行实际生成：
   - 根据 `model_call_id` 读取 `ai_models`。
   - 调用不同 provider。
   - 成功写入 `generation_history`，更新 `generation_tasks`。
   - 失败会通过 `points.recharge` 退款。
7. 等待页轮询 `getTaskStatus`：
   - 成功后底部按钮显示可查看结果。
   - 失败时弹窗提示网络原因失败，星光已返还，确认后回模板详情页。
8. 结果页 `pages/result` 展示图片、支持分享、保存、评分。

## 生图模板类型

`ai_features` 支持两类模板：

```text
template_type = image_to_image
template_type = text_to_image
```

图生图常用字段：

- `upload_count`
- `prompt`
- `model_call_id`
- `points_cost`
- `home_banner`
- `detail_banner`

文生图新增字段：

- `input_fields`：动态字段配置数组。
- `template_type = text_to_image`
- `upload_count` 可为 0。

`input_fields` 示例：

```json
[
  {
    "key": "category",
    "title": "品类",
    "placeholder": "例如：宠物食品",
    "maxLength": 12,
    "required": true,
    "sort": 1
  }
]
```

提示词中使用 `{字段key}` 占位，例如：

```text
生成一张{品类}的端午节宣传海报，左上角呈现品牌名称{品牌名}，画面中间排列文案{主文案}
```

提交时会生成：

- `inputValues`
- `compiledPrompt`
- `templateType`

这些字段会写入 `generation_tasks` 和 `generation_history`，便于排查。

## 生图 provider 与 size 规则

当前生成执行器位置：

- `cloudfunctions/aiGenerate/generationExecutor.js`
- `cloudfunctions/generationWorker/generationExecutor.js`

重要函数：

```js
function resolveImageSize(modelConfig = {}, fallback = '1024x1024') {
  if (String(modelConfig.model_id || '').trim() === 'gpt-image-2') {
    return 'auto'
  }
  return modelConfig.size || fallback
}
```

当前规则：

- `gpt-image-2`：无论 provider，统一传 `size: "auto"`。
- `volcengine`：仍使用 `size: "2K"`。
- 非 `gpt-image-2` 的 `supersolo`/`jiucan`：默认 `1024x1024`。
- 非 `gpt-image-2` 的 `toapis`：默认 `1:1`。

注意：

- 2026-06-05 曾出现 `gpt-image-2` 上游报错，日志中有 `size: 1152x1536` 导致 no available channel。
- 为避免复发，代码和数据库都已统一 `gpt-image-2 size = auto`。
- 后续如果从 GitHub V1.4.1 干净代码重新部署，必须保留这次 `auto` 热修，或者先提交它。

## 云函数说明

### `aiGenerate`

主要 action：

- `createTask`
- `getTaskStatus`
- `rateTask`
- `ensureWorker`
- `listTasks`
- 默认同步生成

依赖文件：

- `generationExecutor.js`
- `taskHelpers.js`

职责：

- 校验模板
- 校验文生图字段
- 扣星光
- 创建异步任务
- 查询任务状态
- 同步生成兜底

### `generationWorker`

职责：

- 认领 `generation_tasks` pending 任务。
- 处理卡在 running 的任务自愈。
- 调用 provider 执行生成。
- 成功写 `generation_history`。
- 失败标记任务失败并退款。

重要逻辑：

- `RUNNING_TIMEOUT_MS = 16 * 60 * 1000`
- 异步 provider：`toapis`、`supersolo_async`
- 可重试网络错误会回到 pending。

### `adminApi`

后台 Web 主接口，运行时 `Nodejs18.15`。

主要 action：

- 管理员：`getAdminStatus`、`bootstrapAdmin`、`listAdmins`
- 模型：`listModels`、`createModel`、`updateModel`、`deleteModel`
- 分组：`listGroups`、`createGroup`、`updateGroup`
- 模板：`listFeatures`、`createFeature`、`updateFeature`、`deleteFeature`
- 图片资源：`listImages`、`createImageAsset`、`updateImageAsset`、`deleteImageAsset`
- 用户：`listUsers`、`syncUserPoints`、`adjustUserPoints`

注意：

- V1.4.1 后台支持文生图模板字段。
- `FEATURE_FIELDS` 包含 ToAPIs 专用卡片比例 `size`；仅当主模型或兜底模型 provider 为 `toapis` 时后台显示，允许 `1:1`、`3:4`、`9:16`。
- 后台登录通过 CloudBase Auth / 管理员白名单集合 `admin_users`。

### `points`

管理星光积分：

- 初始化用户积分
- 消耗积分
- 充值/退款
- 配置读取

主要集合：

- `user_points`
- `points_history`
- `points_config`

## 主要数据库集合

```text
ai_features              生图模板
ai_models                模型配置
ai_groups                模板分组
image_assets             后台图片素材
generation_tasks         异步生成任务
generation_history       生成历史
user_points              用户星光余额
points_history           星光流水
points_config            星光配置
orders                   订单
feedbacks                意见反馈
admin_users              后台管理员白名单
```

实验/未正式使用集合：

```text
notification_logs
notification_config
```

## 管理后台 Web

目录：`admin-web/`

技术栈：

- React 19
- Vite 6
- `@cloudbase/js-sdk`
- `lucide-react`

常用命令：

```bash
npm --prefix admin-web run build
npm --prefix admin-web run dev
npm --prefix admin-web run preview
```

线上后台地址：

```text
https://makedream-admin.supersolo.tech/admin/index.html
```

当前线上资源：

```text
assets/index-D7BGGWxI.js
assets/index-BdI9w66V.css
```

本地 `admin-web/dist/index.html` 与线上资源一致。

注意：

- 这个后台域名未在当前 CloudBase `queryHosting(domainStatus)` 查到绑定，可能是外部静态托管/CDN 或其他环境配置。
- 当前环境 CloudApp 未查到 admin 应用。
- 如果修改后台前端，需要先 `npm --prefix admin-web run build`，再按实际托管方式部署 `admin-web/dist`。

## 等待页体验

页面：`pages/analyzing/`

V1.4.0 重点改动：

- 白底像素风 UI。
- 内嵌黑白像素贪吃蛇 Canvas 小游戏。
- 游戏支持滑动控制方向。
- 生成完成后不弹窗，底部按钮变为“生图完成啦 去看看”。
- 失败弹窗统一提示：

```text
因网络原因导致生图失败，您的星光已返还，请返回重试
```

按钮：`确认`，点击返回模板详情页。

注意：

- 等待页小游戏不影响任务轮询。
- `onHide/onUnload` 要清理游戏定时器。
- 当前订阅消息相关代码已回滚，不在正式等待页逻辑中。

## 分享逻辑

结果页：`pages/result/result`

V1.4.0 分享优化：

- 分享路径携带 `shared=1`、`featureId`、`featureName`、`id/url`。
- 分享访客态主按钮为“生成同款图片”。
- 点击跳转 `/pages/feature/feature?id={featureId}`。
- 非访客态仍显示“分享给好友”。

## 订阅消息状态

最低目标方案曾经实现过，但目前已回滚，不属于线上正式版本。

遗留状态：

- 本地有未跟踪目录 `cloudfunctions/notification/`。
- 线上可能存在曾创建过的 `notification` 云函数和 `notification_logs` / `notification_config` 集合。
- 当前 `generationWorker` V1.4.1 代码不再调用 `notification.sendGenerationDone`。

后续如果继续做订阅消息：

- 不建议直接基于当前未跟踪目录上线，应重新审查代码。
- 微信订阅消息不需要强制微信登录，云函数可通过 `wx.cloud.getWXContext().OPENID` 识别用户。
- 订阅授权记录可以优先写入 `user_points`，避免新建过多集合。
- 需要配置真实订阅模板 ID，否则 `wx.requestSubscribeMessage` 没有实际价值。

## 部署与回滚

### 查看 Git 状态

```bash
git status --short --branch
git log --oneline -5
```

### 回滚到 GitHub main

危险操作，执行前先备份：

```bash
git diff --binary --output=tmp/v1.4.1-rollback-backup.patch
git reset --hard origin/main
```

注意：

- `git reset --hard` 会清掉 tracked 文件的未提交改动。
- 未跟踪目录如 `cloudfunctions/notification/` 不会被清掉。
- 如果需要清理未跟踪文件，必须谨慎使用 `git clean`。

### 部署云函数

CloudBase MCP 方式：

```text
manageFunctions.updateFunctionCode
functionRootPath = E:\私人\独立开发_本地\一人公司\开发部\AI生图小程序\cloudfunctions
```

常部署函数：

- `aiGenerate`
- `generationWorker`
- `adminApi`

部署前建议：

```bash
node --check cloudfunctions/aiGenerate/generationExecutor.js
node --check cloudfunctions/generationWorker/generationExecutor.js
node --check cloudfunctions/adminApi/index.js
```

部署后查询：

```text
queryFunctions.getFunctionDetail
```

确认字段：

- `Status = Active`
- `AvailableStatus = Available`
- `ModTime` 为最新时间

## 最近重要事故与处理

2026-06-05 发生过 `gpt-image-2` 模板生成失败。

现象：

- 上游日志出现 400/503。
- ToAPIs 返回类似：

```text
no available channel for model_name: gpt-image-2
params: map[resolution:1536p size:1152x1536]
```

处理过程：

1. 曾尝试回滚云函数到 GitHub V1.4.1。
2. 重新部署 `aiGenerate`、`generationWorker`、`adminApi`。
3. 最终按产品要求将所有 `gpt-image-2` 的 `size` 改为 `auto`。
4. 数据库 `ai_models` 中相关记录也全部写入 `size: "auto"`。

后续注意：

- 如果重新从 GitHub V1.4.1 部署，`size=auto` 代码热修会丢失，除非先提交当前改动。
- 如果再次报错，优先查 `generationWorker` 日志详情中的 `responseData`、`url`、`provider`、`modelCallId`。

## 常用排查命令

搜索代码：

```bash
rg -n "gpt-image-2|size|model_call_id|template_type|input_fields" .
```

检查关键文件：

```bash
node --check cloudfunctions/aiGenerate/index.js
node --check cloudfunctions/aiGenerate/generationExecutor.js
node --check cloudfunctions/generationWorker/index.js
node --check cloudfunctions/generationWorker/generationExecutor.js
node --check cloudfunctions/adminApi/index.js
```

后台构建：

```bash
npm --prefix admin-web run build
```

查看线上后台 HTML：

```powershell
Invoke-WebRequest -Uri https://makedream-admin.supersolo.tech/admin/index.html -UseBasicParsing
```

## 给下一个 Codex 的建议

1. 先读本文档，再执行 `git status --short --branch`。
2. 不要假设 GitHub `main` 等于线上状态，因为当前线上包含 `gpt-image-2 size=auto` 热修。
3. 在继续订阅消息功能前，先决定是否提交当前热修。
4. 生图链路优先保护 `aiGenerate`、`generationWorker`，不要把实验代码混入部署。
5. 修改 `cloudfunctions/generationWorker` 时要注意：部署会上传整个函数目录，旁边文件的未提交改动也会被带上线。
6. 修改后台功能时，通常需要同时考虑：
   - `admin-web/src/main.jsx`
   - `admin-web/src/styles.css`
   - `cloudfunctions/adminApi/index.js`
   - 相关数据库字段
7. 对线上问题先查 CloudBase 函数日志，不要只看前端提示。
