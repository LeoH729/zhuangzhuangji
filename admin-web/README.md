# AI 生图后台

独立 Web 后台，使用 CloudBase Web SDK 登录并通过 `adminApi` 云函数管理数据。

## 本地运行

```bash
npm install
npm run dev
```

## 部署

```bash
npm run build
```

将 `dist` 部署到 CloudBase 静态托管，并把后台域名加入 CloudBase 安全域名。

## 首次初始化管理员

1. 先用账号密码注册/登录后台账号。
2. 如果 `admin_users` 集合为空，页面会出现“初始化当前账号为管理员”按钮。
3. 初始化后，后续只有 `admin_users` 中 `status` 不为 `0` 的用户可访问管理接口。
