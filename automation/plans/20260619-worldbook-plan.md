# 任务规格：世界书系统增强 — 角色卡附加世界观设定

> 任务ID：JJC-20260619-001
> 日期：2026-06-19
> 来源：backlog.md → AI风月参考功能（高优先级）→ 世界书系统
> 状态：规划中

---

## 一、任务背景

**Backlog 原文**：
> 世界书系统：角色卡附加世界观设定，触发词自动注入上下文

### 1.1 现状调查结论

经完整代码调查，**核心功能已 100% 实现**：

| 功能 | 状态 | 关键实现 |
|------|------|---------|
| 世界书 CRUD | ✅ | `backend/src/modules/worldBooks.js` |
| 条目 CRUD（含全部高级字段） | ✅ | 同上，支持 triggerKeys / regexMode / selective / alwaysActive / depth / probability / sticky / cooldown / delay |
| 角色卡 ↔ 世界书多对多绑定 | ✅ | `character_world_books` 联结表 + `CharacterFormView.vue` 选择弹窗 |
| 触发词匹配引擎 | ✅ | `matchWorldBookEntries()` — 字符串/正则 + selective + probability + cooldown/delay |
| 自动注入上下文 | ✅ | `buildWorldBookContext()` 注入 system prompt + `injectAtDepthEntries()` 注入消息列表 |
| 递归激活（最多 5 层） | ✅ | `RECURSIVE_MAX_DEPTH = 5` |
| 组内互斥（加权随机） | ✅ | `applyGroupInclusion()` |
| Token 预算截断 | ✅ | `lorebook_context_percent` |
| AI 世界书生成（SSE 流式） | ✅ | `worldBookAssistant.js` |
| 前端管理界面 | ✅ | `WorldBookView.vue`（2247 行） |
| 会话级 Lorebook 绑定 | ✅ | `chat_lorebook_id` + `ChatSettingsDrawer.vue` |
| 命中可视化 | ✅ | `ChatMessageItem.vue` + `latestWorldBookMatches` |
| 测试覆盖 | ✅ | `backend.test.js`, `worldBookOwnershipRoutes.test.js`, `frontendWorldBookView.test.js` |

### 1.2 核心数据流

```
用户发送消息
  → POST /api/conversations/:id/messages
    → matchWorldBookEntries(db, characterId, recentTexts, { conversationId })
      ├─ 收集角色绑定的世界书（world_books.character_id + character_world_books）
      ├─ 收集会话绑定的 chat_lorebook_id
      ├─ Phase 0: Sticky 条目
      ├─ Phase 1: always_active 条目
      ├─ Phase 2: 触发词匹配（字符串/正则 + selective + probability）
      ├─ Phase 2.5: 组内互斥（加权随机）
      ├─ Phase 3: 递归激活（最多 5 层）
      ├─ Phase 4: Token 预算截断（lorebook_context_percent）
      └─ Phase 5: 更新条目状态
    → buildWorldBookContext(entries) → 拼入 system prompt
    → injectAtDepthEntries(messages, entries) → 按 depth 插入消息列表
    → 发送给 LLM
```

### 1.3 关键文件清单

| 层级 | 文件 | 职责 |
|------|------|------|
| DB Schema | `D:\Cat\FLAI-TavernAI\backend\src\db.js` | `world_books`, `world_book_entries`, `character_world_books`, `world_book_entry_state` 四张表 |
| 核心逻辑 | `D:\Cat\FLAI-TavernAI\backend\src\modules\worldBooks.js` | CRUD + `matchWorldBookEntries()` + `buildWorldBookContext()` + `injectAtDepthEntries()` |
| 路由 | `D:\Cat\FLAI-TavernAI\backend\src\routes\worldBooks.js` | REST API + AI 生成端点 |
| 对话集成 | `D:\Cat\FLAI-TavernAI\backend\src\routes\conversations.js` | `buildModelMessagesV2()` 中注入世界书上下文 |
| AI 助手 | `D:\Cat\FLAI-TavernAI\backend\src\services\worldBookAssistant.js` | AI 生成世界书 draft |
| 验证 | `D:\Cat\FLAI-TavernAI\backend\src\validations\schemas.js` | 请求体校验 |
| 前端 API | `D:\Cat\FLAI-TavernAI\frontend\src\api.js` | `fetchWorldBooks`, `createWorldBook` 等 |
| 前端视图 | `D:\Cat\FLAI-TavernAI\frontend\src\views\WorldBookView.vue` | 世界书管理界面 |
| 角色表单 | `D:\Cat\FLAI-TavernAI\frontend\src\views\CharacterFormView.vue` | 世界书选择弹窗 + 绑定逻辑 |

---

## 二、本轮迭代目标

鉴于核心功能已完成，本轮聚焦于**社区分享能力和编辑效率提升**，选取 4 项高价值增强：

### 2.1 世界书导入/导出（SillyTavern 兼容格式）

**价值**：用户社区分享世界观设定的基础能力，降低创建门槛，是"AI风月参考"的核心体验。

**技术方案**：
- **导出**：`GET /api/world-books/:id/export` → 序列化为 SillyTavern 格式 JSON
- **导入**：`POST /api/world-books/import` → 解析 SillyTavern 格式 JSON，映射字段到现有数据模型
- 支持覆盖/合并模式

**SillyTavern 字段映射**：

| SillyTavern 字段 | FLAI 字段 |
|------------------|-----------|
| `comment` | `name` |
| `content` | `content` |
| `key` / `keysecondary` | `triggerKeys` / `keysSecondary` |
| `position` (0/1/2/3) | `position` (`before_char`/`after_char`/`at_start`/`at_depth`) |
| `constant` / `selective` | `alwaysActive` / `selective` |
| `disable` | `enabled`（取反） |
| `order` | `orderIndex` |
| `depth` | `depth` |
| `role` | `role` |
| `selectiveLogic` | `selectiveLogic` |
| `extensions.cooldown` | `cooldown` |
| `extensions.delay` | `delay` |
| `extensions.sticky` | `sticky` |
| `extensions.probability` | `probability` / `useProbability` |
| `extensions.group` | `inclusion_group` / `groupWeight` |

### 2.2 世界书全局开关

**价值**：用户可临时禁用整个世界书而不删除，调试时尤其有用。

**技术方案**：
- `world_books` 表新增 `enabled` 列（`INTEGER NOT NULL DEFAULT 1`）
- `matchWorldBookEntries()` 跳过 `enabled = 0` 的世界书
- 前端列表页和详情页添加全局开关

### 2.3 条目复制与批量操作

**价值**：减少重复创建条目的工作量，提升编辑效率。

**技术方案**：
- 条目复制：`POST /api/world-books/:id/entries/:entryId/duplicate`
- 批量启用/禁用：`POST /api/world-books/:id/entries/batch-update`
- 批量删除：`POST /api/world-books/:id/entries/batch-delete`（需二次确认）

### 2.4 条目搜索与筛选

**价值**：世界书条目数量增长后的可发现性保障。

**技术方案**：纯前端实现，数据已全量加载
- 条目列表支持按名称/触发词搜索
- 按位置（position）/ 状态（enabled/disabled）筛选

---

## 三、DoD（完成定义）

### DOD-1：SillyTavern 格式导入/导出
- [ ] 世界书详情页可导出为 SillyTavern 兼容 JSON 文件
- [ ] 世界书列表页可导入 SillyTavern 格式 JSON 创建新世界书
- [ ] 导入时字段映射正确，不丢失关键数据（触发词、内容、位置、高级属性）
- [ ] 导入大文件（50+ 条目）不超时
- [ ] 导入格式异常时给出友好错误提示

### DOD-2：全局开关
- [ ] `world_books` 表新增 `enabled` 列，迁移向后兼容
- [ ] 禁用的世界书不参与触发词匹配
- [ ] 开关状态在列表页和详情页均可操作
- [ ] 开关切换后立即生效（无需重新进入对话）

### DOD-3：条目复制与批量操作
- [ ] 可单条复制条目，副本数据完整（名称追加"（副本）"）
- [ ] 可批量启用/禁用选中条目
- [ ] 可批量删除选中条目（需二次确认对话框，显示条目名称）

### DOD-4：条目搜索与筛选
- [ ] 详情页条目列表支持按名称/触发词搜索
- [ ] 可按位置或状态筛选条目
- [ ] 搜索/筛选为纯前端过滤，无额外 API 请求

### DOD-5：通用要求
- [ ] 所有文件 UTF-8 编码
- [ ] 后端测试通过：`npm test`
- [ ] 前端构建通过：`npm run build`
- [ ] 编码检查通过：`node scripts/check-encoding.mjs`
- [ ] 门下省审核通过

---

## 四、技术方案

### 4.1 数据库迁移

```sql
-- world_books 表新增 enabled 列
ALTER TABLE world_books ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
```

使用 `ensureColumn()` 模式（`D:\Cat\FLAI-TavernAI\backend\src\db.js`），与现有迁移机制一致。

### 4.2 新增 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/world-books/:id/export` | 导出为 SillyTavern JSON |
| POST | `/api/world-books/import` | 从 SillyTavern JSON 导入 |
| POST | `/api/world-books/:id/entries/:entryId/duplicate` | 复制条目 |
| POST | `/api/world-books/:id/entries/batch-update` | 批量更新条目状态 |
| POST | `/api/world-books/:id/entries/batch-delete` | 批量删除条目 |

### 4.3 需修改的文件

#### 后端

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `D:\Cat\FLAI-TavernAI\backend\src\db.js` | 修改 | `ensureColumn` 添加 `world_books.enabled` |
| `D:\Cat\FLAI-TavernAI\backend\src\modules\worldBooks.js` | 修改 | 新增 `exportWorldBook()`, `importWorldBook()`, `duplicateEntry()`, `batchUpdateEntries()`, `batchDeleteEntries()`；`matchWorldBookEntries()` 过滤 `enabled=0` |
| `D:\Cat\FLAI-TavernAI\backend\src\routes\worldBooks.js` | 修改 | 新增 5 个路由端点 |
| `D:\Cat\FLAI-TavernAI\backend\src\validations\schemas.js` | 修改 | 新增导入/batch 验证 schema |
| `D:\Cat\FLAI-TavernAI\backend\src\tests\backend.test.js` | 修改 | 新增导入/导出/批量操作/全局开关测试 |
| `D:\Cat\FLAI-TavernAI\backend\src\tests\worldBookOwnershipRoutes.test.js` | 修改 | 新增所有权验证测试 |

#### 前端

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `D:\Cat\FLAI-TavernAI\frontend\src\api.js` | 修改 | 新增 5 个 API 函数 |
| `D:\Cat\FLAI-TavernAI\frontend\src\views\WorldBookView.vue` | 修改 | 导入/导出按钮、批量选择 UI、搜索筛选、全局开关 |

---

## 五、风险评估

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| SillyTavern 格式版本差异 | 导入字段映射失败 | 中 | 宽松解析 + 缺失字段用默认值 + 友好错误提示 |
| 大文件导入超时 | 用户体验差 | 低 | 限制单次导入条目数（≤200），后端同步处理（无需 SSE） |
| 批量操作误删 | 数据丢失 | 低 | 二次确认对话框，显示即将删除的条目名称 |
| `enabled` 列迁移 | 现有数据兼容 | 极低 | `DEFAULT 1` 确保现有世界书默认启用 |
| 条目复制触发 `order_index` 冲突 | 排序异常 | 极低 | 复制时取 `MAX(order_index) + 1` |
| WorldBookView.vue 已有 2247 行 | 继续膨胀 | 中 | 新增 UI 逻辑使用 composables 抽离，或拆分子组件 |

---

## 六、验收标准（可测试条件）

### AC-1：SillyTavern 格式导入/导出
```
Given  用户在世界书详情页，世界书有 3 个条目（含 always_active、普通触发词、正则各一）
When   点击"导出"按钮
Then   下载 JSON 文件，格式符合 SillyTavern WorldInfo 规范
And    所有条目字段正确映射（name, content, triggerKeys, position, enabled 等）

Given  用户在世界书列表页
When   上传 SillyTavern 格式 JSON 文件（含 5 个条目）
Then   创建新世界书，条目数据完整导入
And    导入完成后跳转到新世界书详情页
And    条目数量 = 5
```

### AC-2：全局开关
```
Given  一个已绑定角色的世界书，有 always_active 条目
When   在列表页将其全局开关设为禁用
Then   对话中该世界书的条目不再被触发词匹配
And    always_active 条目也不再注入
When   重新启用
Then   恢复正常匹配
```

### AC-3：条目批量操作
```
Given  用户在世界书详情页，有 5 个条目
When   勾选 3 个条目，点击"批量禁用"
Then   3 个条目状态变为禁用
And    触发词匹配不再匹配已禁用条目

When   勾选 2 个条目，点击"批量删除"
Then   弹出确认对话框，显示 2 个条目名称
When   确认删除
Then   2 个条目被删除，剩余 3 个条目
```

### AC-4：条目搜索与筛选
```
Given  世界书有 10 个条目，其中 3 个 position = "at_depth"
When   在搜索框输入"魔法"
Then   仅显示名称或触发词包含"魔法"的条目
When   清空搜索，筛选 position = "at_depth"
Then   仅显示 3 个 at_depth 条目
```

### AC-5：编码与测试
```
Given  所有改动完成
When   运行 node scripts/check-encoding.mjs
Then   无编码错误
When   运行 npm test（backend）
Then   所有测试通过
When   运行 npm run build（frontend）
Then   构建成功
```

---

## 七、实施顺序建议

| 步骤 | 功能 | 复杂度 | 预估工时 | 依赖 |
|------|------|--------|---------|------|
| 1 | 数据库迁移 + 全局开关 | 低 | 0.5h | 无 |
| 2 | 条目搜索与筛选（纯前端） | 低 | 1h | 无 |
| 3 | 条目复制 + 批量操作 | 中 | 2h | 步骤 1 |
| 4 | SillyTavern 导入/导出 | 高 | 3h | 步骤 1 |
| 5 | 测试 + 编码检查 + 审核 | 中 | 1.5h | 步骤 1-4 |
| **合计** | | | **8h** | |

---

## 八、注意事项

1. **不修改代码**：本文件仅为规划，实际编码由尚书省（OpenCode/Claude Code）执行
2. **编码规范**：所有文件必须 UTF-8，修改后运行 `node scripts/check-encoding.mjs`
3. **安全边界**：不涉及 `backend/data/flai.sqlite` 直接操作、不涉及用户对话数据外传
4. **AGENTS.md 合规**：中书省已立项，尚书省可行动；门下省审核后方可合并
