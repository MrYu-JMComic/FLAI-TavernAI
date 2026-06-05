# TASK-20260603-001 — 世界书系统：补全前端 UI 与端到端验证

## 基本信息

| 字段 | 内容 |
|------|------|
| 任务 ID | TASK-20260603-001 |
| 来源 | backlog.md Ready 区域 · 高优先级第一项 |
| 规划日期 | 2026-06-03 |
| 状态 | 📋 已规划，待尚书省执行 |

---

## 目标描述

backlog 原文：**「世界书系统：角色卡附加世界观设定，触发词自动注入上下文」**

经过代码审查发现，世界书系统的**后端已基本完成**（包括 CRUD、触发词匹配引擎、正则模式、选择性过滤、概率激活、包含组、递归激活、Token 预算、at_depth 注入、Sticky/Cooldown/Delay、聊天世界书等），共 8 份自动化报告记录了增量开发过程。

**核心差距在前端**：WorldBookView.vue 条目编辑表单仅暴露了基础字段（name、triggerKeys、content、position、enabled），后端已支持的 14+ 高级参数在 UI 上不可见、不可编辑。

本任务目标：**补全世界书前端 UI，使所有后端能力可达用户，并完成端到端验证。**

---

## DoD 验收标准

### 功能完整性

- [ ] 1. 世界书条目编辑表单暴露所有后端支持的高级字段：
  - [ ] `regexMode` — 正则模式开关
  - [ ] `alwaysActive` — 始终激活开关
  - [ ] `selective` + `keysSecondary` + `selectiveLogic` — 选择性过滤（含逻辑模式：OR/NOT/NOT ALL）
  - [ ] `useProbability` + `probability` — 概率激活
  - [ ] `inclusionGroup` + `groupWeight` — 包含组与权重
  - [ ] `role` — 注入角色（system/user/assistant）
  - [ ] `depth` — at_depth 模式下的深度值
  - [ ] `sticky` / `cooldown` / `delay` — 粘滞/冷却/延迟参数
- [ ] 2. 条目列表卡片显示关键高级属性标签（如 "始终激活"、"正则"、"概率 50%" 等）
- [ ] 3. 角色编辑表单（CharacterFormView.vue）支持选择并关联多个世界书（通过 `character_world_books` 接口），而非仅单个 `worldBookId`
- [ ] 4. `at_depth` 位置选项出现在注入位置下拉中（当前仅有 at_start/before_char/after_char）
- [ ] 5. 聊天视图（ChatView.vue）的世界书选择器可正常工作，聊天世界书在对话中被正确匹配和注入

### 质量保证

- [ ] 6. 后端现有 86 个测试全部通过（`npm test`）
- [ ] 7. 新增后端测试覆盖至少 3 个场景：
  - [ ] `alwaysActive` 条目无需触发词即可匹配
  - [ ] `regexMode` 条目按正则匹配触发
  - [ ] `selective` + `selectiveLogic` 过滤逻辑正确
- [ ] 8. 前端构建通过（`npm run build`）
- [ ] 9. `node scripts/check-encoding.mjs` 通过
- [ ] 10. 所有新写/修改的文件为 UTF-8 编码

### 文档

- [ ] 11. 写入实施报告到 `automation/reports/`

---

## 技术方案概要

### 现状分析

#### 后端（✅ 已完成）

| 模块 | 文件 | 状态 |
|------|------|------|
| 世界书 CRUD | `backend/src/modules/worldBooks.js` | ✅ 完整 |
| 条目 CRUD | 同上 | ✅ 完整 |
| 触发词匹配引擎 | 同上 `matchWorldBookEntries()` | ✅ 含正则、选择性、概率、递归 |
| Token 预算管理 | 同上 Phase 5 | ✅ |
| at_depth 注入 | 同上 `injectAtDepthEntries()` | ✅ |
| Sticky/Cooldown/Delay | 同上 + `world_book_entry_state` 表 | ✅ |
| 字符-世界书关联 | `character_world_books` 表 + 路由 | ✅ |
| 聊天世界书 | `conversations.chat_lorebook_id` | ✅ |
| API 路由 | `backend/src/routes/worldBooks.js` | ✅ |
| 数据库 Schema | `backend/src/db.js` | ✅ 含所有列迁移 |
| 验证 Schema | `backend/src/validations/schemas.js` | ✅ |

#### 前端（⚠️ 需补全）

| 组件 | 文件 | 状态 |
|------|------|------|
| 世界书列表/详情页 | `frontend/src/views/WorldBookView.vue` | ⚠️ 条目编辑仅暴露 5 个基础字段 |
| 角色编辑表单 | `frontend/src/views/CharacterFormView.vue` | ⚠️ 仅单个 worldBookId 下拉 |
| 聊天世界书选择器 | `frontend/src/views/ChatView.vue` | ✅ 基本可用 |
| API 封装 | `frontend/src/api.js` | ✅ 完整 |

### 实施步骤

#### Step 1：扩展 WorldBookView.vue 条目编辑表单

**文件**：`D:\Cat\FLAI-TavernAI\frontend\src\views\WorldBookView.vue`

将 `editingEntry` reactive 对象扩展为包含所有高级字段：

```javascript
// 当前仅 5 个字段
editingEntry: { name, triggerKeys, content, position, enabled }

// 扩展为完整字段
editingEntry: {
  name, triggerKeys, content, position, enabled,
  regexMode, alwaysActive, depth,
  selective, selectiveLogic, keysSecondary,
  useProbability, probability,
  inclusionGroup, groupWeight,
  role,
  sticky, cooldown, delay
}
```

UI 布局建议：
- **基础区域**（默认展开）：name、triggerKeys、content、position、enabled
- **高级区域**（可折叠面板）：
  - 正则模式开关 + 始终激活开关（同一行）
  - 选择性过滤：开关 + 二级触发词 + 逻辑选择（OR/NOT/NOT ALL）
  - 概率激活：开关 + 滑块（0-100%）
  - 包含组：组名 + 权重
  - 注入角色：system/user/assistant 下拉
  - at_depth 深度值（仅当 position=at_depth 时显示）
  - 粘滞/冷却/延迟：三个数字输入

同时扩展 `openEditEntry()` 函数以回填所有高级字段，扩展 `saveEntry()` 以提交完整 payload。

#### Step 2：条目列表卡片增强

**文件**：`D:\Cat\FLAI-TavernAI\frontend\src\views\WorldBookView.vue`

在条目行的 `entry-header` 区域增加属性标签（chips），例如：
- `正则` (regexMode)
- `始终激活` (alwaysActive)
- `概率 50%` (useProbability)
- `包含组: xxx` (inclusionGroup)
- `深度 N` (position=at_depth)
- `Sticky N` / `CD N` / `Delay N`

使用现有 CSS 变量和 `.entry-position` 标签样式。

#### Step 3：增加 at_depth 位置选项

**文件**：`D:\Cat\FLAI-TavernAI\frontend\src\views\WorldBookView.vue`

在 `positionOptions` 数组中添加：

```javascript
{ value: 'at_depth', label: '指定深度 (at_depth)' }
```

当选择 `at_depth` 时，条件显示 `depth` 输入框。

#### Step 4：角色表单多世界书关联

**文件**：`D:\Cat\FLAI-TavernAI\frontend\src\views\CharacterFormView.vue`

当前角色表单通过 `form.worldBookId` 关联单个世界书。需要改为：

1. 使用 `fetchWorldBooks()` 获取所有世界书（已有）
2. 将单选下拉改为多选复选列表或 tag 式多选
3. 保存时调用 `linkWorldBookToCharacter` API（已有后端支持）
4. 编辑时通过 `getWorldBook` 返回的 `linkedCharacters` 或后端新增接口获取已关联的世界书列表

可能需要后端新增一个路由：`GET /api/characters/:id/world-books` 返回角色关联的所有世界书（已有模块函数 `listCharacterWorldBooks()`，需确认路由是否已暴露）。

#### Step 5：后端路由补全（如需要）

**文件**：`D:\Cat\FLAI-TavernAI\backend\src\routes\characters.js`

检查是否有 `GET /api/characters/:id/world-books` 路由。如无，使用已有的 `listCharacterWorldBooks()` 模块函数添加：

```javascript
router.get('/:id/world-books', requireAuth, (req, res) => {
  const books = listCharacterWorldBooks(db, req.params.id);
  res.json(books);
});
```

#### Step 6：新增后端测试

**文件**：`D:\Cat\FLAI-TavernAI\backend\src\tests\backend.test.js`

新增测试用例：

1. **alwaysActive 条目匹配**：创建 alwaysActive=true 的条目，不提供任何触发文本，验证匹配结果包含该条目
2. **regexMode 正则匹配**：创建 regexMode=true、triggerKeys=`\d+` 的条目，提供含数字的文本，验证匹配
3. **selective 逻辑过滤**：创建 selective=true、逻辑模式为 NOT 的条目，验证二级键存在时不匹配

---

## 涉及文件列表

### 需修改的文件

| 文件 | 修改内容 |
|------|---------|
| `D:\Cat\FLAI-TavernAI\frontend\src\views\WorldBookView.vue` | 扩展条目编辑表单、列表标签、at_depth 选项 |
| `D:\Cat\FLAI-TavernAI\frontend\src\views\CharacterFormView.vue` | 多世界书关联 UI |
| `D:\Cat\FLAI-TavernAI\backend\src\routes\characters.js` | 可能需新增角色世界书列表路由 |
| `D:\Cat\FLAI-TavernAI\backend\src\tests\backend.test.js` | 新增 3 个测试用例 |

### 只读参考文件（不修改）

| 文件 | 用途 |
|------|------|
| `D:\Cat\FLAI-TavernAI\backend\src\modules\worldBooks.js` | 后端模块参考 |
| `D:\Cat\FLAI-TavernAI\backend\src\routes\worldBooks.js` | API 路由参考 |
| `D:\Cat\FLAI-TavernAI\backend\src\db.js` | Schema 参考 |
| `D:\Cat\FLAI-TavernAI\frontend\src\api.js` | API 封装参考 |
| `D:\Cat\FLAI-TavernAI\frontend\src\views\ChatView.vue` | 聊天世界书集成参考 |

---

## 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| 条目编辑表单扩展后 UI 过于复杂 | 🟡 中 | 使用可折叠「高级选项」面板，默认收起 |
| 多世界书关联改动角色表单逻辑较多 | 🟡 中 | 保持单选与多选兼容，渐进迁移 |
| 角色世界书路由可能已存在但未暴露 | 🟢 低 | 先检查 `characters.js` 路由文件，再决定是否新增 |
| 后端测试新增可能导致现有测试不稳定 | 🟢 低 | 使用独立数据、清理 test fixture |
| 前端 CSS 样式冲突 | 🟢 低 | 使用 scoped styles，参考现有标签样式 |

---

## 预计工作量

| 步骤 | 预计时间 | 复杂度 |
|------|---------|--------|
| Step 1：扩展条目编辑表单 | 30-45 min | 中 |
| Step 2：条目列表标签增强 | 10-15 min | 低 |
| Step 3：at_depth 位置选项 | 5-10 min | 低 |
| Step 4：角色多世界书关联 UI | 20-30 min | 中 |
| Step 5：后端路由补全 | 10-15 min | 低 |
| Step 6：新增后端测试 | 20-30 min | 中 |
| **合计** | **~2-2.5 小时** | |

建议分 2 个子任务执行：
1. **子任务 A**：Step 1-3（WorldBookView.vue 增强）— 约 1 小时
2. **子任务 B**：Step 4-6（角色关联 + 测试）— 约 1-1.5 小时

---

## 备注

- 本任务后端工作量极小（可能仅 1 个路由），主要工作在前端 Vue 组件
- 世界书系统已有 8 份增量报告，说明此前已通过多轮迭代完成了后端核心功能
- 执行时需遵循 AGENTS.md 的编码规则：UTF-8、运行 `check-encoding.mjs`、使用 Claude Code/OpenCode 作为代码编辑执行器
- 所有修改需通过门下省审核（`scripts/review-gate.ps1`）
