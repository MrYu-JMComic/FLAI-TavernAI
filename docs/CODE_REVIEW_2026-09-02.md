# FLAI TavernAI 代码审查报告（2026-09-02）

## 结论摘要

本次审查基于当前分支 `codex/gameplay-systems-ui-refresh`（提交 `e7188c9`），覆盖 `backend`、`frontend`、共享代码、路由/数据库边界、构建脚本和端到端测试。

代码已有较好的基础：后端模块化、资源归属检查、CSRF/HMAC、Provider URL 策略、数据库迁移账本和大量回归测试都已建立。但是，当前不建议直接作为多用户服务发布：发现一个可导致跨用户任意代码执行的信任边界问题、一个明确的天赋池 IDOR、开发模式下的 Provider SSRF、AI 成本配额旁路，以及前端依赖审计失败。端到端测试也有 6 项失败，而现有 review gate 仍会显示 PASS。

本报告只写入审查结果，没有修改业务源代码。

## 优先级定义

- **P0 / 严重**：可造成账户/数据被接管，或多用户环境下的任意代码执行；应立即阻断发布。
- **P1 / 高**：跨用户访问、SSRF、成本控制旁路、发布级回归或高概率拒绝服务。
- **P2 / 中**：可复现的功能/可靠性/性能问题，或需要尽快补齐的安全纵深。
- **P3 / 低**：维护性、文档和长期工程治理建议。

## P0/P1 发现

### F-01（P0，多用户部署）公开角色会自动执行作者提供的 JavaScript 和副作用技能

**证据**

- `backend/src/validations/schemas.js:61-75,109-123` 允许公开角色携带 `customJs`、`customJsEnabled`、`customJsRiskAccepted` 及附属技能配置。
- `backend/src/modules/characters.js:713-735` 对非拥有者返回完整 `authorAdvancedSettings`。
- `backend/src/routes/helpers.js:94-109` 将作者设置放入会话并合并为有效设置。
- `backend/src/modules/advancedSettings.js:38-44` 和 `frontend/src/utils/chatAppearance.js:41-60` 会把作者的“已确认风险”当成当前用户的启用条件。
- `frontend/src/composables/chat/useChatAppearance.js:213-218` 在打开会话时调用 `runChatCustomScript`；`frontend/src/utils/chatAppearance.js:155-225` 使用 `AsyncFunction` 执行脚本。
- 同一合并设置还会驱动 `backend/src/services/accessoryAgents.js:41-102`；`backend/src/routes/conversationGeneration.js:306-315` 在每次回复后启动这些后台技能。作者可以间接触发模型请求、经济/场景/世界状态写入等副作用。

**影响**

公开角色作者可以放入 `fetch(...)`、DOM 操作或其他同源 JavaScript。其他用户只要使用该角色，脚本即可在其聊天页的 origin 中运行，读取页面和本地存储、调用带凭据的 API，或向外部地址发送数据。即使产品允许“自定义 JS”，作者勾选风险不等于使用者同意；当前实现失去了多用户信任边界。

**建议**

1. 立即对非拥有者清空/禁用 `customJs`、`customCss` 和所有会产生写入或模型调用的作者附属技能；不要继承作者的 `RiskAccepted`。
2. 将“作者默认值”和“当前用户授权”分开保存，首次使用时由当前用户明确确认，并提供可撤销的 per-user 开关。
3. 最好把扩展代码移到无凭据、严格 CSP 的 sandbox iframe；若保留 `AsyncFunction`，至少禁止访问 `fetch`、`document.cookie`、Storage 和任意网络。
4. 增加 E2E 回归：恶意公开角色在非拥有者会话中不得执行脚本、不得启动副作用技能。

### F-02（P1）天赋池没有用户归属，存在完整 IDOR

**证据**

- `backend/src/db/schema.js:653-659` 的 `talent_pools` 没有 `user_id`/`owner_id`。
- `backend/src/modules/talents.js:21-40,43-95` 的列表、读取、更新、删除 SQL 全部只按 `poolId` 操作。
- `backend/src/routes/talents.js:16-60` 只调用 `requireAuth`，没有用户过滤。
- 现有测试 `backend/src/tests/backend.test.js:8235-8312` 只覆盖单用户 CRUD，没有跨用户用例。

**影响**

用户 A 创建的池会出现在用户 B 的列表中；知道 ID 的用户 B 可以读取、修改或删除 A 的池。由于 `character_talents.pool_id` 外键指向该全局池，修改会影响依赖它的角色。

**建议**

1. 新增版本化迁移：为池增加 `user_id`（或明确的 `owner_type/owner_id`）。无法判断历史拥有者的旧行应先标为只读系统池，而不是随意归给首个用户。
2. 让 `list/get/create/update/delete/roll` 全部显式接收 `userId`，SQL 同时约束池和角色归属；必要时增加复合唯一键/外键。
3. 为列表增加 cursor/limit，避免全表返回。
4. 增加 A/B 两个账号的 GET、PUT、DELETE、roll 负向测试。

### F-03（P1）开发模式 Provider 健康检查可被普通用户用于 SSRF

**证据**

- `backend/src/config.js:22-25` 在非生产环境默认开启 `allowPrivateProviderNetworkInDevelopment`。
- `backend/src/routes/upgrade.js:54-57,230-251` 的 `/api/providers/health` 直接接受请求中的 `providerType/baseUrl/model`，没有复用 URL 权限校验，也没有 root 检查。
- `backend/src/services/providerHttp.js:157-163` 以“开发模式开关”为 OR 条件允许私网请求。
- `backend/src/services/providerUrlPolicy.js:26-35` 在该选项开启时允许 loopback、私网和本地地址。

**复现证据**（本地临时 HTTP 服务，认证用户标记为非 root）：

```text
POST /api/providers/health
baseUrl = http://127.0.0.1:<临时端口>
=> 200，返回 internal-service-model
```

**影响**

在 `NODE_ENV!=production` 的 LAN/共享开发服务器上，任意已注册用户（默认公开注册开启）都可以让后端访问本机端口、云元数据端点或内网服务，并得到响应摘要，形成内网探测/数据读取通道。

**建议**

- `/providers/health` 与 `/providers/models` 统一调用同一个 `buildProviderProbeSettings`/URL policy；私网地址必须同时满足显式部署开关和 root 权限。
- 对共享开发/LAN 启动脚本默认关闭私网 Provider，或强制 `REGISTRATION_ENABLED=false`。
- 增加 loopback、RFC1918、link-local、云元数据地址的路由级负向测试；不要只测底层函数。

### F-04（P1）直接聊天和多数 AI 助手绕过日成本配额与用量记账

**证据**

- `backend/src/services/quotas.js:94-100` 定义 `assertDailyCostQuota`；在 Provider 调用门面中只有 `backend/src/services/providerTaskRouter.js:15` 做调用前检查（`quotas.js:56` 仅是 durable job 提交时的间接检查）。
- 只有 `providerTaskRouter.js:28` 调用 `recordProviderUsage`，主聊天保存 usage 的路径没有调用它。
- 主聊天直接在 `backend/src/routes/conversationGeneration.js:235,400` 调用 `generateCompletion`，流式路径在 `backend/src/services/conversationStreamResponse.js:82` 调用 `streamCompletion`；这些路径没有成本预检或 `recordProviderUsage`。
- `characterAssistant.js`、`worldBookAssistant.js`、`sceneOrganizer.js`、`accessoryAgents.js` 也直接调用 Provider tool/completion。
- `backend/src/services/conversationAssistantResults.js:41-50` 只是把 usage 放进消息快照，不会更新 `user_daily_usage`。

**影响**

`maxDailyCostMicros` 对主聊天、流式聊天、角色/世界书助手和后台技能不生效；管理员的日成本面板也会漏记这些请求。当前检查还是“调用前看余额、调用后不预留”，单次请求本身也可能超过上限，带来不可控的 Provider 费用。

**建议**

建立唯一的 Provider 调用门面，所有 completion、tool round、重试和生图都必须经过：

1. 原子预留/检查用户预算；
2. 记录 provider、模型、请求类型和实际 usage；
3. 对流式中断、无 usage、fallback 和多轮 tool 调用定义一致的计费策略；
4. 预算不足返回稳定的 429/配额错误。

增加“成本配额设为极小值后调用主聊天/流式聊天/助手”的集成测试，断言 Provider 不会被调用且 `user_daily_usage` 与消息 usage 一致。

### F-05（P1，发布阻断）端到端测试 16 项中有 6 项失败，且 gate 未覆盖

**本次运行**

```text
npm run test:e2e
16 tests: 10 passed, 6 failed
```

失败包括：

- `local-first-smoke.spec.js`、`settings-npc.spec.js`：测试点击“完整表单”后立即寻找“角色背景内容”等字段；当前 `frontend/src/components/character/CharacterEditorDesktop.vue:58-60` 只渲染一个 active section，而 `useCharacterCreationWizard.js:67-78` 在 full 模式仍定位到 `basic`。界面文案却声称“显示全部创建字段”。
- `chat-composer-viewport.spec.js`：移动端实际快捷按钮为“新角色”，测试寻找 `/创建角色/`。
- `settings-npc.spec.js`、两个 `town-ai-step.spec.js`：测试用户保存 loopback Provider 时收到“只有 root 管理员可以使用本地或私网 Provider”。这是当前安全策略与测试 fixture 的冲突，不能靠放宽生产权限解决。

单独以 `--workers=1` 重跑 `local-first-smoke.spec.js` 和 Provider 用例仍失败，因此不只是并发偶发问题。

**建议**

- 明确产品契约：full 模式要么真正渲染全部 section，要么改文案并让测试逐区导航；同步更新 mobile “新角色/创建”可访问名称。
- E2E 使用专用 root bootstrap 账号或 mock/public test gateway；保留普通用户不能保存私网 Provider 的安全断言。
- 将至少 smoke、认证、聊天、Provider 和 town 流程加入 review gate/CI，并在失败时上传截图、trace 和后端日志。

### F-06（P1）前端生产依赖审计失败

`frontend` 执行 `npm audit --omit=dev --audit-level=moderate` 退出码为 1，发现 4 项（1 moderate、3 high）：

| 包 | 当前锁定版本 | 影响/建议 |
| --- | ---: | --- |
| `linkify-it` | 5.0.1 | 高危 mailto 校验二次复杂度 DoS；`MarkdownContent.vue` 开启 `linkify: true`，恶意长消息可冻结浏览器。优先升级。 |
| `dompurify` | 3.4.5 | 多项 XSS/配置污染修复缺失；当前后端已是较新版本，前后端应统一到修复版本。 |
| `postcss` | 8.5.15 | 高危路径/Source Map 问题，主要影响构建链；升级 Vite/锁文件。 |
| `nanoid` | 3.3.12 | 高危异常 size 可能死循环，主要为构建链传递依赖；升级并锁定修复版本。 |

**建议**：先更新 `frontend/package-lock.json`（优先 runtime 依赖），再运行后端测试、前端构建、E2E 和审计；不要只调高 audit 阈值。审计报告中的 advisory 链接应记录在依赖升级 PR 中。

### F-07（P1/P2）聊天附件链接未做协议白名单，存在可点击的 `javascript:` XSS

**证据**

- `frontend/src/components/chat/ChatMessageItem.vue:106-120` 只对附件 URL 做 `String(...).trim()`。
- `frontend/src/components/chat/ChatMessageItem.vue:220-230` 将该值直接绑定到 `<a :href>` 和 `<img :src>`，链接使用 `target="_blank"`、`rel="noreferrer"` 但未校验协议。
- `frontend/src/composables/chat/useChatSubmit.js:1580-1604` 对非 data URL 也只检查 MIME 类型；遗留消息、导入数据或被污染的持久化记录仍可进入展示层。

**影响**

攻击者若能写入消息附件字段，诱导用户点击 `javascript:` 链接即可在应用 origin 执行脚本。`img` 本身通常不执行脚本，但不能抵消 `<a>` 的风险。

**建议**

统一 `isSafeAttachmentUrl`：只允许站内 `/api/assets/...`、`http/https`（如产品需要）和受限的 `data:image/png|jpeg|webp;base64`；其余在入库和展示两端都丢弃。外链使用 `rel="noopener noreferrer"`，并补充 `javascript:`, `vbscript:`, `data:text/html` 回归测试。

### F-08（P1/P2）认证请求边界的递归 JSON schema 可被深层嵌套触发栈溢出

**证据**

- `backend/src/validations/schemas.js:703-710` 的 `jsonBoundarySchema` 通过 `z.lazy` 无限递归，没有深度或对象键数上限。
- `backend/src/app.js:136-142` 的 `requireAuth` 在所有认证路由统一调用该边界检查。

用原始 JSON（不依赖客户端 `JSON.stringify`）发送嵌套对象的结果：

```text
depth 1000  -> 200
depth 2000+ -> 500 {"error":"Maximum call stack size exceeded"}
```

**影响**

已登录用户可以用很小的请求反复触发同步栈溢出和错误处理，消耗事件循环；在不同 Node/Zod 版本上可能进一步导致进程不稳定。该类输入本应返回 400，而不是 500。

**建议**

在进入 Zod 前用迭代式扫描限制最大深度（例如 64/100）、对象键数、数组长度和序列化字节数；具体路由继续使用严格 schema。加入深度 fuzz 测试，确认不会 500 或阻塞进程。

## P2/P3 发现与改进建议

### F-09（P2）备份覆盖顺序会在新备份失败时删除最后一份有效备份

`backend/src/services/backup.js:84-89` 在执行 `VACUUM INTO` 前调用 `removeBackupFileGroup(destPath)`。如果磁盘满、数据库忙或 VACUUM 失败，旧文件已经被删除。

已用临时故障注入复现：

```text
existedBefore=true, existsAfterFailure=false, error="simulated VACUUM failure"
```

建议写入唯一临时文件，完成完整性校验并 `fsync` 后再原子替换；只有新备份成功后才清理旧文件，并给手动/定时备份加进程内互斥锁。补充“创建失败仍保留旧备份”的测试。

### F-10（P2）CSRF/Provider 配置没有使用 `createApp(context.config)` 的配置

`backend/src/services/csrf.js:16,85,95,110-120` 和 `backend/src/routes/settings.js:265-269` 读取导入的全局 `appConfig`；而 `backend/src/app.js:68-74,108-114` 支持注入自定义 config。结果是：

- 测试或嵌入式部署传入的 `clientOrigins`、`isProduction`、私网开关不会影响 CSRF 校验或 cookie `secure` 属性；
- CORS 的私网来源规则与 CSRF 的来源规则可能不一致。

建议改为 `createCsrfMiddleware(config)`/请求级配置，并让 Provider URL 校验也从同一配置对象读取。增加“自定义 production config + 自定义 origin + cookie flag”的集成测试。

### F-11（P2）局部 catch 绕过统一错误脱敏和错误 envelope

`backend/src/routes/upgrade.js:214-224`、`backend/src/routes/towns.js:102-107,179-187,278-286` 等路径直接返回 `error.message`。这会绕过 `backend/src/app.js:354-360` 的 `publicErrorMessage`，可能把 Provider 响应、SQL 约束或内部实现细节返回给客户端。

建议只向客户端返回稳定的 `AppError.publicMessage/code`，把原始错误和 request ID 写入脱敏日志；对已知业务校验错误使用显式 4xx 映射。为 production config 增加“内部错误不出现在响应”的测试。

### F-12（P2）请求体上限与资产上限不一致，且文本/JSON 没有存储配额

- `backend/src/config.js:43` 默认 `jsonBodyLimit` 为 `8mb`。
- `backend/src/validations/schemas.js:13,172-180` 允许资产 data URL 长度达到 8,500,000 字符；`backend/src/config.js:48` 又允许 6 MiB 二进制资产。
- 一个恰好 6 MiB 的二进制负载转成 base64 并包进 JSON 后约为 8,388,644 bytes，超过 8 MiB 的 body limit（8,388,608 bytes），合法的最大资产会在路由前收到 413。
- 配额服务只限制二进制上传、AI 任务、请求数和成本；大量角色/世界书/消息/`z.record(z.any())` JSON 没有总存储或深度限制。

建议统一“二进制、base64、JSON body”三套上限，或改用 multipart/流式上传；为文本/结构化数据增加每用户存储配额和深度/键数限制。

### F-13（P2）OpenAPI 响应模型与实际路由形状不一致

`backend/src/services/apiContracts.js:150-152` 将 `WorldBookList`、`TownList` 定义为带字段的对象，但 `backend/src/routes/worldBooks.js:23-25` 和 `backend/src/routes/towns.js:62-64` 实际直接返回数组。依赖 `/openapi.json` 生成客户端时会得到错误类型。

建议以真实响应快照或 schema validator 做契约测试，并补齐 mutation、SSE、CSRF header 和错误响应的 OpenAPI 描述。

### F-14（P2）review gate/CI 没有覆盖 E2E，且 E2E 数据库跨运行复用

- `scripts/review-gate.ps1:93-151` 只有编码、诊断、后端测试、前端构建和 Git 检查，没有 `npm run test:e2e`。
- 仓库没有 `.github/workflows` 等 CI workflow。
- `frontend/playwright.config.js:17` 固定使用 `.runtime-check/e2e.sqlite`；当前该文件在多次运行后已累积到约 2 MB，存在跨运行状态污染和无限增长风险。

建议每次运行使用随机临时 DB，测试结束后在已验证的 `.runtime-check` 子目录清理；CI 至少执行 Node 24 后端测试、前端构建、关键 Playwright smoke，并上传失败工件。不要把 E2E 失败隐藏在“gate PASS”后面。

### F-15（P2，配置条件）root 初始化依赖公开注册和明文配置密码比较

`backend/src/config.js:31` 默认公开注册开启；`backend/src/routes/auth.js:32-60,115-121` 只要注册请求的用户名和密码恰好等于 `ROOT_ADMIN_*` 环境变量，就将新用户设为 root admin，没有“数据库为空/一次性 bootstrap”条件。

这不是默认无凭据提权，但在配置密码泄露、过弱或共享注册端点暴露时，任何人都可抢先注册 root。建议使用一次性 CLI/启动 bootstrap、要求用户表为空、初始化成功后自动关闭注册，并避免把长期登录密码作为 bootstrap secret。

### F-16（P3）历史/损坏密码哈希缺少格式上限

`backend/src/security.js` 的 `verifyPassword` 对 salt/hash 长度和 base64 格式没有严格限制，也没有把 `scrypt` 异常统一转换为失败结果。损坏数据库行可能造成昂贵计算或反复 500。建议限制固定 salt/hash 字节数、捕获参数异常并记录审计事件。

### F-17（P3）未引用重复实现和超大模块增加维护风险

仓库同时存在 `backend/src/services/toolSchemaOptimizer.js` 与嵌套的 `backend/src/services/backend/src/services/toolSchemaOptimizer.js`，后者未被运行时引用；`frontend/src/views/WorldBookView.vue`、`backend/src/tests/backend.test.js` 等文件也已超过 2,000/9,000 行。建议在确认无外部导入后清理重复文件，并按领域/组件拆分，降低后续安全修复的回归半径。

## 已确认的优点

- `backend` 全量测试 **1321/1321 通过**，未发现失败或跳过测试。
- 编码检查扫描 **576 个文件通过**；未发现常见中文乱码或替换字符。
- Provider URL、重定向、私网策略、Session 哈希、HMAC CSRF、资源归属和数据库迁移已有较完整的基础实现。
- 前端构建成功，并已有 DOMPurify、可访问性扫描、源代码 hygiene 和大量前端 API 行为测试。
- 备份已有完整性校验、SHA-256 和离线恢复回滚副本；问题主要在“失败时替换顺序”和运行级演练覆盖。

## 建议实施顺序

1. **立即（发布前）**：处理 F-01、F-02、F-03、F-04；升级 F-06 的 runtime 依赖；修复/明确 F-05 的 E2E 契约。
2. **随后**：完成 F-07、F-08、F-09、F-10，并将负向安全用例加入 CI。
3. **一个迭代内**：完成 F-11～F-14 的错误/契约/配额治理，建立稳定的 Node 24 + build + E2E gate。
4. **持续治理**：按 F-15～F-17 清理 bootstrap、重复实现和超大模块，定期做备份恢复演练与依赖审计。

## 实施进度（实时更新）

- 2026-09-02：已读取本报告并完成仓库状态盘点；当前分支为 `codex/gameplay-systems-ui-refresh`，评审文档尚未纳入版本控制。
- 2026-09-02：已建立修复计划，按 F-01～F-17 的发布优先级分批处理；下一步先定位并修复 P0/P1 安全问题。
- 2026-09-02：已并行启动 F-01、F-02 与 F-07～F-11/F-16 修复；主线同步处理 F-03～F-06、F-12～F-15、F-17 及 review gate。
- 2026-09-02：F-06 依赖修复已落地：前端升级 DOMPurify、Markdown-it、Vite 与 Vue 插件并刷新锁文件；`npm install --package-lock-only` 审计结果为 0 个漏洞，待最终构建复核。
- 2026-09-02：F-05/F-14 开始处理：创建页“完整表单”现在具备真正的全量分区渲染；Playwright 改用每次运行随机数据库并在 teardown 清理，review gate/CI 已加入依赖审计与 E2E 步骤，待运行复核。
- 2026-09-02：根据连接检测反馈修复 F-03 兼容路径：开发环境仍要求 root + 私网开关，root 使用本地 URL 时自动推断 `allowPrivateNetwork`；test/mock 网关仅在测试环境允许 loopback，且 `/providers/models` 与 `/providers/health` 共用同一策略。
- 2026-09-02：F-03 根因补强：启动时修复 root 账户历史 Provider 的私网授权标志，运行时也按 root/部署开关计算有效权限；设置页新增 root 专用开关并对普通用户禁用私网检测。随后将所有入口收敛到统一策略，并在 UI/错误响应中明确生产需 `ALLOW_PRIVATE_PROVIDER_NETWORK=true`、开发需 `ALLOW_PRIVATE_PROVIDER_NETWORK_DEV=true` 后重启。F-05 E2E 契约用例已同步到全量表单与移动端入口。
- 2026-09-02：后端定向回归已通过配额、Provider、CSRF、备份、输入边界、来源卫生和天赋 CRUD；全量回归还需处理迁移计数/契约测试更新后的最终核验。
- 2026-09-02：F-07/F-08/F-09/F-10/F-11/F-16 已落地并通过对应测试：附件协议白名单、迭代式 JSON 扫描、备份临时文件原子替换、注入式 CSRF 配置、稳定错误 envelope、密码哈希格式限制。
- 2026-09-02：新增跨用户天赋池、Provider 配额、附件协议和损坏密码哈希回归测试；后端全量回归更新为 `1326/1326` 通过。
- 2026-09-02：针对连接检测仍被私网策略拦截的问题完成根因修复：统一 settings/models/health/聊天/后台任务的 Provider 网络策略，按运行时 root 身份与生产/开发部署开关重新计算权限，不再信任遗留数据库标志；生产错误提示明确要求 `ALLOW_PRIVATE_PROVIDER_NETWORK=true` 并重启后端，测试 Mock loopback 仅限 `NODE_ENV=test`。新增跨路由回归后，后端全量回归为 `1334/1334` 通过，前端构建通过。
- 2026-09-02：F-15 初始化加固完成：令牌模式下错误注册不会占用空库，成功初始化后公开注册自动关闭；旧的用户名/长期密码 root 初始化必须显式开启 `ALLOW_LEGACY_ROOT_BOOTSTRAP=true`，注册页支持一次性令牌输入，并新增对应回归测试。
- 2026-09-02：最终 review gate 通过：编码检查（586 文件）、后端 `1334/1334`、前端构建、生产依赖审计（0 漏洞）、Playwright E2E `16/16` 与 Git diff 检查均通过；当前仅保留 F-17 的超大模块拆分作为后续治理项。
- 2026-09-02：API 契约、root bootstrap 和 Provider 网络策略最后一轮改动复核完成；再次执行 review gate（日志 `.runtime-check/review-gate-20260902-115943.log`）仍为 `PASS`，未发现需阻塞 PR 的回归。
- 2026-09-02：已创建 PR [#5](https://github.com/MrYu-JMComic/FLAI-TavernAI/pull/5)，分支 `MrYu/code-review-2026-09-02`，提交 `65b88bd`；后续按 CI 结果处理审阅意见。
- 2026-09-02：PR #5 的 GitHub Actions job 未启动，平台报告账号 billing lock（非代码测试失败）；本地 review gate 已完成同等验证，待仓库账单状态恢复后重新执行 CI。

### 问题清单

| 编号 | 当前状态 | 证据/说明 |
| --- | --- | --- |
| F-01 | 已完成 | 非拥有者响应清空可执行代码并禁用作者附属技能；前端按角色拥有权决定是否执行作者设置。 |
| F-02 | 已完成 | 0010 迁移增加池归属/只读系统池；CRUD、roll 和角色天赋读取均按用户约束，已补 A/B 负向测试。 |
| F-03 | 已完成 | health/models 共用 root + 部署开关 URL 策略；启动修复历史 root 配置，设置页提供显式开关，测试环境 mock 例外限定为 `NODE_ENV=test`。 |
| F-04 | 已完成 | completion、stream、tool、image 和助手调用统一进入配额门面，使用 SQLite 原子预留与实际用量结算；极小成本配额测试确认 Provider 不被调用。 |
| F-05 | 已完成 | full 表单/移动入口契约已同步，16 项 Playwright 在单 worker 下全部通过。 |
| F-06 | 已完成 | DOMPurify 3.4.14、Markdown-it 14.3.1、Vite 8.2.2 等升级，生产依赖审计 0 漏洞。 |
| F-07 | 已完成 | 前后端统一拒绝 `javascript:`、`vbscript:`、HTML data URL，外链使用 `noopener noreferrer`。 |
| F-08 | 已完成 | 认证 JSON 边界改为迭代扫描，限制深度、键数、数组和字节，深层输入返回 400。 |
| F-09 | 已完成 | 备份先写唯一临时文件、校验并原子替换，失败保留旧备份，增加进程内互斥。 |
| F-10 | 已完成 | CSRF middleware/token endpoint、Provider URL 和 cookie secure 标志均使用 `createApp(context.config)`。 |
| F-11 | 已完成 | upgrade、town、world-book 局部 catch 使用稳定 public error envelope，生产不回传内部错误。 |
| F-12 | 已完成 | body limit 提升并与 6 MiB base64 资产留出余量；认证边界统一按配置字节上限，新增结构化存储配额。 |
| F-13 | 已完成 | WorldBook/Town 列表 schema 改为数组，补 talent/provider 路径与契约断言。 |
| F-14 | 已完成 | review gate/CI 纳入 audit 与 E2E；Playwright 使用随机 DB，启动/teardown 清理残留。 |
| F-15 | 已完成 | 一次性 `ROOT_ADMIN_BOOTSTRAP_TOKEN` 仅允许空库首次初始化，错误注册不会占位，成功后自动关闭公开注册；传统密码兼容路径默认关闭，必须显式设置 `ALLOW_LEGACY_ROOT_BOOTSTRAP=true`。 |
| F-16 | 已完成 | scrypt hash 总长、salt/hash 字节数和 base64 格式严格校验，异常统一返回失败，新增损坏哈希测试。 |
| F-17 | 部分完成 | 已移除未引用嵌套 `toolSchemaOptimizer.js` 并更新历史说明；超大模块拆分留作后续低风险重构。 |
