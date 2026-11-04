# 会话记忆 V1 改动关联检测与处理清单

日期：2026-11-01。关联主方案：[Conversation Memory V1 Plan](conversation-memory-v1-plan.md)。

## 目标与本次边界

检查完整记忆 V1 在本项目中的依赖传播，明确必须同批修改的入口、数据、后台任务、配置、界面和测试，避免只改主链后留下旧写入口或失效的消费者。

关联检测阶段的处理结果限于方案与 Markdown。2026-11-01 用户随后明确授权创建任务目标并开始完整 V1 实现；执行状态以主方案的 Implementation Execution 为准。检测阶段的静态发现不等于已复现或已修复，运行数据库、上传目录与环境文件仍不属于修改范围。

验收标准：每个直接影响项必须有源码依据、处理规则和关联验收；主方案必须同步吸收关键约束；现有未提交工作保持原样。

## 检测基线与方法

- Git HEAD：`5e10b20ae691fdee5fb60741efac6e8ad3ea06e5`。
- 首次关联检测时工作区有 69 个已修改路径、2 个已删除路径、11 个未跟踪路径，共 82 个；其中包含本对话已经创建的主方案。
- 依据当前工作区源码及相对 HEAD 的未提交差异，不把 HEAD 旧实现当成唯一事实。
- 追踪静态 import、函数调用、SQL 表引用、任务类型和串行键、快照字段、共享契约、前端 API、配置归一化、导出清单和测试引用。
- 以文件内容哈希保留检测开始时的工作区基线；文档更新完成后对照，确认本次只修改两个方案文档。
- 行号用于本次定位；后续实施以前应重新搜索函数名和调用者，不能依赖行号永久稳定。

## 已有未提交改动的交集

| 交集 | 本次看到的已有改动 | V1 实施时必须保留 |
|---|---|---|
| 记忆模型及共享工具 | `conversationMemoryAgent.js:470`、`shared/memoryAgentTools.js:5` 将模型说明与中文 UI 文案分离；对应测试已调整 | 新 packet/工具继续分别维护模型说明与 UI 说明；保留本轮证据、引文、revision、置顶和重试约束 |
| 主提示词 | `promptPipeline.js:425`、`chatContextDirector.js:23` 调整固定指令和包装文本 | 默认中文及本轮语言覆盖、禁止擅自决定用户动作、引文作为数据、预设原文及来源优先级继续有效 |
| 世界导演 | `accessoryAgents.js:324` 增加未决尝试可以请求服务端检定的例外 | 保留 `attempt → server check → trusted outcome`；提取器不得把所有尝试丢弃，也不得提前写成成功 |
| 场景整理 | `sceneOrganizer.js:65` 明确真实空间证据、同名地点、路线和布局的区别 | 不因同名盲目合并；不虚构连通路线；不把 UI 坐标变成剧情事实；未提及不代表删除 |
| 状态栏模板 | `accessoryAgents.js:430`、`shared/statusTemplateSyntax.js` 调整模型指令及模板规则 | 作者规则不是事件证据；复合字段只更新对应子项；列表完整值与 U+3001 分隔规则、代码编辑权限不能丢失 |
| 聊天交互与渲染 | `ChatView.vue`、`ChatComposer.vue`、`useChatConversation.js`、`MarkdownContent.vue` 等已有焦点、视口、侧栏和流式渲染改动；旧打字机文件已删除 | 记忆进度和等待 UI 不重置草稿、滚动、焦点或响应式阈值；不恢复已删除的旧打字机实现 |
| 作者助手及世界书工作区 | `characterAssistant.js`、`worldBookAssistant.js`、工作区工具和对应测试已有改动 | 只联动记忆设置契约、角色知情元数据及环境能力说明；避免整文件覆盖作者工作区行为 |

这些差异属于进入本次任务前已经存在的工作。本次不对其作者或所属任务作推断，也不重置、提交或清理它们。

## 直接影响矩阵

### A01：统一提交不能遗漏公开任务和人工写入

依据：`conversationPostprocessing.js:132` 调用记忆 Agent；`jobs/jobHandlers.js:21` 的公开 `memory.extract` 直接调用规则提取器。`routes/upgrade.js:159` 至 `:251` 还有新增、更新、确认、置顶、禁用、回滚和删除入口。

处理：自动后处理、公开提取任务和人工审核全部经过统一记忆 service。公开提取只能产生同样经过验证的候选／提交，不能写旧表旁路。人工更正、合并、撤销、禁用也推进记忆版本并使摘要、图投影、FTS、向量和上下文缓存失效；新变更接口要求 expected revision。

前端正式请求统一收口到 `frontend/src/api/memories.js`；现有 `api/chat.js` 记忆函数和 `ConversationMemoryReview.vue` 内直连 URL 一起迁移，过渡转发完成调用方迁移后移除。UI 需区分暂存提案和已提交事实；不同角色信念、不同有效时间的事件不能仅因文本相似而合并。

明确退出 `fullTextSearch.js:8` 的 `RECALLABLE_MEMORY_SQL` 兼容规则：它目前允许部分 `enabled=false` 的初始 auto 候选参与召回。迁移时按审核记录映射 candidate／active／superseded／rejected 等显式生命周期状态，无法判断的旧禁用记录保守保持不可用；归档、置顶和事实真假是独立维度。所有检索通道共用 eligibility。未经接受的规则候选不能进入正式剧情上下文、世界事实或当前状态；已接受的旧文本也不自动变成没有结构化证据的领域状态。

验收：分别通过自动、公开 job 和人工 API 修改同一事实，得到一致的状态及证据约束；过期 revision 无写入；禁用和撤销后所有召回通道都一致；旧自动候选迁移后不再绕过审核。

### A02：新增核心任务与生成锁的等待顺序

依据：`routes/conversationGeneration.js:78` 先取得 `chat:` 生成锁；`jobs/jobQueue.js:145` 只给特定 `conversation.postprocess` 设置运行豁免。

处理：默认在取得新生成锁和写入本轮用户消息之前，完成上轮所需核心同步。等待结束后取得锁，重新核对 timeline、core watermark 和配置指纹；若发生竞争，释放／重试准备流程。锁内和同步 savepoint 内都不能等待一个被该锁阻挡的任务。发送、续写、重生成使用同一个应用服务规则。

验收：核心任务排队时发送不会相互等待；两端同时发送只有一个获准；超时返回明确错误和 `accepted:false`，草稿与附件保留，重试不重复写消息。

### A03：任务范围必须独立于调度串行键

依据：`jobQueue.js:52` 当前按 conversationId 设置统一 serial key；`:318`、`:325`、`:335`、`:349` 的活跃、取消、汇总和重试判断依赖该键。时间线失效又调用这些入口。

处理：任务显式携带 owner、conversation、source timeline、stage 和 index generation。serial key 只决定核心／摘要／索引的调度；范围查询、取消、删除和历史失效按显式会话范围执行。核心按顺序提交；派生失败单独统计和重试；所有旧版本任务提交前重新校验。

验收：拆键后编辑历史仍能取消全部受影响任务；索引任务不会挡住核心队列；索引失败不把核心标成失败；取消核心不能让后续核心跳过水位缺口。

### A04：开关、缺配置和公开角色不能造成永久 pending

依据：`advancedSettings.js:171` 定义 auto；`:199` 至 `:224` 会禁用非拥有者角色卡提供的附属技能。`conversationMemoryAgent.js:63` 当前停用／无 provider 会走规则回退。

处理：每轮先解析有效处理策略并返回 `requiredStages`。记忆关闭时不调用记忆模型，也不制造一个永远无法完成的记忆核心任务；auto 且无模型进入原文连续性模式。明确开启却配置失效时在接受新请求前报告配置问题，可由用户切换原文模式。其他已经启用的领域技能按各自依赖执行，不被记忆开关隐式关闭。embedding 关闭只降级检索，不影响已经成功的核心提交。公开卡不能携带作者凭据或替用户开启收费调用。

验收：owner／非 owner、auto／on／off、无凭据、provider 删除、embedding off 组合均可解释；原文模式不宣称结构化记忆已最新，也不自动把规则候选当世界事实。

### A05：新增字段要贯穿所有归一化和编辑器

依据：`validations/schemas.js:55`、`modules/advancedSettings.js`、`frontend/src/composables/character/useCharacterFormPayload.js`、`frontend/src/composables/chat/useChatAccessory.js` 都定义或过滤附属技能字段。角色助手也有自己的工具 schema。

处理：共享记忆策略契约；同步后端 Zod、默认值、归一化、角色保存／读取、会话覆盖、前端表单、AI 草稿 schema 和环境能力说明。前端字段相等比较与本地模型缓存也要升级，避免新字段被判为无变化。明确用户设置、作者默认、会话覆盖的顺序及恢复继承；保存一个开关不应意外冻结所有作者默认。用户 provider 绑定属于用户／会话，作者可分享的策略不携带该绑定。

验收：保存、刷新、导出角色、导入角色、开新会话、覆盖及恢复默认后策略不被静默丢弃；公开角色导出没有私有配置或剧情记忆。

### A06：异步 resolver 会改变生成、预览和评测调用契约

依据：`promptPipeline.js:32` 和 `contextPreview.js:42` 当前同步；`routes/upgrade.js:104` 的预览路由同步调用。预览在 pipeline 之后独立检索，见 `contextPreview.js:60`。

处理：provider 查询 embedding 在事务外异步执行；生成、预览和评测调用者全部等待同一个 resolver。预览不推进世界书状态，不生成领域事件，不在轮询或单纯打开检查器时重复发起收费查询。展示历史实际请求直接读保存 manifest；需要重新检索时明确执行一次，并使用缓存／去重。

验收：不存在返回 Promise 当 JSON、未捕获 rejection、预览消耗 sticky/cooldown 或重放即再次计费；预览选择清单和实际请求一致。

### A07：有效历史不能简单按 timeline 数字相等筛选

依据：`db/migrations/0014ConversationTimeline.js:55` 在正文、附件、role 变化时递增消息和时间线；`conversationTimeline.js:70` 还有显式失效。新时间线仍包含大量未变的早期消息。

处理：分开提取时版本、当前有效分支、来源消息 revision 和 as-of 截止点。timeline revision 用于阻止旧任务写入，不作为全部历史事件必须等于当前数字的条件。附件和说话者修订同样触发依赖失效。

验收：修改最后一轮不会让全部旧记忆消失；改附件或 role 会正确失效相关来源；旧任务不能借用未变化消息向新时间线提交。

### A08：来源版本留存与分支 ID 重映射

依据：当前消息 revision 是计数，候选文本保存在 swipe；`conversationSnapshotRepository.js:202` 至 `:256` 用字段名规则重映射普通列和 JSON 内 ID。

处理：为被证据引用的消息版本保留可校验的原文／附件元数据与内容哈希，不能只保存一个 revision 数字；可采用明确的消息版本记录。分支映射用类型化引用注册，覆盖 entity、message revision、commit、摘要依赖、水位和 source range；不改写模型 ID、provider ID、共享角色卡 ID。复制后重算依赖哈希和向量 source key。

验收：编辑后仍能解释历史证据，但旧版本不参与当前召回；分支没有指向父分支未来的引用；所有本地外键和 JSON 引用均通过范围检查。

### A09：完整存档、每轮检查点、项目快照与素材包必须分开

依据：`conversationSnapshotRepository.js:12` 固定表清单；`modules/saves.js:103`、`:107`、`:157` 硬编码 v2。`projectSnapshot.js:37`、`:288` 独立导出旧记忆；`exportEnvelopes.js:37` 的类型目录没有会话／记忆。

处理：完整会话存档包含恢复所需规范记录；紧凑检查点只保存当前投影及日志位置。项目快照说明其摘要／诊断性质，不冒充完整备份。作者素材包不带私有剧情。若新增完整会话导入包，单独定义版本、体积、所有权、冲突策略和 ID 映射。同步 save 创建、加载、旧 v2 归一化及返回版本。

验收：v2 存档可按规则升级；V1 完整导出／恢复保持认知和证据；检查点体积不随全事件日志逐轮重复复制；角色卡分享不泄漏会话数据。

### A10：原生向量扩展影响所有数据库连接

依据：`db/runtime.js:32` 是主连接；`backupRestoreDrill.js:50` 绕开该工厂；`backup.js` 中还有独立连接。主连接加载模块不代表其他连接也加载。

处理：建立连接用途清单：运行读写、内存测试、迁移、备份校验、恢复预检与演练。验证哪些操作实际需要 vec0 模块，为它们提供固定初始化；禁止为了复用启动函数而重置运行中全局缓存。核验固定依赖加载后关闭扩展加载，以及备份副本可以独立检查和恢复。

验收：这些连接分别能打开含向量表的数据库并完成实际承担的操作；故障演练不污染主服务缓存；Windows 打包、干净安装和副本恢复通过。

### A11：缓存、trace 和索引需要来源指纹

依据：场景缓存使用 `versionKey(conversationId, 'scene')`；快照恢复直接 DELETE/INSERT。`promptTrace.js:148` 主要通过 timeline 判过期，记忆人工修改或同一 provider profile 内换模型未必改变它。

处理：contextBundle 绑定 owner、数据库实例／恢复代、会话、as-of、核心 commit、记忆 revision、角色／预设／世界书 revision、有效策略和 embedding profile fingerprint。区分历史实际请求快照与当前可重现性。人工纠错、领域提交、restore、branch、配置变化统一发出缓存失效。每个维度使用明确的版本，不把整段私有文本当日志 key。

验收：无 timeline 变化的记忆修改仍刷新下一轮；恢复后不返回旧场景；同 profile ID 换模型触发新索引；旧 trace 保留原请求并说明其来源已变化。

### A12：世界书角色知情会传播到作者与触发逻辑

依据：`worldBooks/normalization.js:110` 没有角色受众字段；`worldBookRuntime.js:174` 维护 sticky/cooldown 等状态。共享世界书没有会话内 actor ID。

处理：定义作者真相／公共常识／受限事实的范围及旧条目迁移默认；使用可跨会话分享的 cast key 映射到会话 entity。同步编辑器、AI 工具、归一化、导入导出、匹配预览、运行触发及存档。所有最终 prompt 来源都受严格视角约束，不能只过滤向量结果。未实际注入的条目不按已注入推进状态。

验收：受限世界书、摘要、旧原文、状态和工具结果均不绕过严格角色视角；匹配预览只读；被过滤或预算裁掉的条目不消耗错误的触发状态。

### A13：初始会话与“接受当前状态”需要来源基线

依据：`routes/conversations.js:79` 创建会话，`:104` 写开场白；自动入队在后续 assistant 保存。`conversationTimeline.js:166` 的 acceptCurrent 直接接受状态并写 checkpoint。

处理：初始角色、世界书、开场白建立版本化 bootstrap 基线和初始水位。用户接受现状时创建 `adopted_baseline`，分别注明已接受状态与未提取历史；不凭空补出旧事件或角色获知过程。后续事件从明确基线继续。

验收：第一轮不缺开场既定事实；接受旧存档现状不冒充历史完整；从 bootstrap／adopted baseline 都可确定性恢复。

### A14：删除、日志保留和空间配额

依据：`routes/conversations.js:152`、`:162` 单个／批量删会话；`conversationRetention.js:9` 仅清理部分派生存储；`quotas.js:89` 有静态表体积计算；`diagnosticsExport.js:6` 有静态统计白名单。

处理：普通表按明确外键级联，向量虚表、任务、缓存和生成中的索引结果显式清理；删除后的 provider 响应不能复活实体。新表／向量 BLOB 纳入用户空间和索引预算。日志压缩不得移除仍被检查点、存档或分支引用的数据；明确删除会话时按用户意图移除其私有数据，不能用无限审计保留阻止删除。诊断计数按用户隔离，不给无 user_id 的新表直接暴露全局总数。

验收：单删、批删、角色级联删除和运行中 embedding 返回均无残留；保留策略不破坏仍有效存档；空间统计含向量和新事件，跨用户不泄漏。

### A15：模型目录、路由和计费必须识别任务类型

依据：现有 provider 主要服务 chat/Responses/Anthropic；`providerTaskRouter.js:89` 可以任意模型回退；前端 modelCatalog 缓存不区分任务。`providerUsage.js:4` 仅内建部分 DeepSeek 定价，配额中有自己的货币单位换算。

处理：明确 chat／embedding 的 capability 与协议，更新目录缓存版本、过滤及设置入口。沿用 HTTP、凭据和网络策略，向量 profile 指纹锁定空间；不允许任意备用聊天模型。usage 只记账一次，保存币种、地域、价目版本及 ingest/query/rebuild 用途。查询指令和文档模板变化采用可解释的索引版本策略。

验收：聊天下拉框不会误选 embedding；同维不同模型不能混查；供应商故障执行词法／图降级；token 和金额无漏计或重复换算。

### A16：处理状态界面和发送语义

依据：`useChatSubmit.js:167`、`:175` 的可发送／续写判定共用 busy；`ChatProcessingStatus.vue` 与提交逻辑主要围绕单个 postprocessJobId。

处理：返回 coreReady、requiredStages、核心／摘要／索引水位及各阶段 job；派生失败不能锁整个输入流程。发起端、job SSE、刷新回调都绑定会话、提交 run 和来源版本。等待核心时输入框可编辑，取消、超时和重试保持草稿及附件。最新轮与旧轮完成事件分别处理，不把旧响应写进新会话。

验收：快速切会话、停止生成、取消同步、重试、移动端键盘和弹层 Escape 均保持现有交互；不等待摘要／embedding 完成才可继续。

## 必须共同交付的依赖组

| 组 | 同批完成的范围 | 退出条件 |
|---|---|---|
| D1 写入与策略 | A01、A04、A05、A13：契约、有效开关、统一提交、公开 job、人工修订和来源基线 | 不存在旧提取／人工写库旁路；关闭配置不会制造不可完成任务 |
| D2 队列与锁 | A02、A03、A16：同步前置、锁兼容、显式范围、串行键、取消／重试／UI | 无等待环和水位跳跃；核心与派生的 readiness 分开 |
| D3 读取与上下文 | A06、A07、A11、A12：resolver、实际请求、预览、世界书和所有来源权限、预算 | 统一 manifest；指定历史点正确；预览无副作用 |
| D4 时间线与恢复 | A08、A09、A13、A14：消息版本、映射、紧凑检查点、完整存档、基线及保留 | 恢复确定、无未来记忆、无日志重复快照或断引用 |
| D5 向量运行时 | A03、A10、A14、A15：所有连接、profile、scope、队列、计费与删除 | 主启动之外的备份／恢复也可用；失败不污染当前状态 |
| D6 迁移与退出旧路 | 迁移 ledger、FTS 触发器、schema/indexes、状态机、API 调用者、作者助手说明和旧测试 | 新旧消费者完整迁移后移除旧运行分支；历史迁移保留 |

允许分批开发与评审；发布验收覆盖上述完整组，不把临时双写、两个 resolver 或不同候选状态语义作为永久方案。

## 定向回归映射

以下表格保留关联检测时确定的回归映射；实施阶段的实际通过结果已登记在主方案，不把方案阶段的分析当成运行验证。

| 关联 | 现有测试／入口 | 需要增加的关键场景 |
|---|---|---|
| D1 | `conversationMemoryAgent.test.js`、`conversationMemoryReview.test.js`、`conversationMemoryExtraction.test.js`、`requestValidationBoundary.test.js` | 公开 memory.extract 无旁路；人工修订原子失效；off/auto/无模型；开场与接受基线；新旧配置往返 |
| D2 | `jobs.test.js`、`conversationTimeline.test.js`、`conversationStreamingRoutes.test.js` | 持锁等待环；拆键取消；核心失败后不得跳水位；派生失败只影响自己的数据；重试不重复消息 |
| D3 | `promptPipelineTokenBudget.test.js`、`promptBudgetPairing.test.js`、`contextQualityEvaluation.js`、`contextPreview` 相关测试 | 所有输入总预算；as-of；来源版本变更；真实 manifest；严格角色下多来源秘密过滤；预览不重复收费 |
| D4 | 分支／存档／timeline／snapshot／retention 相关测试 | v2 读取和新完整存档；JSON 引用映射；消息附件／role 修订；恢复缓存；线性规模检查点；保留依赖 |
| D5 | `providers.test.js`、`providerQuota.test.js`、`backupRestoreDrill.test.js` 及新增 embedding 测试 | 模型空间混用阻止；配置同 ID 改模型；多连接 vec0；断点重建；删会话时 provider 返回；费用单次统计 |
| 前端 | 现有 memory/context/processing 单测及 `chat-runtime`、`conversation-timeline`、`context-quality`、`chat-interaction-stability` E2E | 草稿／附件恢复；旧 job 回调；角色默认与覆盖；索引失败可继续；移动端焦点、布局和流式显示回归 |

需要写新行为测试时，验证跨模块结果，不只镜像实现。旧文本断言随新 schema 改写时应保留已有的证据、中文输出、用户控制、模板和服务端检定约束。

## 本次执行记录

### 实施接续：2026-11-01

用户随后授权完整 V1 实现，并要求任务目标列出必读 Markdown。跟踪目标与实施验收记录已写入主方案；下方仅方案阶段的结论保留为历史记录，不能据此推断当前仍未实施。

| 交付组 | 实施落点与关键回归 |
|---|---|
| D1 / D6 | `0030`-`0033`、共享策略与工具、canonical commit / projection audit、唯一 memory router / frontend API；暂存失败无写入、人工 revision/幂等、legacy/v2 往返 |
| D2 | 显式会话与 stage、核心顺序、生成锁前等待、独立 summary/index；核心失败不跳水位，取消覆盖全部派生，未接受输入不写消息 |
| D3 | 统一 contextBundle、有效时间 claims、别名谱系、角色权限、FTS/graph/vector、预算和 trace；同消息顺序的后来修订不进入历史 prompt，错误信念不泄真相 |
| D4 | 完整 v3 snapshot、紧凑 checkpoint、类型化 branch 映射、adopted baseline；超过 10000 事件恢复、缓存失效、丢弃未来与旧 v2 支持 |
| D5 | 独立 DashScope profile、固定 sqlite-vec、所有需要的连接初始化、scoped KNN、索引 generation guard、usage/quota/删除；迟到索引不驱逐新 active，query 失败可降级 |
| 界面与运营 | 角色认知、来源、水位、packet 修订、手动重建、独立模型设置、世界书知情范围；两种视口共 14 张截图均实际查看，路径和最终 gate 结果见主方案 |

真实千问质量、费用和供应商延迟仍未实测；离线契约、干净原生安装与界面截图不替代这部分外部验证。正式运行文档 `architecture.md`、`conversation.md`、`chat-agent-context.md`、`ai-runtime.md` 与 `maintenance.md` 已同步新契约。

实施完整 gate 已通过：后端 1720/1720、前端 348/348、端到端 116/116，构建和生产审计均通过；中文离线契约评测为 v3、42/42。最终截图与命令日志位置见主方案。

### 方案阶段记录（历史）

- [x] 检查工作区状态与已有差异。
- [x] 追踪记忆提交、检索、配置、任务、恢复、导出、配额、缓存及前端消费者。
- [x] 完成后端、前端和独立方案复核，汇总 16 组直接影响。
- [x] 将必须联动的处理规则同步回主方案。
- [x] 明确已有改动保留边界、关联回归与旧逻辑退出条件。
- [ ] 执行业务实现、迁移和上述回归：不属于本次仅方案任务。
- [ ] 验证 sqlite-vec 在本项目所有连接上的兼容、性能及千问真实剧情召回：等待实施阶段。

本次文档验证结果：`node scripts/check-encoding.mjs` 通过，扫描 749 个文件；两份文档的 UTF-8、行尾空白、互相链接和引用测试名检查通过。`git diff --no-index --check` 无空白错误输出（未跟踪文件相对空文件存在差异时退出码为 1）。逐路径哈希对照确认 HEAD 未变，仅主方案和本报告变化；检测开始时的其他 81 个工作区路径状态与内容均未变化。
