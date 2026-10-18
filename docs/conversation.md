# 对话运行时

本文合并聊天页面、会话可靠性、上下文预算和记忆工具的维护约定。2026-09 的阶段报告已收敛到本文；其中旧的“同步阻塞下一轮”和“自动记忆必须先禁用”约定已被后续实现取代。带日期的测试结果见 [维护记录](maintenance.md#历史验证记录)。

## 消息与页面状态

服务器消息是事实来源。`ChatView` 装配页面和操作锁，`useChatConversation` 按 ID 对齐完整服务端记录；相同内容保留对象引用，变更记录连同已删除字段一起替换。`useChatSubmit` 管理请求及本地生成行，网络增量只更新当前行，`useTypewriterText` 控制可见输出节奏。

`MarkdownContent` 净化内容并复用 DOM；文本、插件和流状态共用 Vue post-flush watcher。`VirtualMessageList` 负责行身份与测量，`useChatScroll` 负责阅读锚点和用户跟随意图。

| 项目 | 约定 |
| --- | --- |
| 虚拟列表 | 超过 80 条启用；本地 ID 转服务端 ID 保留行身份，删除消息清除 alias 与测量缓存 |
| Markdown 缓存 | 最多 200 项、估算 UTF-16 文本 8 MiB、单项 512 KiB；LRU 淘汰，超大内容仍渲染 |
| 流式内容 | 中间前缀净化但不入缓存，终态即使仅流标记变化也缓存；折叠、代码和 KaTeX 走同一路径 |
| 编辑 | 只向正在编辑的行传递编辑内容，避免每次键入刷新全部行 |
| 阅读位置 | 保存消息 ID 和相对偏移；布局就绪后先恢复，再等待辅助请求；三帧稳定或最多 13 次纠偏，用户滚动立即取消 |

`highlightDialogue` 默认开启，仅影响消息正文。高亮在净化后的文本节点中处理完整引号对，支持多行和嵌套，不改变存储内容、HTML 属性或缓存；代码、数学和折叠标题不参与，流中未闭合引号保留普通文本。明暗主题使用独立 `--chat-dialogue-color`。

### 草稿与互斥

- 草稿存于 `sessionStorage` 的 `flai-chat-drafts:v1`，按用户和会话隔离；250 ms 防抖，在切页、隐藏和清理时刷新，提交/清空后立即移除。
- 最多保留 20 份、七天、序列化 UTF-16 512 Ki；不保存附件或图片 data URL。超大提示不会被截断，存储被拒绝或超限时提示未缓存。
- 发送在首个 `nextTick` 前加锁。`sending` 表示可见生成，`requestPending` 直到取消及持久记录对齐结束才释放；停止后不能立刻启动重叠请求。
- 加载、编辑、消息修改、分支和候选生成互斥；复制与阅读仍可用。旧 route/unmount 回调通过 token 拒绝。
- 候选失败保留当前版本、释放锁并提示；首次载入失败显示重试，不伪装空会话。大历史目前仍整批读取，服务器分页尚未包含在该优化中。

## 时间线、快照与后台处理

Snapshot v2 包含会话拥有的状态、消息/候选和相关子表；角色卡、Provider 凭据、全局设置和二进制素材不属于快照，素材只存 URL 引用。

- 恢复在一个事务内完成，验证外键，失败保留原会话。旧存档缺失派生状态时清空该部分并返回 partial 警告。
- 分支按字段语义重映射本地 ID 和结构化引用，不替换任意故事文本。历史分支只能使用对应 checkpoint，不能继承后来经济/场景状态；无匹配 checkpoint 时明确标为 partial。
- 编辑、删除、截断和候选变化更新历史 revision，失效旧任务及回调，按需要恢复前一 checkpoint。多轮历史重建需要用户确认，也可接受当前状态为新基线。
- 回复保存与后处理入队原子完成。`services/jobs/` 的持久 worker 按会话串行，不同会话可并行；模型请求不放进 SQLite 事务。
- 每步保留 before-state、租约、来源 revision 和执行记录。活动步骤中断后回滚未完成写入，重试复用已完成步骤；取消不退还已产生的模型费用。
- 正常聊天可与后台同步重叠；同步完成只刷新状态面板，不替换消息列表或流式草稿。手工状态变更仍互斥。
- 某轮失败或取消不阻塞后续排队轮次；有效步骤结果保留，失败步骤可恢复。后续任务已开始后不能重试旧快照覆盖新状态，需显式重建。
- 非世界书步骤回滚保留当前触发时钟；pending 快照不能当作完整历史 checkpoint。滞后时提示词明确让较新叙事优先于旧派生状态。

### 重新生成与保留策略

`POST /api/conversations/:id/messages/:messageId/regenerate` 支持 JSON/SSE，原地重生成最后一条 assistant，旧文本成为候选；恢复前一 checkpoint 并重排后处理，不额外生成 recovery save。候选箭头超过末项会真实生成。

`POST /api/conversations/:id/messages/truncate` 一次删除整段尾部；编辑后重跑只保留一份恢复点并取消一轮旧任务。

0018 的 `saves.kind` 区分自动恢复与手工存档。`conversationRetention.js` 按 `CONVERSATION_RECOVERY_SAVE_LIMIT` 保留恢复点，按 `CONVERSATION_STALE_JOB_STEP_DAYS` 清理已结束/过时任务的快照和 pending checkpoint。启动和新增恢复点时清理，不能移除仍被活动或可重试任务需要的数据。切换候选不再新建恢复点，存档面板默认折叠它们。

## 提示词与上下文预算

`promptPipeline.js` 将导演、角色、预设、世界书条目、状态、记忆和 Mod 分为独立消息；内部来源元数据在发给 Provider 前移除。最终 `messages` 是实际发送依据，预览候选正文并不表示已全部保留。

`GET/PUT /api/conversations/:id/context/budget` 只接受正整数覆盖值，null 清除覆盖：

- 默认对话分配 16384 tokens、预留输出 4096、每图估算 1024；预设/Provider 提供输出默认值，会话预留优先。Anthropic 思考预算归一化后，输入检查与出站请求使用同一预留。
- 对话分配计算历史、当前输入及对话图片；角色、预设、世界书、记忆、状态、Mod 和工具另计。显式物理模型窗口仍包含全部输入和预留输出。
- 模型窗口绑定服务端选中的 Provider/model，切换后忽略旧窗口并警告，不能猜测模型上限。所有 token 数均为估计，不代表供应商 tokenizer。
- 先移除最老完整轮次，保留最新完整轮次及输入，不让注入的 lore 拆散 user/assistant。系统段只在确实存在的物理窗口约束下裁剪。
- 系统可选来源按优先级逐项移除：Mod、普通记忆、旧轮次、状态、世界书等；同级后项先移除，受保护的角色/导演/预设和当前实际输入保持完整。优先级和系统/对话分配共同生效，不能机械套用旧总字符预算。
- 不截成半段指令或输入。不可避免的对话/物理窗口溢出返回 `CONTEXT_BUDGET_EXCEEDED`、`accepted: false`，在保存本轮用户消息之前拒绝；草稿和附件可恢复。旧字符上限仅作用于对话分配。

被裁掉的相关旧消息仍可作为有界引用证据召回。记忆检索将近期候选与全文 FTS 命中结合，按相关性、置信度和时效排序；中文检索补充分段词。旧实现的 200 条近期/100 条 FTS 候选与最多 24 条完整记忆是有界词法检索，不是 embeddings 或语义事实验证，参数以当前实现为准。

### 世界书触发与扩展

- 每本书使用自己的扫描深度，除非调用方显式覆盖。真实会话只使用 `conversation_world_book_clock/state`，预览只读，不消耗其他会话的激活窗口。
- sticky/cooldown/delay、删除级联和快照恢复保持会话隔离。只有最终提示词保留的条目提交激活状态；超大条目跳过后仍尝试后续条目。
- 深度位置按原始消息尾计算；相同深度保留顺序与角色，before/after-character 等位置实际生效，注入内容明确标记为 lore。
- Mod 沿用加载范围和顺序，跳过空白、关闭和重复 ID，每条指令完整保留/移除；风格 Mod 不修改人物或世界事实。
- 自定义脚本在隔离 sandbox 中执行。清理回调/返回函数留在 frame 内，逆序、幂等、有超时地清理；需要清理时 frame 保持存活，结束后移除，函数和 DOM 不跨 `postMessage`。

## 实际请求追踪

`GET /api/conversations/:id/context/traces` 列出逻辑生成，`/:traceId` 返回逻辑消息、来源选择、预算和构造的 wire request。预览页是新的 dry-run，不能当历史证据。

每次传输记录序号、redirect/auth fallback、body hash、净化 body、HTTP 结果和估算成本；不存 Header、原始响应、凭据或内联二进制。超过 250000 字符明确标记截断，去除 URL 敏感值后保留普通文本；Responses 继承服务端上下文时标记估算覆盖不全。Mock 不产生真实 wire request。

状态区分 completed、empty、failed、partial、cancelled、stale、进程中断。`response_received` 只表示 HTTP 响应到达；trace 观察失败不能破坏有效响应。启动标记未结束记录为 interrupted，历史 trace 留在原会话，时间线变化标为过时。

## 会话记忆与工具

`conversationMemoryAgent.js` 在 `memoryAgent` 为 auto/on 且模型可用时执行工具驱动审查，停用、不可用或失败时回退规则提取。用户已完成动作和双方叙事可作证据；计划、假设、请求不能偷偷升级为完成事实。自动记忆可启用，显式禁用、归档、失效、合并与手工控制仍受尊重。

来源 ID 必须属于本轮观察消息，缺失来源不能借用另一说话者。逐字引文置信度上限为 1、概述 0.6、无引文 0.5。正文变化需本轮来源，元数据调整不能绕过置信度规则。主生成读取记忆作为连续性证据，不视为所有角色都知道的事实或改写状态的授权。

工具设置和模型描述共用 `MEMORY_AGENT_TOOLS`。通用执行器验证参数，处理函数验证归属、revision、状态和来源：

| 工具 | 参数、每轮上限与保护 |
| --- | --- |
| `search_memories` | query/type 可选，默认排除归档；limit 1–20、默认 8；每轮 6 次。total 为匹配数，返回完整正文，初始简表标注 contentTruncated |
| `search_history` | 非空 query；limit 1–10、默认 5；每轮 4 次。返回非 observation 保存消息片段，最长 400 字；过滤本轮消息，不承诺自动排除后来保存消息，不能替代本轮证据 |
| `record_memory` | 八种 memoryType，content 非空且 ≤600 字，本轮 sourceMessageId 必填；每轮 12 次；quote 可选，按证据限制置信度 |
| `update_memory` | memoryId/revision 必填；目标不能置顶/归档；省略字段保留；每轮 8 次。正文变化需新来源，无变化返回原记录 |
| `merge_memories` | targetId/revision，1–8 个唯一来源及 revision；每轮 4 次。拒绝自合并、重复、置顶/归档目标及来源；省略 content 保留目标；同一事实的语义仍依赖模型判断 |
| `invalidate_memory` | 默认关闭；ID/revision、非空 reason 和本轮来源必填，quote 可选；每轮 6 次；保护置顶/归档，保存审查依据 |
| `pin_memory` | 默认关闭；ID/revision 必填，pinned 默认 true；每轮 4 次；归档不能借此恢复，置顶优先但仍受总预算约束 |
| `finish_memory_review` | 必须结束，每轮 1 次；summary 可选且 ≤300 字。未结束返回 `MEMORY_AGENT_INCOMPLETE`，保留成功操作并走回退 |

批量审查、合并和撤销检查 revision；撤销只能在无后续修改时精确恢复。分支重映射审查记录内的 message/memory ID。中断重试刷新最新 revision 和已执行调用，失败回退保留 updated/merged/invalidated/pinned/rejected 信息；写入后刷新去重索引。

附属技能由 `accessorySkillProvider.js` 解析主聊天设置或保存的 Provider profile，可覆盖 model；缺失、不可用或策略拒绝的 profile 回退主设置并提示。

## 回归入口

| 范围 | 现有覆盖 |
| --- | --- |
| 时间线、恢复、分支、后台租约和旧回调 | `conversationTimeline.test.js`、`conversation-timeline.spec.js` |
| 上下文选取、轮次配对与预算 | `aiContextUpgrade.test.js`、`promptBudgetPairing.test.js`、`promptTokenBudget.test.js` |
| JSON/SSE 请求追踪、归属与脱敏 | `conversationStreamingRoutes.test.js`、`conversationContextQualityRoutes.test.js` |
| 记忆来源、审查、Agent 与回退 | `conversationMemoryExtraction.test.js`、`conversationMemoryReview.test.js`、`conversationMemoryAgent.test.js` |
| lore 状态与迁移 | `worldBookSessionState.test.js`、`migrationLedger.test.js` |
| 页面滚动、草稿、渲染与互斥 | 前端 `useChatDraft.test.js`、`components/__tests__/`、`utils/__tests__/` 与聊天 E2E；后端 `frontendChat*.test.js` 契约 |

`npm --prefix backend run evaluate:context` 是内存固定契约评估，不是在线语义质量或真实模型延迟评测。历史上通过的固定样例不应被表述为当前全量测试已经通过；当前已知失败见 [维护记录](maintenance.md#历史验证记录)。
