# 任务规划：世界书系统 — 测试补全 + 导入/导出 + 上下文预算可视化

> 中书省规划 · 2026-06-06 · 任务 ID: `WB-20260606-002`
> 前序计划: `20260604-world-book-plan.md`、`20260604-世界书系统-plan.md`、`20260606-世界书系统-plan.md`

---

## 1. 任务背景

FLAI-TavernAI 是一个 AI 角色扮演聊天应用（Vue + Vite 前端，Express + Node 24 + SQLite 后端）。当前项目已有角色卡系统，需要补充"世界书"（World Info/Lorebook）功能——角色卡附加世界观设定，触发词自动注入上下文。

### 1.1 参考设计

SillyTavern World Info 核心理念：
- 世界书 = 条目集合，每个条目有触发关键词和注入内容
- 当用户消息或对话历史包含触发词时，对应条目内容自动注入到 AI 上下文
- 支持递归激活（被激活的条目内容可能触发更多条目）
- 支持位置控制（system/before_char/after_char/at_depth）
- 支持高级特性：概率激活、互斥分组、selective 过滤、sticky/cooldown/delay 状态机

---

## 2. 现状分析

### 2.1 已完成模块（~90%）

| 层级 | 状态 | 关键文件 |
|------|------|----------|
| 数据库 schema（5 张表） | ✅ | `backend/src/db.js` L314-363 |
| 模块：CRUD + 触发匹配 + 递归激活 + 概率/分组/sticky/cooldown/delay | ✅ | `backend/src/modules/worldBooks.js` (450+ 行) |
| 路由：REST API + AI 草稿 SSE | ✅ | `backend/src/routes/worldBooks.js` |
| 服务：AI 世界书助手 | ✅ | `backend/src/services/worldBookAssistant.js` |
| 对话集成：matchEntries + buildContext + injectAtDepth | ✅ | `backend/src/routes/conversations.js` L235, L826-896 |
| 前端：列表/详情/条目管理/AI 创建 | ✅ | `frontend/src/views/WorldBookView.vue` |
| 角色关联 UI | ✅ | `frontend/src/views/CharacterFormView.vue` |
| 会话级世界书绑定 | ✅ | `frontend/src/components/chat/ChatSettingsDrawer.vue` |
| 前端 API 函数 | ✅ | `frontend/src/api.js` L233-289 |

### 2.2 缺口分析

| # | 缺口 | 风险等级 | 说明 |
|---|------|----------|------|
| 1 | **无专用测试** — `worldBooks.test.js` 不存在 | 🔴 高 | 触发匹配引擎逻辑复杂（正则/选择性/概率/递归/状态机），无测试覆盖 = 回归风险极高 |
| 2 | **无导入/导出** — 用户无法分享世界书、无法迁移 SillyTavern 资产 | 🟡 中 | 社区分享和生态兼容受阻 |
| 3 | **无上下文预算可视化** — 用户无法感知世界书消耗了多少 token | 🟡 中 | 影响用户对上下文窗口的控制感 |

### 2.3 数据库 Schema（已完整，无需修改）

```sql
-- world_books: id, user_id, name, description, character_id, scan_depth, lorebook_context_percent
-- world_book_entries: id, world_book_id, name, trigger_keys, content, position, enabled, order_index,
--   regex_mode, always_active, depth, selective, selective_logic, keys_secondary, probability,
--   use_probability, inclusion_group, group_weight, role, sticky, cooldown, delay
-- character_world_books: character_id, world_book_id, order_index (多对多中间表)
-- world_book_entry_state: entry_id, last_activated_message, last_deactivated_message,
--   first_seen_message, sticky_remaining, was_active
-- conversations.chat_lorebook_id: 对话级世界书绑定
```

---

## 3. 任务规格

### 3.1 DoD（Definition of Done）

- [ ] `backend/src/tests/worldBooks.test.js` 存在且 `npm test` 全部通过
- [ ] 导入/导出端点可用（`GET /api/world-books/:id/export`、`POST /api/world-books/import`）
- [ ] 前端世界书列表页有"导入"按钮，详情页有"导出"按钮
- [ ] 对话中能看到世界书注入的上下文 token 占比标签
- [ ] `cd frontend && npm run build` 无报错
- [ ] `node scripts/check-encoding.mjs` 通过
- [ ] 迭代报告写入 `automation/reports/`

### 3.2 验收标准

#### AC-1: 后端单元测试覆盖

| 测试组 | 测试场景 | 预期结果 |
|--------|----------|----------|
| A1 CRUD | 创建世界书（含 scanDepth/lorebookContextPercent） | HTTP 201，返回正确结构 |
| A1 CRUD | 获取世界书详情（含 entries 和 linkedCharacters） | 返回完整数据 |
| A1 CRUD | 更新世界书字段 | 字段正确更新 |
| A1 CRUD | 删除世界书（级联删除条目） | 世界书和条目均删除 |
| A1 CRUD | 名称校验（空名称、超长名称） | 抛异常 |
| A2 条目 | 创建条目（默认值填充） | 所有字段有合理默认值 |
| A2 条目 | 更新条目（部分更新） | 仅更新传入字段 |
| A2 条目 | 删除条目 | 条目删除，世界书 updated_at 刷新 |
| A2 条目 | toggle enabled/disabled | enabled 状态翻转 |
| A3 关联 | linkWorldBookToCharacter | 中间表正确插入 |
| A3 关联 | unlinkWorldBookFromCharacter | 中间表正确删除 |
| A3 关联 | listCharacterWorldBooks（含排序） | 按 order_index ASC 返回 |
| A4 触发 | 字符串匹配（大小写不敏感） | 命中条目 |
| A4 触发 | 正则匹配（regex_mode） | 正则命中条目 |
| A4 触发 | 混合模式（`/regex/flags` 语法） | 内嵌正则命中 |
| A4 触发 | always_active 条目 | 无条件激活 |
| A4 触发 | 无效正则 | 跳过不崩溃 |
| A5 高级 | Selective 过滤（逻辑 0/1/2） | 三种逻辑正确 |
| A5 高级 | 概率激活（probability=0 不返回） | 概率控制正确 |
| A5 高级 | 分组互斥（加权随机） | 同组仅返回一个 |
| A5 高级 | Sticky（持续 N 条消息） | 粘性期内持续激活 |
| A5 高级 | Cooldown（冷却 N 条消息） | 冷却期内不激活 |
| A5 高级 | Delay（首次出现后延迟 N 条消息） | 延迟期内不激活 |
| A6 递归 | 匹配条目内容触发其他条目 | 递归展开 |
| A6 递归 | 最大递归深度 5 层 | 5 层后停止 |
| A6 递归 | 无新匹配时终止 | 不死循环 |
| A7 注入 | injectAtDepthEntries 在正确位置插入 | 深度排序正确 |
| A7 注入 | role 映射（0→system, 1→user, 2→assistant） | 角色正确 |
| A8 预算 | 匹配条目按 order_index 排序后截断 | 超预算条目被裁剪 |
| A9 边界 | 空世界书（无条目） | 返回空数组 |
| A9 边界 | 禁用条目不参与匹配 | 跳过 |
| A9 边界 | 超长内容截断（10000 字符限制） | 截断正确 |
| A9 边界 | 不存在的世界书/条目 | 返回 null |

#### AC-2: 导入/导出

| 场景 | 预期 |
|------|------|
| 导出世界书为 JSON | 文件包含 `_flai_export_version`、`exported_at`、`world_book` 对象 |
| 导入 FLAI JSON | 解析并创建世界书和条目 |
| 导入 SillyTavern JSON（entries 为对象） | 自动转换为 FLAI 格式 |
| 导入无效 JSON | 返回 400 错误，不创建数据 |
| 导入空 entries | 返回 400 错误 |
| 导入超过 100 条目 | 返回 400 错误 |
| 导出 → 导入往返 | 数据不丢失 |

#### AC-3: 上下文预算可视化

| 场景 | 预期 |
|------|------|
| 对话中有世界书命中 | 聊天 UI 显示注入条目数和估算 token 占比 |
| 无世界书命中 | 不显示预算信息 |
| 多本世界书叠加 | 显示合并后的总占比 |

---

## 4. 技术方案

### 4.1 方向 A：后端单元测试

**新增文件**：`backend/src/tests/worldBooks.test.js`

使用项目现有测试模式（参考 `backend.test.js`），用内存 SQLite 数据库：

```
测试结构：
├── describe('World Book CRUD')
│   ├── 创建世界书（含 scanDepth、lorebookContextPercent）
│   ├── 获取世界书详情（含 entries、linkedCharacters）
│   ├── 更新世界书
│   ├── 删除世界书（级联删除 entries）
│   └── 名称验证（空、超长）
│
├── describe('World Book Entries')
│   ├── 创建条目（各 position 类型）
│   ├── 更新条目
│   ├── 删除条目
│   ├── 启用/禁用切换
│   └── 排序（orderIndex）
│
├── describe('Character ↔ World Book Linking')
│   ├── 关联世界书到角色
│   ├── 取消关联
│   └── 列表角色的世界书（含排序）
│
├── describe('Trigger Matching Engine')
│   ├── 字面量触发词匹配（大小写不敏感）
│   ├── 正则模式匹配（regex_mode）
│   ├── 混合模式（/regex/flags 内嵌语法）
│   ├── always_active 条目
│   ├── 无效正则跳过
│   ├── Selective 过滤（逻辑 0: OR, 1: NOT ANY, 2: NOT ALL）
│   ├── 概率激活（probability=0 不返回）
│   ├── 互斥分组（加权随机）
│   ├── Sticky 持续激活
│   ├── Cooldown 冷却
│   ├── Delay 延迟
│   └── 递归激活（最大 5 层）
│
├── describe('Context Building & Injection')
│   ├── buildWorldBookContext 合并 at_start/before_char/after_char
│   ├── injectAtDepthEntries 在正确位置插入
│   └── role 映射（0→system, 1→user, 2→assistant）
│
├── describe('Token Budget Truncation')
│   ├── 按 order_index 排序后截断
│   └── 超预算条目被裁剪
│
└── describe('Edge Cases')
    ├── 空世界书返回空数组
    ├── 禁用条目不参与匹配
    ├── 超长内容截断（10000 字符）
    └── 不存在的世界书/条目返回 null
```

**测试工具函数**：
- `createTestWorldBook(db, userId, overrides)` — 快速创建测试世界书
- `createTestEntry(db, userId, bookId, overrides)` — 快速创建测试条目
- `createTestCharacter(db, userId)` — 快速创建测试角色

### 4.2 方向 B：导入/导出

#### 后端新增

**`backend/src/modules/worldBooks.js`** 增加两个函数：

```javascript
export function exportWorldBook(database, userId, bookId) {
  // 1. 获取世界书和条目
  // 2. 转换为导出格式
  // 3. 返回 JSON 对象
}

export function importWorldBook(database, userId, payload) {
  // 1. 校验 JSON 结构
  // 2. 检测 SillyTavern 格式 → 自动转换
  // 3. 创建世界书 + 批量插入条目
  // 4. 返回创建的世界书
}
```

**`backend/src/routes/worldBooks.js`** 增加两个端点：

```
GET  /api/world-books/:id/export   → 导出单个世界书为 JSON
POST /api/world-books/import        → 从 JSON 导入创建世界书
```

**导出格式**：

```json
{
  "_flai_export_version": 1,
  "exported_at": "2026-06-06T...",
  "world_book": {
    "name": "魔法世界观",
    "description": "中世纪魔法世界设定",
    "scan_depth": 4,
    "lorebook_context_percent": 25,
    "entries": [
      {
        "name": "魔力体系",
        "triggerKeys": "魔力,魔法,魔力值",
        "content": "这个世界存在魔力...",
        "position": "before_char",
        "enabled": true,
        "orderIndex": 0,
        "regexMode": false,
        "alwaysActive": false,
        "depth": 0,
        "selective": false,
        "selectiveLogic": 0,
        "keysSecondary": "",
        "probability": 100,
        "useProbability": false,
        "group": "",
        "groupWeight": 0,
        "role": 0,
        "sticky": null,
        "cooldown": null,
        "delay": null
      }
    ]
  }
}
```

**SillyTavern 格式字段映射**：

| SillyTavern 字段 | FLAI 字段 | 转换规则 |
|------------------|-----------|----------|
| `entries` (Object) | `entries` (Array) | `Object.values()` |
| `entries[].key` | `triggerKeys` | 逗号分隔字符串 |
| `entries[].content` | `content` | 直接映射 |
| `entries[].position` | `position` | 0→before_char, 1→after_char, 2→at_start |
| `entries[].disable` | `enabled` | 取反 |
| `entries[].addMemo` | `alwaysActive` | 直接映射 |
| `entries[].order` | `orderIndex` | 直接映射 |
| `entries[].depth` | `depth` | 直接映射 |
| `entries[].selective` | `selective` | 直接映射 |
| `entries[].selectiveLogic` | `selectiveLogic` | 直接映射 |
| `entries[].secondKey` | `keysSecondary` | 逗号分隔 |
| `entries[].extensions.depth` | `depth` | 直接映射 |
| `entries[].extensions.role` | `role` | 直接映射 |
| `entries[].extensions.sticky` | `sticky` | 直接映射 |
| `entries[].extensions.cooldown` | `cooldown` | 直接映射 |
| `entries[].extensions.probability` | `probability` | 直接映射 |
| `entries[].extensions.useProbability` | `useProbability` | 直接映射 |
| `entries[].extensions.group` | `group` | 直接映射 |
| `entries[].extensions.group_weight` | `groupWeight` | 直接映射 |
| `entries[].extensions.delay` | `delay` | 直接映射 |

**`backend/src/validations/schemas.js`** 新增导入校验 schema：

```javascript
export const importWorldBookSchema = z.object({
  _flai_export_version: z.number().optional(),
  world_book: z.object({
    name: z.string().min(1).max(80),
    description: z.string().max(2000).optional(),
    scan_depth: z.number().int().min(1).max(50).optional(),
    lorebook_context_percent: z.number().int().min(1).max(100).optional(),
    entries: z.array(z.object({ /* entry fields */ })).min(1).max(100)
  })
});
```

#### 前端新增

**`frontend/src/api.js`**：

```javascript
export function exportWorldBook(id) {
  return apiRequest(`/api/world-books/${id}/export`);
}

export function importWorldBook(payload) {
  return apiRequest('/api/world-books/import', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}
```

**`frontend/src/views/WorldBookView.vue`**：

- 列表页顶部添加"📥 导入世界书"按钮
  - 点击打开文件选择器（accept `.json`）
  - 解析 JSON → 调用 `importWorldBook()` → 刷新列表
- 详情页标题栏添加"📤 导出"按钮
  - 点击调用 `exportWorldBook()` → 触发 JSON 文件下载

### 4.3 方向 C：上下文预算可视化

#### 后端修改

**`backend/src/routes/conversations.js`**：

在消息发送响应中增加 `worldBookMeta` 字段（约 L235 附近）：

```javascript
// 在 matchWorldBookEntries 之后添加
const worldBookMeta = {
  matchedEntries: worldBookEntries.length,
  estimatedTokens: worldBookEntries.reduce((sum, e) => sum + Math.ceil((e.content || '').length / 4), 0),
  budgetPercent: /* 从 world_books 表获取 */,
  books: /* 按 bookId 分组统计 */
};
```

流式响应的 `done` 事件中同样包含此字段。

#### 前端修改

**`frontend/src/composables/chat/useChatConversation.js`**：

- 从 SSE `done` 事件中提取 `worldBookMeta`
- 存入响应式状态供 UI 消费

**`frontend/src/components/chat/ChatMessageItem.vue`** 或 **`frontend/src/views/ChatView.vue`**：

- 当 `worldBookMeta.matchedEntries > 0` 时，在聊天区域底部显示标签
- 格式：`📚 世界书注入 5 条 · ~1200 tokens (25% 预算)`
- 点击可展开查看各世界书的命中详情

---

## 5. 涉及文件清单

### 新增文件
| 文件 | 说明 |
|------|------|
| `backend/src/tests/worldBooks.test.js` | 世界书系统专用测试（A1-A9 全覆盖） |

### 修改文件
| 文件 | 修改内容 |
|------|----------|
| `backend/src/modules/worldBooks.js` | 新增 `exportWorldBook()`、`importWorldBook()` 函数 |
| `backend/src/routes/worldBooks.js` | 新增 `/export`、`/import` 端点 |
| `backend/src/validations/schemas.js` | 新增导入校验 schema |
| `backend/src/routes/conversations.js` | 消息响应中增加 `worldBookMeta` 字段 |
| `frontend/src/api.js` | 新增 `exportWorldBook()`、`importWorldBook()` 函数 |
| `frontend/src/views/WorldBookView.vue` | 增加导入/导出按钮和交互 |
| `frontend/src/views/ChatView.vue` | 增加上下文预算标签显示 |
| `frontend/src/composables/chat/useChatConversation.js` | 提取和存储 `worldBookMeta` |

### 不修改的文件
- `backend/src/db.js` — 表结构已完整，无需变更
- `backend/src/services/worldBookAssistant.js` — AI 生成逻辑无需变更
- `frontend/src/views/CharacterFormView.vue` — 世界书选择器已完整
- `frontend/src/components/chat/ChatSettingsDrawer.vue` — 对话级世界书绑定已完整

---

## 6. 实现步骤

### Phase 1: 后端单元测试（优先，建立安全网）

1. 创建 `backend/src/tests/worldBooks.test.js`
2. 实现测试工具函数（createTestWorldBook, createTestEntry, createTestCharacter）
3. 按测试组 A1→A9 逐步编写测试用例
4. 运行 `npm test` 确认全部通过
5. 修复发现的 bug（如有）

### Phase 2: 导入/导出

6. 在 `modules/worldBooks.js` 中实现 `exportWorldBook()` 函数
7. 在 `modules/worldBooks.js` 中实现 `importWorldBook()` 函数
8. 在 `validations/schemas.js` 中添加导入校验 schema
9. 在 `routes/worldBooks.js` 中添加 `/export` 和 `/import` 端点
10. 在 `api.js` 中添加前端 API 函数
11. 在 `WorldBookView.vue` 中添加导入/导出 UI
12. 编写导入/导出测试用例
13. 运行 `npm test` 确认通过

### Phase 3: 上下文预算可视化

14. 在 `conversations.js` 消息响应中添加 `worldBookMeta`
15. 在 `useChatConversation.js` 中提取 `worldBookMeta`
16. 在 `ChatView.vue` 中添加预算标签 UI
17. 确保流式/非流式响应均包含 `worldBookMeta`

### Phase 4: 集成验证

18. `npm test` 全部通过
19. `cd frontend && npm run build` 成功
20. `node scripts/check-encoding.mjs` 通过
21. 手动验证：创建世界书 → 关联角色 → 发送消息 → 看到注入标签
22. 编写迭代报告写入 `automation/reports/`

---

## 7. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 内存数据库中 `DatabaseSync(':memory:')` 行为差异 | 低 | 测试不准确 | 使用 `createAppDatabase(':memory:')` 初始化，schema 完全一致 |
| SillyTavern JSON 格式版本变体多 | 中 | 导入失败 | 先支持标准格式，异常格式 fallback 为原始 JSON；未知字段静默忽略 |
| 导入大量条目导致性能问题 | 低 | 响应慢 | 限制单次导入最多 100 条目 |
| 上下文预算估算不准确 | 中 | 用户误导 | 明确标注"估算"，使用 `~1200 tokens` 格式 |
| 流式响应中 worldBookMeta 丢失 | 低 | UI 不显示 | 在 `done` 事件中始终包含，即使为空对象 |
| 互斥分组测试中的随机性 | 低 | 测试不稳定 | 分组测试用 mock Math.random 或固定 seed |
| 测试运行时间过长 | 低 | CI 慢 | 每个测试用独立内存 DB，用完即弃 |

---

## 8. 工作量预估

| Phase | 内容 | 预估工作量 |
|-------|------|-----------|
| Phase 1 | 后端单元测试（A1-A9，30+ 用例） | 主要工作量 |
| Phase 2 | 导入/导出（后端 + 前端） | 中等 |
| Phase 3 | 上下文预算可视化（后端 + 前端） | 轻量 |
| Phase 4 | 集成验证 + 编码检查 + 报告 | 收尾 |
| **总计** | | **6-9 小时** |

---

## 9. 依赖关系

- 无外部依赖新增（使用现有 `node:sqlite`、Express、Vue、`node:test`）
- Phase 2 和 Phase 3 可并行开发
- Phase 4 依赖 Phase 1-3 全部完成
- 前序计划 `20260606-世界书系统-plan.md` 与本计划内容一致，本计划为精炼版
