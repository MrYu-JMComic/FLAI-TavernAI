# 会话存档/读档系统 (Save/Load) 实施报告

**日期**: 2026-05-25  
**任务**: 为 FLAI-TavernAI 实现会话存档/读档系统

---

## 改动文件清单

### 后端 (3 个文件)

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/src/db.js` | **修改** | 在 `initializeDatabase` 末尾追加 `saves` 表定义，包含索引 |
| `backend/src/modules/saves.js` | **新建** | 存档 CRUD 模块：listSaves / getSave / createSave / updateSave / deleteSave / loadSave，含快照构建与恢复逻辑 |
| `backend/src/server.js` | **修改** | 导入 saves 模块，新增 6 个 API 端点 |

### 前端 (3 个文件)

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/api.js` | **修改** | 新增 6 个存档 API 函数 |
| `frontend/src/components/SaveLoadPanel.vue` | **新建** | 存档面板组件（侧边抽屉样式） |
| `frontend/src/views/ChatView.vue` | **修改** | 导入 SaveLoadPanel，添加存档按钮和面板状态管理 |

---

## 数据库表结构

```sql
CREATE TABLE saves (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  snapshot TEXT NOT NULL DEFAULT '{}',   -- JSON: { messages: [...], savedAt }
  preview TEXT NOT NULL DEFAULT '',       -- 最后一条 assistant 消息摘要
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

## API 端点

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/conversations/:id/saves` | 列出某会话所有存档 |
| POST | `/api/conversations/:id/saves` | 创建存档（快照当前消息） |
| GET | `/api/saves/:saveId` | 获取存档详情（含完整快照） |
| POST | `/api/saves/:saveId/load` | 读档（清除当前消息，恢复存档消息） |
| PUT | `/api/saves/:saveId` | 更新存档名 |
| DELETE | `/api/saves/:saveId` | 删除存档 |

## 快照逻辑

- **保存时**: 抓取当前会话所有消息（id, role, content, reasoning, usage_json, created_at）和保存时间戳
- **生成预览**: 自动提取最后一条 assistant 消息的前 120 字符作为预览
- **读档时**: 清除当前会话所有消息 → 按原顺序插入存档消息 → 更新会话时间戳
- 存档名留空时自动生成（格式: "存档 2026/5/25 19:30:00"）

## 前端交互

- ChatView 顶栏新增「存档管理」按钮（Save 图标）
- 点击打开右侧抽屉面板（SaveLoadPanel）
- 面板功能：
  - 输入存档名 + 一键存档按钮
  - 存档列表（按时间倒序，显示名称、时间、预览）
  - 一键读档（含确认弹窗）
  - 重命名存档（行内编辑）
  - 删除存档（含确认弹窗）
- 读档成功后自动刷新当前会话消息

---

## 测试结果

- **后端测试**: ✅ 26/26 通过（含原有测试，saves 模块不影响现有功能）
- **前端构建**: ✅ vite build 成功（423ms）

---

## 未改动

- `backend/data/` — 未触碰
- `backend/uploads/` — 未触碰
- `.env` — 未触碰
- `node_modules/` — 未触碰

---

## 下一步建议

1. **单元测试**: 为 `saves.js` 模块编写专门的测试用例（CRUD + load 快照恢复）
2. **快照扩展**: 当前快照只保存消息，可扩展为同时保存世界书激活状态和会话变量
3. **存档上限**: 可考虑为每个会话设置最大存档数量（如 50 个），超出时自动删除最旧的
4. **存档导入/导出**: 支持导出存档为 JSON 文件，方便跨设备迁移
5. **自动存档**: 在重要操作前自动创建存档（如切换角色、长对话间隔后）
