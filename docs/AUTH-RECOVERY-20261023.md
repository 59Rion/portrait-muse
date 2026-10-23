# 登录服务恢复 · 2026-10-23

## 原因与恢复

Supabase 项目 `mcetzngmqkglqnlpufsj` 当时为 INACTIVE，项目域名出现 NXDOMAIN / ENOTFOUND。网页仍可由 GitHub Pages 打开，但无法请求独立的登录服务，浏览器显示 Failed to fetch。这次主题发布只改了样式与静态图片，不涉及认证配置。

已恢复原项目，状态经过 COMING_UP / RESTORING 后回到 ACTIVE_HEALTHY。未新建项目、改密码、关闭邮箱验证、调整权限或开通付费方案。

## 页面修复

- 登录页首次加载时检查公开 Auth settings，显示连接状态；失败时提供“重新检查连接”。不会在浏览器使用管理令牌或自动恢复项目。
- 登录和注册请求设 12 秒超时，网络失败、服务 5xx、非 JSON 响应显示中文说明，不再仅显示 Failed to fetch，也不会将网络中断归咎于错误密码。
- 保留错误密码、邮箱未验证、邮件发送限制等不同提示；不自动重试注册或重复发送邮件。

## 验证及限制

- 类型检查、正式构建及五组自动测试通过；新增网络失败、超时、服务异常、非 JSON、错误凭据、邮件限制和无令牌连接检查测试。
- Auth settings 返回 200：disable_signup=false、mailer_autoconfirm=false；浏览器也显示“登录服务已连接 · 注册后请到邮箱完成验证”。
- 两条 Auth 提交接口使用故意无效的输入返回 validation_failed，不创建账号、不发送真实密码、不发验证码邮件。OPTIONS 跨域检查通过。
- 原私人资料匿名读写均为 401；Security Advisor 无告警。
- 没有代用户登录或完成真实邮箱验证，因此不将这些检查说成已验证用户密码或邮件送达。
- 恢复期间不同解析器可能仍缓存旧域名结果；先等项目 ACTIVE_HEALTHY，再刷新页面重查连接。不要因网络问题重复注册或关闭邮箱验证。

## 后续维护

免费项目在低活跃期间可能再次暂停，需要管理员在原项目后台恢复；本次没有建立无人值守保活、自动恢复或付费升级。

公共注册的邮件送达还取决于邮件服务。Supabase 默认邮件服务仅支持预授权收件人且有限流；如遇 email_address_not_authorized 或邮件发送限制，应配置自己的 SMTP，不要绕过验证。不要把 SMTP 密钥、用户密码、验证码或管理密钥放入网页、仓库或聊天。

官方说明：

- https://supabase.com/docs/guides/platform/free-project-pausing
- https://supabase.com/docs/guides/auth/auth-smtp

线上地址：https://59rion.github.io/portrait-muse/
