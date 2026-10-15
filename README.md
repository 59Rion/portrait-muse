# 人像灵感库 · Portrait Muse

手机优先的摄影灵感收藏与拍摄筹备项目，面向人像、韩系、少女、清冷、汉服等摄影参考整理。

网页：https://59rion.github.io/portrait-muse/

发布状态：GitHub Pages 已发布；Supabase 项目 `mcetzngmqkglqnlpufsj` 已初始化并接入默认配置，支持独立邮箱账号和私有云端空间。数据库隔离验证、匿名访问拒绝检查及前端构建已通过；真实邮箱注册、图片上传与跨设备操作仍需首次使用验收。原站账号、收藏与图片尚未迁入。

本地待发布升级：新增项目工作台（需求、参考、执行方案、版本与对话）以及待配置模型的工具调用入口。本次受连接器权限限制，新增数据表和函数尚未部署，前端也未发布；模型未接入。见 [本次交付与上线说明](docs/PROJECT-STUDIO-DEPLOY.md)，请勿将本地已编写功能计作线上已完成。

本地下载功能补充：已新增 `services/xhs` 的用户鉴权下载网关及网页自动下载/详情重试接线。Render 免费工作区已确认，但 GitHub 写入被审批策略阻止，尚未创建或发布下载服务；网页配置没有填入虚构后台网址。图片下载暂不能作为线上可用能力。

## 已实现

- 蓝灰色响应式界面、灵感卡片、搜索与标签筛选。
- 从小红书 App 复制整段分享文案，识别 `xiaohongshu.com`、`xhslink.com` 和 `xhslink.cn` 链接。
- 保存来源与文字，按关键词规则推荐摄影标签；不是视觉 AI 分类。
- 标签新增、重命名和删除，同步修改已有收藏。
- 手机相册与截图批量上传、收藏详情图片浏览。
- 拍摄项目创建、加入参考；项目详情浏览尚待完善。
- 设置页；原站使用 ChatGPT 登录，GitHub Pages 版使用独立邮箱账号，云端按用户身份隔离记录与图片。
- 附 Sony/Nikon 来源的摄影知识卡片，按日期轮换并可手动更换。
- XHS-Downloader API 适配层。

## 尚未完成

- XHS-Downloader 独立服务尚未配置，自动图片下载尚未端到端打通。
- 每日知识来自内置知识池，尚未自动联网更新。
- 当前 iPhone 快捷分享是 URL 参数接收与设置指南，尚未提供可安装的快捷指令文件。
- 新账号真实注册与跨设备端到端验收、原站私人数据迁移尚未完成。
- 中国大陆网络可达性尚未实测；GitHub Pages 和海外云端服务不能保证所有网络均可访问。

## 本地运行

需要 Node.js 22.13 或更新版本。

```sh
npm ci
npm run dev
```

本地开发使用预览身份；生产 API 必须经过服务端身份验证。数据库迁移位于 `drizzle/`，原部署使用 Cloudflare D1 与 R2。

## GitHub Pages 迁移说明

GitHub Pages 仅托管静态 HTML/CSS/JavaScript，不能直接运行 `app/api/`、Python 下载器、D1 或 ChatGPT 服务端登录。

仓库保留原站代码，并增加 `pages/` 独立静态前端。`npm run build:pages` 生成 `dist-pages/`；GitHub Actions 自动构建并发布。

迁移后的前端采用 Supabase 独立邮箱登录、PostgreSQL 与私有图片存储，保留跨设备同步；不使用浏览器本地收藏冒充云端存储。当前部署已连接云端；未配置后端的其他部署会显示“云端空间尚未连接”，不会假装导入成功。

当前项目已完成以下配置。自行部署到其他项目时：

1. 在新 Supabase 项目的 SQL Editor 执行 `supabase/schema.sql`。它创建五张业务表、逐用户 RLS 策略和私有 `portrait-images` 存储桶。
2. 在 Auth URL Configuration 中，将 Site URL 和允许的重定向地址设为 `https://59rion.github.io/portrait-muse/`。
3. 修改 `pages/deployment.json` 中的公开连接信息，或在 GitHub 仓库 Settings → Secrets and variables → Actions → Variables 设置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY` 覆盖默认值。这里只使用公开 publishable / anon key，绝不填写 secret / service_role；公开 key 不是管理员权限，数据保护由身份验证和 RLS 执行。
4. 在 Settings → Pages 中选择 GitHub Actions。重新运行 Publish GitHub Pages。
5. 注册测试账号并验证邮箱；检查图片上传、退出再登录和另一设备同步。再使用第二个账号确认无法访问第一个账号的记录或图片。

单个浏览器也可在未连接页面输入公开配置进行验证；当前默认配置已部署，其他设备无需重复输入。真实收藏保存在云端；浏览器仅保留该服务的登录会话。首次使用需创建新账号并验证邮箱，旧站 ChatGPT 账号不会自动成为新站邮箱账号。若默认邮件服务限制收件人或发送频率，需要配置自己的 SMTP；不要为省略邮件配置而关闭验证。

验证记录：`npm run test:pages` 检查适配层、会话刷新和私有图片签名；`node scripts/check-cloud.mjs` 检查实际云端登录配置与匿名访问拒绝。`supabase/check-isolation.sql` 已在新项目执行通过，覆盖双用户记录、标签、图片对象的隔离、越权写入与关联拒绝，所有测试数据通过事务回滚移除。Supabase 安全顾问当前无告警。这些检查不能替代真实用户注册、上传和跨设备验收。

旧账号与 D1/R2 数据不会自动迁移到 Supabase。需要用户验证新身份后，将旧身份映射到新账号，再通过有权限的服务端迁移记录与图片。GitHub Pages 版目前只保存链接并支持上传照片，尚未连接 XHS-Downloader；不会从浏览器直接请求内网下载器。

收藏、图片、Cookie、密码、数据库导出与访问令牌不应提交到公开仓库。

本次迁移可用的本地源码基线是原站第 3 版提交 `ae8d6f6c16bdb776838d4d2c85420ac03ac7b5c4`。线上登记的第 4 版提交是 `47cf3cd1109276e5a4135b2a98309c44ca0a4358`；由于原源码 Git 服务当前无法连接，尚未完成两版比对，未覆盖线上第 4 版。

## XHS-Downloader

上游项目：https://github.com/JoeanAmier/XHS-Downloader

本站通过独立 HTTP API 对接该项目，没有内嵌其 Python 源码。服务端配置 `XHS_DOWNLOADER_URL` 后调用 `/xhs/detail`；仍可能受链接有效期、Cookie 和平台风控影响。请仅保存你有权使用的素材并保留来源。
