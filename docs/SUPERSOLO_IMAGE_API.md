# Supersolo 图片接口文档与兼容策略

> 版本：2026-06-08  
> 适用范围：小程序云函数调用自建 `supersolo` 中转站的同步图片生成通道。  
> 暂不扩展：`supersolo_async`，该通道视为历史过渡方案。

## 1. 定位

`supersolo` 是我们自建的图片生成中转站，母项目参考 `router-for-me/CLIProxyAPI`。在小程序项目中，它是长期保留的同步图片生成主通道：

- 云函数只面向 `supersolo` 暴露出的 OpenAI 兼容接口。
- `supersolo` 内部负责转发到 OpenAI、Gemini、Codex、Gemini CLI 或其他上游。
- 小程序侧不直接接触 OpenAI/Gemini 官方密钥。
- 当前不再把 `supersolo_async` 作为新模型接入目标。

CLIProxyAPI 官方配置里有 `disable-image-generation` 开关，启用后会影响 `/v1/images/generations` 与 `/v1/images/edits`。但 CLIProxyAPI 公开文档没有像 ToAPIs 那样逐模型列出图片参数表，所以本文件作为项目级接口契约。

## 2. 认证

小程序云函数到 `supersolo` 的认证方式：

```http
Authorization: Bearer <solo-api-key>
Content-Type: application/json
```

注意：

- 这个 key 是访问自建中转站的客户端 key，不是 OpenAI key，也不是 Gemini key。
- 如果上游是 Gemini，Gemini 原生认证头是 `x-goog-api-key`，这应由 `supersolo` 内部处理。
- 遇到 401 时，优先检查 `solo-api-key`、`base_url`、中转站模型别名、CLIProxyAPI 上游凭证，不要先改业务请求体。

## 3. Supersolo 稳定契约

### 3.1 GPT Image 2 文生图

```http
POST {base_url}/images/generations
```

推荐请求体：

```json
{
  "model": "gpt-image-2",
  "prompt": "生成一张端午节宣传海报...",
  "n": 1,
  "size": "auto"
}
```

### 3.2 GPT Image 2 图生图

GPT Image 2 图生图必须与文生图区分，走 OpenAI 编辑接口：

```http
POST {base_url}/images/edits
Authorization: Bearer <solo-api-key>
Content-Type: multipart/form-data
```

表单字段：

```text
model = gpt-image-2
prompt = 保留主体，改成节日海报风格...
n = 1
size = auto
image = <参考图二进制文件>
```

旧的 `/images/generations + image URL` 属于中转站自定义兼容层，容易被上游当作普通文生图处理，不再作为 GPT Image 2 图生图主路径。

### 3.3 Gemini 文生图 / 图生图

Gemini 不走 OpenAI Images 端点，而是走 Gemini 原生 `generateContent` 形态：

```http
POST {base_url}
x-goog-api-key: <solo-api-key>
Content-Type: application/json
```

实践约定：后台 `base_url` 必须填写完整的 Gemini `generateContent` 接口地址；云函数不再根据 `provider` 或 `model_id` 自动拼接端点。

文生图只传 `parts[].text`；图生图在同一个 `parts` 数组里追加 `inline_data`：

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

### 3.4 响应

GPT Image 2 响应优先兼容 OpenAI Image API 的图片响应：

```json
{
  "created": 1713833628,
  "data": [
    {
      "b64_json": "..."
    }
  ]
}
```

项目云函数同时兼容 URL 结果：

```json
{
  "data": [
    {
      "url": "https://example.com/result.png"
    }
  ]
}
```

Gemini 响应从 `candidates[].content.parts[].inlineData.data` 或 `inline_data.data` 读取。

云函数处理顺序：

1. 优先读取 `data[0].b64_json` 并上传到云存储。
2. 如果没有 base64，则读取 `data[0].url` 并转存到云存储。
3. 如果两者都没有，判定为中转站响应格式不兼容。

## 4. OpenAI 官方基准

### 4.1 图片生成

OpenAI Image API 的生成端点：

```http
POST https://api.openai.com/v1/images/generations
```

核心字段：

| 字段 | 说明 |
| --- | --- |
| `model` | 图片模型，例如 GPT Image 模型 |
| `prompt` | 生成提示词 |
| `n` | 生成数量，通常为 `1` |
| `size` | GPT Image 支持 `auto`、`1024x1024`、`1536x1024`、`1024x1536` 等 |
| `quality` | GPT Image 支持 `auto`、`low`、`medium`、`high` |
| `background` | GPT Image 支持 `auto`、`transparent`、`opaque` |
| `output_format` | GPT Image 支持 `png`、`jpeg`、`webp` |

重要差异：

- GPT Image 模型默认返回 base64 图片数据。
- `response_format` 主要用于 DALL-E 2/3；OpenAI 文档说明 GPT Image 模型不支持该参数，始终返回 base64 图片。
- 因此 `supersolo` 调 OpenAI GPT Image 时，不应强依赖 `response_format: "url"`。

### 4.2 图片编辑

OpenAI Image Edit 端点：

```http
POST https://api.openai.com/v1/images/edits
```

官方支持两种形态：

- `multipart/form-data`：使用 `image` 上传二进制图片。
- `application/json`：使用 `images` 数组引用图片 URL 或文件 ID。

与当前项目差异：

- 当前 `supersolo` 图生图请求是 `POST /images/generations` + `image: "https://..."`。
- 如果中转站没有做适配，直接转发给 OpenAI 官方会不兼容。
- 如果中转站做了适配，应在中转站文档中明确：`image` URL 会被转换为 OpenAI Edit 的 `images` 或 multipart `image`。

## 5. Gemini 官方基准

Gemini 原生图片生成不是 OpenAI Image API 形态，而是 `generateContent`：

```http
POST https://generativelanguage.googleapis.com/v1/models/gemini-3.1-flash-image:generateContent
x-goog-api-key: <GEMINI_API_KEY>
Content-Type: application/json
```

### 5.1 文生图

```json
{
  "contents": [
    {
      "parts": [
        {
          "text": "Create a picture of a nano banana dish..."
        }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["IMAGE"]
  }
}
```

输出图片在：

```text
candidates[0].content.parts[].inlineData.data
```

### 5.2 图生图

Gemini 图生图把提示词和图片都放进 `contents.parts`：

```json
{
  "contents": [
    {
      "parts": [
        {
          "text": "把这张图改成端午节海报风格"
        },
        {
          "inline_data": {
            "mime_type": "image/png",
            "data": "<BASE64_IMAGE_DATA>"
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

### 5.3 比例与尺寸

Gemini 3.1 图片模型的比例和尺寸不使用 OpenAI 的 `size: "1024x1024"` 语义，而是：

```json
{
  "generationConfig": {
    "responseFormat": {
      "image": {
        "aspectRatio": "16:9",
        "imageSize": "2K"
      }
    }
  }
}
```

因此，如果小程序仍向 `supersolo` 传 `size: "16:9"`、`size: "1:1"` 或 `size: "2K"` 这类值，中转站必须明确映射规则，例如：

| 小程序/后台值 | Gemini 原生字段 |
| --- | --- |
| `1:1`、`16:9`、`3:4` | `generationConfig.responseFormat.image.aspectRatio` |
| `1K`、`2K`、`4K` | `generationConfig.responseFormat.image.imageSize` |
| `1024x1024` | 需要中转站转换为 `aspectRatio: "1:1"` + 合适的 `imageSize` |

## 6. 当前项目实现对照

当前 `cloudfunctions/aiGenerate/generationExecutor.js` 与 `cloudfunctions/generationWorker/generationExecutor.js` 中，`supersolo` 同步通道实际请求体为：

```json
{
  "model": "<modelConfig.model_id>",
  "prompt": "<feature.prompt>",
  "n": 1,
  "size": "<resolveImageSize(...)>",
  "response_format": "b64_json",
  "image": "<可选，参考图 HTTPS URL>"
}
```

已知注意点：

- `gpt-image-2` 当前会被强制解析为 `size: "auto"`。
- `response_format: "b64_json"` 对 OpenAI GPT Image 官方不是必需项，且官方说明 GPT Image 不支持该参数；如果中转站严格转发，可能需要由中转站过滤。
- 图生图的 `image` URL 是项目自定义输入，依赖中转站适配。
- `supersolo` 返回 `b64_json` 或 `url` 都可以被云函数处理。

## 7. 推荐模型配置

### 7.1 GPT Image 2

后台模型建议：

```json
{
  "provider": "supersolo",
  "base_url": "https://<solo-domain>/v1",
  "model_id": "gpt-image-2",
  "api_key": "<solo-api-key>"
}
```

推荐请求策略：

- 默认 `size: "auto"`。
- 默认 `quality: "auto"`。
- 不要求 `response_format: "url"`。
- 期望返回 `data[0].b64_json`。

### 7.2 Gemini 3.1 Flash Image

后台模型建议：

```json
{
  "provider": "supersolo",
  "base_url": "https://<solo-domain>/v1",
  "model_id": "gemini-3.1-flash-image",
  "api_key": "<solo-api-key>"
}
```

推荐请求策略：

- 小程序仍按 `supersolo` 契约传 `model/prompt/n/size/image`。
- 中转站内部负责转成 Gemini `generateContent`。
- 中转站需要把返回的 `inlineData.data` 转换成 OpenAI 兼容的 `data[0].b64_json`。
- 401 优先查 CLIProxyAPI 的 Gemini 上游凭证和模型别名配置。

## 8. 错误排查

### 8.1 401 Unauthorized

优先检查：

1. 后台 `ai_models.api_key` 是否是 `supersolo` 客户端 key。
2. `base_url` 是否指向自建中转站，而不是直接指向 OpenAI 或 Gemini。
3. CLIProxyAPI 的客户端 `api-keys` 是否启用。
4. CLIProxyAPI 上游 OpenAI/Gemini 凭证是否有效。
5. `model_id` 是否是中转站暴露出的模型别名。

### 8.2 400 Bad Request

优先检查：

1. 是否把 OpenAI 的 `size` 像素值直接传给 Gemini 原生接口。
2. 是否把 Gemini 的 `aspectRatio/imageSize` 直接传给 OpenAI Image API。
3. GPT Image 请求是否传了上游不接受的 `response_format`。
4. 图生图是否仍用 `image` URL，但中转站没有做 OpenAI Edit/Gemini inline_data 适配。

### 8.3 404 Not Found

优先检查：

1. CLIProxyAPI 是否配置了 `disable-image-generation: true`。
2. `base_url` 是否漏了 `/v1` 或重复拼接路径。
3. 中转站是否实际暴露 `/images/generations`。

### 8.4 返回成功但无图

优先检查：

1. 响应里是否存在 `data[0].b64_json`。
2. 响应里是否存在 `data[0].url`。
3. Gemini 原生响应是否没有被中转站转换成 OpenAI 兼容格式。
4. 远程 URL 是否可由云函数访问并转存。

## 9. 测试清单

### 9.1 GPT Image 2 文生图

请求：

```json
{
  "model": "gpt-image-2",
  "prompt": "生成一张白底极简风端午节粽子海报",
  "n": 1,
  "size": "auto"
}
```

验收：

- HTTP 200。
- 返回 `data[0].b64_json` 或 `data[0].url`。
- 小程序云函数能转存到云存储。

### 9.2 GPT Image 2 图生图

请求：

```json
{
  "model": "gpt-image-2",
  "prompt": "保留主体，改成端午节宣传海报",
  "n": 1,
  "size": "auto",
  "image": "https://example.com/reference.png"
}
```

验收：

- 中转站能正确处理 `image` URL。
- 若失败，记录是中转站适配失败还是 OpenAI 官方参数不兼容。

### 9.3 Gemini 文生图

请求：

```json
{
  "model": "gemini-3.1-flash-image",
  "prompt": "生成一张白底极简风端午节粽子海报",
  "n": 1
}
```

验收：

- HTTP 200。
- 中转站返回 OpenAI 兼容的 `data[0].b64_json`。
- 如果 401，优先检查中转站 Gemini 凭证。

### 9.4 Gemini 图生图

请求：

```json
{
  "model": "gemini-3.1-flash-image",
  "prompt": "把这张图改成端午节宣传海报风格",
  "n": 1,
  "image": "https://example.com/reference.png"
}
```

验收：

- 中转站将 `image` URL 下载并转换为 Gemini `inline_data`。
- 返回 OpenAI 兼容 `data[0].b64_json`。

## 10. 参考资料

- OpenAI Image generation guide: https://developers.openai.com/api/docs/guides/image-generation
- OpenAI Images API reference: https://platform.openai.com/docs/api-reference/images/generate
- OpenAI Image Edit API reference: https://platform.openai.com/docs/api-reference/images/create
- OpenAI API authentication: https://platform.openai.com/docs/api-reference
- Gemini image generation guide: https://ai.google.dev/gemini-api/docs/image-generation
- Gemini API reference: https://ai.google.dev/api
- CLIProxyAPI basic config: https://help.router-for.me/cn/configuration/basic
- CLIProxyAPI README_CN: https://github.com/router-for-me/CLIProxyAPI/blob/main/README_CN.md
