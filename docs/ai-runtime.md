# AI 运行时与世界书助手

本文集中维护 Provider、工具执行、作者助手和连接诊断，替代早期多份工具优化完成报告。供应商适配以代码与契约测试为依据，不对全部模型或网关作兼容性保证。

## 调用入口与协议

`backend/src/services/providers.js` 是聊天、工具和生图调用门面，连接配额、网络策略、超时、重试预算、熔断和任务路由。向量使用 `services/embeddings/` 的专用协议边界，复用现有 HTTP、网络和配额设施；业务不要另建绕过这些保护的 Provider 调用。所有付费调用均需按当前用户记录 usage、预算预留与结算，chat 与 embedding 模型目录/任务能力分开。

| 责任 | `backend/src/services/` 下的实现 |
| --- | --- |
| Chat Completions 与通用请求体 | `providerChatCompletions.js`、`providerRequestBody.js` |
| Responses | `providerOpenAiResponses.js` |
| Anthropic | `providerAnthropic.js`、`providerAnthropicThinking.js` |
| 工具循环、结果 | `providerToolCompletions.js`、`providerToolResults.js` |
| 供应商 schema 适配 | `toolSchemaOptimizer.js`、`toolProviderAdapter.js` |
| 工具注册、参数与执行保护 | `toolRegistry.js` |
| 网络与韧性 | `providerNetworkPolicy.js`、`providerHttp.js`、`providerRetry.js`、`providerResilience.js` |
| 路由、事件和用量 | `providerTaskRouter.js`、`providerSse.js`、`providerUsage.js` |
| 向量协议、空间指纹与索引 | `embeddings/profile.js`、`embeddings/dashScope.js`、`embeddings/index.js`；SQL 在 `repositories/embeddingRepository.js` |

配置所有权和兼容别名见 [架构账本](architecture.md#遗留账本)，上下文与实际请求追踪见 [对话运行时](conversation.md)。

## 工具契约

工具定义描述业务语义、类型、必填字段、范围和副作用；发送前的协议转换与执行时的原始 schema 校验相互独立。

- Chat、Responses、Anthropic 工具循环共用执行保护。只有本轮提供的工具可执行，重复工具名拒绝，schema 改动后校验缓存随之更新。
- 原始参数必须是有效 JSON 对象且不超过 128000 字符；通用执行器用原始 JSON Schema 生成的校验规则验证后再调用 handler。
- 非法调用返回有界结构化错误，供模型在剩余轮次修正；合法调用的取消、停止标记和结果沿原有流程传播。
- 归属、revision、跨字段和业务状态由业务 handler 继续校验，不能因模型给出合法 JSON 就绕过。
- 整数开区间可精确转为闭区间；小数开区间保留原约束，不能用任意 `0.0001` 增量代替。显式 `additionalProperties: false` 和 strict 保留。
- 递归处理 properties、items、additionalProperties 及联合 schema；没有显式约束的空 object 才补默认结构。
- Gemini 适配保留必填与联合分支，移除空 required；`oneOf` 在协议侧可映射为 `anyOf`，执行侧仍按原排他约束检查。不要丢弃分支以获得“兼容”。
- 新工具优先复用同领域定义和 handler，避免提示词、设置列表、工具描述维护不同副本。普通工具型副作用仍经既有业务服务；作者助手只修改草稿。记忆工具与核心后处理先暂存提案/领域计划，在模型流程完成后统一验证并原子提交，不逐次写正式状态。

`toolSchemaOptimizer.js` 提供 `optimizeToolSchema`、`optimizeTool`、`optimizeTools`、`createTool` 和结构检查 helper；只做 schema 规范化，不证明任何远端模型实现了所有特性。

`node backend/src/services/validate-tools.js` 从实际生产 builder 收集目录，检查对象/集合格式、数量边界、registry 双向覆盖和本地校验器编译，失败退出码为 1。当前覆盖 64 个工具、69 种结构，JSON Pointer 的两类多态值有明确的目标字段校验例外。它不代替 handler 的跨字段/归属业务检查，也不证明远端模型兼容；完整目录与精确/批量能力见 [工具审查](ai-tool-contract-audit.md)。

## 记忆核心与上下文

记忆 Agent 使用共享 `MEMORY_AGENT_TOOLS`；`finish_memory_review` 可提交实体、事件、声明、角色认知、剧情线和领域回执 packet。工具阶段只写本轮隔离工作区，`conversationMemory/commit.js` 在短同步事务内复核 owner、timeline、消息版本/内容哈希、租约、revision 和先前水位，再一次提交领域变化、规范记录、回执及摘要/索引 outbox。模型调用不跨数据库事务；未结束、失败和过期流程不保留半轮事实，也不启动规则提取回退。

提取工具使用显式的有界数组/item schema，类型错误反馈包含字段路径；不能只声明泛化 `packet: object` 后在最终提交才发现格式不符。finish handler 在封存前校验 schema，并把文本工具的最终投影与模型事件合并校验容量；metadata、置顶、失效和合并来源也计入。最多 3 次 handler 尝试、1 次成功结束，原 8 轮及 90 秒边界保留。schema 拒绝不会封存 session；模型可在剩余轮次修正。prepared 包已通过结构和容量校验，来源归属、引用解析与时间范围等数据库业务语义仍在最终原子提交中复核。验证仅用隔离模型脚本，不代表已实测远端模型质量。

下一轮发送/续写/重生成默认通过后台连续性策略准备：cast 模式完整保留尚未处理的近期原文，受保护部分不会为满足预算被悄悄删除；积压超过配置轮数或窗口不足时在接受输入前报错。显式 blocking 模式和严格 actor 视角仍在加生成锁前等待必要核心。历史明确需要重建时要求恢复/接受状态，不绕过事实缺口。记忆关闭或 auto 无模型采用原文模式，不建立无法完成的记忆任务；明确无必需阶段的可选任务失败不阻塞后续核心，摘要、索引独立调度，派生失败不回滚核心。严格角色视角在所有上下文来源上采取保守过滤，无法标注受众的原文、状态和注入配置关闭或报错；默认 cast 模式不承诺一次多角色调用中的模型认知隔离。

四个工作流字段由共享 `memoryPolicy` 贯穿设置、API、作者默认和 AI 精确编辑：`syncMode` 默认 background，`shortTermTurns` 默认 8（1～32），`autoConsolidate` 默认 true，`statusLink` 默认 false。联动开启时提取器读取更新前权威状态，状态 Agent 读取提取包与原文证据，仍各自遵守权限和原子提交。自动合并按角色、受众、真假和图依赖保守处理，不因文本相似丢掉独立信念/事件。记忆 `update_memory` 支持匹配次数保护的 literal patch；`batch_memory_changes` 复用启用子工具和各自预算，单项结果明确，最终仍统一 finish。场景和世界书的精确/批量操作具有各自原子回滚与恢复重放测试。

记忆 Agent 的 `thinkingLevel` 复用状态栏的供应商解析与思考参数适配：空值跟随选中的供应商，`off` 关闭，其余等级按模型支持范围归一化。提取器不再固定关闭思考；分层摘要使用同一设置，并将有效思考参数加入缓存指纹。作者默认、会话覆盖和恢复继承沿既有附属技能契约处理，工具说明与前端保存一致。该设置控制推理预算，不将模型内部思考当作剧情证据。

`resolvedPromptPipeline.js` 解析 context bundle，`promptPipeline.js` 编译预算后的实际消息。来源清单绑定提交祖先、历史截止、核心水位及配置指纹；预览和评测复用同一编译路径。完整存档使用 snapshot v3，紧凑 checkpoint 只保留记忆提交与水位；v2 兼容读取不能补造缺失的旧知情事件。详细契约见 [对话运行时](conversation.md)。

## 向量记忆运行时

向量默认关闭，需要当前用户明确选择独立的已保存 Provider profile；公开角色导出清除私有绑定、actor ID 及向量启用状态。开启后，选中的剧情文本发送到已配置向量供应商。接口不沿聊天 fallback 链选择任意备用模型，供应商不可用时检索降级为 FTS/词法与实体图。

| 项目 | 当前支持范围 |
| --- | --- |
| 协议与模型 | DashScope 官方 text-embedding API；固定 `qwen3.7-text-embedding-flash`，document/query 分开，query 支持 instruct |
| 向量空间 | 256/512/768/1024 维，默认 1024；provider endpoint、模型、维度、归一化和模板/指令版本共同组成 fingerprint，同名 profile 改内容也不能混查 |
| 地域与价目 | 仅 `cn-beijing`；固定 `dashscope-cn-beijing-sync-2026-11-01` 人民币同步价目，每千输入 tokens ¥0.000125。其他 region 或国际官方端点明确拒绝，不套用北京价格 |
| 配额 | 每次成功 Provider 调用只结算一次；记录原币种、价目版本、ingest/query/rebuild 用途和显式人民币到美元换算率。启用金额限额却没有换算率时，发请求前拒绝 |
| 存储与检索 | 固定 `sqlite-vec 0.1.9` 的原生 vec0；owner/会话/index 分区，eligibility 在 native top-k 前过滤，浮点距离不在请求线程做全表 JS 扫描 |
| 重建 | shadow generation 分批写入、相同内容复用、失败续建；完整后原子切换。保留当前与前一个完整 generation，保留可续建任务，按会话清理更旧索引和向量 |
| 预览 | 只用缓存 query vector，不因打开检查器/轮询新发起付费 embedding；实际生成允许查询，未命中缓存的只读预览显示降级原因 |
| 连接与恢复 | 主运行库、内存库和需要访问向量表的备份/预检/演练连接统一加载固定扩展后关闭后续扩展加载；删除会话级联清理 metadata 与 vec0，迟到响应不能复活来源 |

价目依据：[阿里云同步向量 API](https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api)。供应商调整价格后需更新价目版本和契约，不能把当前常量当作永久报价。

2026-11-01 在 Windows x64、Node 24.16.0 的临时目录复制 backend package/lock 并执行 `npm ci --ignore-scripts`，实际加载固定原生扩展，通过 scoped KNN、权限过滤先于 top-k 及禁止后续 `loadExtension`；独立备份连接有定向回归。Provider 响应采用模拟数据，未调用真实千问模型：真实长篇剧情召回质量、供应商延迟、当前 API 账号权限和线上账单仍需专门验证，不能由原生安装或契约测试结果推断。

## 世界书助手

独立世界书助手与角色 AI 完善助手共用 `worldBooks/worldBookAssistantWorkspace.js`，通过目录检索、按需读取、选书、创建和差量编辑修改内存工作区，返回 `workspace/changes/reply`。生成阶段不自动保存世界书；用户查看后一次应用勾选结果。

### 目标与草稿

- 手选已有书决定默认参考和编辑对象，不影响创建独立新书。未手选时可自主检索并选择；要求更新却找不到目标时说明情况，不擅自改成新建。
- 支持只读讨论、同轮更新 A 并新建 B、多轮续聊；每本书按真实 ID/临时 ref 保存目标、底稿与差量，同名书不能混用身份。
- 角色助手默认使用编辑器当前全部关联选择，包括尚未保存的选择。本次选书不改变长期关联，关闭世界书完善范围后不读取/创建/修改书。
- 无绑定和未保存角色也可创建书；新书先加入编辑器本地关联，保存角色后才正式关联。角色表单参考开关不清除独立世界书上下文。
- 续聊、暂停和重试使用最新未应用草稿，切换目标/角色不串书。可重新读取最新原书、放弃单项草稿；外部目标已删除时也可退出旧草稿继续。
- 已有条目按 ID 做稀疏字段变更，省略字段保留，禁止全量替换丢失未列条目、禁用/不完整条目、ID 或排序。
- 30 条限制用于单批和独立助手本轮新增额度，不截断已有书；80 条书更新第 65 条时其他条目必须完整保留。空书、只改资料和明确删除最后一条均可处理。
- 正文按需读取，目录检索与预览只读。资料工具不能通过额外参数偷带条目替换；触发预览使用同一套世界书规则。

### 事务应用

`POST /api/world-books/apply-changes` 经过 `worldBookService.applyWorldBookChanges`，校验当前用户、书与条目归属、底稿 revision 和选中差量，再以单个事务应用。

- 只写实际差异，保留其他条目、顺序和角色关联；任何写失败整体回滚。
- 目标在生成后被外部修改时返回明确冲突，不静默覆盖；每本书可以重新读取后继续。
- `requestId` 和 `world_book_change_requests` 回执保证保存响应丢失后重试不重复创建书/条目。回执不作为 AI 持久会话。
- 应用成功后更新工作区底稿、列表和关联选择，清除已应用差量，可继续编辑同一书。
- HTTP 局域网环境不能假定 `crypto.randomUUID()` 可用；公共 helper 使用 `crypto.getRandomValues()` 生成请求 ID，同批重试复用。请求准备纳入错误处理，失败保留草稿并恢复按钮。

### Plan、流式与页面

普通模式直接生成差量。Plan 为可选模式：规划阶段不下发业务写工具，使用 `submit_character_plan` / `submit_world_book_plan` 提交步骤；用户勾选、修改或补充后执行，计划绑定原目标和底稿。

执行阶段以批准计划作为范围，工具结果维护 `workflow.plan` 台账。未完成步骤时角色 `finish_character_draft` 返回 `PLAN_STEPS_REMAIN`。独立助手中断后从当前草稿重新规划，避免重放旧底稿；已完成计划收起。

JSON、SSE 和后台 `world-book.assist` 使用同一工作区。流中断保留已收到草稿，重复创建调用不能复制同一草稿；后台任务传递数据库、用户、选书、history、context、thinking 和 plan，不另建保存链路。

界面使用 `WorldBookTargetPicker.vue`、`WorldBookChanges.vue`、`WorldBookAiPanel.vue`；状态在 `useWorldBookAi.js` 与 `useCharacterAiGeneration.js`，底稿更新在 `utils/worldBookWorkspace.js`。常驻新建入口，按书分组展示更新/新建和差异，支持勾选后一次应用；提示共享角色数量和关联生效时间。桌面双栏、手机纵排，长正文和过程详情默认折叠。

### 回归重点

| 范围 | 测试 |
| --- | --- |
| 工作区身份、续聊、同名书、80 条书、只讨论、限额和 SSE 重放 | `worldBookWorkspace.test.js` |
| 唯一写入口、事务回滚、冲突与幂等 | `worldBookArchitecture.test.js`、`worldBookApplyChanges.test.js` |
| 角色关联、范围开关、后台工具契约 | `characterWorldBookTools.test.js`、`worldBookAssistantTools.test.js`、`worldBookJobs.test.js` |
| 缺 randomUUID、保存准备失败和重试 | 前端 world-book 单测、`composables/character/__tests__/` |
| 真实 HTTP 应用、移动端 Plan 与角色面板 | `worldbook-assistant.spec.js`、`ai-plan-review-mobile.spec.js`、`character-ai-panel-drag.spec.js` |

## 连接与故障排查

私网/本地 Provider 同时要求 root 用户和部署开关。生产使用 `ALLOW_PRIVATE_PROVIDER_NETWORK=true`，开发使用 `ALLOW_PRIVATE_PROVIDER_NETWORK_DEV=true`，修改后完整重启后端；生产不读取开发开关。保存、models、health、聊天和后台任务共用策略，旧数据库私网标记不能绕过。

首次 root 初始化推荐 `ROOT_ADMIN_BOOTSTRAP_TOKEN`：仅空用户库可用，成功后公开注册自动关闭。传统用户名/长期密码初始化只有显式 `ALLOW_LEGACY_ROOT_BOOTSTRAP=true` 才启用。

| 症状 | 检查顺序 |
| --- | --- |
| 私网被拒绝 | 确认实际运行进程、环境模式、root 权限与对应开关，排除旧后端未重启；不要放宽普通用户网络权限 |
| schema/required/properties 错误 | 对比本轮原始工具与协议适配结果，检查必填字段确实存在、联合分支未丢；用离线契约测试复现 |
| 没有工具调用或 Agent 未结束 | 核对模型/网关工具能力、tool choice、工具列表、可用轮次和结束工具；合法正文不等于完成业务工具流程 |
| 超时/断流 | 定位连接、HTTP、SSE、单步和整体 deadline；检查队列步骤状态与取消信号，再考虑有界调整，不照抄旧固定超时常量 |
| 重试重复写入/草稿消失 | 检查 requestId、目标 ref、底稿 revision 和 SSE 恢复；区分生成与最终应用，不新增前端逐条保存回滚路径 |
| 模型不可用或费用异常 | 核对选中 profile、路由事件、配额预留与 usage；显式记忆配置故障需修复或切换原文模式，embedding 不使用聊天模型回退；检查 region、价目版本和换算率 |

诊断记录 Provider 类型、模型、轮次、工具名、稳定错误码和 request ID；沿现有脱敏诊断与 trace 收集证据，不把 API Key、Cookie、签名 URL、原始二进制或整段私密会话写入仓库。
