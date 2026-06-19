# 世界书系统增强规划

> 日期：2026-06-18
> 来源：backlog.md → AI风月参考功能（高优先级）→ 世界书系统
> 状态：规划中

---

## 一、现状分析

### 已实现功能

经过代码调研，世界书系统**核心功能已完整实现**，包括：

| 功能模块 | 状态 | 关键文件 |
|---------|------|---------|
| 世界书 CRUD | ✅ 完成 | `backend/src/modules/worldBooks.js`, `backend/src/routes/worldBooks.js` |
| 条目 CRUD | ✅ 完成 | 同上 |
| 角色卡绑定（多对多） | ✅ 完成 | `character_world_books` 联结表, `CharacterFormView.vue` |
| 触发词匹配（字符串+正则） | ✅ 完成 | `matchWorldBookEntries()` |
| 自动注入上下文 | ✅ 完成 | `buildWorldBookContext()`, `injectAtDepthEntries()` |
| 递归激活 | ✅ 完成 | `RECURSIVE_MAX_DEPTH = 5` |
| 组内互斥（加权随机） | ✅ 完成 | `applyGroupInclusion()` |
| 概率激活 | ✅ 完成 | `use_probability` + `probability` |
| Sticky / Cooldown / Delay | ✅ 完成 | `world_book_entry_state` 表 |
| Token 预算截断 | ✅ 完成 | `lorebook_context_percent` |
| AI 世界书生成 | ✅ 完成 | `worldBookAssistant.js`, SSE 流式 |
| 前端管理界面 | ✅ 完成 | `WorldBookView.vue`（2247 行） |
| 会话级 Lorebook 绑定 | ✅ 完成 | `chat_lorebook_id`, `ChatSettingsDrawer.vue` |
| 命中可视化 | ✅ 完成 | `ChatMessageItem.vue`, `showWorldBookMatches` |
| 测试覆盖 | ✅ 完成 | `backend.test.js`, `worldBookOwnershipRoutes.test.js`, `frontendWorldBookView.test.js` |

### 关键代码路径

```
用户发送消息
  → conversations.js POST /:id/messages
    → matchWorldBookEntries(db, characterId, recentTexts, { conversationId })
      → 收集角色绑定的世界书（direct + junction）
      → 收集会话绑定的 chat_lorebook_id
      → 按 scan_depth 取最近 N 条消息
      → Phase 0: Sticky 条目
      → Phase 1: always_active 条目
      → Phase 2: 触发词匹配（字符串/正则 + selective + probability）
      → Phase 2.5: 组内互斥
      → Phase 3: 递归激活（最多 5 层）
      → Phase 4: Token 预算截断
      → Phase 5: 更新状态
    → buildWorldBookContext(entries) → 注入 system prompt
    → injectAtDepthEntries(messages, entries) → 注入消息列表
    → buildModelMessagesV2({ worldBookContext, worldBookEntries, ... })
```

---

## 二、本轮迭代目标

鉴于核心功能已完成，本轮迭代聚焦于**体验增强和生产可用性提升**，选取以下高价值改进项：

### 2.1 世界书导入/导出（SillyTavern 兼容格式）

**价值**：用户社区分享世界观设定的基础能力，降低创建门槛。

**技术方案**：
- 导出：将世界书及其条目序列化为 SillyTavern 格式 JSON（`entries` 对象，key 为条目序号）
- 导入：解析 SillyTavern 格式 JSON，映射字段到现有数据模型
- 支持批量导入（覆盖/合并模式）

**需修改的文件**：
- `backend/src/modules/worldBooks.js` — 新增 `exportWorldBook()`, `importWorldBook()`
- `backend/src/routes/worldBooks.js` — 新增 `GET /:id/export`, `POST /import` 路由
- `backend/src/validations/schemas.js` — 新增导入验证 schema
- `frontend/src/api.js` — 新增 `exportWorldBook()`, `importWorldBook()`
- `frontend/src/views/WorldBookView.vue` — 添加导入/导出按钮和文件选择

**SillyTavern 格式映射**：
```
SillyTavern 字段        → FLAI 字段
comment                 → name
content                 → content
key / keysecondary      → triggerKeys / keysSecondary
position                → position (需做枚举映射)
constant / selective    → alwaysActive / selective
disable                 → enabled (取反)
order                   → orderIndex
depth                   → depth
role                    → role
selectiveLogic          → selectiveLogic
addMemo / vectorized    → (忽略)
extensions.cooldown     → cooldown
extensions.delay        → delay
extensions.sticky       → sticky
extensions.probability  → probability / useProbability
extensions.group        → inclusion_group / groupWeight
extensions.lorebook     → (忽略)
```

### 2.2 条目复制与批量操作

**价值**：减少重复创建条目的工作量，提升编辑效率。

**技术方案**：
- 条目复制：创建条目的副本，名称追加"（副本）"
- 批量启用/禁用：选中多个条目后统一切换状态
- 批量删除：选中多个条目后统一删除

**需修改的文件**：
- `backend/src/modules/worldBooks.js` — 新增 `duplicateEntry()`, `batchUpdateEntries()`, `batchDeleteEntries()`
- `backend/src/routes/worldBooks.js` — 新增路由
- `backend/src/validations/schemas.js` — 新增批量操作验证 schema
- `frontend/src/api.js` — 新增 API 函数
- `frontend/src/views/WorldBookView.vue` — 添加批量选择 UI 和操作按钮

### 2.3 世界书搜索与排序增强

**价值**：世界书数量增长后的可发现性保障。

**技术方案**：
- 列表页：支持按名称/描述搜索，按创建时间/更新时间/条目数排序
- 详情页条目列表：支持按名称/触发词搜索，按位置/状态筛选

**需修改的文件**：
- `frontend/src/views/WorldBookView.vue` — 添加搜索输入框和排序/筛选控件（纯前端过滤，数据已全量加载）

### 2.4 世界书全局开关

**价值**：用户可以临时禁用整个世界书而不删除，调试时尤其有用。

**技术方案**：
- `world_books` 表新增 `enabled` 列（`INTEGER NOT NULL DEFAULT 1`）
- 匹配时跳过 `enabled = 0` 的世界书
- 前端列表页和详情页添加全局开关

**需修改的文件**：
- `backend/src/db.js` — `ensureColumn` 迁移
- `backend/src/modules/worldBooks.js` — `listWorldBooks`, `getWorldBook`, `updateWorldBook`, `matchWorldBookEntries` 修改
- `backend/src/routes/worldBooks.js` — `updateWorldBookSchema` 支持 `enabled` 字段
- `backend/src/validations/schemas.js` — schema 更新
- `frontend/src/views/WorldBookView.vue` — 开关 UI
- `frontend/src/api.js` — 更新 payload

---

## 三、DoD（Definition of Done）

1. **导入/导出功能**：
   - [ ] 可导出世界书为 SillyTavern 兼容 JSON 文件
   - [ ] 可导入 SillyTavern 格式 JSON 创建新世界书
   - [ ] 导入时字段映射正确，不丢失关键数据
   - [ ] 导入大文件（50+ 条目）不超时

2. **条目复制与批量操作**：
   - [ ] 可单条复制条目，副本数据完整
   - [ ] 可批量启用/禁用选中条目
   - [ ] 可批量删除选中条目（需二次确认）

3. **搜索与排序**：
   - [ ] 列表页支持名称/描述搜索
   - [ ] 详情页条目支持名称/触发词搜索
   - [ ] 排序选项持久化到本地存储

4. **全局开关**：
   - [ ] 禁用的世界书不参与触发词匹配
   - [ ] 开关状态在列表页和详情页均可操作
   - [ ] 数据库迁移向后兼容

5. **通用要求**：
   - [ ] 所有文件 UTF-8 编码
   - [ ] 后端测试通过：`npm test`
   - [ ] 前端构建通过：`npm run build`
   - [ ] 编码检查通过：`node scripts/check-encoding.mjs`
   - [ ] 门下省审核通过

---

## 四、验收标准

### AC-1：SillyTavern 格式导入/导出
```
Given 用户在世界书详情页
When 点击"导出"按钮
Then 下载 JSON 文件，格式符合 SillyTavern WorldInfo 规范
And 所有条目字段正确映射

Given 用户在世界书列表页
When 上传 SillyTavern 格式 JSON 文件
Then 创建新世界书，条目数据完整导入
And 导入完成后跳转到新世界书详情页
```

### AC-2：条目批量操作
```
Given 用户在世界书详情页，有 3 个条目
When 勾选 2 个条目，点击"批量禁用"
Then 2 个条目状态变为禁用
And 触发词匹配不再匹配已禁用条目
```

### AC-3：搜索与排序
```
Given 用户有 10 个世界书
When 在搜索框输入"魔法"
Then 仅显示名称或描述包含"魔法"的世界书
When 切换排序为"条目数降序"
Then 列表按条目数从多到少排列
```

### AC-4：全局开关
```
Given 一个已绑定角色的世界书
When 在列表页将其全局开关设为禁用
Then 对话中该世界书的条目不再被触发词匹配
When 重新启用
Then 恢复正常匹配
```

---

## 五、技术方案概要

### 5.1 数据库迁移

```sql
-- world_books 表新增 enabled 列
ALTER TABLE world_books ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
```

使用 `ensureColumn()` 模式，与现有迁移机制一致。

### 5.2 SillyTavern 导出格式

```json
{
  "entries": {
    "0": {
      "uid": 0,
      "comment": "条目名称",
      "content": "条目内容",
      "key": ["触发词1", "触发词2"],
      "keysecondary": ["次要词1"],
      "position": 0,
      "constant": false,
      "selective": true,
      "selectiveLogic": 0,
      "disable": false,
      "order": 0,
      "depth": 2,
      "role": 0,
      "extensions": {
        "position": 0,
        "cooldown": null,
        "delay": null,
        "sticky": null,
        "probability": 100,
        "useProbability": false,
        "group": "",
        "groupWeight": 100
      }
    }
  }
}
```

### 5.3 位置枚举映射

| SillyTavern `position` | FLAI `position` |
|------------------------|-----------------|
| 0 (before main) | `before_char` |
| 1 (after main) | `after_char` |
| 2 (top of stack) | `at_start` |
| 3 (at depth) | `at_depth` |

### 5.4 API 端点设计

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/world-books/:id/export` | 导出为 JSON 文件 |
| POST | `/api/world-books/import` | 从 JSON 导入 |
| POST | `/api/world-books/:id/entries/:entryId/duplicate` | 复制条目 |
| POST | `/api/world-books/:id/entries/batch-update` | 批量更新条目状态 |
| POST | `/api/world-books/:id/entries/batch-delete` | 批量删除条目 |

---

## 六、需要修改的文件列表

### 后端

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `backend/src/db.js` | 修改 | `ensureColumn` 添加 `world_books.enabled` |
| `backend/src/modules/worldBooks.js` | 修改 | 新增 `exportWorldBook`, `importWorldBook`, `duplicateEntry`, `batchUpdateEntries`, `batchDeleteEntries`; `matchWorldBookEntries` 过滤 `enabled=0` 的书 |
| `backend/src/routes/worldBooks.js` | 修改 | 新增 5 个路由端点 |
| `backend/src/validations/schemas.js` | 修改 | 新增导入/batch 验证 schema |
| `backend/src/tests/backend.test.js` | 修改 | 新增导入/导出/批量操作/全局开关测试 |
| `backend/src/tests/worldBookOwnershipRoutes.test.js` | 修改 | 新增所有权验证测试 |

### 前端

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `frontend/src/api.js` | 修改 | 新增 5 个 API 函数 |
| `frontend/src/views/WorldBookView.vue` | 修改 | 导入/导出按钮、批量选择 UI、搜索排序、全局开关 |
| `frontend/src/tests/frontendWorldBookView.test.js` | 修改 | 新增源码断言 |

---

## 七、风险点

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| SillyTavern 格式变化 | 导入失败 | 版本检测 + 宽松解析 + 友好错误提示 |
| 大文件导入超时 | 用户体验差 | 限制单次导入条目数（≤200），进度反馈 |
| 批量操作误删 | 数据丢失 | 二次确认对话框，显示即将删除的条目名称 |
| `enabled` 列迁移 | 现有数据兼容 | `DEFAULT 1` 确保现有世界书默认启用 |
| 条目复制触发 `order_index` 冲突 | 排序异常 | 复制时取 `MAX(order_index) + 1` |
| 前端 WorldBookView.vue 已有 2247 行 | 继续膨胀 | 新增功能使用 composables 抽离逻辑 |

---

## 八、实施顺序建议

1. **第一步**：数据库迁移 + 全局开关（改动最小，独立可测）
2. **第二步**：条目复制 + 批量操作（纯增量功能）
3. **第三步**：搜索与排序（纯前端改动）
4. **第四步**：导入/导出（最复杂，依赖前三步的稳定基础）

---

## 九、工作量估算

| 功能 | 预估工时 | 复杂度 |
|------|---------|--------|
| 全局开关 | 0.5h | 低 |
| 搜索与排序 | 1h | 低 |
| 条目复制 + 批量操作 | 2h | 中 |
| 导入/导出 | 3h | 高 |
| 测试 + 审核 | 2h | 中 |
| **合计** | **8.5h** | — |

---

## 十、依赖与前置条件

- 无外部依赖
- 不涉及数据迁移风险（`ensureColumn` 向后兼容）
- 不涉及 `backend/data/flai.sqlite` 直接操作
- 不涉及用户对话数据外传
