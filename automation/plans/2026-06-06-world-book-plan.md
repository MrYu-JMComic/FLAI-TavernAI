# 任务规格：JJC-20260606-001

## 任务标题
世界书系统完善与测试补全

## 背景与目标

### 背景
世界书（World Book / Lorebook）是 backlog 中最高优先级功能。经过调研，**该系统已基本实现**，覆盖了完整的 CRUD、触发匹配、状态管理、AI 辅助生成、角色关联、对话级世界书等核心能力。

### 现状评估

| 层级 | 文件 | 状态 |
|---|---|---|
| 数据库 | `backend/src/db.js` — world_books, world_book_entries, character_world_books, world_book_entry_state 表 | ✅ 完成 |
| 后端模块 | `backend/src/modules/worldBooks.js` — CRUD + 触发匹配（regex/alwaysActive/selective/probability/group/sticky/cooldown/delay/recursive/at_depth/token budget） | ✅ 完成 |
| 后端路由 | `backend/src/routes/worldBooks.js` — REST API + AI 草稿生成 SSE 流 | ✅ 完成 |
| AI 助手 | `backend/src/services/worldBookAssistant.js` — tool completion 生成世界书 | ✅ 完成 |
| 前端页面 | `frontend/src/views/WorldBookView.vue` — 列表/详情/条目编辑/AI 生成 | ✅ 完成 |
| 角色关联 | CharacterFormView 中世界书多选 + junction table 同步 | ✅ 完成 |
| 对话集成 | conversations.js 中 matchWorldBookEntries → buildWorldBookContext → injectAtDepth | ✅ 完成 |
| 对话级世界书 | ChatSettingsDrawer 中 chatLorebookId 设置 | ✅ 完成 |
| 测试 | backend.test.js 中约 30+ 个世界书相关测试 | ✅ 完成 |

### 目标
识别并修补现有实现中的缺口，提升系统健壮性和可维护性。

## 缺口分析与待办事项

### 高优先级（必须完成）

#### 1. 独立世界书测试文件
- **问题**：所有世界书测试散落在 `backend.test.js` 中，没有独立测试文件，不便维护和定位
- **行动**：抽取世界书测试到 `backend/src/tests/worldBooks.test.js`
- **涉及文件**：
  - 新建：`D:\Cat\FLAI-TavernAI\backend\src\tests\worldBooks.test.js`
  - 修改：`D:\Cat\FLAI-TavernAI\backend\src\tests\backend.test.js`（移除已迁移的测试）

#### 2. 递归激活测试补全
- **问题**：`matchWorldBookEntries` 支持最多 5 层递归激活（条目内容触发其他条目），但缺少专门测试
- **行动**：添加递归激活测试用例
- **涉及文件**：`D:\Cat\FLAI-TavernAI\backend\src\tests\worldBooks.test.js`

#### 3. at_depth 注入测试补全
- **问题**：`injectAtDepthEntries` 函数在 conversations 路由中使用，但没有单元测试
- **行动**：添加 at_depth 注入的单元测试，覆盖 depth=0/中间/边界、role 映射、多条目排序
- **涉及文件**：`D:\Cat\FLAI-TavernAI\backend\src\tests\worldBooks.test.js`

### 中优先级（建议完成）

#### 4. 独立世界书导入/导出
- **问题**：角色导出已包含世界书数据，但无法独立导入/导出世界书（如分享给其他用户或跨实例迁移）
- **行动**：
  - 后端：在 `routes/worldBooks.js` 添加 `GET /:id/export` 和 `POST /import` 端点
  - 前端：在 WorldBookView 列表页添加导入/导出按钮
- **涉及文件**：
  - `D:\Cat\FLAI-TavernAI\backend\src\routes\worldBooks.js`
  - `D:\Cat\FLAI-TavernAI\frontend\src\views\WorldBookView.vue`
  - `D:\Cat\FLAI-TavernAI\frontend\src\api.js`

#### 5. 世界书搜索/过滤
- **问题**：世界书列表无搜索和过滤能力，条目多时难以管理
- **行动**：
  - 列表页添加名称搜索
  - 详情页条目列表添加触发词/名称搜索
- **涉及文件**：
  - `D:\Cat\FLAI-TavernAI\frontend\src\views\WorldBookView.vue`

#### 6. 条目批量操作
- **问题**：无法批量启用/禁用/删除条目
- **行动**：添加条目多选 + 批量操作工具栏
- **涉及文件**：
  - `D:\Cat\FLAI-TavernAI\frontend\src\views\WorldBookView.vue`

### 低优先级（可选）

#### 7. 世界书模板/预设
- **问题**：新用户不知道如何编写有效的世界书条目
- **行动**：提供内置模板（如"奇幻世界"、"现代都市"、"科幻设定"）
- **涉及文件**：
  - `D:\Cat\FLAI-TavernAI\backend\src\services\worldBookAssistant.js`（prompt 增强）
  - `D:\Cat\FLAI-TavernAI\frontend\src\views\WorldBookView.vue`（模板选择 UI）

## DoD（Definition of Done）

- [ ] 世界书测试独立为 `worldBooks.test.js`，`npm test` 全部通过
- [ ] 递归激活有至少 2 个测试用例（链式触发 + 深度限制）
- [ ] at_depth 注入有至少 3 个测试用例（不同 depth + role）
- [ ] 独立世界书可导出为 JSON 文件、可从 JSON 导入
- [ ] `npm test` 全部通过
- [ ] `cd frontend && npm run build` 构建成功
- [ ] `node scripts/check-encoding.mjs` 编码检查通过

## 验收标准

1. **测试独立性**：`node --test backend/src/tests/worldBooks.test.js` 可独立运行并全部通过
2. **递归激活**：创建条目 A（触发词 "魔法"，内容含 "魔杖"）和条目 B（触发词 "魔杖"），输入 "魔法" 后两个条目均被匹配
3. **at_depth 注入**：创建 at_depth=2 的条目，验证其在 messages 数组中被插入到正确位置且 role 正确
4. **导入/导出**：
   - 导出世界书得到包含 name/description/entries 的 JSON 文件
   - 从该 JSON 文件导入，创建新世界书且条目内容一致
5. **回归**：现有功能（CRUD、触发匹配、AI 生成、角色关联、对话级世界书）不受影响

## 技术方案概要

### 测试抽取（高优先级）
```
backend/src/tests/worldBooks.test.js
├── 从 backend.test.js 迁移所有 world book 相关 test()
├── 新增：递归激活测试（A→B 链式触发）
├── 新增：at_depth 注入单元测试
└── 新增：多世界书叠加测试（角色绑定 2 本书，触发词分布在不同书）
```

### 世界书导入/导出 API（中优先级）
```
GET  /api/world-books/:id/export  → { name, description, scanDepth, lorebookContextPercent, entries: [...] }
POST /api/world-books/import      → 接收同格式 JSON，创建新世界书
```

### 前端导入/导出（中优先级）
```
WorldBookView 列表页：
  - 每个书卡添加"导出"按钮（下载 JSON）
  - 页面顶部添加"导入世界书"按钮（文件选择 → POST /import）
```

## 风险评估

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| 测试抽取可能遗漏隐含依赖 | 测试失败 | 迁移后完整运行 `npm test` 验证 |
| 导入 JSON 可能含恶意数据 | 数据库损坏 | 使用 zod schema 校验 + sanitizeText 清洗 |
| 递归激活可能在极端情况下性能差 | 请求超时 | 已有 RECURSIVE_MAX_DEPTH=5 限制，测试验证 |

## 预估工作量

| 事项 | 工作量 |
|---|---|
| 测试抽取 + 递归/at_depth 测试补全 | 中（2-3h） |
| 独立世界书导入/导出 | 中（2-3h） |
| 搜索/过滤 + 批量操作 | 中（2-3h） |
| **总计** | **中-大（6-9h）** |

## 执行建议

建议分两个迭代完成：

**迭代 1（高优先级）**：测试抽取 + 递归/at_depth 测试补全
- 最小风险，提升代码质量
- 为后续功能开发提供测试安全网

**迭代 2（中优先级）**：独立世界书导入/导出
- 产品价值明确，用户可分享世界书设定
- 与角色导入/导出形成完整体验
