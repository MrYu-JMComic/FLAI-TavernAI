# 架构与所有权

本文合并功能地图、所有权规则和遗留账本。调用链盘点始于 2026-09-27，世界书边界于 2026-10-17 更新；2026-10-18 整理时已纳入旧 NPC 管理移除。分层规则描述收敛目标，下表同时注明尚未完成的边界。

## 所有权规则

1. 一个业务动作只能有一个正式 service。迁移期的 module/service 并存必须登记替代者和退出条件。
2. 一个数据对象只能有一个正式写入口。跨表写入由该入口用 `withSavepoint` 组成事务，不允许不同模块各写一套。
3. route 负责鉴权、Zod 参数校验和响应；业务编排进入 service，错误响应使用 `routes/errorResponse.js`。
4. repository 负责 SQL，不承接业务判断或调用 service；新增 SQL 归入 `repositories/` 或 `db/`。
5. AI 生成结果或计划，最终写库经过正式业务入口，沿用人工编辑的校验和审计；作者助手在内存工作区操作。
6. 每个前端领域只维护一份 `api/<domain>.js` 请求封装，传输和 SSE 共享 `api/core.js`。组件不新增直接 `apiRequest('/api/...')`；根 `api.js` 只作为兼容导出。
7. `shared/` 只放前后端共用、无数据库和网络依赖的稳定契约、纯函数和常量。

| 层 | 路径 | 职责 |
| --- | --- | --- |
| domain | `backend/src/domain/<domain>/` | 纯规则、归一化、常量、限额、领域错误 |
| repository | `backend/src/repositories/<domain>Repository.js` | 数据库读写 |
| service | `backend/src/services/<domain>/` | 业务动作、事务、审计、AI 编排 |
| route | `backend/src/routes/<domain>.js` | 鉴权、校验、响应 |
| 前端 | `views/`、`composables/<domain>/`、`components/<domain>/`、`api/<domain>.js` | 分别负责装配、状态、展示和请求 |

世界书是现有参考实现：`domain/worldBooks/`、`worldBookRepository.js`、`services/worldBooks/` 和 `routes/worldBooks.js`。其他领域仍有直接 SQL 和聚合 module，详见遗留账本。

## 功能调用链

以下后端路径相对于 `backend/src`，前端路径相对于 `frontend/src`。

### 对话与消息

```text
ChatView.vue -> composables/chat/useChatSubmit.js
  -> api/chat.js -> api/core.js
  -> /api/conversations/:id/messages
  -> routes/conversationGeneration.js
  -> conversationTimeline + promptPipeline + conversationStreamResponse
  -> services/providers.js
  -> messages / conversations / conversation_checkpoints
```

- 路由组合在 `routes/conversations.js`；消息继续、重新生成、编辑、删除、截断、分支、候选和存档由 conversation 子路由承担。context 预览、预算、trace 和 memory 仍部分位于 `routes/upgrade.js`。
- 结果写入由 `conversationAssistantResults.js` 负责，时间线加锁、快照和后处理入队分别由 `conversationTimeline.js`、`conversationSnapshotRepository.js` 与 `services/jobs/` 负责。发送编排仍在 route，需要后续提炼 application service。
- 核心表包括 `messages`、`message_swipes`、`saves`、`conversation_checkpoints`、`conversation_memories`、记忆审查表、`conversation_world_book_clock/state`、`prompt_traces`、`prompt_requests` 和 `job_steps`；检索使用 `fts_messages`、`fts_memories`。
- 前端状态分布在 `composables/chat/`；`ChatContextBudget`、`ChatPromptHistory`、`ConversationMemoryReview` 和 `ChatProcessingStatus` 的直接传输调用仍需收口。行为约定见 [对话运行时](conversation.md)。

### 角色卡

`CharacterFormView.vue -> useCharacterEditor.js -> api/characters.js -> /api/characters/*`。资料和 AI 完善由 `modules/characters.js`、`services/characterAssistant.js` 负责；表包括 `characters`、`character_images`、`character_world_books`、`character_tags`、`character_talents`、`character_growth`。

角色资料写入口尚需独立收口。旧 NPC 管理、多角色对话、人格/情绪和人物物品所有权实现已移除；历史数据处置见 [移除记录](maintenance.md#旧-npc-管理移除)。

### 世界书

```text
WorldBookView.vue -> api/worldBooks.js -> routes/worldBooks.js
  -> services/worldBooks/worldBookService.js -> worldBookRepository.js

WorldBookAiPanel.vue / CharacterAiDraftPanel.vue
  -> /api/world-books/complete-draft 或 /api/characters/complete-draft
  -> worldBookAssistant.js / characterAssistant.js
  -> worldBooks/worldBookAssistantWorkspace.js -> providers.js
  -> workspace + changes + reply（未写库）
  -> /api/world-books/apply-changes
  -> worldBookService.applyWorldBookChanges（一次事务）
```

- CRUD 和 AI 差量应用的唯一作者写入口为 `worldBookService.js`，SQL 统一在 `worldBookRepository.js`。
- 匹配和会话触发状态分别在 `worldBookRuntime.js`、`worldBookMatcher.js`、`worldBookStateService.js`；`match-preview` 实现在领域 service，兼容路由仍位于 `upgrade.js`。
- 正式表为 `world_books`、`world_book_entries`、`character_world_books`；`world_book_change_requests` 保存幂等回执。会话触发状态只用 `conversation_world_book_clock/state`，聊天专用书引用为 `conversations.chat_lorebook_id`。
- `useWorldBookAi.js` 与 `useCharacterAiGeneration.js` 共用目标选择和结果组件；新书先加入角色编辑器本地关联，保存角色后正式关联。详细工作区约定见 [AI 运行时](ai-runtime.md#世界书助手)。
- `worldBookArchitecture.test.js` 守住 SQL、唯一写入口、旧 module 和旧全局状态清零；`worldBookWorkspace.test.js`、`worldBookApplyChanges.test.js` 验证草稿及事务行为。

### Provider 与模型运行时

`SettingsProviderPanel.vue / ChatModelSwitcher.vue / AI 面板 -> api/providers.js -> routes/settings.js + routes/upgrade.js -> services/providers.js`。

`providers.js` 是调用门面；具体协议为 `providerChatCompletions.js`、`providerOpenAiResponses.js`、`providerAnthropic.js`、工具循环和生图模块；重试、熔断、网络、任务路由、SSE、usage 分别有独立 helper。提示词编排在 `promptPipeline.js`。

配置通过 `providerProfileRepository.js` 写入 `provider_presets`、`provider_selections`；`provider_settings` 是兼容表。`provider_route_events`、`prompt_requests`、`prompt_traces` 记录运行情况；配额使用 `user_quotas`、`user_daily_usage`。`/api/settings/provider`、`/api/provider` 不能作为新的业务写入口。

### 会话游戏系统

聊天 HUD、场景、经济、任务和存档从 `ChatView.vue`、`GameHud.vue`、`ScenePanel.vue`、`EconomyPanel.vue` 进入，API 位于 `/api/conversations/:id/gameplay`、`/scenes`、`/economy` 等。表包括 `world_events/clocks/advances`、`player_travel_states`、`discovered_scene_nodes`、`quests/quest_objectives`、`skill_checks`、`reward_grants`、`economy_accounts/transactions`、`scene_nodes/routes/objects`。场景物品独立经 `sceneItemRepository.js` 写入 `scene_objects`，旧遭遇战表不再代表在用功能。

### 设置、管理和后台设施

| 入口 | 后端职责 | 前端入口 |
| --- | --- | --- |
| auth、users、settings、presets、mods、tags、regex-rules、talent-pools、assets | 各领域 route/module；部分账户和设置 SQL 仍在 route | Settings 分区、角色编辑器、登录注册页和各领域 API |
| `/api/jobs/*` | `services/jobs/jobQueue.js`、worker、handler、SSE；表为 `jobs/job_events/job_steps` | `ChatProcessingStatus.vue`、`api/jobs.js` |
| `/api/admin/*` | `adminOperations.js`、`automationAudit.js`、`metricsExposition.js`、`performanceMetrics.js`、`quotas.js` | `AdminView.vue`、`api/admin.js` |
| backup / restore preflight | `createApp` 注入 `backupService`，实现与演练为 `backup.js`、`backupRestoreDrill.js` | 管理员备份页 |
| diagnostics、snapshot、envelopes | `diagnosticsExport.js`、`diagnosticRedaction.js`、`projectSnapshot.js`、`exportEnvelopes.js` | `SettingsDataExportPanel.vue` 和领域 API |

“设置与管理”是多个领域的控制面，不能合并成吞并所有职责的 `settingsService`。健康检查是 `/health/live`、`/health/ready`；详细诊断、指标和恢复预检保持管理员权限。

## 遗留账本

类别：A 为正式实现，B 为有替代者的临时兼容/边界债务，C 为升级数据代码，D 为待核验的孤立候选。旧编号保留，缺号不代表待办丢失。

| ID / 类别 | 现状与正式替代者 | 退出条件与验证 |
| --- | --- | --- |
| L-001 / B | `provider_settings` 仍由 `providerProfileRepository.js` fallback/sync；正式表为 presets/selections | 支持的旧库完成迁移、运行时不再双读写；保留一次性迁移。`providerSettingsRoutes`、`providers`、`database-structure` 测试 |
| L-002 / B | Provider 设置三组别名并存；正式前端封装为 `api/providers.js` | 客户端和 OpenAPI 迁移、别名调用清零后删除。`providerSettingsRoutes`、`apiContracts`、`frontendProviderModels` |
| L-003 / B | `upgrade.js` 聚合 context、memory、diagnostics、snapshot、envelope、match-preview | 按领域迁移调用方和路由契约后移除聚合分支；公开路径迁移期间可读。`upgradeRoutes`、领域 route 测试 |
| L-004 / B | 四个 context/processing 组件直接 `apiRequest` | 补齐 `api/chat.js`、`api/jobs.js` 命名函数；组件领域 URL 清零。前端 API、processing、inspector 测试 |
| L-005 / A，已收口 | 原 `modules/worldBooks.js` 已退役；CRUD/AI 应用统一 `worldBookService` | 维持 architecture/workspace/apply-changes/ownership 边界测试，禁止旧 module 回归 |
| L-006 / C | 0019 回填旧 `world_books.character_id`，运行时只用 `character_world_books` | 支持旧库升级期间保留迁移，不恢复双写。world-book architecture/session/database 测试 |
| L-009 / B | conversation 和 settings route 仍直接 SQL、跨 service 编排 | 新 service 覆盖角色初始化、开场消息、状态栏、checkpoint 和 timeline 失效后迁移；conversation/auth 测试 |
| L-010、L-017 / B | 根 `api.js` barrel 仍被测试使用；`modExtension.js` 旁路调用 core | 扩展统一 `api/mods.js`，迁移测试/公共 import 后缩减 barrel；frontend API/extension 测试 |
| L-011 / B | 世界书旧直接函数调用保留 `current/worldBook` 草稿形状；新 HTTP/角色/任务都走工作区 | 旧直接调用与兼容测试迁移后移除 `legacyDraft` 输入输出适配；不新增第二执行器或写入口 |
| L-012 / D | 一些 helper 只有少量文本引用，尚不能证明无生产调用 | 检查静态 import、动态事件、工具、prompt、表访问和测试后才可判断删除 |
| L-015 / C，运行时已收口 | 0020 清理旧全局 world-book 状态；只用真实 conversation 状态，作者预览只读 | 保留历史迁移，禁止 `legacyCounters` 或无会话 fallback 回归；architecture/session/database 测试 |
| L-016 / B | `world-book.assist` 已共用工作区，旧 `worldBookId` 映射默认选书 ID | 支持的旧任务 payload 迁移后去掉旧参数适配；后台生成不自动写书；jobs/workspace 测试 |
| L-018 / B | `PresetView` 与 Settings presets 两个编辑入口/状态 | 明确产品正式入口，完成路由、状态与 E2E 后收口 |
| L-019 / D | bootstrap/assets、单个 preset 读取和部分 talent mutation wrapper 缺生产 UI 调用方，仍被测试/barrel 引用 | 先决定接入功能或删除 wrapper，再更新测试和导出；测试引用不等于生产引用 |
| L-020 / B | `api/chat.js` 同时承接消息、记忆、存档、场景、经济和 gameplay | 按领域迁移组件与测试 import、同步后端路由后去掉兼容转发，避免重复实现 |

迁移文件承担支持旧数据库升级的责任，不能因运行时代码退役而一概删除；退休 NPC 专属迁移按 [移除记录](maintenance.md#旧-npc-管理移除) 处理。

## 收口与验收

顺序为确定正式 API/service、迁移所有调用方、补充行为及边界测试、清理旧入口/helper/别名、更新本页。优先维护世界书边界并迁移 match-preview，再处理角色、对话和横向设施。

关闭账本条目时必须同时满足：

- 唯一入口和写路径可定位；前后端使用相同字段契约。
- `rg` 不再发现旧 import、路由注册、动态事件、工具名、prompt 或表访问；不能只凭文件名判断。
- 新入口有行为测试；目录边界可参考 `worldBookArchitecture.test.js` 检查 SQL、route 纯度和旧标记。
- 支持的历史数据库仍可升级；清理范围、日期和对应测试写回账本。
- 修改全部完成后统一运行相关测试、构建和编码检查。具体仓库规则见 [AGENTS.md](../AGENTS.md)。
