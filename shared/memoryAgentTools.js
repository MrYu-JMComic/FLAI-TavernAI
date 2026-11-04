// The memory agent's callable tool library. `enabledByDefault` is the initial
// per-conversation switch; `required` tools cannot be turned off because the
// loop needs them to terminate.
// 设置界面保留中文 description；modelDescription 是单独发给模型的英文工具说明。
// Write capabilities stage proposals; canonical writes happen once after finish and server validation.
export const MEMORY_AGENT_TOOLS = Object.freeze([
  { name: 'search_memories', label: '检索已有记忆', effect: 'read', enabledByDefault: true, limit: 6,
    description: '按可选关键词、类型查找当前会话记忆；默认排除归档，limit 为 1～20（默认 8）。返回完整内容、当前 revision 和匹配总数，用于去重和定位。',
    modelDescription: 'Search memories in the current conversation using optional keywords and memory type. Archived memories are excluded by default. limit must be 1-20 (default 8). Returns full content, the current revision, and the total match count for deduplication and review.' },
  { name: 'search_history', label: '检索历史消息', effect: 'read', enabledByDefault: true, limit: 4,
    description: '用非空 query 检索本会话除本轮外的已保存消息，返回最多 400 字的片段；limit 为 1～10（默认 5）。仅供核对已有事件，结果不能替代 observation 作为本轮写入证据。',
    modelDescription: 'Search saved messages in this conversation, excluding the current turn, using a non-empty query. Returns snippets of at most 400 characters. limit must be 1-10 (default 5). Use results only to verify earlier events; they cannot replace observation as evidence for a write.' },
  { name: 'record_memory', label: '记录新记忆', effect: 'write', enabledByDefault: true, limit: 12,
    description: '暂存本轮的新事实、事件、关系、地点、稳定偏好、计划或假设；content 为非空文本，最多 600 字。sourceMessageId 必须来自 observation；quote 可省略，原文引用置信度上限 1，概述 0.6，无引文 0.5。计划和假设保留对应类型，重复内容应跳过。',
    modelDescription: 'Stage a proposal for a fact, event, relationship, location change, stable preference, plan, or hypothesis established in this turn. content must be non-empty and at most 600 characters. sourceMessageId must identify a message in observation. quote is optional; an exact quote supports confidence up to 1, a paraphrase up to 0.6, and no quote up to 0.5. Preserve intent and hypothesis types. Skip duplicates.' },
  { name: 'update_memory', label: '修正已有记忆', effect: 'write', enabledByDefault: true, limit: 8,
    description: '暂存修订：用 memoryId 和当前 revision 更新未置顶、未归档记忆；省略字段保留原值。改正文须提供 observation 的 sourceMessageId；引文和置信度规则同 record_memory。仅修正标签、对象或置信度可沿用已有证据；无实际变化返回原记录。',
    modelDescription: 'Stage an update to an unpinned, non-archived memory using memoryId and its current revision. Omitted fields retain their existing values. A content change requires sourceMessageId from the current observation; quote and confidence rules match record_memory. Existing evidence may be reused when changing only the type, subject, or confidence. Return the unchanged record when nothing actually changes.' },
  { name: 'merge_memories', label: '合并重复记忆', effect: 'write', enabledByDefault: true, limit: 4,
    description: '把同一事实的记忆合并到目标，提供目标及 1～8 条唯一来源的当前 revision；来源不能包含目标。目标和来源都须未置顶、未归档。content 省略时保留目标正文；提供时保留已有事实。来源归档并可撤销。',
    modelDescription: 'Merge memories that describe the same fact into a target. Provide the target revision and 1-8 unique source memories with their current revisions; a source cannot be the target. The target and sources must be unpinned and non-archived. If content is omitted, keep the target content; if supplied, preserve all established facts. Sources are archived, and the merge can be undone.' },
  { name: 'invalidate_memory', label: '标记记忆失效', effect: 'write', enabledByDefault: false, limit: 6,
    description: '用当前 revision 把本轮明确否定的未置顶、未归档旧记忆标记失效，保留历史。提供非空 reason 和 observation 中的 sourceMessageId，quote 可省略；不确定时保留。',
    modelDescription: 'Mark an unpinned, non-archived memory as invalid only when this turn explicitly disproves it. Use its current revision and preserve it in history. Provide a non-empty reason and a sourceMessageId from observation; quote is optional. Keep the memory when evidence is uncertain.' },
  { name: 'pin_memory', label: '置顶或取消置顶', effect: 'write', enabledByDefault: false, limit: 4,
    description: '仅显式启用时，用当前 revision 置顶或取消置顶未归档记忆；pinned 省略为 true。置顶优先进入上下文，仍受总预算限制；不能借此改正文或恢复归档记忆。',
    modelDescription: 'Use only when this tool is explicitly enabled. Pin or unpin a non-archived memory using its current revision; pinned defaults to true. Pinned memories receive context priority but remain subject to the total budget. Do not use this tool to edit content or restore an archived memory.' },
  { name: 'batch_memory_changes', label: '批量整理记忆', effect: 'write', enabledByDefault: true, limit: 3,
    description: '按顺序暂存 1～12 项记忆变更，复用各工具权限和次数上限；逐项返回结果及 revision。成功项保留在工作区，失败项需修正，最后统一结束整理才提交。',
    modelDescription: 'Stage 1-12 ordered memory writes using the declared child-tool schemas and their existing permissions and budgets. Results identify each successful proposal and current revision; failed items make no proposal. Successful items remain staged, so do not replay them. Correct failures and finish once. Nested batches and finish calls are forbidden.' },
  { name: 'finish_memory_review', label: '结束本轮整理', effect: 'read', enabledByDefault: true, required: true, limit: 3,
    description: '处理完毕后必须调用以结束本轮并提交暂存提案（服务端验证通过后生效）；summary 可省略，最多 300 字。',
    modelDescription: 'Validate and finish the review once. Optional packet must follow its structured schema: each collection is an array, never an ID-keyed object. summary is optional and limited to 300 characters. A validation failure does not finish or commit the review; correct it and retry, up to three handler attempts. Only one successful finish is allowed.' }
]);
