# NPC 独立代理引擎 — 工部执行报告

**执行时间**: 2026-05-25 21:41 CST  
**执行者**: 工部 Agent (gongbu)  
**项目**: D:\Cat\FLAI-TavernAI

---

## 完成状态: ✅ 已完成

---

## 实现内容

### 1. 后端 — 数据库表 (`db.js`)

新增两张表：

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| `npc_memories` | NPC 独立记忆 | id, conversation_id, npc_name, memory_type, content, created_at |
| `npc_behaviors` | NPC 行为决策规则 | id, conversation_id, npc_name, behavior_type, trigger_condition, action, priority, enabled, created_at |

- 两张表均通过 `conversation_id` 外键关联 `conversations` 表，级联删除
- 创建了 `conversation_id` + `npc_name` 联合索引

### 2. 后端 — NPC 模块 (`src/modules/npcs.js`)

完整的 NPC 管理模块，包含：

**CRUD 操作:**
- `listNpcMemories` / `addNpcMemory` / `deleteNpcMemory` — 记忆管理
- `listNpcBehaviors` / `addNpcBehavior` / `updateNpcBehavior` / `deleteNpcBehavior` — 行为规则管理

**NPC 发现引擎:**
- `scanNpcsFromMessages` — 从 AI 回复中自动识别 NPC 名称
  - `【NPC名】` 格式
  - `**NPC名**` Markdown 加粗格式
  - `"NPC名"说` 引号+动词格式
  - `NPC名说道` 中文对话格式
- `listConversationNpcs` — 汇总消息扫描 + 已存储的记忆/行为，返回完整 NPC 列表及计数

**行为注入引擎:**
- `buildNpcBehaviorPrompt` — 将 NPC 行为规则和记忆组装为系统提示片段，注入 AI 上下文

**安全约束:**
- 所有操作通过 `assertConversationAccess` 验证用户所有权
- 内容长度限制 2000 字符
- 优先级限制 0-100

### 3. 后端 — API 端点 (`server.js`)

新增 8 个端点：

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/conversations/:id/npcs` | 列出会话中的 NPC |
| GET | `/api/conversations/:id/npcs/:npc/memories` | 获取 NPC 记忆 |
| POST | `/api/conversations/:id/npcs/:npc/memories` | 添加 NPC 记忆 |
| DELETE | `/api/conversations/:id/npcs/:npc/memories/:memoryId` | 删除 NPC 记忆 |
| GET | `/api/conversations/:id/npcs/:npc/behaviors` | 获取 NPC 行为规则 |
| POST | `/api/conversations/:id/npcs/:npc/behaviors` | 添加 NPC 行为规则 |
| PUT | `/api/conversations/:id/npcs/:npc/behaviors/:behaviorId` | 更新 NPC 行为规则 |
| DELETE | `/api/conversations/:id/npcs/:npc/behaviors/:behaviorId` | 删除 NPC 行为规则 |

**聊天流程集成:**
- `buildModelMessages` 新增 `npcBehaviorPrompt` 参数，NPC 行为规则自动注入系统提示
- `saveAssistantResult` 新增 `autoScanNpcFromReply`，每次 AI 回复后自动扫描并持久化新发现的 NPC

### 4. 前端 — API 函数 (`api.js`)

新增 8 个 API 调用函数：
- `fetchConversationNpcs` / `fetchNpcMemories` / `addNpcMemory` / `deleteNpcMemory`
- `fetchNpcBehaviors` / `addNpcBehavior` / `updateNpcBehavior` / `deleteNpcBehavior`

### 5. 前端 — NPC 管理面板 (`components/NpcPanel.vue`)

完整的 NPC 管理面板组件：
- **NPC 列表**: 从对话中自动识别，显示记忆数/行为规则数
- **记忆管理**: 查看/添加/删除 NPC 记忆（支持 5 种记忆类型：事件、关系、看法、知识、情感）
- **行为规则配置**: 查看/添加/编辑/删除行为规则（支持 5 种行为类型：反应、对话、行动、情绪、移动）
- 支持优先级调节（0-100）和启用/禁用切换
- 滑入式面板，带过渡动画

### 6. 前端 — ChatView 集成

- 新增 👥 NPC 管理按钮（位于头部工具栏，存档管理按钮左侧）
- 集成 `NpcPanel` 组件到 ChatView 模板

---

## 验证结果

### 后端测试
```
backend.test.js:  55 pass, 0 fail ✅
npcs.test.js:     9 pass, 0 fail ✅
```

NPC 测试覆盖：
- NPC 记忆 CRUD
- NPC 行为规则 CRUD（含优先级和启用/禁用）
- NPC 名称扫描（4 种文本模式）
- NPC 列表合并（消息扫描 + 存储数据）
- 行为提示生成（含禁用规则过滤和记忆注入）
- 记忆类型规范化
- 内容长度截断
- 会话所有权隔离
- 优先级数值限制

### 前端构建
```
vite build: ✅ 成功 (567ms)
```

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/src/db.js` | 修改 | 新增 npc_memories + npc_behaviors 表 |
| `backend/src/modules/npcs.js` | 新建 | NPC 模块（CRUD + 发现 + 行为引擎） |
| `backend/src/server.js` | 修改 | 新增 8 个 API 端点 + 聊天流程集成 |
| `backend/src/tests/npcs.test.js` | 新建 | NPC 模块测试（9 个测试用例） |
| `frontend/src/api.js` | 修改 | 新增 8 个 NPC API 函数 |
| `frontend/src/components/NpcPanel.vue` | 新建 | NPC 管理面板组件 |
| `frontend/src/views/ChatView.vue` | 修改 | 集成 NPC 面板入口 |
