# Web 1.0 实施状态

## 已交付

- 独立 Next.js 网站：同级目录 `../zhuangzhuangji-web/`。
- 免登录首页、模板中心、模板详情与业务字段工作台。
- 24 小时本地草稿、300ms 自动保存、登录后继续提交。
- 桌面三栏、平板两栏、手机五步式响应布局。
- 微信开放平台同页扫码会话及开发环境显式模拟入口。
- 火山引擎和 Gemini 比例编译、原生参数映射与任务快照字段。
- 生成任务幂等、结果页和 4× 超分入口。
- 微信 Native 支付下单、回调验签/解密/金额校验和支付 Provider 接口。
- 现有管理后台支持配置网站可选比例。

## 已验证

- Web 单元测试：5/5 通过。
- Web TypeScript：通过。
- Web Next.js 生产构建：通过。
- 管理后台 Vite 生产构建：通过。
- 已修改的 CloudBase 云函数 `node --check`：通过。
- HTTP 冒烟：首页、模板中心、工作台、登录会话均返回 200。
- 状态链冒烟：登录、幂等生成、任务成功、结果和超分均通过。

## 生产上线前仍需完成

以下事项依赖尚未提供的企业资质或生产服务，代码会明确拒绝而不会伪造成功：

1. 微信开放平台网站应用、回调域名与真实扫码联调。
2. 微信 Native 支付商户配置与真实回调、查单、关单和退款联调。
3. 将开发内存 Store 替换为 CloudBase 持久化的用户、会话、任务、订单和只追加账本。
4. 实现网站统一 `userId` 与小程序 OpenID/UnionID 的绑定迁移。
5. 部署 CloudBase 网站桥接接口，连接真实火山/Gemini Worker 与超分任务。
6. 接入文本、上传图片和生成结果内容安全审核。
7. 完成 ICP、隐私政策、用户协议、AI 标识和素材授权说明。
8. 依赖安装器仍报告安全公告；由于当前环境不允许向 npm Audit 服务发送依赖清单，正式发布前需由项目所有者在可信 CI 中运行 `npm audit` 并完成评估。

## 启动

```powershell
Set-Location ..\zhuangzhuangji-web
npm install
npm run dev
```

生产配置和环境变量见 `../zhuangzhuangji-web/README.md` 与 `../zhuangzhuangji-web/.env.example`。
