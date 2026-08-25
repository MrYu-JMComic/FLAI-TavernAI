# NPC 系统重构任务账本

> 状态规则：只有实现、清理和对应验证全部完成后，任务才能从 `[ ]` 改为 `[x]`。
> 禁止因为“已经开始”“代码已写”或“局部测试通过”提前勾选。

## 不可变需求

- 保留聊天顶部现有 `NPC 管理` 入口、位置和打开方式。
- 保留 NPC 自动同步、名册、资料、位置、记忆、行为、物品与衣物、审计回滚和 AI 整理能力。
- 重设计并重写 NPC 管理面板内部 UI，优化桌面和移动端体验。
- 移除独立 `NPC Agent` 模型及模型覆盖配置。
- 移除 NPC Agent 调用的全部查询、写入工具及工具执行流程。
- 移除旧 NPC 提示词，自动同步和 AI 整理改用新的结构化变更计划。
- 先完整移除旧运行时实现，再接入新架构；禁止保留并行实现或永久兼容层。
- 现有数据必须通过事务迁移保留，不直接修改 `backend/data`。
- 所有 NPC 写入必须经过同一领域服务完成校验、去重、事务和审计。
- 保留工作区内与本任务无关的用户改动。

## 阶段状态表

| 阶段 | 当前状态 | 完成判定 |
| --- | --- | --- |
| 0. 任务控制 | 已完成 | 账本、基线和旧实现依赖清单均已复核 |
| 1. 架构设计 | 已完成 | 设计文档完成并通过边界复核 |
| 2. 完整移除旧实现 | 已完成 | 旧运行时、工具、提示词、UI 和专用测试无残留 |
| 3. 新后端架构 | 已完成 | 新领域、仓储、服务及迁移实现并验证 |
| 4. 自动同步与 AI 整理 | 已完成 | 无工具调用链路完整并验证 |
| 5. 新 HTTP API | 已完成 | 新接口完整且鉴权、隔离、限制通过测试 |
| 6. 前端 UI 与状态重构 | 已完成 | 功能、响应式和可访问性全部验证 |
| 7. 跨模块接入 | 已完成 | 所有消费者改用新接口且无旁路写入 |
| 8. 测试与最终验证 | 已完成 | 清单内全部验证命令和人工复核通过 |
| 9. CastChangePlanV1 真实模型兼容修复 | 已完成 | 同源契约、修复重试、错误反馈与全量验证全部通过 |

## 完成清单

### 0. 任务控制

- [x] 创建并确认本任务账本。
- [x] 记录重构前基线测试、构建失败和既有脏工作区状态。
- [x] 建立旧文件、API、数据库表、提示词、工具和测试依赖清单。

### 1. 架构设计

- [x] 定义新人物领域模型及资料、位置、记忆、行为、物品、审计边界。
- [x] 定义自动同步与 AI 整理共用的结构化变更计划协议。
- [x] 定义领域服务、仓储、应用服务、HTTP 路由和前端状态边界。
- [x] 定义旧数据到新数据结构的一次性事务迁移和失败回滚策略。
- [x] 评审设计，确认没有双写、循环依赖或长期兼容分支。

### 2. 完整移除旧实现

- [x] 移除旧 `NPC Agent` 配置、模型覆盖、运行任务和状态事件。
- [x] 移除 NPC Agent 的全部工具定义、挂载、执行和重试逻辑。
- [x] 移除旧 NPC 查询工具及主回复模型的工具注入。
- [x] 移除旧 NPC AI 整理器及其工具协议。
- [x] 移除旧 NPC 提示词和上下文组装分支。
- [x] 移除旧 NPC 管理面板、前端状态逻辑和旧 API 包装。
- [x] 移除旧后端路由、模块和只服务于旧实现的辅助函数。
- [x] 移除旧实现专用测试和文档引用。
- [x] 全仓扫描确认旧运行时标识和工具名称无残留。

### 3. 新后端架构

- [x] 创建统一人物领域模型和仓储接口。
- [x] 实现人物资料与当前位置的增删改查。
- [x] 实现记忆的新增、编辑、删除、权重和封存规则。
- [x] 实现行为规则的新增、编辑、启停、删除和优先级。
- [x] 实现主角与 NPC 物品、衣物和穿戴状态管理。
- [x] 实现统一审计事件、分页读取和事务回滚。
- [x] 实现名称、正式名、别名和隐藏人物解析。
- [x] 实现批量变更计划的验证、去重、权限和事务应用。
- [x] 实现旧数据事务迁移并在迁移测试中确认数据等价。

### 4. 自动同步与 AI 整理

- [x] 实现无工具调用的本轮人物状态投影器。
- [x] 保留自动同步开关，移除独立模型选择并使用当前聊天供应商。
- [x] 实现当前人物 AI 整理。
- [x] 实现全对话 AI 整理。
- [x] 实现整理要求、取消、超时、进度和错误处理。
- [x] 确认自动同步与 AI 整理共用同一变更协议和写入服务。
- [x] 确认模型输出不能绕过服务端校验、权限、事务或审计。

### 5. 新 HTTP API

- [x] 实现人物名册与详情 API。
- [x] 实现资料、位置、记忆和行为 API。
- [x] 实现主角与 NPC 物品、衣物 API。
- [x] 实现审计分页和回滚 API。
- [x] 实现当前人物和全局 AI 整理 API。
- [x] 保持现有入口所需的 URL 生命周期与错误反馈完整。
- [x] 为所有写接口增加鉴权、会话归属验证和输入限制。

### 6. 前端 UI 与状态重构

- [x] 保持聊天头部 `NPC 管理` 入口设计和事件不变。
- [x] 重写 NPC 面板状态层，拆分加载、选择、编辑、整理和审计状态。
- [x] 重设计人物列表、搜索、统计、空状态和隐藏操作。
- [x] 重设计资料与位置编辑体验。
- [x] 重设计记忆列表、编辑和删除体验。
- [x] 重设计行为规则列表、编辑、启停和删除体验。
- [x] 重设计主角与 NPC 物品、衣物管理体验。
- [x] 重设计审计时间线与回滚确认体验。
- [x] 重设计当前人物和全局 AI 整理体验及进度反馈。
- [x] 完成键盘操作、焦点管理、ARIA、44px 触控尺寸和 reduced-motion。
- [x] 完成桌面、平板和手机响应式检查，无重叠或横向溢出。

### 7. 跨模块接入

- [x] 主回复提示管线只读取新的压缩人物上下文，不注入 NPC 工具。
- [x] 场景、动态世界、遭遇、物品和世界事件改用新人物领域接口。
- [x] 多角色、HMDT、记忆衰减和回合队列改用新人物领域接口。
- [x] 备份、项目快照和诊断导出改用新数据结构。
- [x] 确认不存在绕过领域服务的 NPC 数据直接写入。

### 8. 测试与最终验证

- [x] 新增领域模型、仓储和事务回滚测试。
- [x] 新增结构化变更计划规范化、越权和恶意输出测试。
- [x] 新增自动同步与单人/全局整理测试。
- [x] 新增数据迁移、幂等和失败回滚测试。
- [x] 新增 API 鉴权、归属隔离和输入限制测试。
- [x] 新增 NPC 面板状态、竞态、错误恢复和可访问性测试。
- [x] 后端 `npm test` 全部通过。
- [x] 前端 `npm run build` 通过。
- [x] `node scripts/check-encoding.mjs` 通过。
- [x] `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1` 通过。
- [x] 最终全仓扫描确认无旧 Agent、旧工具、旧提示词、并行实现和失效文档。
- [x] 最终 Git diff 人工复核确认未覆盖无关用户改动。

### 9. CastChangePlanV1 真实模型兼容修复

- [x] 自动同步与 AI 整理提示词使用由领域 Schema 生成的同源 JSON 契约。
- [x] 对模型 JSON/Schema/权限格式错误执行至多一次无工具修复重试。
- [x] 同步状态向前端返回具体错误代码与字段路径，不再只显示总括错误。
- [x] 新增真实模型常见错误形态、修复成功、修复失败和无额外重试测试。
- [x] 后端测试、前端构建、编码检查与 review gate 全部通过。

## 工作记录

- 2026-08-15：用户确认先移除旧实现，再完整重构并重新接入；功能和入口保留。
- 2026-08-15：编码暂停期间已整理需求；恢复后先建立本账本。
- 2026-08-15：任务账本已创建并读取确认，开始执行基线与依赖清点。
- 2026-08-15：已记录初始脏工作区、后端既有失败、前端构建和编码检查基线。
- 2026-08-15：已逐项复核旧工具别名、HTTP 路由、数据库对象、直接 SQL 消费者、前端状态事件和重点测试，依赖清单完成。
- 2026-08-15：完成 `NPC_REFACTOR_ARCHITECTURE.md`；复核人物 ID、统一变更计划、单一写服务、事务迁移、无兼容 API 和前端状态边界后，架构阶段完成。
- 2026-08-15：完成旧运行时删除；旧模型配置、工具、提示词、表访问、路由、面板/API、专用测试和备份均已移除，全仓旧协议扫描归零后才勾选阶段 2。
- 2026-08-15：新人物域 schema 与一次性事务迁移首轮实现完成；内存库的数据保留、无效位置修复、别名冲突、幂等和故障回滚专项测试 3/3 通过。迁移总项暂不勾选，等待新仓储接入和全量验证。
- 2026-08-15：人物领域、三仓储、唯一命令服务、查询服务、审计回滚及 `CastChangePlanV1` 完成；结构/迁移/领域/计划/API 专项 18/18 通过，SQL 边界扫描确认无运行时旁路写入，阶段 3 完成后才逐项勾选。
- 2026-08-15：无工具本轮投影、当前模型开关、单人物/全对话整理、SSE 进度、取消、供应商超时和事务应用超时均已接入；本轮证据白名单、幂等、恶意输出、整批回滚及 HTTP 流专项 24/24 通过。补清故障排查文档中的旧 NPC Agent/工具示例后，全仓旧协议和人物工具调用扫描归零，阶段 4 完成后才逐项勾选。
- 2026-08-15：新 `/cast` API 已覆盖名册详情、资料位置、记忆、行为、主角/NPC 衣物、外貌、审计回滚、清理、同步事件及单人/全局整理；查询游标和上限、资源 ID、空更新与回滚 body 均严格校验。完整 HTTP 流、归属隔离、未认证、SSE 成功/错误及 Cast/数据库专项 34/34 通过，路由 SQL 扫描归零后才勾选阶段 5。
- 2026-08-15：新人物管理抽屉、独立状态层、严格 Cast API、分区脏状态、竞态保护、取消流程、桌面/移动操作菜单和全部资料页已完成；前端相关 102/102、Cast 专项 7/7、构建与编码检查通过。真实 Playwright 工作流验证了入口、资料、记忆、行为、物品、审计回滚、焦点恢复、标签键盘导航和严重级可访问性，并人工检查 1280px、768px、390px 截图无重叠或横向溢出，阶段 6 完成后才逐项勾选。
- 2026-08-17：场景、动态世界、遭遇、奖励、HUD、多角色、HMDT、记忆衰减、回合队列、主提示管线、备份、项目快照和诊断均已改用 Cast 领域边界；补齐 V2 事务迁移、稳定人物 ID、完整导出分页及 205 条记忆分页衰减。跨模块专项 90/90 通过，旧 Agent/旧表运行时扫描零命中，Cast SQL 边界测试无旁路访问后才勾选阶段 7。
- 2026-08-17：最终 UI 复验覆盖 1280px、768px、375px、横屏、暗色、125% 字号、键盘、ARIA 与 Axe 严重级扫描；Playwright 3/3 通过。后端全量 1226/1226 与前端生产构建通过；旧运行时、工具、表、路由、包装和失效文档扫描零命中，受保护路径未变更，Git diff 空白检查通过。
- 2026-08-17：最终独立编码检查扫描 501 个文件并通过；完整 review gate 通过，日志为 `.runtime-check/review-gate-20260817-191342.log`，其中后端 1226/1226、前端生产构建、Git 与可访问性静态检查均通过。最终 Playwright 联合流程 3/3、稳定性复跑 3/3 通过，确认后才完成阶段 8。
- 2026-08-18：真实模型触发自动同步后返回 `CAST_PLAN_SCHEMA`；只读核对确认开关已开启、主回复已落库但计划在写入前被拒绝。根因为提示词未提供字段级契约、测试只使用手写完美 JSON，且同步状态丢弃具体校验详情；新增阶段 9，修复完成前不勾选。
- 2026-08-18：自动同步契约现由严格领域 Schema 生成并限制为 8 种允许操作、40 项上限及强制 evidence；AI 整理共用同源契约。加入至多一次无工具结构修复重试，并通过 SSE 向前端返回错误代码、字段路径和重试状态。真实错误形态专项 30/30 与编码检查通过后勾选前四项，阶段 9 继续等待全量门禁。
- 2026-08-18：后端全量 1233/1233、前端生产构建、506 文件编码检查、Git diff 检查及 review gate 全部通过；门禁日志为 `.runtime-check/review-gate-20260818-105707.log`。全部验证完成后才勾选最后一项并完成阶段 9。

## 重构前基线

- 工作分支：`codex/gameplay-systems-ui-refresh`。
- 初始工作区已经包含大量用户改动和未跟踪的多角色/HMDT 文件；本任务不得回退这些改动。
- 2026-08-15 清点时工作区共有 125 条状态记录，其中 90 个已跟踪文件有改动、35 个路径未跟踪。
- 重构开始前后端 `npm test` 已失败。已确认的既有失败包括：
  - accessory agent observation-window 断言失败；
  - `chatPipelineOptimizations` 仍期待旧的 45 秒超时；
  - `providerOpenAiResponses.js` 存在未使用的 `extractReasoning` 导入；
  - `conversationMultiAgent.js` 与 `validate-tools.js` 存在重复导入；
  - `validate-tools.js` 存在运行时代码之前未完成全部导入的问题。
- 当前前端 `npm run build` 通过；这里只记录基线，不代表最终验证完成。
- 当前编码检查通过；这里只记录基线，不代表最终验证完成。
- 在用户要求建立账本前曾产生部分未完成的 NPC 重构草稿；这些草稿必须纳入删除和重新设计审查，不能直接视为新架构完成。

## 旧实现依赖清单

### 核心运行时

- 领域与存储：`backend/src/modules/npcs.js`、`backend/src/db/schema.js`、`backend/src/db/indexes.js`。
- HTTP：`backend/src/routes/conversationNpcs.js`、`backend/src/routes/conversationMultiAgent.js`。
- 自动化：`backend/src/services/accessoryAgents.js`、`backend/src/services/npcOrganizer.js`、`backend/src/services/npcContextTools.js`。
- 提示管线：`backend/src/services/promptPipeline.js`、`backend/src/services/chatContextDirector.js`、`backend/src/routes/conversationGeneration.js`。
- 配置与验证：`backend/src/modules/advancedSettings.js`、`backend/src/validations/schemas.js`、`backend/src/services/characterAssistant.js`。
- 物品与外貌：`backend/src/modules/scenes.js`、`backend/src/modules/characterAppearance.js`、`backend/src/services/itemOrganizer.js`、`backend/src/services/itemManagerAgent.js`、`backend/src/services/appearanceManagerAgent.js`。
- 记忆与多角色：`backend/src/modules/hmdtEngine.js`、`backend/src/modules/memoryAssociator.js`、`backend/src/modules/memoryDecayEngine.js`、`backend/src/services/memoryManagerAgent.js`、`backend/src/services/turnManager.js`。
- 其他读取者：`backend/src/modules/gameplayDashboard.js`、`backend/src/services/projectSnapshot.js`、`backend/src/services/diagnosticsExport.js`。
- 前端入口与状态：`frontend/src/views/ChatView.vue`、`frontend/src/components/chat/ChatHeader.vue`、`frontend/src/composables/chat/useChatAccessory.js`。
- 前端管理：`frontend/src/components/NpcPanel.vue`、`frontend/src/api/chat.js`、`frontend/e2e/settings-npc.spec.js`。
- 多角色前端：`frontend/src/views/MultiAgentChatView.vue`、`frontend/src/api/multiAgent.js`。

### 旧数据库对象

- 人物主体：`npc_registry`。
- 记忆与行为：`npc_memories`、`npc_behaviors`。
- 审计：`npc_profile_audit`、`npc_item_audit`。
- 世界活动：`npc_activities`。
- HMDT：`npc_personality_anchors`、`npc_emotion_vectors`、`npc_emotion_history`。
- 多角色回合：`npc_turn_queue`；关联对象还有 `actor_appearances`、`appearance_audit`、`conversation_turns` 和 NPC 所有权的 `scene_items`。

### 旧工具协议

- NPC Agent 写工具：`upsert_npc`、`record_npc_memory`、`record_npc_behavior`、`upsert_actor_item`、`delete_actor_item`。
- 查询工具：`get_npc_profile`、`get_npc_memories`、`get_npc_behaviors`、`get_actor_items`、`get_scene_locations`。
- AI 整理工具：`sync_npc_profile`、`sync_npc_memories`、`sync_npc_behaviors`、`delegate_item_organization`、`hide_npc_profile`、`finish_npc_organization`。
- 整理器旧兼容别名：`upsert_npc_profile`、`add_npc_memory`、`update_npc_memory`、`delete_npc_memory`、`add_npc_behavior`、`update_npc_behavior`、`delete_npc_behavior`、`upsert_actor_item`、`delete_actor_item`。
- 被整理器委派的旧物品工具：`sync_actor_items`、`delete_actor_items`、`transfer_actor_item`、`finish_item_organization`。

### 旧 HTTP 接口

- 名册与清理：`GET /npcs`、`DELETE /npcs-empty`、`PUT/DELETE /npcs/:npc`。
- AI 整理：`POST /npcs/organize`。
- 记忆：`GET/POST /npcs/:npc/memories`、`PUT/DELETE /npcs/:npc/memories/:memoryId`。
- 行为：`GET/POST /npcs/:npc/behaviors`、`PUT/DELETE /npcs/:npc/behaviors/:behaviorId`。
- 审计：`GET /npcs/:npc/audit`、`POST /npcs/:npc/audit/:auditId/rollback`。
- 主角与 NPC 物品：`GET /items`、`GET /items/audit`、`POST /items/audit/:auditId/rollback`、`POST /items/organize`。
- 多角色扩展：`/npc-contexts`、`/npc-contexts/:npcName/memories` 及整理接口。
- 多角色关联接口还包括 `/npc-interactions`、`/memories/*`、`/turns/*`、`/appearance/*`、`/consistency/*` 和 `/scene-snapshot`。
- 同一路由文件还混入 `/scenes`、`/items` 和场景整理接口，重构时必须拆分职责但保持对外功能。

### 直接访问旧表的跨模块消费者

- `dynamicWorld.js`、`encounters.js`、`scenes.js`。
- `hmdtEngine.js`、`memoryAssociator.js`、`memoryDecayEngine.js`。
- `conversationMultiAgent.js`、`memoryManagerAgent.js`、`turnManager.js`、`itemOrganizer.js`、`itemManagerAgent.js`、`appearanceManagerAgent.js`。
- `gameplayDashboard.js`、`characterAppearance.js`、`promptPipeline.js`、`conversationGeneration.js`。
- `projectSnapshot.js`、`diagnosticsExport.js`。
- 暂停前产生的 `npcStateProjector.js` 草稿也直接访问旧表，必须删除后按新仓储边界重写。

### 旧提示词标识

- `[NPC 按需名册 / NPC on-demand roster]`。
- `[NPC 自主行为引擎 / NPC autonomous behavior engine]`。
- `[NPC application rules]`。
- 所有要求调用 `get_npc_*`、`record_npc_*`、`upsert_npc` 和 `sync_npc_*` 的提示文本。
- `npcAgent` 配置键、附件任务名和前端 `data.skill === 'npcAgent'` 完成事件分支。

### 重点测试面

- `npcs.test.js`、`conversationNpcRoutes.test.js`、`frontendNpcPanel.test.js`。
- `npcOrganizer.test.js`、`npcContextTools.test.js`、`accessoryAgentsNpc.test.js`、`accessoryAgents.test.js`。
- `promptPipelineContext.test.js`、`worldEvents.test.js`、`scenes.test.js`。
- `dynamicWorld.test.js`、`encounters.test.js`、`gameplayDashboard.test.js`。
- `multiAgentModules.test.js`、`multiAgentRoutes.test.js`、`frontendChatAccessory.test.js`。
- `database-structure.test.js`、`providers.test.js`、`worldDirector.test.js`、`frontendChatSubmit.test.js`。
- `frontend/e2e/settings-npc.spec.js` 和 `validation-scripts.test.js`。
