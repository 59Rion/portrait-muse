# 人像灵感库 · Portrait Muse

手机优先的摄影灵感收藏与拍摄筹备项目，面向人像、韩系、少女、清冷、汉服等摄影参考整理。

## 已实现

- 蓝灰色响应式界面、灵感卡片、搜索与标签筛选。
- 从小红书 App 复制整段分享文案，识别 `xiaohongshu.com`、`xhslink.com` 和 `xhslink.cn` 链接。
- 保存来源与文字，按关键词规则推荐摄影标签；不是视觉 AI 分类。
- 标签新增、重命名和删除，同步修改已有收藏。
- 手机相册与截图批量上传、收藏详情图片浏览。
- 拍摄项目创建、加入参考；项目详情浏览尚待完善。
- 设置页、ChatGPT 登录，服务端按用户身份隔离记录与图片。
- 附 Sony/Nikon 来源的摄影知识卡片，按日期轮换并可手动更换。
- XHS-Downloader API 适配层。

## 尚未完成

- XHS-Downloader 独立服务尚未配置，自动图片下载尚未端到端打通。
- 每日知识来自内置知识池，尚未自动联网更新。
- 当前 iPhone 快捷分享是 URL 参数接收与设置指南，尚未提供可安装的快捷指令文件。
- 独立于 ChatGPT 的账号系统与中国大陆访问部署尚未完成。

## 本地运行

需要 Node.js 22.13 或更新版本。

```sh
npm ci
npm run dev
```

本地开发使用预览身份；生产 API 必须经过服务端身份验证。数据库迁移位于 `drizzle/`，原部署使用 Cloudflare D1 与 R2。

## GitHub Pages 迁移说明

GitHub Pages 仅托管静态 HTML/CSS/JavaScript，不能直接运行 `app/api/`、Python 下载器、D1 或 ChatGPT 服务端登录。

仓库保留原网站完整应用代码。Pages 前端的构建、数据连接与发布状态以实际部署为准，不把源码上传成功当作全功能迁移完成。收藏、图片、Cookie、密码、数据库导出与访问令牌不应提交到公开仓库。

本次迁移可用的本地源码基线是原站第 3 版提交 `ae8d6f6c16bdb776838d4d2c85420ac03ac7b5c4`。线上登记的第 4 版提交是 `47cf3cd1109276e5a4135b2a98309c44ca0a4358`；由于原源码 Git 服务当前无法连接，尚未完成两版比对，未覆盖线上第 4 版。

## XHS-Downloader

上游项目：https://github.com/JoeanAmier/XHS-Downloader

本站通过独立 HTTP API 对接该项目，没有内嵌其 Python 源码。服务端配置 `XHS_DOWNLOADER_URL` 后调用 `/xhs/detail`；仍可能受链接有效期、Cookie 和平台风控影响。请仅保存你有权使用的素材并保留来源。
