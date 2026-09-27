# Changelog

本文件记录面向用户与部署者的可见变更。格式参考 Keep a Changelog；版本号遵循语义化版本，
`backend`、`frontend`、`packaging/windows` 三处 `package.json` 版本保持一致。

## [Unreleased]

### Added

- 对话：最后一条模型回复可“重新生成”，原回复保留为候选；候选翻页到末尾时同样触发真实重新生成（此前只是把当前内容复制为候选）。新增 `POST /api/conversations/:id/messages/:messageId/regenerate`（JSON 与 SSE）。
- 对话：编辑用户消息后重跑改为一次 `POST /api/conversations/:id/messages/truncate` 删除整段尾部，只产生一份恢复点和一次同步任务取消。
- 记忆 Agent：每轮回复后的长期记忆整理改为模型驱动（附属技能 `memoryAgent`，自动/开启/关闭），工具库包含检索记忆、检索历史、记录、修正、合并、失效、置顶与结束，可按会话勾选；供应商不可用或调用失败时回退规则提取。
- 附属技能与 NPC 管理 Agent 支持“跟随主聊天设置”或指定已保存的供应商配置与模型（`providerProfileId` / `modelOverride`），聊天高阶设置与 NPC 管理面板均提供弹窗设置。
- NPC 管理 Agent：自动同步与 AI 整理可执行的 `CastChangePlanV1` 操作可按会话开关，未勾选的操作在写入前被拒绝。
- 正则规则新增 `display` 作用域（仅显示时替换）；此前后端的显示分支无法启用。

### Changed

- 自动恢复点存档标记为 `kind = 'recovery'`（迁移 `0018`），存档面板默认折叠；每个会话最多保留 `CONVERSATION_RECOVERY_SAVE_LIMIT`（默认 5）份，已结束或失效任务的步骤快照在 `CONVERSATION_STALE_JOB_STEP_DAYS`（默认 3）天后清理，启动时执行一次全库清理。切换候选不再写恢复点。
- 依赖主版本升级：`jsdom` 30、`katex` 0.18、`markdown-it` 15、`@lucide/vue` 1.39、`vue-router` 5，以及 `zod`、`vue`、`highlight.js`、Playwright 等小版本；
  `@vscode/markdown-it-katex` 通过 npm override 复用根目录 KaTeX，前端包体减少一份重复的 KaTeX 拷贝。
- markdown-it 渲染管线（实例、KaTeX 插件、`\( \)`/`\[ \]`/color box 规则、fence 渲染）从 `MarkdownContent.vue` 抽出为 `frontend/src/utils/markdownRenderer.js`。
- Windows 打包依赖从 `latest` 固定为 `electron` 44.1.1 与 `electron-builder` 26.15.3，并提交 `packaging/windows/package-lock.json`；CI 新增 `windows-latest` job 执行打包 staging 与 smoke。
- 前端引入 Vitest 4（jsdom 环境）与 `@vue/test-utils`，`npm run test:unit` 进入 review gate（第 7 步，共 9 步）与 CI；CI 的 E2E 拆为独立 job 并按 2 分片执行。
- 新增 `.github/dependabot.yml`：每周检查 backend、frontend、packaging/windows 的 npm 依赖，小版本合并为一组，主版本单独 PR。
- CI 与 review gate 对 `backend` 也执行生产依赖审计（此前只审计 `frontend`）。
- 两个包声明 `engines.node >= 24`，仓库新增 `.nvmrc`。
- 后端运行时版本号改为读取 `backend/package.json`，三处 `package.json` 版本由测试保证一致。
- 新增 `docs/UPGRADE_PLAN_2026-09.md` 升级计划。

### Fixed

- 人物同步 / AI 整理 / 记忆 Agent：网关偶发返回 `auth_unavailable: no auth available`（HTTP 503）或 429/5xx 时，此前会直接以 `CAST_PLAN_FAILED` 失败且不重试。现在 HTTP 层把这类响应归类为可重试的网关暂时不可用（`PROVIDER_AUTH_UNAVAILABLE`，附中文说明），模型调用带退避重试，后台任务也会按最大次数重试。
- Provider URL 策略：`fetchProviderRequest` 对已归一化的策略二次归一化时会把默认 DNS 解析器误判为调用方自定义解析器，
  导致 `.test`/`.example`/`.invalid` 保留测试域名的例外失效；无本地 DNS 代理的环境下 Provider 契约测试会因 `ENOTFOUND` 失败。

## [0.2.0] - 2026-09-02

基于 2026-07-07 模块化重构（`26895fb`）之后的累计变更，作为后续升级的基线。

### Security

- 公开角色的自定义 JS/CSS 与作者附属技能不再对非拥有者生效；作者"已确认风险"不再继承给使用者。
- 天赋池增加用户归属（迁移 `0010`），修复跨用户读写。
- Provider 健康检查与模型列表统一走 root + 部署开关的 URL 策略，修复开发模式 SSRF；
  私网 Provider 需要 `ALLOW_PRIVATE_PROVIDER_NETWORK=true`（生产）或 `ALLOW_PRIVATE_PROVIDER_NETWORK_DEV=true`（开发）。
- 所有 completion、流式、tool、生图和助手调用统一进入配额门面，日成本配额使用原子预留与实际用量结算。
- 聊天附件链接增加协议白名单，拒绝 `javascript:`、`vbscript:` 与 HTML data URL。
- 认证请求 JSON 边界改为迭代扫描，限制深度、键数、数组长度与字节数。
- root 初始化改为一次性 `ROOT_ADMIN_BOOTSTRAP_TOKEN`，成功后自动关闭公开注册；
  旧的用户名/密码初始化需显式 `ALLOW_LEGACY_ROOT_BOOTSTRAP=true`。
- 密码哈希格式严格校验，损坏哈希统一判定为失败。
- 前端生产依赖升级至无已知漏洞版本（DOMPurify、markdown-it、Vite 等）。

### Added

- AI 虚拟小镇模拟：连续引擎、AI 回合、记忆/反思/日程、居民与世界删除端点。
- 游戏系统（经济、场景、天赋）与刷新后的游戏 UI。
- 工具驱动的 NPC 上下文与 HTML 预览。
- 场景工作区与聊天交互升级；聊天 UI 刷新。
- Cast（角色阵容）领域整合与结构化变更计划。
- 持久任务队列与任务事件 SSE。
- Playwright E2E 使用每次运行随机数据库，review gate 与 CI 纳入依赖审计与 E2E。

### Fixed

- 小镇记忆来源标记与检索截断；提示词预算裁剪按 user/assistant 轮次成对丢弃。
- 转义 KaTeX color box 渲染；Cast 证据归一化。
- 备份改为写临时文件、校验后原子替换，失败时保留旧备份。
- CSRF、Provider URL 策略与 cookie `secure` 标志统一使用 `createApp(context.config)` 注入配置。
- 局部 catch 不再向客户端回传内部错误信息。
- OpenAPI 中 WorldBook/Town 列表响应形状与实际路由一致。
