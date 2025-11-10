# 妆妆记 - 云开发部署指南

## 概述
本项目已完成微信云开发集成，包含用户认证、云数据库存储和定时提醒功能。

## 云开发环境配置
- 环境ID: `cloudbase-5gmfinom29f48930`
- 订阅消息模板ID: `Bt7Mmwj4cz-klq4dBnp1EZ_L9ovLeZykyk5atwzcjgY`

## 部署步骤

### 1. 上传云函数
需要上传以下云函数到微信云开发控制台：

#### login 云函数
- 路径: `cloudfunctions/login/`
- 功能: 获取用户openid
- 依赖: wx-server-sdk

#### cosmetics 云函数
- 路径: `cloudfunctions/cosmetics/`
- 功能: 化妆品数据的增删改查
- 依赖: wx-server-sdk

#### reminders 云函数
- 路径: `cloudfunctions/reminders/`
- 功能: 提醒设置和消息发送
- 依赖: wx-server-sdk

#### points 云函数（妆妆蛋积分）
- 路径: `cloudfunctions/points/`
- 功能: 读取/初始化全局积分配置、初始化用户积分、原子扣减（含并发安全）
- 依赖: wx-server-sdk
- 部署：右键“上传并部署（云端安装依赖）”，选择环境 `cloudbase-5gmfinom29f48930`

#### cozeWorkflow 云函数（代理扣子工作流）
- 路径: `cloudfunctions/cozeWorkflow/`
- 功能: 从 `app_config/secrets` 读取 `coze_api_key` 与 `workflow_ids` 映射，代替前端请求调用 Coze 工作流接口，统一超时与错误处理
- 依赖: wx-server-sdk, axios
- 部署：右键“上传并部署（云端安装依赖）”，选择环境 `cloudbase-5gmfinom29f48930`
- 返回值：直接返回 Coze 后端的 `data` 对象（其中包含 `data: "{...json...}"`），前端用 `parseWorkflowResponse` 解析即可

#### scheduledReminder 云函数
- 路径: `cloudfunctions/scheduledReminder/`
- 功能: 定时触发提醒任务
- 依赖: wx-server-sdk
- 定时器: 每天上午9点执行 (0 0 9 * * * *)

### 2. 创建数据库集合
在云开发控制台创建以下集合：

#### app_config 集合（密钥与工作流映射）
存储调用Coze所需的密钥与工作流别名映射，仅管理员可读写：
```json
{
  "_id": "secrets",
  "coze_api_key": "pat_xxx",
  "updated_at": 1730890000000,
  "workflow_ids": {
    "analyze": "7564249346457485338",
    "generate_reference": "7566202567706771499"
  },
  "coze_base_url": "https://api.coze.cn/v1/workflow/run"
}
```
> 权限：集合与该文档设置为“仅管理员可读写”，前端不得直接读取。

#### cosmetics 集合
存储化妆品信息：
```json
{
  "_id": "自动生成",
  "_openid": "用户openid",
  "name": "化妆品名称",
  "category": "分类",
  "purchaseDate": "开封日期",
  "expiryDate": "过期日期",
  "remarks": "备注",
  "imageUrl": "图片URL",
  "createTime": "创建时间",
  "updateTime": "更新时间"
}
```

#### reminders 集合
存储提醒设置：
```json
{
  "_id": "自动生成",
  "_openid": "用户openid",
  "cosmeticId": "化妆品ID",
  "cosmeticName": "化妆品名称",
  "templateId": "模板消息ID",
  "reminderDate": "提醒日期",
  "expiryDate": "过期日期",
  "isActive": "是否激活",
  "createTime": "创建时间",
  "sentTime": "发送时间"
}
```

#### points_config 集合（妆妆蛋配置）
存储全局运营配置（仅一条，`_id: "global"`）：
```json
{
  "_id": "global",
  "name": "妆妆蛋",
  "initial_points": 100,
  "analyze_cost": 3,
  "generate_cost": 5,
  "updated_at": 0
}
```

#### user_points 集合（用户积分）
用户积分以 openid 作为文档ID：
```json
{
  "_id": "<用户OPENID>",
  "points": 100,
  "updated_at": 0
}
```

> 注意：首次运行时，`points` 云函数的 `ensureUserPoints` 会自动创建用户的积分文档并返回最新积分。若未部署 `points` 云函数，将出现 `FUNCTION NOT FOUND` 错误。

### 3. 配置权限
确保云函数具有以下权限：
- 数据库读写权限
- 订阅消息发送权限
- 定时触发器权限

### 4. 测试功能
部署完成后测试以下功能：
- 用户登录授权
- 化妆品数据增删改查
- 订阅消息授权
- 提醒设置
- 定时任务执行
- 妆容分析与参考图生成（别名：`analyze`、`generate_reference`）

## 功能特性

### 用户认证
- 使用微信云开发用户认证体系
- 自动获取用户openid
- 数据按用户隔离

### 数据存储
- 云数据库存储化妆品信息
- 支持图片上传和存储
- 数据实时同步

### 定时提醒
- 用户可设置过期提醒
- 自动在过期前7天发送提醒
- 使用微信订阅消息推送
- 每天上午9点检查并发送提醒

### 订阅消息
- 模板ID: `Bt7Mmwj4cz-klq4dBnp1EZ_L9ovLeZykyk5atwzcjgY`
- 支持一次性订阅
- 自动发送过期提醒

## 注意事项
1. 确保小程序已开通云开发服务
2. 订阅消息模板需要在微信公众平台配置
3. 定时触发器需要在云开发控制台启用
4. 测试时注意云函数调用次数限制
5. 生产环境建议配置独立的云开发环境