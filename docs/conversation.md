# 对话运行时

本文合并聊天页面、会话可靠性、上下文预算和记忆工具的维护约定，2026-11-01 已按会话记忆升级更新。核心提交按序执行，默认 cast 生成通过受保护的短期原文允许有界滞后；严格角色视角仍等待必要核心，摘要与向量独立派生。带日期的测试结果见 [维护记录](maintenance.md#历史验证记录)。

## 消息与页面状态

服务器消息是叙事来源，结构化事实还需通过证据和提交验证。`ChatView` 装配页面和操作锁，`useChatConversation` 按 ID 对齐完整服务端记录；相同内容保留对象引用，变更记录连同已删除字段一起替换。`useChatSubmit` 管理请求及本地生成行，网络增量只更新当前行；流式节奏由 `MarkdownContent` 合并频繁增量并协调 DOM，旧逐字队列已移除。

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

完整 Snapshot v3 包含会话拥有的状态、消息/候选、规范记忆及来源证据；兼容读取 v2 并保守重建其记忆投影，不补造旧角色知情过程。每轮 compact checkpoint 只保存记忆提交、水位和视图位置，不逐轮复制全事件日志。角色卡、Provider 凭据、全局设置和二进制素材不属于快照，素材只存 URL 引用；向量索引为派生数据，恢复后重建。

- 恢复在一个事务内完成，验证外键，失败保留原会话。旧存档缺失派生状态时清空该部分并返回 partial 警告。
- 分支按字段语义重映射本地 ID 和结构化引用，不替换任意故事文本。历史分支只能复制对应 checkpoint 的提交祖先及证据闭包，不能继承后来认知、剧情线或经济/场景状态；无匹配 checkpoint 时明确标为 partial。历史预览使用独立只读状态投影，不改当前时间线。
- 编辑、删除、截断和候选变化更新历史 revision，失效旧任务及回调，按需要恢复前一 checkpoint。多轮历史重建需要用户确认，也可接受当前状态为新基线。
- 回复保存与核心后处理入队原子完成。`services/jobs/` 按 owner、conversation、timeline 和 stage 保存明确范围；串行键仅决定调度。核心按会话有序，摘要/索引独立排队，不同会话可并行；模型请求不放进 SQLite 事务。
- 记忆工具先生成隔离提案，领域 Agent 在独立规划副本上操作；模型调用完成后，在同一个短同步事务复核租约、来源 revision 与先前水位，提交规范记录、领域变更、回执和派生 outbox。失败不保留半轮事实；重试不能用旧整会话快照覆盖较新核心。
- 本轮回复可先展示，记忆默认在后台按顺序处理。`memoryPolicy.syncMode=background` 时，普通 cast 视角的下一次发送、续写或重生成无需等待前几轮整理；服务端把所有尚未入库轮次及对应用户原文作为受预算保护的短期连续性带入实际请求，默认最多 8 轮，可设 1～32 轮。不能静默裁掉这部分剧情；容量超限返回 `MEMORY_SHORT_TERM_CAPACITY`，模型窗口不足沿原预算错误返回 `accepted:false`，草稿和附件保留。状态区/摘要可能稍晚，主模型按近期原文处理后续剧情，不能把旧面板值当成新结果。
- `syncMode=blocking` 或严格 actor 知情视角仍在取得生成锁和写入用户消息之前等待必要核心，默认 15 秒，可配置 1～60 秒。严格视角不能为避免等待而注入未经受众标注的原文。失败/超时返回 `MEMORY_CORE_FAILED` / `MEMORY_CORE_PENDING`；历史已修改且要求重建的状态仍需明确恢复，不通过后台策略绕过。
- 必需核心失败或取消形成待修复缺口，后续核心不得跳过水位；明确 `requiredStages: []` 的可选原文任务失败不形成串行缺口，缺少该字段的旧任务仍保守视为必需。摘要/向量失败只影响自己的输出和阶段状态，不阻塞核心已就绪的下一轮。记忆关闭或 auto 无可用模型采用原文模式，不制造无法完成的记忆核心任务；其他已启用领域技能仍按依赖同步。
- 前轮依赖检查在模型调用前与原子提交时复用同一规则：当前时间线、当前消息版本的核心任务优先于消息旧标记，真实 queued/running 和必需 failed/cancelled 仍阻挡；显式可选任务的终态失败不构成记忆缺口。没有对应任务时，仅对当前选中提交链中已完成轮次或明确接受基线以外的未完成消息标记保守拦截；bootstrap 开场基线和人工修订本身不代表该轮抽取完成，旧分支的后续提交也不扩大当前覆盖范围。
- 同步完成只刷新状态面板，不替换消息列表或流式草稿。pending 快照不能当完整历史 checkpoint；接受当前状态建立 `adopted_baseline`，明确此前历史未被完整提取。取消不退还已产生的模型费用。

`GET /api/conversations/:id/processing` 在顶层返回 `coreReady`、核心计数、`requiredStages` 和 `stages`，同时保留原 `job` 汇总。聊天不显示正常排队/运行的构建横幅，组件继续轮询并在完成后刷新状态面板；异常只显示简短入口。详细核心、摘要、索引及重试/重建操作在记忆工作台的“同步与恢复”查看。已有汇总明确要求重建时，生成前置检查返回 `CONVERSATION_STATE_REBUILD_REQUIRED` 和 `accepted:false`，不等待不存在的工作。

`POST /api/conversations/:id/processing/rebuild` 先返回需确认的 `turnCount`；确认时界面提交 `expectedTurnCount`，轮数变化会在修改状态或入队前返回 `CONVERSATION_REBUILD_PREVIEW_STALE`。真实零轮不启动重建模型调用。恢复检查点不能跨过失败/取消的必需来源；首次开场 bootstrap 可保留初始状态，但开场提取仍必须重放。没有可信检查点时断开当前记忆水位，保留不可变日志，避免把后来事实带回重建起点。

### 重新生成与保留策略

`POST /api/conversations/:id/messages/:messageId/regenerate` 支持 JSON/SSE，原地重生成最后一条 assistant，旧文本成为候选；恢复前一 checkpoint 并重排后处理，不额外生成 recovery save。候选箭头超过末项会真实生成。

`POST /api/conversations/:id/messages/truncate` 一次删除整段尾部；编辑后重跑只保留一份恢复点并取消一轮旧任务。

### DeepSeek 联网模式

聊天响应模式中的联网开关仅对 DeepSeek Provider 显示，默认关闭，并将偏好保存在当前浏览器。开启后，模型可按需通过服务端工具调用 DeepSeek Search 与 Fetch API；每轮最多搜索两次、抓取三篇页面，查询词最多 128 个字符，搜索摘要和网页正文会在加入模型上下文前截断。Fetch 仅接受本轮 Search 返回的 HTTP/HTTPS 链接。关闭开关或使用其他 Provider 时不附加联网工具，也不会请求 Search/Fetch。

DeepSeek 官方文档注明 Search 和 Fetch 分别按每千次成功调用 ¥5 计费，自北京时间 2026-11-01 00:00 起执行，且费用由 API 账号承担。详见 [DeepSeek Search API](https://api-docs.deepseek.com/zh-cn/guides/search)。

0018 的 `saves.kind` 区分自动恢复与手工存档。`conversationRetention.js` 按 `CONVERSATION_RECOVERY_SAVE_LIMIT` 保留恢复点，按 `CONVERSATION_STALE_JOB_STEP_DAYS` 清理已结束/过时任务的快照和 pending checkpoint。启动和新增恢复点时清理，不能移除仍被活动或可重试任务需要的数据。切换候选不再新建恢复点，存档面板默认折叠它们。

## 提示词与上下文预算

`resolvedPromptPipeline.js` 先异步解析带 owner、会话、提交、水位、历史截止和配置指纹的 context bundle，再由 `promptPipeline.js` 编译导演、角色、预设、世界书条目、状态、记忆和 Mod。生成、预览与评测复用同一选择规则；内部来源元数据在发给 Provider 前移除。最终 `messages` 是实际发送依据，预览候选正文并不表示已全部保留。

`GET/PUT /api/conversations/:id/context/budget` 只接受正整数覆盖值，null 清除覆盖：

- 默认对话分配 16384 tokens、预留输出 4096、每图估算 1024；预设/Provider 提供输出默认值，会话预留优先。Anthropic 思考预算归一化后，输入检查与出站请求使用同一预留。
- 对话分配计算历史、当前输入及对话图片；角色、预设、世界书、记忆、状态、Mod 和工具另计，但全部来源仍参与最终模型窗口检查。窗口未知时采用记忆策略的保守总上限（默认 32768 tokens），扣除输出预留，不默认无限上下文。
- 模型窗口绑定服务端选中的 Provider/model，切换后忽略旧窗口并警告，不能猜测模型上限。所有 token 数均为估计，不代表供应商 tokenizer。
- 先移除最老完整轮次，保留最新完整轮次及输入，不让注入的 lore 拆散 user/assistant。随后按显式模型窗口或未知窗口的保守上限检查全部来源，必要时裁剪可选系统段。
- 系统可选来源按优先级逐项移除：Mod、普通记忆、旧轮次、状态、世界书等；同级后项先移除，受保护的角色/导演/预设和当前实际输入保持完整。优先级和系统/对话分配共同生效，不能机械套用旧总字符预算。
- 不截成半段指令或输入。不可避免的对话/物理窗口溢出返回 `CONTEXT_BUDGET_EXCEEDED`、`accepted: false`，在保存本轮用户消息之前拒绝；草稿和附件可恢复。旧字符上限仅作用于对话分配。

记忆检索结合近期事件、FTS/中文词法、实体关系图和可选向量通道，经统一来源版本、生命周期、提交祖先、历史截止及角色知情过滤后排序，并按预算选择完整条目。摘要保留事件依赖和 source hash；依赖过期不能继续注入。向量相似度只发现候选，不证明事实成立或角色知情。关闭/失败的向量通道降级为词法与图检索。

严格 `actor` 视角需要有效会话角色：普通原文历史、作者摘要、未经受众标注的角色正文、预设、Mod、状态/场景/经济/天赋上下文不进入该视角；世界书只保留公共或匹配 cast key 的条目，记忆使用该角色可知内容及其错误信念。无法安全判定的来源关闭，缺角色或不安全的 Provider 继承上下文配置明确报错。默认 `cast` 视角保留叙事导演的多角色信息；不能把一次多角色模型调用解释为各角色认知彼此隔离。

### 世界书触发与扩展

- 每本书使用自己的扫描深度，除非调用方显式覆盖。真实会话只使用 `conversation_world_book_clock/state`，预览只读，不消耗其他会话的激活窗口。
- sticky/cooldown/delay、删除级联和快照恢复保持会话隔离。只有最终提示词保留的条目提交激活状态；超大条目跳过后仍尝试后续条目。
- 深度位置按原始消息尾计算；相同深度保留顺序与角色，before/after-character 等位置实际生效，注入内容明确标记为 lore。
- Mod 沿用加载范围和顺序，跳过空白、关闭和重复 ID，每条指令完整保留/移除；风格 Mod 不修改人物或世界事实。
- 自定义脚本在隔离 sandbox 中执行。清理回调/返回函数留在 frame 内，逆序、幂等、有超时地清理；需要清理时 frame 保持存活，结束后移除，函数和 DOM 不跨 `postMessage`。

## 实际请求追踪

`GET /api/conversations/:id/context/traces` 列出逻辑生成，`/:traceId` 返回逻辑消息、来源选择、预算和构造的 wire request。预览页是新的 dry-run，不能当历史证据。

每次传输记录序号、redirect/auth fallback、body hash、净化 body、HTTP 结果和估算成本；不存 Header、原始响应、凭据或内联二进制。超过 250000 字符明确标记截断，去除 URL 敏感值后保留普通文本；Responses 继承服务端上下文时标记估算覆盖不全。Mock 不产生真实 wire request。

状态区分 completed、empty、failed、partial、cancelled、stale、进程中断。`response_received` 只表示 HTTP 响应到达；trace 观察失败不能破坏有效响应。启动标记未结束记录为 interrupted，历史 trace 留在原会话；人工记忆修订、时间线或上下文指纹变化会影响当前可重现性，历史实际请求仍保留。dry-run 不推进世界书状态，也不会为打开预览或轮询状态新发起付费 query embedding。

## 会话记忆与工具

`conversationMemoryAgent.js` 在 `memoryAgent` 为 auto/on 且模型可用时执行工具驱动审查。关闭、显式原文模式或 auto 无模型采用原文连续性；显式开启却配置不可用时报错。模型失败保留可重试核心失败，不再调用规则提取器。用户已完成动作和双方叙事可作证据；计划、假设、请求不能升级为完成事实。候选、已接受、替代和拒绝是显式生命周期；置顶、归档、事实真假和角色知情分别记录，所有召回通道共用 eligibility。

工具写操作只修改本轮隔离工作区；`finish_memory_review` 的 optional `packet` 可包含实体、事件、时间性声明、角色认知、剧情线与领域回执。模型契约由 `domain/conversationMemory/extractionSchema.js` 定义，六类集合均为有条数和字段限制的对象数组，不能返回按 ID 索引的对象。类型、容量和服务端保留字段在结束前校验；失败反馈给模型修正，不封存、不写正式记忆，也不继续领域规划。成功结束后返回已校验的合并提取包，`commitMemoryPacket` 在最终事务中复核来源、引用归属、时间范围等业务语义并一次提交。人工编辑、批量审查、合并与撤销沿已有 API 进入同事务规范修订，旧文本投影不构成另一个事实写入口。

记忆工作台默认按角色查看“记忆、事件、关系、物品”；角色来自当前规范实体，剧情新角色不需要创建独立角色卡。作者按角色查看与严格角色知情视角分别传参，不可混用。名称或别名用于搜索，关联用实体 ID，不按正文子串猜角色。实体登记有明确 `castKey` 时只复用该身份，不因同名合并其他角色；明确 ID 与身份标识冲突时拒绝整包。物品只由明确持有关系及有效领域回执展示；场景物品数量沿权威记录读取，历史回看读取对应检查点，不能复制一个并行背包账本。角色 API、分页、精确修订和批量契约见 [角色档案接口](memory-actor-workbench-api.md)。原有人工编辑保留在“全部记忆”，纯文本/置顶修订保留原关系、角色认知、剧情线与领域引用；删除/失效不复活这些事实，涉及结构化图的合并或语义范围变更要求明确修订。

`autoConsolidate` 控制模型整理时的自动合并压缩，默认开启，并作为界面的唯一合并开关。开启时使用已有暂存/版本校验工具，合并同角色、同受众、同真假及兼容语义的重复文本。服务端还核对规范实体 ID、事件类型、剧情时间、地点和参与者，不能借同名或重标主体跨范围合并；新暂存记录与旧规范记录混合时，因范围尚未确认而拒绝合并。历史压缩和链式合并保留各来源证据，逐一复核版本与内容哈希。置顶记忆及带独立图关联的记录不自动合并，派生摘要承担跨事件压缩。关闭时不下发 `merge_memories`，批量工具也不能绕过。它不承诺每轮一定合并，也不会在没有重复时创建额外收费任务。

`statusLink` 默认关闭。开启后，记忆 Agent 可读权威的更新前状态字段作为参考；状态 Agent 同时收到本轮原文证据和已验证提取包，从同一事实解释规划更新。各自开关、模型和工具权限仍独立，联动不会自动开启状态 Agent；记忆中的计划/信念不能直接变成状态值，最后仍由同一核心事务接受领域变更。

实体上限 80，合并事件上限 80；文本记忆的新建、修订、置顶、失效和合并来源等最终投影均计入事件容量，同一记忆只计一次。事件 key 必须唯一，`projection:` 前缀由服务端保留。来源版本、操作提案、消息锚点、提交键和版本号由服务端生成，模型不能自行提供或覆盖。非法集合不自动转换为空数组，也不通过提高条数上限掩盖格式问题。

来源 ID 必须属于本轮观察消息，缺失来源不能借用另一说话者。逐字引文置信度上限为 1、概述 0.6、无引文 0.5。正文变化需本轮来源，元数据调整不能绕过置信度规则。主生成读取记忆作为连续性证据，不视为所有角色都知道的事实或改写状态的授权。

工具设置和模型描述共用 `MEMORY_AGENT_TOOLS`。通用执行器验证参数，处理函数验证归属、revision、状态和来源：

| 工具 | 参数、每轮上限与保护 |
| --- | --- |
| `search_memories` | query/type 可选，默认排除归档；limit 1–20、默认 8；每轮 6 次。total 为匹配数，返回完整正文，初始简表标注 contentTruncated |
| `search_history` | 非空 query；limit 1–10、默认 5；每轮 4 次。返回非 observation 保存消息片段，最长 400 字；过滤本轮消息，不承诺自动排除后来保存消息，不能替代本轮证据 |
| `record_memory` | 八种 memoryType，content 非空且 ≤600 字，本轮 sourceMessageId 必填；每轮 12 次；quote 可选，按证据限制置信度 |
| `update_memory` | memoryId/revision 必填；目标不能置顶/归档；省略字段保留；每轮 8 次。可给 content 或 search/replacement 精确修改，匹配次数须等于 expectedOccurrences（默认 1），正文变化需新来源，无变化返回原记录 |
| `merge_memories` | targetId/revision，1–8 个唯一来源及 revision；每轮 4 次。拒绝自合并、重复、置顶/归档目标及来源；省略 content 保留目标；同一事实的语义仍依赖模型判断 |
| `invalidate_memory` | 默认关闭；ID/revision、非空 reason 和本轮来源必填，quote 可选；每轮 6 次；保护置顶/归档，保存审查依据 |
| `pin_memory` | 默认关闭；ID/revision 必填，pinned 默认 true；每轮 4 次；归档不能借此恢复，置顶优先但仍受总预算约束 |
| `batch_memory_changes` | 每轮 3 次，每次 1～12 项顺序暂存；子工具仍检查自身权限、次数、revision 和证据。逐项返回结果，成功项不可重复执行，失败项可纠正；最后统一 finish 提交，不能嵌套批量或结束调用 |
| `finish_memory_review` | 必须成功结束一次；handler 最多 3 次尝试，summary 可选且 ≤300 字。格式或合并容量失败可在原工具循环内修正，未通过前不封存；第三次 handler 失败停止。schema 在 handler 前拒绝的调用仍受原 8 轮循环限制。未结束返回 `MEMORY_AGENT_INCOMPLETE` 或最近的 `MEMORY_PACKET_INVALID`，本轮暂存操作不写入正式状态 |

批量审查、合并和撤销检查 revision；撤销只能在无后续修改时精确恢复。分支重映射审查记录内的 message/memory ID。证据引用保留可校验的消息原文/附件元数据版本；编辑最后一轮只让相关来源失效，不按 timeline 数字相等抹掉全部旧记忆。角色认知与剧情线状态采用追加修订，回看或恢复按所选提交祖先读取，不能泄漏被丢弃未来。

同一轮对同一记忆只能选择工具修订或显式 `packet.events` 替代其中一种路径，不能重复替代同一记忆。`finish` 返回可纠正的 `MEMORY_REVISION_PATH_CONFLICT` / `MEMORY_REVISION_TARGET_CONFLICT`；模型可保留工具提案并移除重复 packet 事件后再次结束。最终提交独立复核并原子回滚冲突，防止出现两个 active 版本或丢掉本轮置顶结果。

附属技能由 `accessorySkillProvider.js` 解析主聊天设置或保存的 Provider profile，可覆盖 model。记忆设置的“思考等级”与状态栏共用 `thinkingLevel`：空值跟随所选供应商，`off` 明确关闭，支持 `minimal/low/medium/high/xhigh/max`，实际按模型能力适配。作者默认、会话覆盖、恢复继承与导入导出保留该值；提取和派生摘要统一使用，摘要缓存指纹区分思考配置。显式记忆配置故障不能静默变成成功；embedding 单独选择当前用户保存的配置，不回退聊天模型。向量默认关闭，开启会把选中剧情文本发往已配置供应商，当前模型、地域、计费和实测边界见 [AI 运行时](ai-runtime.md#向量记忆运行时)。

## 回归入口

| 范围 | 现有覆盖 |
| --- | --- |
| 时间线、恢复、分支、后台租约和旧回调 | `conversationTimeline.test.js`、`conversation-timeline.spec.js` |
| 已登记旧库投影升级、失败开场恢复和确认范围 | `memoryProjectionUpgrade.test.js`、`memoryRecovery.test.js`、`chatProcessingStatus.test.js`、`memory-rebuild-recovery.spec.js` |
| 上下文选取、轮次配对与预算 | `aiContextUpgrade.test.js`、`promptBudgetPairing.test.js`、`promptTokenBudget.test.js` |
| JSON/SSE 请求追踪、归属与脱敏 | `conversationStreamingRoutes.test.js`、`conversationContextQualityRoutes.test.js` |
| 规范提交、来源、审查、角色知情与原文模式 | `conversationMemoryV1.test.js`、`memoryIntegrationV1.test.js`、`conversationMemoryReview.test.js`、`conversationMemoryAgent.test.js` |
| 提取数组协议、同轮纠正、合并投影容量及无半写入 | `memoryPacketContracts.test.js`、`conversationMemoryAgent.test.js`、`memoryPacketPostprocessing.test.js` |
| 角色档案、持有关系、同名/分支/历史隔离与编辑保留关联 | `memoryActors.test.js`、`memory-character-workflow.spec.js` |
| 后台短期桥、预算保护、同步/联动/整理策略 | `memoryBackgroundWorkflow.test.js`、`conversationMemoryAgent.test.js`、`accessoryAgents.test.js` |
| 历史压缩证据、合并范围、修订关联与思考等级 | `memoryConsolidationEvidence.test.js`、`memoryConsolidationScopes.test.js`、`memoryAgentRevisionIntegrity.test.js`、`memoryAgentThinking.test.js` |
| 同轮修订路径冲突、同名角色身份与知情隔离 | `memoryRevisionOverlap.test.js`、`memoryEntityIdentity.test.js` |
| 向量、独立连接、计费及空间/导出隔离 | `memoryEmbeddings.test.js`、`memoryOperations.test.js` |
| 历史投影与受限世界书 | `projectedContext.test.js`、`memoryPolicyAndLoreScope.test.js` |
| lore 状态与迁移 | `worldBookSessionState.test.js`、`migrationLedger.test.js` |
| 页面滚动、草稿、渲染与互斥 | 前端 `useChatDraft.test.js`、`components/__tests__/`、`utils/__tests__/` 与聊天 E2E；后端 `frontendChat*.test.js` 契约 |

`npm --prefix backend run evaluate:context` 是内存固定契约评估，不是在线语义质量或真实模型延迟评测。历史上通过的固定样例不应被表述为当前全量测试已经通过；当前已知失败见 [维护记录](maintenance.md#历史验证记录)。
