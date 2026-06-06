# WORLDBOOK-001 · 世界书系统规划

> 中书省规划文档 · 2026-06-06

---

## 1. 现状审计

经过全面代码审计，世界书系统**核心功能已全部实现**。以下是已有能力清单：

### 已完成

| 层 | 文件 | 功能 |
|---|---|---|
| DB Schema | `backend/src/db.js` (L314-388) | `world_books`、`world_book_entries`、`character_world_books`、`world_book_entry_state` 四张表，含所有高级字段 |
| 模块 | `backend/src/modules/worldBooks.js` | 完整 CRUD + 触发匹配引擎（递归激活、选择性过滤、概率、sticky/cooldown/delay、分组互斥、token 预算截断） |
| 路由 | `backend/src/routes/worldBooks.js` | REST API + AI 助手 SSE 流式生成 |
| 路由 | `backend/src/routes/characters.js` | 角色卡 ↔ 世界书关联 API（link/unlink/list） |
| 路由 | `backend/src/routes/conversations.js` | 对话中世界书上下文注入 + at_depth 消息插入 + 每会话 chatLorebookId |
| 服务 | `backend/src/services/worldBookAssistant.js` | AI 世界书草稿生成（tool calling 流式） |
| 校验 | `backend/src/validations/schemas.js` | Zod schema 校验 |
| 前端 | `frontend/src/views/WorldBookView.vue` | 完整列表/详情视图 + CRUD 弹窗 + AI 助手面板 |
| 前端 API | `frontend/src/api.js` (L147-291) | 全部客户端函数 |
| 对话设置 | `frontend/src/components/chat/ChatSettingsDrawer.vue` | 每会话世界书选择器 |

### 未覆盖（Gap 分析）

| 编号 | 缺失项 | 严重度 | 说明 |
|---|---|---|---|
| G1 | 后端测试 | **高** | `backend/src/tests/` 无任何世界书测试文件 |
| G2 | 世界书导入/导出 | 中 | 无 Tavern JSON 格式互操作（backlog 中"角色卡导入/导出"含此需求） |
| G3 | 世界书列表搜索 | 低 | `WorldBookView.vue` 列表无搜索/筛选 |
| G4 | 条目搜索 | 低 | 详情页无条目关键词搜索 |
| G5 | 批量操作 | 低 | 无批量启用/禁用/删除 |
| G6 | 世界书复制 | 低 | 无一键复制世界书功能 |
| G7 | 条目复制 | 低 | 无条目快速复制 |
| G8 | 拖拽排序 | 低 | 仅上/下按钮排序，无拖拽 |

---

## 2. 任务规格

### 基本信息

- **任务 ID**：WORLDBOOK-001
- **标题**：世界书系统 — 补全测试 + 导入/导出 + 体验优化
- **优先级**：高（AI风月参考功能系列第一个）
- **状态**：规划完成，待尚书省执行

### 目标描述

世界书核心功能已全部实现。本次任务聚焦三个方向：

1. **测试覆盖**：为世界书模块编写后端单元测试，确保触发匹配引擎可靠
2. **导入/导出**：支持 Tavern JSON 格式互操作，方便用户迁移和分享
3. **体验优化**：列表搜索、条目搜索、批量操作、世界书/条目复制

### DoD（Definition of Done）

- [ ] `backend/src/tests/worldBooks.test.js` 通过，覆盖核心触发匹配逻辑
- [ ] 世界书列表页支持按名称搜索
- [ ] 世界书详情页支持条目关键词搜索
- [ ] 支持导出世界书为 JSON 文件
- [ ] 支持从 JSON 文件导入世界书
- [ ] 支持一键复制世界书（含全部条目）
- [ ] 支持条目快速复制
- [ ] 支持批量启用/禁用条目
- [ ] `npm test` 全部通过
- [ ] `npm run build` 前端构建成功
- [ ] `node scripts/check-encoding.mjs` 通过
- [ ] 所有文件 UTF-8 编码

### 验收标准

#### AC-1：后端测试
```
场景：世界书触发匹配引擎
  Given 一个包含 3 个条目的世界书（always_active、触发词匹配、概率触发）
  When 调用 matchWorldBookEntries 匹配包含触发词的文本
  Then always_active 条目始终返回
  And 触发词匹配的条目被返回
  And 概率条目按概率返回（mock Math.random 验证）
```

```
场景：选择性过滤
  Given 一个带副关键词和 selective 逻辑的条目
  When 主关键词命中但副关键词未命中
  Then 条目不被激活（selective_logic=0 时）
```

```
场景：递归激活
  Given 条目 A 内容包含条目 B 的触发词
  When 条目 A 被激活
  Then 条目 B 也被递归激活
```

```
场景：Sticky / Cooldown / Delay
  Given 带 sticky=3、cooldown=2、delay=1 的条目
  When 按顺序发送消息
  Then sticky 条目在激活后持续 3 条消息
  And cooldown 条目在停用后 2 条消息内不重新激活
  And delay 条目在首次出现后 1 条消息才激活
```

```
场景：分组互斥
  Given 同一 inclusion_group 内有 2 个条目
  When 两个条目都被触发
  Then 只有 1 个被选中（基于 group_weight 权重）
```

```
场景：Token 预算截断
  Given contextSize=1000, lorebookContextPercent=25
  When 匹配到大量条目
  Then 总注入内容不超过 250 tokens（约 1000 字符）
```

#### AC-2：导入/导出
```
场景：导出世界书
  Given 用户拥有一个包含 5 个条目的世界书
  When 点击导出按钮
  Then 下载一个 JSON 文件，包含 name、description、scanDepth、lorebookContextPercent、entries 数组
  And 每个条目包含所有字段（triggerKeys、content、position、enabled 等）
```

```
场景：导入世界书
  Given 一个符合格式的 JSON 文件
  When 用户选择导入
  Then 创建新的世界书和所有条目
  And 返回导入结果（成功数、失败数）
```

#### AC-3：搜索与批量操作
```
场景：世界书搜索
  Given 世界书列表包含"魔法世界"和"科幻设定"
  When 搜索"魔法"
  Then 只显示"魔法世界"
```

```
场景：条目搜索
  Given 世界书包含 20 个条目
  When 在条目列表搜索"王城"
  Then 只显示包含"王城"的条目（名称或触发词或内容匹配）
```

```
场景：批量操作
  Given 选中 3 个条目
  When 点击"批量禁用"
  Then 3 个条目全部变为禁用状态
```

#### AC-4：复制功能
```
场景：复制世界书
  Given 用户拥有一个包含 5 个条目的世界书
  When 点击复制按钮
  Then 创建一个名称为"原名 (副本)"的新世界书
  And 包含所有条目的副本
```

```
场景：复制条目
  Given 世界书详情页
  When 点击某个条目的复制按钮
  Then 创建一个相同内容的新条目，排在原条目之后
```

---

## 3. 技术方案

### 子任务拆分

#### ST-1：后端测试（预估 2h）
- **新建**：`backend/src/tests/worldBooks.test.js`
- **修改**：无
- **说明**：测试 `matchWorldBookEntries`、`buildWorldBookContext`、`injectAtDepthEntries`、`resetMessageCounter` 等导出函数。使用内存数据库 `:memory:`。

#### ST-2：导入/导出 API（预估 1.5h）
- **新建**：无新文件
- **修改**：
  - `backend/src/modules/worldBooks.js` — 新增 `exportWorldBook()` 和 `importWorldBook()` 函数
  - `backend/src/routes/worldBooks.js` — 新增 `GET /:id/export` 和 `POST /import` 路由
  - `frontend/src/api.js` — 新增 `exportWorldBook()` 和 `importWorldBook()` 函数
  - `frontend/src/views/WorldBookView.vue` — 列表页新增导入/导出按钮和文件选择器

#### ST-3：前端搜索（预估 1h）
- **修改**：
  - `frontend/src/views/WorldBookView.vue` — 列表页新增搜索输入框（computed filter）；详情页新增条目搜索输入框

#### ST-4：批量操作与复制（预估 1.5h）
- **修改**：
  - `backend/src/modules/worldBooks.js` — 新增 `duplicateWorldBook()` 和 `duplicateEntry()` 函数
  - `backend/src/routes/worldBooks.js` — 新增 `POST /:id/duplicate` 和 `POST /:id/entries/:entryId/duplicate` 路由
  - `frontend/src/api.js` — 新增对应客户端函数
  - `frontend/src/views/WorldBookView.vue` — 新增复制按钮、批量选择 UI、批量操作按钮

### 数据库变更

无。所有现有表和字段已满足需求。

### API 变更

| Method | Path | 说明 | 新增? |
|---|---|---|---|
| GET | `/api/world-books/:id/export` | 导出世界书 JSON | ✅ |
| POST | `/api/world-books/import` | 导入世界书 JSON | ✅ |
| POST | `/api/world-books/:id/duplicate` | 复制世界书 | ✅ |
| POST | `/api/world-books/:id/entries/:entryId/duplicate` | 复制条目 | ✅ |

### 涉及文件清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `backend/src/tests/worldBooks.test.js` | 新建 | 单元测试 |
| `backend/src/modules/worldBooks.js` | 修改 | 新增导出/导入/复制函数 |
| `backend/src/routes/worldBooks.js` | 修改 | 新增 4 个路由 |
| `frontend/src/api.js` | 修改 | 新增 4 个客户端函数 |
| `frontend/src/views/WorldBookView.vue` | 修改 | 搜索、批量操作、复制、导入/导出 UI |

---

## 4. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| 触发匹配引擎的 edge case 未被测试覆盖 | 中 | 条目不触发或误触发 | 测试覆盖 recursive、selective、probability、sticky/cooldown/delay、group |
| 导入 JSON 格式不兼容外部工具 | 中 | 用户导入失败 | 同时支持 Tavern 原始格式和 FLAI 扩展格式，导入时做字段归一化 |
| 复制大量条目时性能问题 | 低 | 前端卡顿 | 限制单次复制条目数（≤100），服务端批量 INSERT |
| 编码问题（中文条目内容） | 低 | 乱码 | 导出/导入均使用 UTF-8 JSON，测试含中文内容 |

---

## 5. 工作量估算

| 子任务 | 预估工时 | 依赖 |
|---|---|---|
| ST-1 后端测试 | 2h | 无 |
| ST-2 导入/导出 | 1.5h | 无 |
| ST-3 前端搜索 | 1h | 无 |
| ST-4 批量操作与复制 | 1.5h | 无 |
| **总计** | **6h** | — |

建议拆为 2-3 个自主迭代周期执行，每个周期 2-3h。

---

## 6. 执行建议

1. **优先 ST-1**：测试先行，为后续改动提供回归保障
2. **ST-2 与 ST-3 可并行**：前后端独立
3. **ST-4 最后**：依赖 ST-1 的测试覆盖
4. 每个子任务完成后运行 `npm test` + `npm run build` + `node scripts/check-encoding.mjs`
5. 每个子任务完成后在 `automation/reports/` 写迭代报告

---

*中书省规划完毕，交门下省审核、尚书省执行。*
