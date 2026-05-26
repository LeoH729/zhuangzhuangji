# AI 生图小程序 - 云开发部署指南

本项目采用纯云开发架构。部署前，请确保已经在微信开发者工具中开通了云开发服务。

## 1. 部署云函数
你需要依次右键点击 `cloudfunctions/` 下的各个文件夹，选择 **“上传并部署（所有文件）”** 或 **“上传并部署（云端安装依赖）”**。

### 核心云函数概览
- **`aiGenerate`**: 替代客户端直接发起 API 请求，代理访问各大平台的 AI 生图接口。
- **`featureConfig`**: 提供小程序前端读取可用功能列表（首页瀑布流数据源）。
- **`modelConfig`**: 管理模型配置信息。
- **`points`**: 处理积分扣减与查询，内置并发控制防刷处理。
- **`login`**: 获取微信用户的 `openid`。
- **`createPayment` / `paymentNotify`**: 微信支付接入。

## 2. 数据库集合 (Collections)
请在云开发控制台 - **数据库** 中，手动创建以下集合：

### 2.1. `ai_features`（生图功能表）
驱动首页瀑布流卡片和功能详情页的配置数据。
**权限要求**：所有用户可读，仅创建者/管理员可写。
示例数据结构：
```json
{
  "name": "元气日系写真",        // 功能名称，展示在卡片和页面标题上
  "group": "写真",             // 功能分组，用于在首页进行分类筛选
  "home_banner": "cloud://...", // 首页瀑布流卡片展示图（云存储地址）
  "detail_banner": "cloud://...", // 功能详情页顶部横幅展示图（云存储地址）
  "upload_count": 1,           // 用户需要上传的参考图数量限制（单图为 1，多图为对应数值）
  "points_cost": 5,            // 每次生成需要消耗的积分额度
  "model_call_id": "coze_workflow_12345", // 关联模型配置表中的 model_call_id
  "prompt": "将上传的人像转换成元气日系风格，光线明亮...", // 传递给大模型或工作流的绘图提示词
  "status": 1,                 // 上下架状态（1 为正常上架展示，0 为下架隐藏）
  "sort": 10                   // 首页排序权重（数值越小排序越靠前）
}
```

### 2.2. `ai_models`（模型配置表）
存放调用的模型服务商及其密钥信息（安全起见，绝对不要将密钥放在前端）。
**权限要求**：仅管理员可读写。
示例数据结构：
```json
{
  "model_call_id": "coze_workflow_12345", // 与生图功能表关联的唯一标识 ID
  "provider": "coze",          // 模型接口服务商（支持 'coze' / 'volcengine' / 'supersolo' / 'supersolo_async' / 'toapis' / 'mock'）
  "base_url": "https://api.coze.cn/v1/workflow/run", // 模型 API 接口基础请求地址
  "model_id": "7564249346457485338", // 大模型的工作流 ID、部署的模型 ID 或具体推理名称
  "api_key": "pat_xxxxxx"      // 服务商提供的身份授权密钥 (API Key / Personal Access Token)
}
```

`supersolo_async`（CLIProxyAPI/Supersolo 异步生图）接入示例：
```json
{
  "model_call_id": "supersolo_gpt_image_2_async",
  "provider": "supersolo_async",
  "base_url": "https://your-supersolo-domain.com/v1",
  "model_id": "gpt-image-2",
  "api_key": "your-supersolo-api-key"
}
```

`toapis`（OpenAI 兼容网关）接入示例：
```json
{
  "model_call_id": "toapis_gpt_image_2",
  "provider": "toapis",
  "base_url": "https://toapis.com/v1",
  "model_id": "gpt-image-2",
  "api_key": "your-toapis-key"
}
```

### 2.3. `user_points`（用户积分表）
记录用户的积分余额。文档 `_id` 需与用户 `openid` 保持一致。
**权限要求**：所有用户可读，仅创建者可写。
示例数据结构：
```json
{
  "_id": "oAbCdeFgHiJkLmNoP",
  "points": 100,
  "updated_at": 1730890000000
}
```

### 2.4. `points_config`（全局积分配置表）
仅包含一条记录，`_id` 固定为 `global`，用于设置用户初次进入赠送的积分等。
**权限要求**：所有用户可读，仅管理员可写。
```json
{
  "_id": "global",
  "initial_points": 50,
  "updated_at": 1730890000000
}
```

### 2.5. `generation_history`（生成记录表）
存储用户生成的历史图片记录。
**权限要求**：所有用户可读，仅创建者可读写。

### 2.6. `generation_tasks`（异步生图任务表）
用于解耦“提交任务”和“执行生图”，避免云函数 60 秒超时。
**权限要求**：仅云函数可读写（建议设置为“仅管理端可读写”或“仅创建者可读写”，客户端通过 `aiGenerate` 查询）。

字段说明：
```json
{
  "_openid": "oAbCdeFgHiJkLmNoP",
  "featureId": "feature_doc_id",
  "status": "pending",
  "imageUrls": ["cloud://..."],
  "promptSnapshot": "将上传的人像转换成...",
  "modelCallIdSnapshot": "supersolo_gpt_image_2",
  "featureNameSnapshot": "元气日系写真",
  "pointsCost": 5,
  "pointsDeducted": true,
  "pointsRefunded": false,
  "resultUrl": "",
  "errorMessage": "",
  "historyId": "",
  "createdAt": "serverDate",
  "startedAt": null,
  "finishedAt": null
}
```

`status` 取值：
- `pending`：已创建，等待 worker 执行
- `running`：worker 已抢占任务，正在调用模型
- `succeeded`：生成成功，可读取 `resultUrl`
- `failed`：生成失败，可读取 `errorMessage`

建议索引（在云开发控制台 - 数据库 - 索引 中创建）：
1. `_openid` 升序 + `createdAt` 降序
2. `status` 升序 + `createdAt` 降序

## 3. 异步生图云函数

除原有 `aiGenerate` 外，还需部署新的 `generationWorker` 云函数：

- **`aiGenerate`**
  - `action: "createTask"`：扣积分、写入 `generation_tasks`、触发 worker，秒级返回 `taskId`
  - `action: "getTaskStatus"`：按 `taskId + openid` 查询任务状态
  - 无 `action` 时保留旧同步入口（兼容）
- **`generationWorker`**
  - 接收 `taskId`，CAS 抢占 `pending -> running`
  - 调用模型、写入 `generation_history`、更新任务状态
  - 失败时幂等回滚积分

**重要**：微信小程序云开发的云函数单次执行上限为 **60 秒**，`generationWorker` 也不能超过该上限。请在实现中保持短执行（例如请求超时控制在 50 秒内），超时后写入失败状态并回滚积分。

## 4. 安全注意事项
- **密钥安全**：绝对不要在 `pages/` 客户端代码中硬编码任何第三方大模型的 API Key 或敏感信息。
- **权限隔离**：`ai_models` 集合建议仅允许管理员读写，或完全隔离仅由后端云函数（`aiGenerate` 等）去读取，严防客户端越权访问导致资产损失。