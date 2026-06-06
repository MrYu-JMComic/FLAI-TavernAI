# 世界书系统 · 任务规格

**任务 ID:** `world-book-system`
**创建日期:** 2026-06-06
**来源:** 太子巡检 → backlog.md Ready 区域最高优先级
**规划人:** 中书省

---

## 1. 目标

完善世界书系统，使其达到生产可用状态。当前后端核心功能已基本实现，需补齐前端集成、测试覆盖和导入导出支持。

## 2. 现状分析

### 已完成（后端）

| 模块 | 文件 | 状态 |
|------|------|------|
| 世界书 CRUD | `backend/src/modules/worldBooks.js` | ✅ 完整 |
| 条目 CRUD | `backend/src/modules/worldBooks.js` | ✅ 完整 |
| 触发词匹配引擎 | `backend/src/modules/worldBooks.js` | ✅ 完整（含正则、选择性过滤、概率、分组、递归激活） |
| 角色卡关联（多对多） | `character_world_books` 表 + junction 操作 | ✅ 完整 |
| 会话级世界书（chat lorebook） | `conversations.chat_lorebook_id` | ✅ 完整 |
| Sticky / Cooldown / Delay 状态 | `world_book_entry_state` 表 | ✅ 完整 |
| Token 预算截断 | `matchWorldBookEntries` Phase 5 | ✅ 完整 |
| at_depth 注入 | `injectAtDepthEntries` | ✅ 完整 |
| AI 世界书创建助手 | `backend/src/services/worldBookAssistant.js` | ✅ 完整（含流式） |
| API 路由 | `backend/src/routes/worldBooks.js` | ✅ 完整 |
| 数据库 Schema | `backend/src/db.js` | ✅ 完整（含迁移） |
| 角色导入/导出含世界书 | `backend/src/routes/characters.js` | ✅ 已实现 |
| 单元测试 | `backend/src/tests/backend.test.js` | ✅ 覆盖率高（约 30+ 测试用例） |

### 已完成（前端）

| 模块 | 文件 | 状态 |
|------|------|------|
| 世界书管理页面 | `frontend/src/views/WorldBookView.vue` | ✅ 完整（列表、详情、条目 CRUD、AI 助手） |
| 角色表单世界书选择 | `frontend/src/views/CharacterFormView.vue` | ✅ 已集成（多选 checkbox） |
| 聊天设置世界书绑定 | `frontend/src/components/chat/ChatSettingsDrawer.vue` | ✅ 已集成（chat lorebook 下拉） |
| API 层 | `frontend/src/api.js` | ✅ 完整 |
| 路由集成 | `frontend/src/views/ChatView.vue` | ✅ 已加载世界书列表 |

### 缺失 / 待完善

| 编号 | 问题 | 严重度 | 说明 |
|------|------|--------|------|
| G1 | 独立世界书后端测试文件缺失 | 中 | 测试都在 `backend.test.js` 内，无独立文件；不影响功能但增加维护负担 |
| G2 | 前端无世界书相关测试 | 低 | 当前项目无前端测试框架 |
| G3 | 世界书列表无搜索/筛选 | 中 | 条目多时难以管理 |
| G4 | AI 助手只能创建不能编辑已有世界书 | 中 | 只能生成新草稿，无法对已有世界书补充条目 |
| G5 | 角色表单中世界书 UX 可优化 | 低 | 当前是 checkbox 列表，无搜索、无排序、无预览 |
| G6 | 世界书独立导入/导出缺失 | 中 | 角色导出已含世界书，但无独立的世界书 JSON 导入/导出 |
| G7 | 条目搜索/过滤缺失 | 低 | 世界书详情页条目多时无法快速定位 |
| G8 | 无世界书条目批量操作 | 低 | 无法批量启用/禁用/删除 |
| G9 | 触发词匹配无前端测试工具 | 低 | 用户无法在前端验证哪些条目会被触发 |

## 3. DoD（Definition of Done）

### 核心功能（必须完成）

- [x] **D1:** 世界书 CRUD 完整可用（创建、查看、编辑、删除）
- [x] **D2:** 条目 CRUD 完整可用（创建、查看、编辑、删除、排序、启用/禁用）
- [x] **D3:** 触发词自动匹配注入上下文（对话发送时自动执行）
- [x] **D4:** 角色卡可关联多本世界书（character_world_books 多对多）
- [x] **D5:** 会话可绑定独立世界书（chat lorebook）
- [x] **D6:** AI 助手可生成世界书草稿
- [ ] **D7:** 世界书独立导入/导出（JSON 格式）
- [ ] **D8:** 世界书列表搜索功能
- [ ] **D9:** 后端测试通过（`npm test`）

### 增强功能（建议完成）

- [ ] **E1:** AI 助手支持编辑已有世界书（追加条目）
- [ ] **E2:** 条目搜索/过滤
- [ ] **E3:** 批量启用/禁用条目
- [ ] **E4:** 前端触发词测试工具

## 4. 验收标准

### AC1: 世界书基本流程
1. 创建世界书 → 填写名称、描述、扫描深度、上下文预算 → 保存成功
2. 添加条目 → 填写触发词、内容、选择注入位置 → 保存成功
3. 创建角色 → 关联世界书 → 保存成功
4. 与角色对话 → 消息中包含触发词 → AI 上下文中包含对应条目内容
5. 删除条目 → 对话中不再注入该条目
6. 删除世界书 → 角色关联自动解除

### AC2: 触发词匹配
1. 字面匹配：触发词 "魔法" 匹配消息 "我想学习魔法"
2. 正则匹配：regexMode 开启时，`/\d+个/` 匹配 "我有42个苹果"
3. Always Active：alwaysActive 条目无条件注入
4. 选择性过滤：主关键词命中 + 副关键词逻辑过滤
5. 概率激活：probability=0 不激活，probability=100 始终激活
6. 分组互斥：同组条目只注入一个
7. at_depth 注入：按指定深度插入消息数组
8. Sticky：激活后持续 N 条消息
9. Cooldown：失活后冷却 N 条消息
10. Token 预算：超出上下文预算百分比的条目被截断

### AC3: 导入/导出
1. 导出世界书 → 获得 JSON 文件（含所有条目）
2. 导入 JSON → 创建新世界书及所有条目
3. 导入格式兼容 SillyTavern World Info 格式

### AC4: 搜索
1. 世界书列表页可按名称搜索
2. 世界书详情页可按条目名称/触发词搜索

### AC5: 测试
1. `cd backend && npm test` 全部通过
2. 新增世界书独立测试文件覆盖核心逻辑

## 5. 实现方案

### Phase 1: 世界书导入/导出（G6）

**新增文件：**
- 无（在现有文件中扩展）

**修改文件：**
- `backend/src/modules/worldBooks.js` — 新增 `exportWorldBook()` 和 `importWorldBook()` 函数
- `backend/src/routes/worldBooks.js` — 新增 `GET /:id/export` 和 `POST /import` 路由
- `frontend/src/api.js` — 新增 `exportWorldBook()` 和 `importWorldBook()` API 函数
- `frontend/src/views/WorldBookView.vue` — 添加导入/导出按钮
- `backend/src/validations/schemas.js` — 新增导入 schema

**导出格式：**
```json
{
  "name": "世界书名称",
  "description": "描述",
  "scanDepth": 4,
  "lorebookContextPercent": 25,
  "entries": [
    {
      "name": "条目名",
      "triggerKeys": "关键词1,关键词2",
      "content": "注入内容",
      "position": "before_char",
      "enabled": true,
      "alwaysActive": false,
      "regexMode": false,
      "selective": false,
      "selectiveLogic": 0,
      "keysSecondary": "",
      "probability": 100,
      "useProbability": false,
      "group": "",
      "groupWeight": 0,
      "depth": 0,
      "role": 0,
      "sticky": null,
      "cooldown": null,
      "delay": null
    }
  ]
}
```

**导入兼容性：** 支持 SillyTavern World Info JSON 格式（`entries` 数组，字段名映射）。

### Phase 2: 世界书列表搜索（G8）

**修改文件：**
- `frontend/src/views/WorldBookView.vue` — 添加搜索输入框，前端过滤

**实现方式：** 前端 client-side 搜索（世界书列表通常 <100 条，无需后端搜索）。

### Phase 3: 条目搜索/过滤（G7）

**修改文件：**
- `frontend/src/views/WorldBookView.vue` — 条目列表上方添加搜索/过滤框

### Phase 4: 独立测试文件（G1）

**新增文件：**
- `backend/src/tests/worldBooks.test.js` — 独立世界书测试文件

**测试覆盖：**
- 世界书 CRUD
- 条目 CRUD
- 触发词匹配（字面、正则、alwaysActive、选择性过滤）
- 概率激活
- 分组互斥
- Sticky / Cooldown / Delay
- Token 预算截断
- at_depth 注入
- 导入/导出

### Phase 5: AI 助手增强（G1，建议）

**修改文件：**
- `backend/src/services/worldBookAssistant.js` — 支持传入已有世界书上下文，追加/替换条目
- `frontend/src/views/WorldBookView.vue` — 世界书详情页添加"AI 补充条目"按钮

## 6. 涉及文件清单

### 需修改的文件

| 文件 | 修改内容 |
|------|----------|
| `D:\Cat\FLAI-TavernAI\backend\src\modules\worldBooks.js` | 新增 `exportWorldBook()`, `importWorldBook()` |
| `D:\Cat\FLAI-TavernAI\backend\src\routes\worldBooks.js` | 新增导出/导入路由 |
| `D:\Cat\FLAI-TavernAI\backend\src\validations\schemas.js` | 新增导入 schema |
| `D:\Cat\FLAI-TavernAI\frontend\src\api.js` | 新增导出/导入 API |
| `D:\Cat\FLAI-TavernAI\frontend\src\views\WorldBookView.vue` | 导入/导出按钮、搜索框 |

### 需新增的文件

| 文件 | 内容 |
|------|------|
| `D:\Cat\FLAI-TavernAI\backend\src\tests\worldBooks.test.js` | 独立世界书测试 |

## 7. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 导入 SillyTavern 格式字段不兼容 | 中 | 中 | 实现宽松映射，未知字段忽略，必填字段有默认值 |
| 导入大量条目导致性能问题 | 低 | 低 | 限制单次导入 ≤ 200 条目 |
| 前端搜索在大量世界书时卡顿 | 低 | 低 | 世界书数量通常 <100，client-side 搜索足够 |
| AI 助手编辑模式生成质量不稳定 | 中 | 低 | 作为增强功能，不影响核心流程 |
| 测试文件拆分影响现有 CI | 低 | 中 | 确保 `npm test` 仍能发现所有测试文件 |

## 8. 工作量估算

| Phase | 任务 | 预估工时 | 依赖 |
|-------|------|----------|------|
| Phase 1 | 导入/导出 | 2h | 无 |
| Phase 2 | 列表搜索 | 0.5h | 无 |
| Phase 3 | 条目搜索 | 0.5h | 无 |
| Phase 4 | 独立测试文件 | 1.5h | Phase 1 |
| Phase 5 | AI 助手增强 | 1h | 无 |
| **总计** | | **5.5h** | |

## 9. 执行建议

1. **Phase 1 → Phase 2 → Phase 3** 为前端优先路径，可连续执行
2. **Phase 4** 可与 Phase 1 并行（测试写在前面也行）
3. **Phase 5** 为可选增强，不影响核心验收
4. 每个 Phase 完成后运行 `npm test`（backend）和 `npm run build`（frontend）验证
5. 所有文件编码必须为 UTF-8

---

## 附录：当前世界书系统架构图

```
┌─────────────────────────────────────────────────────────┐
│                      Frontend (Vue)                      │
│                                                          │
│  WorldBookView.vue ←── 管理页面（CRUD + AI 助手）        │
│  CharacterFormView.vue ←── 角色关联世界书（多选）         │
│  ChatSettingsDrawer.vue ←── 会话绑定世界书（下拉）        │
│  ChatView.vue ←── 对话时自动加载世界书列表                │
│  api.js ←── API 调用层                                   │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTP REST
┌───────────────────────▼─────────────────────────────────┐
│                    Backend (Express)                      │
│                                                          │
│  routes/worldBooks.js ←── 世界书 API 路由                │
│  routes/characters.js ←── 角色世界书关联路由              │
│  routes/conversations.js ←── 对话中触发匹配 + 注入       │
│                                                          │
│  modules/worldBooks.js ←── 核心逻辑                      │
│    ├─ CRUD (world_books, world_book_entries)             │
│    ├─ Character ↔ World Book linking                     │
│    ├─ matchWorldBookEntries() ← 触发匹配引擎             │
│    │   ├─ 字面/正则匹配                                  │
│    │   ├─ alwaysActive                                   │
│    │   ├─ selective + secondary keys                     │
│    │   ├─ probability                                    │
│    │   ├─ group inclusion (互斥分组)                      │
│    │   ├─ recursive activation (递归激活)                 │
│    │   ├─ sticky / cooldown / delay state                │
│    │   └─ token budget truncation                        │
│    ├─ buildWorldBookContext() ← 构建系统提示词注入        │
│    └─ injectAtDepthEntries() ← at_depth 消息注入         │
│                                                          │
│  services/worldBookAssistant.js ← AI 生成世界书草稿      │
│  validations/schemas.js ← Zod 验证                      │
└───────────────────────┬─────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────┐
│                    SQLite Database                        │
│                                                          │
│  world_books ← 世界书元数据                              │
│  world_book_entries ← 条目（触发词 + 内容 + 配置）       │
│  character_world_books ← 角色 ↔ 世界书多对多关联         │
│  world_book_entry_state ← sticky/cooldown/delay 状态     │
│  conversations.chat_lorebook_id ← 会话级世界书绑定        │
└─────────────────────────────────────────────────────────┘
```
