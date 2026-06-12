# 模型提供商图片调用参数模板

> 版本：2026-06-09  
> 用途：记录各个提供商/模型的图片生成请求模板，避免后续新增模型时混用参数。  
> 原则：业务云函数适配上游接口规则，不要求上游兼容我们的旧参数。

## 1. 通用规则

- 每个模型必须明确区分文生图与图生图。
- 同一提供商下，不同模型也可以使用不同端点、认证头和请求体。
- 不能把 OpenAI 的 `size: "1024x1024"` 直接套到 Gemini，也不能把 Gemini 的 `generationConfig.responseFormat.image` 直接套到 OpenAI。
- 云函数保存生成历史时继续记录 `compiledPrompt`、`templateType`、`modelCallId`、`originalImages`，用于排查。
- 当前项目新增模型时优先按 `model_id` 判断模型族：只要 `model_id` 包含 `gpt`，无论 `provider` 填什么，都优先使用 GPT 图片模板；只要 `model_id` 包含 `gemini`，无论 `provider` 填什么，都优先使用 Gemini 请求体模板。只有不命中这两个关键词时，才回落到 `provider` 专属模板。
- Gemini 端点规则：云函数不再为任何 provider 自动拼接 `/models/{model_id}:generateContent`；后台 `base_url` 必须直接填写完整可 POST 的 Gemini 接口地址。

## 2. Supersolo / GPT Image 2

后台模型配置：

```json
{
  "provider": "supersolo",
  "base_url": "https://proxy.supersolo.net/v1",
  "model_id": "gpt-image-2"
}
```

### 2.1 文生图

端点：

```http
POST {base_url}/images/generations
Authorization: Bearer <solo-api-key>
Content-Type: application/json
```

请求体：

```json
{
  "model": "gpt-image-2",
  "prompt": "生成提示词",
  "n": 1,
  "size": "auto"
}
```

约束：

- `size` 统一传 `auto`。
- 不传 `response_format`，GPT Image 官方默认返回 base64 图片数据。
- 响应优先读取 `data[0].b64_json`，兼容 `data[0].url`。

### 2.2 图生图

端点：

```http
POST {base_url}/images/edits
Authorization: Bearer <solo-api-key>
Content-Type: application/json
```

请求体：

```json
{
  "model": "gpt-image-2",
  "prompt": "生成提示词",
  "n": 1,
  "size": "auto",
  "images": [
    {
      "image_url": "<参考图 HTTPS 临时链接>"
    }
  ]
}
```

约束：

- Supersolo 的 GPT Image 2 图生图走 `/images/edits`，并使用 `application/json`，不使用 multipart。
- 参考图字段使用 `images[].image_url`。
- 响应优先读取 `data[0].b64_json`，兼容 `data[0].url`。

## 3. Supersolo / Gemini Image

后台模型配置：

```json
{
  "provider": "supersolo",
  "base_url": "https://proxy.supersolo.net/v1beta/models/gemini-3.1-flash-image:generateContent",
  "model_id": "gemini-3.1-flash-image"
}
```

### 3.1 文生图

端点：

```http
POST {base_url}
x-goog-api-key: <solo-api-key>
Content-Type: application/json
```

后台 `base_url` 需要直接填写完整可 POST 的 Gemini 接口地址，不能只填站点根地址或 OpenAI 兼容入口。

请求体：

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [
        {
          "text": "生成提示词"
        }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"]
  }
}
```

### 3.2 图生图

端点同文生图。

请求体：

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [
        {
          "text": "生成提示词"
        },
        {
          "inline_data": {
            "mime_type": "image/jpeg",
            "data": "<参考图 base64>"
          }
        }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"]
  }
}
```

约束：

- 不走 `/images/generations` 或 `/images/edits`。
- 不传 OpenAI 的 `size`、`response_format`。
- 结果从 `candidates[].content.parts[].inlineData.data` 或 `inline_data.data` 读取。
- 如果中转站没有开放 Gemini 协议端点，仍会失败；此时需要调整 CLIProxyAPI 的 Gemini 兼容配置，而不是回退到 OpenAI Images 参数。

## 4. ToAPIs / GPT Image 2

后台模型配置：

```json
{
  "provider": "toapis",
  "base_url": "https://toapis.com/v1",
  "model_id": "gpt-image-2"
}
```

### 4.1 图生图

端点：

```http
POST {base_url}/images/generations
Authorization: Bearer <toapis-api-key>
Content-Type: application/json
```

请求体：

```json
{
  "model": "gpt-image-2",
  "prompt": "生成提示词",
  "n": 1,
  "size": "1:1",
  "resolution": "2K",
  "reference_images": [
    "<参考图 HTTPS URL>"
  ],
  "image_urls": [
    "<参考图 HTTPS URL>"
  ],
  "response_format": "url",
  "client_business_id": "<generation_tasks._id>"
}
```

约束：

- ToAPIs 的 `size` 是卡片级比例字段，不再从后台模型配置读取。只要卡片主模型或兜底模型 provider 为 `toapis`，后台卡片编辑器会显示“图片比例”。
- 当前可选比例只允许 `1:1`、`3:4`、`9:16`。卡片未配置或传入非法值时，云函数兜底发送 `1:1`。
- 非 ToAPIs provider 不显示卡片级 `size` 字段，继续按各自 provider 请求模板处理；常规 GPT/Gemini 兼容模板默认传 `auto`。
- `reference_images` 是 ToAPIs 文档主字段；`image_urls` 作为兼容字段保留。
- `client_business_id` 只用于上游日志追踪，不影响生图内容。

## 5. Volcengine / 火山引擎

后台模型配置：

```json
{
  "provider": "volcengine",
  "base_url": "https://ark.cn-beijing.volces.com/api/v3/images/generations",
  "model_id": "<火山图片模型 ID>"
}
```

### 5.1 文生图

端点：

```http
POST {base_url}
Authorization: Bearer <volcengine-api-key>
Content-Type: application/json
```

请求体：

```json
{
  "model": "<火山图片模型 ID>",
  "prompt": "生成提示词",
  "sequential_image_generation": "disabled",
  "response_format": "url",
  "size": "2K",
  "stream": false,
  "watermark": false
}
```

### 5.2 图生图

端点同文生图。

请求体：

```json
{
  "model": "<火山图片模型 ID>",
  "prompt": "生成提示词",
  "sequential_image_generation": "disabled",
  "response_format": "url",
  "size": "2K",
  "stream": false,
  "watermark": false,
  "image": "<参考图 HTTPS URL>"
}
```

约束：
- 当前项目规范固定传 `watermark: false`，避免火山引擎结果图携带水印。
- 当前响应从 `data[0].url` 读取，再转存到云存储。
- 当前 `size` 固定为 `2K`，后续如需按后台模型配置调整，应先更新本文档。

## 6. 后续新增提供商模板要求

新增任何模型时，先补齐以下信息：

```text
provider:
model_id:
base_url:
认证方式:
文生图端点:
文生图请求体:
图生图端点:
图生图请求体:
响应图片字段:
已知不兼容参数:
测试记录:
```

没有这份模板，不建议直接在后台新增线上模型。
