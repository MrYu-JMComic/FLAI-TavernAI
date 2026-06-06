# 任务规划：世界书系统 — 收尾：导入/导出 + 上下文预算可视化

> 中书省规划 · 2026-06-06 · 任务 ID: `WB-20260606-003`
> 前序计划: `20260604-world-book-plan.md`、`20260606-世界书系统-plan.md`、`20260606-worldbook-plan.md`（旧版）

---

## 1. 任务背景

FLAI-TavernAI 是一个 AI 角色扮演聊天应用（Vue + Vite 前端，Express + Node 24 + SQLite 后端）。"世界书系统"（World Info / Lorebook）已在前序迭代中**基本完成**，本计划聚焦最后两个缺口。

### 1.1 当前完成度：~95%

| 层级 | 状态 | 关键文件 |
|------|------|----------|
| 数据库 schema（5 张表） | ✅ 完成 | `backend/src/db.js` L316-389 |
| 模块 CRUD + 触发匹配 + 递归激活 | ✅ 完成 | `backend/src/modules/worldBooks.js` (580+ 行) |
| 路由 REST API + AI 草稿 SSE | ✅ 完成 | `backend/src/routes/worldBooks.js` |
| AI 世界书助手（流式 + 非流式） | ✅ 完成 | `backend/src/services/worldBookAssistant.js` |
| 对话集成（matchEntries + buildContext + injectAtDepth） | ✅ 完成 | `backend/src/routes/conversations.js` |
| 前端列表/详情/条目管理/AI 创建 | ✅ 完成 | `frontend/src/views/WorldBookView.vue` |
| 角色关联 UI（多世界书选择器） | ✅ 完成 | `frontend/src/views/CharacterFormView.vue` |
| 会话级世界书绑定 | ✅ 完成 | `frontend/src/components/chat/ChatSettingsDrawer.vue` |
| 前端 API 函数 | ✅ 完成 | `frontend/src/api.js` L233-289 |
| 后端测试（触发匹配、状态机、递归、at_depth） | ✅ 已有 ~40 个用例 | `backend/src/tests/backend.test.js` |
| **导入/导出** | ❌ 未实现 | — |
| **上下文预算可视化** | ❌ 未实现 | — |

### 1.2 剩余缺口

| # | 缺口 | 风险 | 说明 |
|---|------|------|------|
| 1 | **无导入/导出** | 🟡 中 | 用户无法分享世界书、无法迁移 SillyTavern 资产 |
| 2 | **无上下文预算可视化** | 🟡 中 | 用户无法感知世界书消耗了多少 token |

---

## 2. 任务规格

### 2.1 DoD（Definition of Done）

- [ ] 导入/导出端点可用（`GET /api/world-books/:id/export`、`POST /api/world-books/import`）
- [ ] 前端世界书列表页有"导入"按钮，详情页有"导出"按钮
- [ ] 支持 SillyTavern 格式 JSON 自动转换导入
- [ ] 对话中能看到世界书注入的上下文 token 占比标签
- [ ] `npm test` 全部通过（含新增导入/导出测试用例）
- [ ] `cd frontend && npm run build` 无报错
- [ ] `node scripts/check-encoding.mjs` 通过
- [ ] 迭代报告写入 `automation/reports/`

### 2.2 验收标准

#### AC-1: 导入/导出

| 场景 | 预期 |
|------|------|
| 导出世界书为 JSON | 文件包含 `_flai_export_version`、`exported_at`、`world_book` 对象 |
| 导入 FLAI JSON | 解析并创建世界书和条目 |
| 导入 SillyTavern JSON（entries 为 Object） | 自动转换为 FLAI 格式（`Object.values()` + 字段映射） |
| 导入无效 JSON | 返回 400 错误，不创建数据 |
| 导入空 entries | 返回 400 错误 |
| 导入超过 100 条目 | 返回 400 错误 |
| 导出 → 导入往返 | 数据不丢失 |

#### AC-2: 上下文预算可视化

| 场景 | 预期 |
|------|------|
| 对话中有世界书命中 | 聊天 UI 显示注入条目数和估算 token 占比 |
| 无世界书命中 | 不显示预算信息 |
| 多本世界书叠加 | 显示合并后的总占比 |

---

## 3. 技术方案

### 3.1 方向 A：导入/导出

#### 后端新增

**`backend/src/modules/worldBooks.js`** 增加两个函数：

```javascript
export function exportWorldBook(database, userId, bookId) {
  // 1. 获取世界书和条目（复用 getWorldBook）
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
  "exported_at": "2026-06-06T18:00:00.000Z",
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
| `entries[].key` | `triggerKeys` | 数组 → 逗号分隔字符串 |
| `entries[].content` | `content` | 直接映射 |
| `entries[].position` | `position` | 0→before_char, 1→after_char, 2→at_start |
| `entries[].disable` | `enabled` | 取反 |
| `entries[].addMemo` | `alwaysActive` | 直接映射 |
| `entries[].order` | `orderIndex` | 直接映射 |
| `entries[].depth` | `depth` | 直接映射 |
| `entries[].selective` | `selective` | 直接映射 |
| `entries[].selectiveLogic` | `selectiveLogic` | 直接映射 |
| `entries[].secondKey` | `keysSecondary` | 数组 → 逗号分隔 |
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
    entries: z.array(z.object({
      name: z.string().max(120),
      triggerKeys: z.string().max(2000).optional(),
      content: z.string().max(10000),
      position: z.enum(['before_char', 'after_char', 'at_start', 'at_depth']).optional(),
      enabled: z.boolean().optional(),
      orderIndex: z.number().int().optional(),
      regexMode: z.boolean().optional(),
      alwaysActive: z.boolean().optional(),
      depth: z.number().int().min(0).max(10).optional(),
      selective: z.boolean().optional(),
      selectiveLogic: z.number().int().min(0).max(2).optional(),
      keysSecondary: z.string().max(2000).optional(),
      probability: z.number().int().min(0).max(100).optional(),
      useProbability: z.boolean().optional(),
      group: z.string().max(100).optional(),
      groupWeight: z.number().int().min(0).optional(),
      role: z.number().int().min(0).max(2).optional(),
      sticky: z.number().int().min(0).nullable().optional(),
      cooldown: z.number().int().min(0).nullable().optional(),
      delay: z.number().int().min(0).nullable().optional()
    })).min(1).max(100)
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

### 3.2 方向 B：上下文预算可视化

#### 后端修改

**`backend/src/routes/conversations.js`**：

在消息发送响应中增加 `worldBookMeta` 字段（约 L244 附近，`matchWorldBookEntries` 之后）：

```javascript
const worldBookMeta = {
  matchedEntries: worldBookEntries.length,
  estimatedTokens: worldBookEntries.reduce(
    (sum, e) => sum + Math.ceil((e.content || '').length / 4), 0
  ),
  budgetPercent: lorebookContextPercent,
  contextSize: contextSize || 0
};
```

流式响应的 `done` 事件中同样包含此字段。

#### 前端修改

**`frontend/src/composables/chat/useChatConversation.js`**：

- 从 SSE `done` 事件中提取 `worldBookMeta`
- 存入响应式状态供 UI 消费

**`frontend/src/views/ChatView.vue`** 或 **`ChatMessageItem.vue`**：

- 当 `worldBookMeta.matchedEntries > 0` 时，在聊天区域底部显示标签
- 格式：`📚 世界书注入 5 条 · ~1200 tokens (25% 预算)`

---

## 4. 涉及文件清单

### 新增文件
| 文件 | 说明 |
|------|------|
| （无新增文件，所有变更在现有文件中） | — |

### 修改文件
| 文件 | 修改内容 |
|------|----------|
| `backend/src/modules/worldBooks.js` | 新增 `exportWorldBook()`、`importWorldBook()` 函数 |
| `backend/src/routes/worldBooks.js` | 新增 `/export`、`/import` 端点，注册路由 |
| `backend/src/validations/schemas.js` | 新增 `importWorldBookSchema` |
| `backend/src/routes/conversations.js` | 消息响应中增加 `worldBookMeta` 字段 |
| `backend/src/tests/backend.test.js` | 新增导入/导出测试用例 |
| `frontend/src/api.js` | 新增 `exportWorldBook()`、`importWorldBook()` 函数 |
| `frontend/src/views/WorldBookView.vue` | 增加导入/导出按钮和交互 |
| `frontend/src/views/ChatView.vue` | 增加上下文预算标签显示 |
| `frontend/src/composables/chat/useChatConversation.js` | 提取和存储 `worldBookMeta` |

### 不修改的文件
- `backend/src/db.js` — 表结构已完整，无需变更
- `backend/src/services/worldBookAssistant.js` — AI 生成逻辑无需变更
- `backend/src/modules/worldBooks.js` 中的触发匹配逻辑 — 已完成且有测试覆盖
- `frontend/src/views/CharacterFormView.vue` — 世界书选择器已完整
- `frontend/src/components/chat/ChatSettingsDrawer.vue` — 对话级世界书绑定已完整

---

## 5. 实现步骤

### Phase 1: 导入/导出（后端）

1. 在 `modules/worldBooks.js` 中实现 `exportWorldBook()` 函数
2. 在 `modules/worldBooks.js` 中实现 `importWorldBook()` 函数（含 SillyTavern 格式检测和转换）
3. 在 `validations/schemas.js` 中添加 `importWorldBookSchema`
4. 在 `routes/worldBooks.js` 中添加 `GET /:id/export` 和 `POST /import` 端点

### Phase 2: 导入/导出（前端）

5. 在 `api.js` 中添加 `exportWorldBook()` 和 `importWorldBook()` 函数
6. 在 `WorldBookView.vue` 列表页添加"导入"按钮（文件选择器 + JSON 解析）
7. 在 `WorldBookView.vue` 详情页添加"导出"按钮（JSON 下载）

### Phase 3: 上下文预算可视化

8. 在 `conversations.js` 消息响应中添加 `worldBookMeta`
9. 在 `useChatConversation.js` 中提取 `worldBookMeta`
10. 在 `ChatView.vue` 中添加预算标签 UI

### Phase 4: 测试 + 验证

11. 在 `backend.test.js` 中新增导入/导出测试用例（FLAI 格式、SillyTavern 格式、无效 JSON、往返测试）
12. `npm test` 全部通过
13. `cd frontend && npm run build` 成功
14. `node scripts/check-encoding.mjs` 通过
15. 手动验证：创建世界书 → 导出 → 导入 → 对比数据一致
16. 手动验证：对话中看到世界书注入标签
17. 编写迭代报告写入 `automation/reports/`

---

## 6. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| SillyTavern JSON 格式版本变体多 | 中 | 导入失败 | 先支持标准格式，异常格式 fallback 为原始 JSON；未知字段静默忽略 |
| 导入大量条目导致性能问题 | 低 | 响应慢 | 限制单次导入最多 100 条目 |
| 上下文预算估算不准确 | 中 | 用户误导 | 明确标注"估算"，使用 `~1200 tokens` 格式 |
| 流式响应中 worldBookMeta 丢失 | 低 | UI 不显示 | 在 `done` 事件中始终包含，即使为空对象 |

---

## 7. 工作量预估

| Phase | 内容 | 预估工作量 |
|-------|------|-----------|
| Phase 1 | 导入/导出后端 | 中等 |
| Phase 2 | 导入/导出前端 | 轻量 |
| Phase 3 | 上下文预算可视化 | 轻量 |
| Phase 4 | 测试 + 验证 + 报告 | 收尾 |
| **总计** | | **3-5 小时** |

---

## 8. 依赖关系

- 无外部依赖新增（使用现有 `node:sqlite`、Express、Vue、`node:test`）
- Phase 1 和 Phase 2 串行（前端依赖后端端点）
- Phase 3 可与 Phase 1-2 并行
- Phase 4 依赖 Phase 1-3 全部完成
