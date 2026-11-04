# AI 工具契约审查与精确修改

日期：2026-11-01。执行主计划：[角色记忆与 Agent 工作流升级](memory-character-workflow-upgrade-plan.md)。

## 阅读顺序与检查入口

维护前阅读 `AGENTS.md`、上述主计划、`conversation-memory-v1-plan.md`、
`conversation-memory-v1-impact-analysis.md`、`memory-packet-contract-fix-plan.md`，
再阅读 `ai-runtime.md` 和将要修改的工具 builder、dispatcher、领域处理器及测试。
记忆与状态协同、后台连续性和角色档案由主计划的独立任务验证；本文记录工具契约部分。

运行 `node backend/src/services/validate-tools.js` 可复核生产目录。
脚本先设置内存 SQLite，再导入实际 builder；不扫描真实剧情、不调用模型、不产生费用。
发现缺失类型、开放固定对象、没有上限或元素结构的数组、没有上限的字典、
错误 required、无法编译的本地校验器、未登记工具或过期登记时，进程退出码为 1。
它检查本地契约，不宣称所有远端模型或网关都支持所有 JSON Schema 关键字。
结构审查也不证明跨字段业务规则已全部进入 schema。创建必需字段、字段组合、
目标归属、revision、来源、权限和状态转换仍由各 handler 校验，并由行为测试验证。

## 最终目录

初次只读盘点为 59 个工具名称。最终为 **64 个名称、69 种参数结构**，
覆盖 12 个实际运行目录，包括角色/世界书规划、旧世界书草稿兼容路径、可选旅行与奖励。
同名工具在旧路径中没有工作区 `targetRef`，因此结构数大于名称数。
作者助手复用世界书和状态工具，按下表所属领域计数一次。

| 领域 | 数量 | 全部工具名称 |
| --- | ---: | --- |
| 角色草稿 | 14 | `read_character_field`、`search_character_draft`、`edit_character_text`、`patch_character_data`、`update_character_profile`、`update_character_story`、`replace_character_regex_rules`、`replace_character_render_plugins`、`update_character_status_bar`、`update_character_agents`、`update_character_presentation`、`set_character_recommendations`、`report_character_progress`、`finish_character_draft` |
| 世界书草稿 | 13 | `search_world_books`、`select_world_book`、`read_world_book`、`preview_world_book_entries`、`create_world_book`、`create_character_world_book`、`set_world_book_profile`、`replace_world_book_entries`、`upsert_world_book_entry`、`remove_world_book_entry`、`patch_world_book_text`、`batch_world_book_entries`、`finish_world_book_task` |
| 状态栏 | 8 | `read_status_bar`、`update_status_bar`、`upsert_status_bar_variable`、`remove_status_bar_variable`、`update_status_bar_metadata`、`replace_status_bar_template`、`update_status_bar_code`、`skip_status_bar_update` |
| 记忆 | 9 | `search_memories`、`search_history`、`record_memory`、`update_memory`、`merge_memories`、`invalidate_memory`、`pin_memory`、`batch_memory_changes`、`finish_memory_review` |
| 场景 | 7 | `upsert_scene_node`、`upsert_scene_route`、`merge_scene_nodes`、`remove_scene_route`、`patch_scene_text`、`batch_scene_changes`、`finish_scene_organization` |
| 世界导演 | 8 | `create_quest`、`advance_quest_objective`、`advance_world_time`、`set_world_weather`、`request_skill_check`、`discover_location`、`travel_to_location`、`propose_reward` |
| 经济 | 1 | `record_economy_transaction` |
| 在线检索 | 2 | `deepseek_web_search`、`deepseek_web_fetch` |
| 作者规划 | 2 | `submit_character_plan`、`submit_world_book_plan` |

完整来源由 `aiToolContractAudit.js` 的 `collectAiToolContracts()` 构建，
参数来自实际工具定义，规划目录也来自实际生产分支。
`toolRegistry.js` 的 effect/idempotency 登记覆盖全部名称；登记本身不替代领域事务和权限检查。

## 格式边界与实际发现

- 原有角色、世界书、搜索、规划的大多数对象已经具备明确结构，不属于统一缺失格式。
  本次保留它们的字段语义，补充了布尔工具开关字典的 `maxProperties: 64`。
- 原有场景、经济、导演，以及部分记忆/旧状态工具缺少关闭固定对象的声明。
  真实 `executeProviderTool` 在未关闭对象时会把额外键传入处理器，不能依赖自动删除。
  本次关闭工具根和相关嵌套对象，拒绝模型提供 `skipWorldEvent`、`auditActor`、
  `permanent`、伪造 `roll/outcome` 和奖励对象的额外字段。
- 场景标签现有上限为 50；旧状态变量数组采用共享 `STATUS_BAR_VARIABLE_LIMIT`。
  列表与对象映射不能互换，所有数组都具备元素格式和有限条数。
- 经济金额保留原 `minimum: 0.0001`；领域模块仍按分舍入，`0.005` 等合法输入继续可用。
  新增有限 `maximum: 1000000000000` 防止无穷大或舍入溢出，描述/NPC 长度与现有模块一致。
- 导演的任务目标、奖励币种项和任务进度都关闭额外键；必需标题/名称/引用不能只含空白。
  服务端继续执行骰点、目标归属、路线、已完成奖励来源和功能开关校验。

只有 `patch_character_data.edits[].oldValue` 与 `.value` 是刻意保留的任意 JSON 值。
JSON Pointer 可以指向标量、数组或对象，处理器已有可修改根/字段白名单、旧值精确比较、
ID 保护、归一化后保留检查、容量与原子失败规则。审查器只对这两个完整路径允许多态，
不会放行另一个空 schema；模型说明解释该语义，不向供应商增加私有 schema 关键字。

记忆 `claims[].value` 与 `domainRefs[].outcome` 则使用有深度、数量限制的 JSON 联合结构，
不是任意未声明对象。状态值的 string/number 联合及 tools 布尔字典也有明确用途。

## 精确与批量修改契约

| 能力 | 接口与限制 | 保留和失败规则 |
| --- | --- | --- |
| 角色文本 | 既有 `edit_character_text`，每次最多 30 项 | 精确原文及匹配次数检查；保留未修改段落 |
| 角色结构 | 既有 `patch_character_data`，每次最多 32 项 | JSON Pointer 白名单和旧值检查；失败整批不生效 |
| 状态栏 | 既有按名 upsert/remove、代码分区和 literal 替换；变量值支持有界批量更新 | 省略字段保留；模板匹配数不符不改写；规则仍控制允许编辑的范围 |
| 记忆 | `update_memory` 增加精确 search/replacement；`batch_memory_changes` 复用已启用写工具，每批 1–12 项 | 遵守来源、revision、置顶与归档保护；逐项暂存，成功项保留、失败项不形成提案，最终 `finish_memory_review` 封存后统一原子提交；详见主计划和记忆 Agent 测试 |
| 场景稀疏更新 | 按已有节点/路线 ID，只提交改变字段 | 节点 layout 与旧 layout 合并，保留已有扩展键；路线省略端点时读取原端点；ID-only 拒绝 |
| 场景精确文本 | 新 `patch_scene_text`；节点 name/description 或路线 label/description | 校验 entityType/field；默认匹配一次；名称 160、节点正文 10000、路线正文 2000 字符 |
| 场景批量 | 新 `batch_scene_changes`，1–24 项 | 每项工具名与 arguments 结构关联；不允许递归 batch 或 finish；SQLite savepoint 回滚所有数据/事件，成功后才发布 changes |
| 世界书正文 | 新 `patch_world_book_text`，1–30 项、单个正文最多 50000 字符 | 在当前未应用草稿上匹配原文；只写 content；保留条目 ID、元数据和无关段落；任一失败恢复整个工作区 |
| 世界书条目 | 新 `batch_world_book_entries`，1–30 项、单一 targetRef | 关联 upsert/remove 参数；逐项复用现有稀疏处理器；任一失败恢复 targets 和 activeRef；真正保存仍走既有 revision 冲突校验 |

记忆 batch 返回每项结果，部分失败不会撤销同批已成功的暂存项；模型应按结果修正失败项，
不重复提交成功项。`finish_memory_review` 成功前没有持久事实写入；封存后的提案通过服务端
来源、租约和版本检查，与本轮核心领域计划原子接受。场景与世界书 batch 则在各自工作区
按整批原子规则执行，任一项失败回滚同批修改，不能将这项语义套用到记忆逐项暂存。

新增节点要求 name、nodeType 和 layout.x/y/iconKey；已有节点更新无需重传整份资料。
场景批量可明确指定新 ID，并由后续操作引用；不得仅为补全图形虚构空间事实或路线。
新 layout 写入只接受明确字段，旧 layout 的其他键在稀疏更新中保留。

世界书新增批量计入原有每轮新增上限，不能借批量绕过 30 条默认生成限制。
已有条目的修改和删除不因整本书超过 30 条而被禁止。
发生流式中断后，包含新增条目的成功批量按目标与参数重放结果，避免因调用 ID 改变而重复新增。
`set_world_book_profile` 仅提供 targetRef 而没有资料字段时明确拒绝。
角色助手自动继承同一工作区工具、权限过滤与规划范围，不维护第二套实现。

## 验证结果与限制

- `aiToolInventory.test.js`：实际全目录、审查器反例、生产参数边界拒绝，以及
  OpenAI/Anthropic/DeepSeek/Gemini 和 custom Gemini 适配后的精确/批量契约。
- `preciseAgentTools.test.js`：场景稀疏保留、路线端点、精确冲突、数据库及事件整批回滚、
  新 ID 引用；世界书元数据保留、草稿整批回滚、混合操作、每轮上限、流式恢复无重复新增，
  以及角色助手的共享精确/批量工具调用和 worldBook 关闭后的权限过滤。
- 上述新增测试 **12/12 通过**。既有工具、场景、导演、附属 Agent、角色运行时/
  JSON Patch 和世界书工作区相关测试 **97/97 通过**。
- 全量测试发现的 fetch mock 恢复规则问题已改为显式 `try/finally`；
  `test-hygiene` 与上述两组新增测试联合 **19/19 通过**，没有放宽隔离检查。
- `node backend/src/services/validate-tools.js`：64 个名称、69 种结构、2 个明确多态字段，PASS。
- 全量后端、前端、截图和 review gate 以主计划的最终记录为准。本子任务没有前端改动。

所有供应商请求在上述测试中使用本地 mock，全部数据库使用内存或隔离测试路径。
本次不含真实收费模型验证、真实剧情重建或线上数据库写入；供应商特定 schema 接受情况仍需
真实网关集成验证，本地结构审查不等于模型执行正确性或剧情质量评价。
