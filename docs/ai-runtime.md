# AI 运行时与世界书助手

本文集中维护 Provider、工具执行、作者助手和连接诊断，替代早期多份工具优化完成报告。供应商适配以代码与契约测试为依据，不对全部模型或网关作兼容性保证。

## 调用入口与协议

`backend/src/services/providers.js` 是模型调用门面，连接配额、网络策略、超时、重试预算、熔断和任务路由；业务不要自行新建 Provider HTTP 调用路径。主聊天、流式、工具轮次和生图均需按当前用户记录 usage、预算预留与结算。

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
- 新工具优先复用同领域定义和 handler，避免提示词、设置列表、工具描述维护不同副本。普通工具型副作用仍经既有业务服务；作者助手只修改草稿。

`toolSchemaOptimizer.js` 提供 `optimizeToolSchema`、`optimizeTool`、`optimizeTools`、`createTool` 和结构检查 helper；只做 schema 规范化，不证明任何远端模型实现了所有特性。

`node backend/src/services/validate-tools.js` 是源码启发式诊断，可能漏报/误报，不能替代 `aiToolContracts.test.js`、`providers.test.js` 和各助手行为测试。旧报告中的固定行号、模型列表、零开销说法和全兼容矩阵不再作为维护依据。

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
| 模型不可用或费用异常 | 核对选中 profile、路由事件、配额预留与 usage；附属技能回退主模型时查看提示 |

诊断记录 Provider 类型、模型、轮次、工具名、稳定错误码和 request ID；沿现有脱敏诊断与 trace 收集证据，不把 API Key、Cookie、签名 URL、原始二进制或整段私密会话写入仓库。
