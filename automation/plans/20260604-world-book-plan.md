# 任务规格：世界书系统完善与测试补全

> 中书省立项 · 2026-06-04 · 最高优先级 Ready 任务

---

## 1. 任务标题

**世界书系统：测试补全、导入导出、上下文预算可视化**

## 2. 任务描述

世界书系统的核心功能已基本实现，包括：
- 后端 CRUD（`modules/worldBooks.js`）、REST 路由（`routes/worldBooks.js`）
- 触发词匹配引擎（`matchWorldBookEntries`）：支持正则、always_active、selective 过滤、概率激活、互斥分组、sticky/cooldown/delay 状态追踪、递归激活、token 预算截断、at_depth 注入
- 角色-世界书多对多关联（`character_world_books` 中间表）
- 对话级世界书绑定（`conversations.chat_lorebook_id`）
- 前端管理界面（`WorldBookView.vue`）：列表、创建、编辑、条目管理、AI 生成
- 角色表单中的世界书选择器（`CharacterFormView.vue`）
- 聊天设置抽屉中的对话级世界书绑定（`ChatSettingsDrawer.vue`）

**本次任务聚焦三个缺口**：
1. 缺少专用测试（无 `worldBooks.test.js`）
2. 缺少世界书导入/导出（Tavern JSON 格式兼容）
3. 缺少上下文预算可视化（用户无法感知世界书消耗了多少 token）

## 3. DoD（Definition of Done）

- [ ] `backend/src/tests/worldBooks.test.js` 通过，覆盖 CRUD、触发匹配、递归激活、token 预算截断
- [ ] 世界书支持导出为 Tavern JSON 格式文件
- [ ] 世界书支持从 Tavern JSON 格式文件导入
- [ ] 对话中能看到世界书注入的上下文 token 占比
- [ ] `npm test` 全部通过
- [ ] `npm run build`（frontend）成功
- [ ] `node scripts/check-encoding.mjs` 通过

## 4. 验收标准

### 4.1 测试覆盖（AC-1）

| 测试场景 | 预期结果 |
|---|---|
| 创建/读取/更新/删除世界书 | HTTP 201/200，返回正确结构 |
| 创建/读取/更新/删除条目 | HTTP 201/200，条目字段完整 |
| 触发词匹配：字面量命中 | 返回匹配条目 |
| 触发词匹配：正则模式命中 | 返回匹配条目 |
| 触发词匹配：always_active 条目 | 无条件返回 |
| 触发词匹配：selective + 副关键词过滤 | 仅副关键词也命中时返回 |
| 触发词匹配：概率激活 | 概率=0 时不返回 |
| 触发词匹配：互斥分组 | 同组仅返回一个 |
| 递归激活 | 已匹配条目内容触发更多条目 |
| token 预算截断 | 超出预算的条目被裁剪 |
| at_depth 注入 | 消息数组在正确位置插入条目 |
| 角色-世界书关联/取消关联 | 中间表正确增删 |
| 对话级世界书绑定 | `chat_lorebook_id` 正确更新 |

### 4.2 导入导出（AC-2）

| 场景 | 预期 |
|---|---|
| 导出世界书为 JSON | 文件包含 `name`、`description`、`entries[]`，字段名兼容 Tavern/SillyTavern 格式 |
| 导入 Tavern JSON | 解析 `entries` 数组，映射字段到 FLAI schema，创建世界书和条目 |
| 导入无效 JSON | 返回 400 错误，不创建任何数据 |
| 导入空 entries | 返回 400 错误 |

### 4.3 上下文预算可视化（AC-3）

| 场景 | 预期 |
|---|---|
| 对话中有世界书命中 | 聊天 UI 显示注入条目数和估算 token 占比 |
| 无世界书命中 | 不显示预算信息 |
| 多本世界书叠加 | 显示合并后的总占比 |

## 5. 技术方案概要

### 5.1 测试补全

**文件**：`backend/src/tests/worldBooks.test.js`

使用项目现有测试模式（参考 `backend.test.js`），用内存 SQLite 数据库：

```
测试结构：
- describe('World Books CRUD')
  - 创建世界书（含 scanDepth、lorebookContextPercent）
  - 列表世界书
  - 获取世界书详情（含 entries、linkedCharacters）
  - 更新世界书
  - 删除世界书（级联删除 entries）
  - 名称验证（空、超长）

- describe('World Book Entries')
  - 创建条目（各 position 类型）
  - 更新条目
  - 删除条目
  - 启用/禁用切换
  - 排序（orderIndex 交换）

- describe('Character ↔ World Book Linking')
  - 关联世界书到角色
  - 取消关联
  - 列表角色的世界书

- describe('Trigger Matching')
  - 字面量触发词匹配
  - 正则模式匹配
  - always_active 条目
  - selective + 副关键词过滤（三种逻辑）
  - 概率激活
  - 互斥分组（加权随机）
  - 递归激活
  - token 预算截断
  - sticky/cooldown/delay 状态
  - 对话级世界书（chat_lorebook_id）

- describe('Context Building')
  - buildWorldBookContext 合并 at_start/before_char/after_char
  - injectAtDepthEntries 在正确位置插入
```

### 5.2 导入导出

**后端新增**：

`routes/worldBooks.js` 增加两个端点：
- `GET /api/world-books/:id/export` — 导出为 Tavern JSON
- `POST /api/world-books/import` — 从 Tavern JSON 导入

`modules/worldBooks.js` 增加两个函数：
- `exportWorldBook(database, userId, bookId)` — 将世界书和条目转为 Tavern 格式
- `importWorldBook(database, userId, payload)` — 解析 Tavern JSON 并创建世界书

**Tavern JSON 字段映射**：

| Tavern 字段 | FLAI 字段 | 说明 |
|---|---|---|
| `name` | `name` | 直接映射 |
| `description` | `description` | 直接映射 |
| `entries[].key` | `triggerKeys` | 逗号分隔 → 逗号分隔 |
| `entries[].content` | `content` | 直接映射 |
| `entries[].position` | `position` | 0→before_char, 1→after_char, 2→at_start |
| `entries[].disable` | `enabled` | 取反 |
| `entries[].addMemo` | `alwaysActive` | 映射 |
| `entries[].order` | `orderIndex` | 直接映射 |
| `entries[].depth` | `depth` | 直接映射 |
| `entries[].selective` | `selective` | 直接映射 |
| `entries[].selectiveLogic` | `selectiveLogic` | 直接映射 |
| `entries[].secondKey` | `keysSecondary` | 直接映射 |
| `extensions.depth` | `depth` (at_depth) | 直接映射 |
| `extensions.role` | `role` | 直接映射 |
| `extensions.sticky` | `sticky` | 直接映射 |
| `extensions.cooldown` | `cooldown` | 直接映射 |
| `extensions.probability` | `probability` | 直接映射 |
| `extensions.useProbability` | `useProbability` | 直接映射 |
| `extensions.group` | `group` | 直接映射 |
| `extensions.group_weight` | `groupWeight` | 直接映射 |
| `extensions.match_whole_words` | — | 忽略（FLAI 用正则模式替代） |
| `extensions.exclude_recursion` | — | 忽略（FLAI 用 selective 替代） |
| `extensions.delay` | `delay` | 直接映射 |

**前端新增**：

`WorldBookView.vue` 增加：
- 列表页「导入」按钮（文件选择器，accept `.json`）
- 详情页「导出」按钮（触发 JSON 下载）

`api.js` 增加：
- `exportWorldBook(id)` — GET 请求，返回 blob
- `importWorldBook(file)` — POST multipart 或 JSON body

### 5.3 上下文预算可视化

**后端修改**：

`routes/conversations.js` 的消息发送响应中增加 `worldBookMeta` 字段：

```json
{
  "worldBookMeta": {
    "matchedEntries": 5,
    "estimatedTokens": 1200,
    "budgetPercent": 25,
    "budgetTokens": 4000,
    "books": [
      { "id": "xxx", "name": "魔法世界", "matchedCount": 3 }
    ]
  }
}
```

流式响应的 `done` 事件中同样包含此字段。

**前端修改**：

`ChatView.vue` 或 `ChatMessageItem.vue` 中：
- 当 `worldBookMeta.matchedEntries > 0` 时，在聊天区域底部或顶部显示一个小标签
- 格式：`📚 世界书注入 5 条 · ~1200 tokens (25% 预算)`
- 点击可展开查看各世界书的命中详情

`composables/chat/useChatConversation.js` 中：
- 从 SSE `done` 事件中提取 `worldBookMeta`
- 存入响应式状态供 UI 消费

## 6. 需要修改的文件清单

### 新增文件
| 文件 | 说明 |
|---|---|
| `backend/src/tests/worldBooks.test.js` | 世界书系统专用测试 |

### 修改文件
| 文件 | 修改内容 |
|---|---|
| `backend/src/modules/worldBooks.js` | 新增 `exportWorldBook()`、`importWorldBook()` 函数 |
| `backend/src/routes/worldBooks.js` | 新增 `/export`、`/import` 端点 |
| `backend/src/validations/schemas.js` | 新增导入验证 schema |
| `backend/src/routes/conversations.js` | 消息响应中增加 `worldBookMeta` 字段 |
| `frontend/src/api.js` | 新增 `exportWorldBook()`、`importWorldBook()` 函数 |
| `frontend/src/views/WorldBookView.vue` | 增加导入/导出按钮和交互 |
| `frontend/src/views/ChatView.vue` | 增加上下文预算标签显示 |
| `frontend/src/composables/chat/useChatConversation.js` | 提取和存储 `worldBookMeta` |

### 不修改的文件
- `backend/src/db.js` — 表结构已完整，无需变更
- `backend/src/services/worldBookAssistant.js` — AI 生成逻辑无需变更
- `frontend/src/views/CharacterFormView.vue` — 世界书选择器已完整

## 7. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| Tavern JSON 格式版本差异（v1 vs v2） | 中 | 导入失败 | 解析时兼容两种格式，遇到未知字段静默忽略 |
| 递归激活测试中的随机性 | 低 | 测试不稳定 | 互斥分组测试用 mock Math.random 或固定 seed |
| 导入大量条目导致性能问题 | 低 | 响应慢 | 限制单次导入最多 100 条目 |
| 上下文预算估算不准确 | 中 | 用户误导 | 明确标注"估算"，使用 ~1200 tokens 格式 |
| 流式响应中 worldBookMeta 丢失 | 低 | UI 不显示 | 在 `done` 事件中始终包含，即使为空对象 |

## 8. 执行顺序

1. **Phase 1：测试补全**（优先，建立安全网）
   - 编写 `worldBooks.test.js`
   - 运行 `npm test` 确认全部通过

2. **Phase 2：导入导出**
   - 后端 `exportWorldBook()` + `importWorldBook()`
   - 后端路由端点
   - 前端 API 函数
   - 前端 UI 按钮和交互
   - 测试导入导出端点

3. **Phase 3：上下文预算可视化**
   - 后端消息响应增加 `worldBookMeta`
   - 前端提取和显示
   - 流式/非流式响应均覆盖

4. **Phase 4：集成验证**
   - `npm test` 全部通过
   - `npm run build` 成功
   - `node scripts/check-encoding.mjs` 通过
   - 手动验证：创建世界书 → 关联角色 → 发送消息 → 看到注入标签

## 9. 预估工作量

| Phase | 预估时间 |
|---|---|
| Phase 1：测试补全 | 2-3 小时 |
| Phase 2：导入导出 | 2-3 小时 |
| Phase 3：上下文预算可视化 | 1-2 小时 |
| Phase 4：集成验证 | 0.5 小时 |
| **总计** | **6-9 小时** |

## 10. 依赖关系

- 无外部依赖新增（使用现有 `node:sqlite`、Express、Vue）
- Phase 2 和 Phase 3 可并行开发
- Phase 4 依赖 Phase 1-3 全部完成
