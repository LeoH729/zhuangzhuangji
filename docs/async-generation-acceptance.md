# 异步生图验收清单

## 部署前准备

1. 在云开发控制台创建集合 `generation_tasks`
2. 按 `docs/generation_tasks_schema.json` 创建索引
3. 上传并部署云函数：
   - `cloudfunctions/aiGenerate`（云端安装依赖）
   - `cloudfunctions/generationWorker`（云端安装依赖）
4. 将 `generationWorker` 超时时间设置为 **60 秒**（平台上限）

## 验收步骤（gpt-image-2）

1. 在 `ai_models` 中配置 `provider: toapis` 的 gpt-image-2 模型
2. 在功能详情页上传图片并点击生成
3. 确认 analyzing 页在 **1~2 秒内** 进入“任务已提交”状态
4. 轮询期间 `aiGenerate(getTaskStatus)` 正常返回 `pending/running`
5. 任务完成后自动跳转 result 页并展示图片（若模型在 60 秒内返回）
6. 历史记录页可看到新记录

## 失败场景

1. 故意关闭中转站或填错 API Key
2. 任务状态应变为 `failed`（包括上游超时场景）
3. 用户积分应被退回且只退回一次
4. analyzing 页应提示错误并返回

## 本地结构校验

```bash
node scripts/validate-async-generation.js
```
