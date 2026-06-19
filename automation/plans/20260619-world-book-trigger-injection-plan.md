# 任务规格：世界书系统 — 角色卡附加世界观设定，触发词自动注入上下文

> 任务ID：20260619-WB-TRIGGER-001
> 日期：2026-06-19
> 来源：backlog.md → 高优先级 #1
> 状态：✅ 核心功能已完成（见调查结论）

---

## 一、问题描述

**Backlog 原文**：世界书系统：角色卡附加世界观设定，触发词自动注入上下文

**需求解读**：
1. 角色卡可以附加世界书（世界观设定集合）
2. 世界书条目通过触发词（关键词）匹配对话内容
3. 匹配的条目自动注入到 AI 上下文中

---

## 二、现状调查结论

经过完整的代码调查，**该功能已完整实现并可投入使用**。以下是各模块的实现状态：

### 2.1 已实现功能清单

| 功能模块 | 状态 | 实现位置 |
|---------|------|---------|
| 世界书 CRUD | ✅ | `backend/src/modules/worldBooks.js` |
| 条目 CRUD（含全部高级字段） | ✅ | 同上 |
| 角色卡 ↔ 世界书多对多绑定 | ✅ | `character_world_books` 联结表 + `CharacterFormView.vue` |
| 触发词匹配（字符串 + 正则） | ✅ | `matchWorldBookEntries()` |
| Selective 逻辑（含/排除二级关键词） | ✅ | `selective` + `selectiveLogic` + `keysSecondary` |
| 自动注入上下文（system prompt） | ✅ | `buildWorldBookContext()` |
| at_depth 消息级注入 | ✅ | `injectAtDepthEntries()` |
| 递归激活（最多 5 层） | ✅ | `RECURSIVE_MAX_DEPTH = 5` |
| 组内互斥（加权随机） | ✅ | `applyGroupInclusion()` |
| 概率激活 | ✅ | `use_probability` + `probability` |
| Sticky / Cooldown / Delay 状态管理 | ✅ | `world_book_entry_state` 表 |
| Token 预算截断 | ✅ | `lorebook_context_percent` |
| AI 世界书生成（SSE 流式） | ✅ | `worldBookAssistant.js` |
| 前端世界书管理界面 | ✅ | `WorldBookView.vue`（2247 行） |
| 角色卡编辑器中选择世界书 | ✅ | `CharacterFormView.vue` 世界书选择弹窗 |
| 会话级 Lorebook 绑定 | ✅ | `chat_lorebook_id` + `ChatSettingsDrawer.vue` |
| 命中可视化 | ✅ | `ChatMessageItem.vue` + `latestWorldBookMatches` |
| 测试覆盖 | ✅ | `backend.test.js`, `worldBookOwnershipRoutes.test.js`, `frontendWorldBookView.test.js` |

### 2.2 数据流验证

```
用户发送消息
  → POST /api/conversations/:id/messages
    → 收集最近 N 条消息文本（N = scan_depth）
    → matchWorldBookEntries(db, characterId, recentTexts, { conversationId })
      ├─ 收集角色绑定的世界书（world_books.character_id + character_world_books）
      ├─ 收集会话绑定的 chat_lorebook_id
      ├─ Phase 0: Sticky 条目（仍在粘性窗口内）
      ├─ Phase 1: always_active 条目
      ├─ Phase 2: 触发词匹配（字符串/正则 + selective + probability + cooldown/delay）
      ├─ Phase 2.5: 组内互斥（加权随机选一个）
      ├─ Phase 3: 递归激活（匹配条目的内容中出现其他条目的触发词）
      ├─ Phase 4: Token 预算截断（lorebook_context_percent）
      └─ Phase 5: 更新条目状态
    → buildWorldBookContext(entries) → 拼入 system prompt 的 [世界书补充信息]
    → injectAtDepthEntries(messages, entries) → 按 depth 插入消息列表
    → buildModelMessagesV2({ worldBookContext, worldBookEntries, ... })
    → 发送给 LLM
```

### 2.3 关键文件清单

| 层级 | 文件 | 职责 |
|------|------|------|
| **DB Schema** | `backend/src/db.js` | `world_books`, `world_book_entries`, `character_world_books`, `world_book_entry_state` 四张表 |
| **核心逻辑** | `backend/src/modules/worldBooks.js` | CRUD + `matchWorldBookEntries()` + `buildWorldBookContext()` + `injectAtDepthEntries()` |
| **路由** | `backend/src/routes/worldBooks.js` | REST API + AI 生成端点 |
| **对话集成** | `backend/src/routes/conversations.js` | `buildModelMessagesV2()` 中注入世界书上下文 |
| **AI 助手** | `backend/src/services/worldBookAssistant.js` | AI 生成世界书 draft |
| **验证** | `backend/src/validations/schemas.js` | 请求体校验 |
| **前端 API** | `frontend/src/api.js` | `fetchWorldBooks`, `createWorldBook`, etc. |
| **前端视图** | `frontend/src/views/WorldBookView.vue` | 世界书管理界面（2247 行） |
| **角色表单** | `frontend/src/views/CharacterFormView.vue` | 世界书选择弹窗 + 绑定逻辑 |
| **聊天提交** | `frontend/src/composables/chat/useChatSubmit.js` | `latestWorldBookMatches` 命中追踪 |
| **消息展示** | `frontend/src/components/chat/ChatMessageItem.vue` | 命中条目可视化 |

---

## 三、结论与建议

### 3.1 功能完成度评估

**核心功能完成度：100%**

Backlog 描述的三项能力均已完整实现：
- ✅ 角色卡附加世界观设定 → `character_world_books` 联结表 + 角色编辑器选择弹窗
- ✅ 触发词 → `trigger_keys` 字段 + `matchWorldBookEntries()` 匹配引擎（支持字符串/正则/selective）
- ✅ 自动注入上下文 → `buildWorldBookContext()` 注入 system prompt + `injectAtDepthEntries()` 注入消息列表

### 3.2 建议后续动作

该 backlog 条目可以标记为 **已完成**。如需进一步增强，可从以下方向选择：

| 方向 | 优先级 | 已有规划 |
|------|--------|---------|
| 世界书导入/导出（SillyTavern 兼容） | P2 | ✅ `20260618-world-book-system-plan.md` §2.1 |
| 条目复制与批量操作 | P2 | ✅ 同上 §2.2 |
| 搜索与排序增强 | P3 | ✅ 同上 §2.3 |
| 世界书全局开关 | P3 | ✅ 同上 §2.4 |

---

## 四、DoD（Definition of Done）

由于核心功能已完成，以下为**验收确认清单**：

- [x] 角色卡编辑器中可以选择/关联一个或多个世界书
- [x] 世界书条目支持设置触发关键词（triggerKeys）
- [x] 对话时自动扫描最近 N 条消息（scan_depth）匹配触发词
- [x] 匹配成功的条目内容自动注入到 AI 上下文（system prompt 或 at_depth）
- [x] 支持 always_active 条目（无需触发词，始终注入）
- [x] 支持正则模式触发（regexMode）
- [x] 支持 selective 逻辑（需要同时匹配主/副关键词）
- [x] 支持概率激活、sticky、cooldown、delay 高级特性
- [x] 支持递归激活（条目内容触发其他条目）
- [x] 支持组内互斥（inclusion_group + group_weight）
- [x] 支持 token 预算截断（lorebook_context_percent）
- [x] 前端命中可视化（ChatMessageItem 显示命中的世界书条目）
- [x] AI 辅助生成世界书（worldBookAssistant.js）

## 五、验收标准

1. 创建一个世界书，添加 3+ 条目（含 always_active、普通触发词、正则触发词各一）
2. 在角色卡编辑器中关联该世界书
3. 发起对话，验证 always_active 条目始终注入
4. 对话中提及触发词，验证对应条目被命中并注入
5. 检查命中条目在 ChatMessageItem 中正确显示
