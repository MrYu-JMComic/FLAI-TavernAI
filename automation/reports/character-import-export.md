# 角色卡导入/导出系统 — 实现报告

**日期**: 2026-05-25  
**任务**: 为 FLAI-TavernAI 项目实现「角色卡导入/导出系统」

---

## 实现概览

### 后端 (Express + node:sqlite)

#### 1. GET `/api/characters/:id/export` — 导出角色卡

- **认证**: 需要登录 (`requireAuth`)
- **逻辑**:
  - 获取角色基本信息（含正则规则）
  - 查询 `character_tags` 关联表获取标签名列表
  - 查询关联的世界书及其条目
- **导出格式**:
  ```json
  {
    "_flai_export_version": 1,
    "exported_at": "2026-05-25T...",
    "character": {
      "name": "...",
      "gender": "...",
      "age": "...",
      "background": "...",
      "worldview": "...",
      "persona": "...",
      "openingMessage": "...",
      "visibility": "private",
      "renderPlugins": [...]
    },
    "regex_rules": [...],
    "tags": ["标签1", "标签2"],
    "world_book": {
      "name": "...",
      "description": "...",
      "entries": [...]
    }
  }
  ```
- **响应头**: `Content-Disposition: attachment` 触发浏览器下载

#### 2. POST `/api/characters/import` — 导入角色卡

- **认证**: 需要登录 (`requireAuth`)
- **逻辑**:
  - 验证 `character` 字段存在且 `name` 非空
  - 调用 `createCharacter` 生成新 UUID（不覆盖现有角色）
  - 正则规则通过 `createCharacter` 的 `regexRules` 参数直接创建
  - 标签通过 `setCharacterTags` 自动创建不存在的标签
  - 如果存在 `world_book`，创建世界书并关联到新角色，逐条创建条目
- **返回**: 新创建的完整角色对象（含标签和世界书 ID）

### 前端 (Vue 3 + Vite)

#### 1. API 层 (`api.js`)

- `exportCharacter(id)` — GET 请求，返回 JSON 数据
- `importCharacter(payload)` — POST 请求，发送导入数据

#### 2. 导出按钮 (`CharacterFormView.vue`)

- 在编辑页面的表单操作区添加「导出」按钮（`Download` 图标）
- 点击后调用 API，创建 Blob 并触发浏览器下载 `.flai-char.json` 文件
- 仅在编辑模式下显示（`v-if="isEditing"`）

#### 3. 导入功能 (`HomeView.vue`)

- **导入按钮**: 在首页工具栏添加「导入角色卡」按钮（`Upload` 图标），使用隐藏 `<input type="file">` 选择 `.json` 文件
- **导入预览**: 选择文件后弹出预览对话框（`Teleport` 到 body），显示：
  - 角色头像首字母、名称、性别、年龄
  - 人设摘要（最多 3 行）
  - 标签列表、正则规则数量、世界书信息
- **确认导入**: 点击「确认导入」后调用 API，成功后刷新角色列表
- **取消**: 点击「取消」或遮罩层关闭预览

#### 4. 样式 (`styles.css`)

- 首页工具栏扩展为 3 列布局（搜索 + 排序 + 导入按钮）
- 导入预览对话框样式（遮罩层、对话框、预览卡片、标签徽章、操作按钮）
- 空状态页面添加双按钮布局（创建 + 导入）
- 响应式适配（900px、620px 断点）

---

## 修改文件清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `backend/src/server.js` | 新增路由 | 添加 export/import 两个 API 端点 |
| `backend/src/tests/backend.test.js` | 新增测试 | 4 个测试用例覆盖导出、导入、世界书导入、校验 |
| `frontend/src/api.js` | 新增函数 | `exportCharacter`、`importCharacter` |
| `frontend/src/views/CharacterFormView.vue` | 新增功能 | 导出按钮 + `handleExport` 函数 |
| `frontend/src/views/HomeView.vue` | 新增功能 | 导入按钮 + 预览对话框 + 确认/取消逻辑 |
| `frontend/src/styles.css` | 新增样式 | 导入对话框、空状态按钮、工具栏布局 |

---

## 验证结果

### 后端测试

```
✔ 34 tests passed, 0 failed
```

新增测试用例：
- `character export includes character, regex rules, tags and world book` ✔
- `character import creates new character with new ID` ✔
- `character import with world book creates book and entries` ✔
- `character import validates required name field` ✔

### 前端构建

```
✓ built in 429ms
```

无编译错误，所有模块正常打包。

---

## 技术约束遵守

- ✅ 使用 `node:sqlite`（Node 24 内置 `DatabaseSync`）
- ✅ 遵循现有代码风格（中文错误提示、函数命名、模块结构）
- ✅ 未修改 `backend/data`、`uploads`、`.env`、`node_modules`
- ✅ 前端使用 Vue 3 Composition API（`<script setup>`）
- ✅ 后端 `npm test` 全部通过
- ✅ 前端 `npm run build` 成功
