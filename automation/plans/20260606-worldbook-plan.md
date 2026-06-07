# 任务规格：世界书系统增强

## 任务 ID
`20260606-worldbook-enhance`

## 任务标题
世界书系统增强 — 补齐导入/导出、搜索过滤、克隆功能

## 背景分析

### 现有实现（已完成）

经过代码审查，世界书系统的核心功能已经完整实现：

| 功能 | 状态 | 关键文件 |
|------|------|----------|
| 世界书 CRUD | ✅ 完成 | `backend/src/modules/worldBooks.js`, `backend/src/routes/worldBooks.js` |
| 条目 CRUD（含全部高级属性） | ✅ 完成 | 同上 |
| 角色卡 ↔ 世界书关联 | ✅ 完成 | `character_world_books` 联合表, `CharacterFormView.vue` |
| 触发词匹配与上下文注入 | ✅ 完成 | `matchWorldBookEntries()` + `buildWorldBookContext()` |
| at_depth 深度注入 | ✅ 完成 | `injectAtDepthEntries()` |
| AI 世界书生成 | ✅ 完成 | `worldBookAssistant.js`, 前端流式 UI |
| 对话级世界书绑定 | ✅ 完成 | `conversations.chat_lorebook_id`, `ChatSettingsDrawer.vue` |
| 递归激活 | ✅ 完成 | `matchWorldBookEntries()` Phase 3 |
| Sticky / Cooldown / Delay | ✅ 完成 | `world_book_entry_state` 表 |
| Token 预算截断 | ✅ 完成 | `lorebookContextPercent` 逻辑 |
| 角色卡导入/导出含世界书 | ✅ 完成 | `characters.js` route 的 export/import |
| 世界书前端管理界面 | ✅ 完成 | `WorldBookView.vue` |

### 缺失功能（本任务范围）

| 缺失功能 | 优先级 | 说明 |
|----------|--------|------|
| 独立世界书 JSON 导入/导出 | 高 | 当前只能通过角色卡导出带世界书，无法独立导出/分享世界书 |
| 世界书列表搜索/过滤 | 高 | 世界书数量增多后无法快速定位 |
| 条目搜索/过滤 | 中 | 大型世界书（20+ 条目）难以管理 |
| 世界书克隆 | 中 | 无法快速复制一个世界书作为变体基础 |

## DoD（Definition of Done）

1. 用户可以在世界书列表页独立导出任意世界书为 JSON 文件
2. 用户可以导入 JSON 文件创建新世界书（含全部条目）
3. 世界书列表页支持按名称/描述搜索过滤
4. 世界书详情页支持按名称/触发词/内容搜索条目
5. 用户可以一键克隆一个世界书（含全部条目）
6. 所有新增 API 有对应的输入校验
7. `npm test` 通过
8. `npm run build`（前端）通过
9. `node scripts/check-encoding.mjs` 通过

## 验收标准

### AC-1：独立世界书导出
- **给定** 用户在世界书列表页或详情页
- **当** 点击"导出"按钮
- **则** 浏览器下载一个 `{书名}.flai-worldbook.json` 文件，包含：
  - `_flai_worldbook_export_version: 1`
  - `exported_at` ISO 时间戳
  - `worldBook` 对象（name, description, scanDepth, lorebookContextPercent）
  - `entries` 数组（含全部字段：name, triggerKeys, content, position, enabled, regexMode, alwaysActive, depth, role, selective, selectiveLogic, keysSecondary, probability, useProbability, group, groupWeight, sticky, cooldown, delay）

### AC-2：独立世界书导入
- **给定** 用户在世界书列表页
- **当** 点击"导入"按钮并选择一个 `.flai-worldbook.json` 或兼容的 SillyTavern world_info JSON 文件
- **则** 系统解析文件，创建新世界书及全部条目，跳过无效条目，显示成功提示并跳转到详情页
- **且** 导入失败时显示具体错误信息

### AC-3：世界书列表搜索
- **给定** 用户在世界书列表页
- **当** 在搜索框输入关键词
- **则** 列表实时过滤，匹配世界书名称或描述中包含关键词的项目
- **且** 搜索框为空时显示全部世界书
- **且** 无匹配结果时显示"未找到匹配的世界书"

### AC-4：条目搜索
- **给定** 用户在世界书详情页
- **当** 在条目搜索框输入关键词
- **则** 条目列表实时过滤，匹配条目名称、触发词或内容中包含关键词的项目
- **且** 搜索框为空时显示全部条目

### AC-5：世界书克隆
- **给定** 用户在世界书列表页或详情页
- **当** 点击"克隆"按钮
- **则** 系统创建一个新世界书，名称为 `{原名}（副本）`，复制全部属性和条目
- **且** 克隆成功后跳转到新世界书详情页

## 技术方案

### 一、后端改动

#### 1. 新增导出 API
**文件：** `backend/src/routes/worldBooks.js`

新增路由 `GET /api/world-books/:id/export`：
- 验证用户身份和世界书所有权
- 查询世界书及其全部条目
- 返回标准化 JSON 格式（参考角色卡导出格式）

#### 2. 新增导入 API
**文件：** `backend/src/routes/worldBooks.js`

新增路由 `POST /api/world-books/import`：
- 接收 JSON body（非文件上传，前端读取文件后 POST）
- 支持两种格式：
  - FLAI 格式（`_flai_worldbook_export_version`）
  - SillyTavern 格式（`entries` 对象，key 为条目名称）
- 校验并创建世界书和条目
- 返回创建的世界书

#### 3. 新增克隆 API
**文件：** `backend/src/routes/worldBooks.js`

新增路由 `POST /api/world-books/:id/clone`：
- 验证用户身份和世界书所有权
- 复制世界书基本信息（名称加"（副本）"后缀）
- 复制全部条目
- 返回新世界书

#### 4. 输入校验
**文件：** `backend/src/validations/schemas.js`

新增 schema：
- `importWorldBookSchema`：校验导入 JSON 结构
- `cloneWorldBookSchema`：无额外参数，仅验证路径参数

### 二、前端改动

#### 5. API 函数
**文件：** `frontend/src/api.js`

新增：
- `exportWorldBook(id)` → fetch + blob download
- `importWorldBook(data)` → POST JSON
- `cloneWorldBook(id)` → POST

#### 6. 世界书列表页增强
**文件：** `frontend/src/views/WorldBookView.vue`

改动：
- 添加搜索框（在列表上方），使用 `computed` 过滤 `books`
- 每个书卡添加"克隆"按钮
- 添加"导入"按钮（带隐藏 file input，accept `.json`）
- 概览区添加"导出全部"（可选，低优先级）

#### 7. 世界书详情页增强
**文件：** `frontend/src/views/WorldBookView.vue`

改动：
- 条目列表上方添加搜索框，过滤 `currentEntries`
- 标题区添加"导出"和"克隆"按钮

### 三、文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/src/routes/worldBooks.js` | 修改 | 添加 export/import/clone 路由 |
| `backend/src/validations/schemas.js` | 修改 | 添加导入校验 schema |
| `frontend/src/api.js` | 修改 | 添加 3 个 API 函数 |
| `frontend/src/views/WorldBookView.vue` | 修改 | UI 增强（搜索、导入/导出/克隆按钮） |
| `backend/src/tests/worldBooks.test.js` | 新建 | 世界书导入/导出/克隆测试 |

### 四、SillyTavern 兼容导入格式

SillyTavern 的 world_info 格式为：
```json
{
  "entries": {
    "0": {
      "key": ["触发词1", "触发词2"],
      "content": "注入内容",
      "comment": "条目名称",
      "enabled": true,
      "position": 0,
      "selective": false,
      "constant": false,
      "vectorized": false,
      "extensions": { "position": 0, "exclude_recursion": false, ... }
    }
  }
}
```

导入时需做字段映射：
- `key` 数组 → `triggerKeys`（逗号拼接）
- `content` → `content`
- `comment` → `name`
- `enabled` → `enabled`
- `position` 数字 → `position` 字符串映射（0→before_char, 1→after_char, 2→at_start）
- `constant` → `alwaysActive`
- `selective` → `selective`
- `extensions.position` → `depth`

## 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 导入恶意/畸形 JSON 导致后端崩溃 | 中 | 严格 Zod 校验 + try-catch 兜底，限制条目数量 ≤ 100 |
| 大世界书导出文件过大 | 低 | 条目内容上限 50000 字，单文件不超过几 MB |
| SillyTavern 格式变化导致兼容性问题 | 低 | 做容错解析，未知字段忽略，仅映射核心字段 |
| 搜索性能（大量条目） | 低 | 前端 computed 过滤，世界书条目通常 < 100 个 |
| 克隆操作创建大量条目 | 低 | 复用现有 createEntry 逻辑，单次事务内完成 |

## 依赖与前置条件

- 无外部依赖
- 无数据库 schema 变更（使用现有表结构）
- 无新 npm 包

## 预估工作量

- 后端 API（export/import/clone）：~2h
- 前端 UI（搜索 + 按钮 + 导入逻辑）：~2h
- 测试：~1h
- **总计：~5h**
