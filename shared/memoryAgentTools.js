// The memory agent's callable tool library. `enabledByDefault` is the initial
// per-conversation switch; `required` tools cannot be turned off because the
// loop needs them to terminate.
export const MEMORY_AGENT_TOOLS = Object.freeze([
  { name: 'search_memories', label: '检索已有记忆', effect: 'read', enabledByDefault: true, limit: 6,
    description: '按可选关键词、类型查找当前会话记忆；默认排除归档，limit 为 1～20（默认 8）。返回完整内容、当前 revision 和匹配总数，用于去重和定位。' },
  { name: 'search_history', label: '检索历史消息', effect: 'read', enabledByDefault: true, limit: 4,
    description: '用非空 query 检索本会话除本轮外的已保存消息，返回最多 400 字的片段；limit 为 1～10（默认 5）。仅供核对已有事件，结果不能替代 observation 作为本轮写入证据。' },
  { name: 'record_memory', label: '记录新记忆', effect: 'write', enabledByDefault: true, limit: 12,
    description: '记录本轮的新事实、事件、关系、地点、稳定偏好、计划或假设；content 为非空文本，最多 600 字。sourceMessageId 必须来自 observation；quote 可省略，原文引用置信度上限 1，概述 0.6，无引文 0.5。计划和假设保留对应类型，重复内容应跳过。' },
  { name: 'update_memory', label: '修正已有记忆', effect: 'write', enabledByDefault: true, limit: 8,
    description: '用 memoryId 和当前 revision 更新未置顶、未归档记忆；省略字段保留原值。改正文须提供 observation 的 sourceMessageId；引文和置信度规则同 record_memory。仅修正标签、对象或置信度可沿用已有证据；无实际变化返回原记录。' },
  { name: 'merge_memories', label: '合并重复记忆', effect: 'write', enabledByDefault: true, limit: 4,
    description: '把同一事实的记忆合并到目标，提供目标及 1～8 条唯一来源的当前 revision；来源不能包含目标。目标和来源都须未置顶、未归档。content 省略时保留目标正文；提供时保留已有事实。来源归档并可撤销。' },
  { name: 'invalidate_memory', label: '标记记忆失效', effect: 'write', enabledByDefault: false, limit: 6,
    description: '用当前 revision 把本轮明确否定的未置顶、未归档旧记忆标记失效，保留历史。提供非空 reason 和 observation 中的 sourceMessageId，quote 可省略；不确定时保留。' },
  { name: 'pin_memory', label: '置顶或取消置顶', effect: 'write', enabledByDefault: false, limit: 4,
    description: '仅显式启用时，用当前 revision 置顶或取消置顶未归档记忆；pinned 省略为 true。置顶优先进入上下文，仍受总预算限制；不能借此改正文或恢复归档记忆。' },
  { name: 'finish_memory_review', label: '结束本轮整理', effect: 'read', enabledByDefault: true, required: true, limit: 1,
    description: '处理完毕后必须调用以结束本轮；summary 可省略，最多 300 字。' }
]);
