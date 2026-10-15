# 拍摄项目工作台：本次交付与上线说明

本次代码位于本地仓库，尚未提交 GitHub，也尚未更新线上网站。当前工具权限拒绝 Supabase 读写，本地浏览器访问也受到网络权限限制。不要将下述本地测试结果当成生产验收。

2026-10-15 下载功能补充：Render 已连接并确认使用「My Workspace」免费实例；尚未创建服务。新增 `services/xhs` 鉴权下载后台和网页下载/重试接线，复用原有 Supabase 表和私有存储桶，不需要先新增数据库。GitHub 仓库写入请求仍被审批策略拦截，源码尚未推送，因此不能创建可运行的 Render 服务，也没有可填写的实际下载后台网址。

## 已写好的功能

- 项目详情页：需求摘要、真实参考、结构化执行方案、版本和对话记录。
- 需求包含用途、风格、主体人数、场地、时段、器材、人员、限制与可用分钟数；缺少关键条件时显示补充提示。
- 参考只搜索当前账号的文字与标签；最多检索最近 500 条，展示前 60 条。明确标注“文字检索，不是 AI 推荐”，不推断未读取的图片或外站正文。
- 方案可编辑场景、服装道具、布光、构图、动作、镜头时间表、拍摄顺序和替代方案。保存前展示完整预览，发现规则冲突时要求复核。
- 每次确认保存创建只读新版本，保留需求快照；旧版可载入编辑器，再确认另存。需求变化时提示旧方案可能不适用。
- AI 工具循环：模型可自主选择读取项目、检索资料、读取素材、提出方案或参考关联，再结束返回追问/草稿。写入工具只提出草稿，不能绕过页面确认直接保存项目。
- 模型尚未配置时返回明确的 503 状态，页面禁用生成入口；没有硬编码“AI 生成方案”。
- 模型端仅处理文字，不发送图片；须在页面显示服务商并取得本次发送同意。密钥只放云端 Secrets，不进入网页或仓库。
- 后台新增三张逐用户隔离的表，复合外键校验项目归属；保存方案时核验素材归属，并在一个事务内创建版本、关联引用。
- 模型入口验证用户会话，转发用户身份查询，绝不使用管理员密钥。每账号限每分钟 3 轮、每天 100 轮，每轮最多 8 次模型响应、18 次工具调用。

## 本地验证状态

通过：TypeScript 类型检查、Pages 正式构建、网页五组自动测试（适配层、工具循环与约束、云端函数请求处理、项目保存/检索/版本链路、下载器接线）。下载后台另有 12 个标准库测试，使用合成账号、模拟框架与下载结果，不启动网络、线程或真实 XHS 依赖；实际框架、并发与容器运行仍需上线验收。内存 REST 测试不能替代 PostgreSQL 的真实 RLS 验证，也不能当成实际模型运行结果。

尚未验证：新 SQL 在真实数据库执行、数据库安全顾问检查、云端函数部署、真实账号端到端操作、浏览器交互与手机视觉布局、真实模型质量。已准备 `supabase/check-workspace.sql`，执行后测试数据会整体回滚；它尚未在云端执行。

## 上线顺序（先不配置模型也能使用手动工作台）

1. 打开已有 Supabase 项目的 SQL Editor，完整执行 `supabase/project-workspace.sql`。这是增量升级，不含私人收藏，不删除原有业务记录。
2. 执行 `supabase/check-workspace.sql`；只有返回 PASS 才算通过新表、版本、引用和频率限制验证。再运行 Supabase Security Advisor 检查。
3. 从当前仓库部署 `supabase/functions/shooting-agent/index.ts` 这个函数，名称为 `shooting-agent`。保留相对依赖文件 `supabase/functions/_shared/agent.ts` 和 `lib/shooting.ts`。推荐按 [Supabase 官方部署说明](https://supabase.com/docs/guides/functions/deploy) 使用 CLI 从仓库部署，不要只粘贴单个入口文件。`supabase/config.toml` 说明由函数内验证用户会话，不使用网关的旧式 API key JWT 检查。
4. 暂时不用填写模型 Secrets。函数此时只报告“未配置模型”，不会产生模型费用；手动方案、参考和版本功能仍可使用。
5. 将本次代码更新提交至现有 `59Rion/portrait-muse` 仓库。GitHub Actions 会测试、构建并发布。等部署成功后再访问原 Pages 网址。
6. 在真实账号中新建验收项目，填写需求 → 预览取消（确认未保存）→ 预览确认 → 检索自己的参考 → 确认关联 → 填方案和镜头 → 确认保存 v1 → 修改并保存 v2 → 查看 v1 快照。
7. 另一账号应看不到上述项目、需求、版本、对话和素材；直接指定其他账号项目或素材 ID 的请求也应失败。完成验证后，才将其作为线上已完成能力。

本地查看隔离验收页：在仓库运行 `node node_modules/vite/bin/vite.js --config scripts/qa/vite.config.ts`，浏览器打开它显示的本地网址。该入口使用合成文字和内存存储，刷新即清空；它不被生产入口导入，不连接真实账号，不模拟已上线功能。

增量代码包以线上提交 `495e32470dffb1a3b42257923f0b785cce1956cb` 为迁移基线，只包含本次升级所需源码、测试与说明，不包含图片、数据库导出、会话、管理员密钥或依赖目录。请先检查仓库是否有其他新改动，再合并同名文件；不要覆盖他人未提交的修改。正式构建不会包含 `scripts/qa` 的演示入口。

## 小红书下载后台上线顺序

1. 先允许 GitHub 连接对现有 `59Rion/portrait-muse` 仓库执行写入；或人工审核、合并代码包内的文件。不要创建另一个仓库，不要覆盖无关的新改动。
2. 从该仓库创建一个 Render Docker Web Service：名称可用 `portrait-muse-xhs`，免费计划，Singapore 区域，Dockerfile 为 `services/xhs/Dockerfile`，构建上下文为 `services/xhs`，使用默认启动命令。不新增 Postgres、Redis、worker 或磁盘。
3. 设置 `SUPABASE_URL` 和公开的 `SUPABASE_PUBLISHABLE_KEY`，取值与现有 `pages/deployment.json` 对应；设置 `ALLOWED_ORIGIN=https://59rion.github.io`。不填写管理员密钥，也不设置全局小红书 Cookie。
4. 等 Render 状态为 live，检查实际服务网址的 `/health` 返回 200；再确认未登录 `/imports` 请求返回 401、另一账号收藏不可访问。不能以本地模拟测试代替这些检查。
5. 将真实的 `https://实际服务名.onrender.com` 填入 `pages/deployment.json` 的 `downloaderUrl` 字段，保持 `projectWorkspaceEnabled` 为 false，直到工作台 SQL 与函数都部署并验收完成。当前未填写下载网址，页面不会假装已经连接后台。
6. 发布 Pages 后，用真实登录账号粘贴新的小红书图文分享文案。验收真实图片数量、来源、私有权限和退出登录后的不可访问性。首次启动可等约一分钟；失败时会保留链接，也可在详情重试或上传截图。已有图片不会自动覆盖。

下载器固定上游版本，支持 xhslink.cn/com 短链，但链接有效性和平台风控仍可能导致失败。只读取公开可访问的图文，不提供验证码破解或无限制下载。免费容器会休眠，文件不保存在容器磁盘；限流仅作用于当前单实例进程，重启会重置，不是持久化费用限额。真实容器运行、超时和并发行为尚待部署验收。

## 稍后配置模型

在 Supabase Edge Functions → Secrets 配置以下四项，不要通过聊天发送密钥：

- `MODEL_CHAT_COMPLETIONS_URL`：提供工具调用能力的完整 HTTPS Chat Completions 接口地址。
- `MODEL_API_KEY`：该模型服务的私有密钥。
- `MODEL_NAME`：你账户可用、支持此协议和 function tools 的模型名称。
- `MODEL_PROVIDER_LABEL`：页面将显示的准确服务商名称。

当前适配器使用 Chat Completions 协议，包括 `tools`、`tool_choice`、`parallel_tool_calls` 和 `max_completion_tokens`，不是所有模型兼容。某些 OpenAI 新模型只支持 Responses 工具调用，不能仅改模型名就使用，届时需按所选服务新增适配器。未选服务商前不默认任何模型，也不承诺配置后无需兼容性调试。

模型接通后还需实测：缺信息时追问、不同工具顺序、无参考时说明不足、手机/独拍/时间冲突、多轮只修改受影响内容、拒绝虚构来源、取消确认不保存、超时/限流后可恢复。现有规则检查只是启发式检查，不是完整语义、摄影安全或场地风险审查。

## 设计边界

本次不增加图片视觉识别、向量检索、自动下载、知识联网更新或长期用户画像。未接通真实模型前，不能将该版本演示为已投入使用的自主智能体。

工具循环参考 [LangChain 官方 Agent 说明](https://www.langchain.com/oss-overview)；接口结构参考 [OpenAI 官方 Function calling 文档](https://developers.openai.com/api/docs/guides/function-calling)。实现没有引入 LangChain 依赖，采用可注入模型驱动的有界工具循环。
