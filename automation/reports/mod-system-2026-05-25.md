# Mod 系统实现报告

**日期**: 2026-05-25  
**任务**: 为 FLAI-TavernAI 项目实现「Mod 系统」

---

## 实现概览

Mod 系统允许用户创建和管理聊天时的提示词注入、文风增强等自定义指令。启用的 Mod 会在聊天时自动注入到系统提示词中。

## 后端实现

### 1. 数据库表 (`backend/src/db.js`)

新增 `mods` 表：

```sql
CREATE TABLE IF NOT EXISTS mods (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'prompt_inject',
  content TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mods_user ON mods(user_id);
```

### 2. Mod 模块 (`backend/src/modules/mods.js`)

功能函数：

| 函数 | 说明 |
|------|------|
| `listMods(db, userId)` | 列出用户的 Mod |
| `getMod(db, userId, modId)` | 获取单个 Mod |
| `createMod(db, userId, payload)` | 创建 Mod（自动分配 order_index） |
| `updateMod(db, userId, modId, payload)` | 更新 Mod |
| `deleteMod(db, userId, modId)` | 删除 Mod |
| `reorderMods(db, userId, orderedIds)` | 批量排序 |
| `getEnabledModsForUser(db, userId)` | 获取启用的 Mod |
| `buildModSystemPrompt(mods)` | 构建 Mod 系统提示词 |

### 3. API 端点 (`backend/src/server.js`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/mods` | 列出用户的 Mod |
| POST | `/api/mods` | 创建 Mod |
| PUT | `/api/mods/order` | 批量排序 |
| PUT | `/api/mods/:id` | 更新 Mod（含启用/禁用） |
| DELETE | `/api/mods/:id` | 删除 Mod |

### 4. 聊天集成

在 `buildModelMessages` 函数中：
- 新增 `modSystemPrompt` 参数
- 启用的 Mod 内容注入到系统提示词中
- 不同类型的 Mod 使用不同前缀：
  - `prompt_inject`：直接注入
  - `style_enhance`：添加 `[文风要求]` 前缀
  - `custom`：添加 `[Mod: 名称]` 前缀

## 前端实现

### 1. API 函数 (`frontend/src/api.js`)

```javascript
export function fetchMods() { ... }
export function createMod(payload) { ... }
export function updateMod(id, payload) { ... }
export function deleteMod(id) { ... }
export function reorderMods(order) { ... }
```

### 2. Mod 管理界面 (`frontend/src/views/SettingsView.vue`)

在设置页添加了「Mod 管理」section：

- **Mod 列表**：卡片式显示，包含名称、类型、描述、内容预览
- **创建/编辑**：支持三种类型选择
  - `prompt_inject`（提示词注入）
  - `style_enhance`（文风增强）
  - `custom`（自定义）
- **启用/禁用开关**：通过 Power 图标切换
- **拖拽排序**：支持 drag & drop 调整顺序

### 3. 样式 (`frontend/src/styles.css`)

新增 `.mod-card-*` 系列样式，支持：
- 卡片布局和间距
- 拖拽状态视觉反馈（`.is-dragging`, `.is-drag-over`）
- 禁用状态半透明（`.is-disabled`）
- 类型标签颜色区分

## 测试结果

### 后端测试

```
✔ mods CRUD with type and ordering
✔ mod name validation rejects empty names
✔ mod ownership isolation
✔ buildModSystemPrompt combines enabled mod contents
```

全部 4 个 Mod 相关测试通过。（另有 1 个预存在的 character export 测试失败，与 Mod 无关）

### 前端构建

```
✓ built in 427ms
```

构建成功，无错误。

## 文件清单

| 文件 | 操作 |
|------|------|
| `backend/src/db.js` | 新增 mods 表 |
| `backend/src/modules/mods.js` | 新建 |
| `backend/src/server.js` | 新增 API 端点和聊天集成 |
| `backend/src/tests/backend.test.js` | 新增测试用例 |
| `frontend/src/api.js` | 新增 API 函数 |
| `frontend/src/views/SettingsView.vue` | 新增 Mod 管理 UI |
| `frontend/src/styles.css` | 新增 Mod 卡片样式 |
