# 任务规格：世界书系统增强

- **任务ID**: world-book-system
- **标题**: 世界书系统增强 - 角色卡关联世界观与触发词注入
- **优先级**: 高
- **预估工作量**: M（中等）
- **创建日期**: 2026-06-19
- **作者**: 中书省（规划子代理）

---

## 一、背景分析

### 1.1 当前系统现状

FLAI-TavernAI 的世界书系统已有较完整的基础设施：

**后端（backend/src/modules/worldBooks.js）**
- 完整的 CRUD：世界书和条目的创建、读取、更新、删除
- 角色绑定：通过 `character_world_books` 关联表支持一对多绑定（一个角色可关联多个世界书）
- 聊天关联：会话级别可选择独立 lorebook（`chat_lorebook_id`）
- 触发词匹配：支持字面量和正则两种模式，含选择性过滤（selective logic）
- 递归激活：匹配到的条目内容会被再次扫描（最多 5 层），触发关联条目
- 状态管理：sticky（粘性持续）、cooldown（冷却期）、delay（延迟激活）机制
- 分组包含：inclusion_group + group_weight 加权随机选择
- 注入位置：before_char / after_char / at_start / at_depth 四种位置
- Token 预算：根据 lorebook_context_percent 百分比截断
- AI 助手：`worldBookAssistant.js` 支持 AI 生成世界书草稿

**前端**
- `WorldBookView.vue`：完整的世界书管理界面，含 AI 生成、条目编辑、启停控制
- `CharacterFormView.vue`：角色卡编辑器中可选择绑定世界书（多选）
- `ChatSettingsDrawer.vue`：会话设置中可选择聊天 lorebook 并显示绑定标签
- 匹配可视化：会话中展示触发的条目列表（showWorldBookMatches）

**对话集成（backend/src/routes/conversations.js）**
- 发送消息时自动扫描最近 N 条消息 + 当前用户输入
- 匹配所有关联世界书的条目（角色绑定 + 聊天 lorebook）
- 匹配内容注入系统提示词（`[世界书补充信息]` 区块）
- at_depth 条目注入为独立消息（指定深度位置）

**数据库**
- `world_books`：主表（含 scan_depth, lorebook_context_percent）
- `world_book_entries`：条目表（含触发词、内容、位置、regex_mode、always_active 等 20+ 字段）
- `character_world_books`：角色-世界书关联表
- `world_book_entry_state`：条目运行时状态（sticky/cooldown/delay 追踪）

### 1.2 当前不足

尽管基础设施完善，但与"角色卡附加世界观设定，触发词自动注入上下文"的目标相比，存在以下差距：

1. **角色卡世界观集成不足**
   - 角色卡有 `worldview` 字段（纯文本），但与世界书系统是分离的
   - 用户需手动创建世界书、手动绑定角色，流程割裂
   - 角色卡编辑器中世界书选择是多选列表，缺少"一键创建关联世界书"的快捷入口

2. **触发词系统智能度不足**
   - 触发词需手动编写，缺少基于角色世界观的智能推荐
   - 无模糊匹配或语义相似度匹配，仅支持精确子串/正则
   - 无触发词冲突检测（多个条目同一触发词的优先级不明确）

3. **上下文注入可见性不足**
   - 用户在对话中只能看到匹配的条目名称列表，无法查看实际注入内容
   - 缺少注入位置的可视化（哪些内容在 system prompt，哪些在 at_depth 消息）
   - 缺少注入历史（哪些条目在哪些消息轮次被触发）

4. **世界书管理体验不足**
   - 无法从角色卡直接跳转到关联世界书的编辑
   - 缺少世界书的导入/导出（JSON 格式分享）
   - AI 助手生成的世界书缺少基于角色已有世界观的上下文感知

5. **触发词注入调试困难**
   - 缺少"测试匹配"功能：无法输入文本预览哪些条目会被触发
   - 匹配结果不显示未匹配原因（触发词未命中？cooldown 中？delay 未到？）

---

## 二、DoD（Definition of Done）

完成以下全部条件时，任务视为完成：

1. 角色卡编辑器支持一键从当前角色世界观创建关联世界书
2. 世界书条目支持从角色世界观自动生成触发词建议
3. 对话中触发的世界书条目内容对用户可见（可展开查看详情）
4. 角色卡编辑器可直接跳转到关联世界书的编辑页面
5. 世界书详情页提供"测试匹配"功能
6. 匹配结果包含未匹配条目的原因说明
7. 所有新功能有对应的后端测试覆盖
8. 前端构建通过（`npm run build`）
9. 后端测试通过（`npm test`）
10. UTF-8 编码检查通过（`node scripts/check-encoding.mjs`）

---

## 三、验收标准

### AC-1：一键创建关联世界书
- **场景**：角色卡编辑器中，点击"从世界观创建世界书"按钮
- **预期**：自动创建新世界书，名称为"`{角色名}的世界观`"，description 填入角色 worldview 内容，自动绑定到当前角色
- **验证**：创建后跳转到世界书详情页，确认绑定关系存在

### AC-2：触发词智能建议
- **场景**：世界书条目编辑中，点击"AI 建议触发词"
- **预期**：基于条目内容和关联角色的世界观，生成 3-5 个推荐触发词
- **验证**：建议的触发词可一键填入触发词字段

### AC-3：注入内容可视化
- **场景**：对话中触发了世界书条目，点击匹配条目列表中的某条目
- **预期**：展开显示该条目的实际注入内容、注入位置（system/at_depth）、触发的触发词
- **验证**：展开内容与条目编辑中的 content 字段一致

### AC-4：角色卡跳转世界书
- **场景**：角色卡编辑器中已绑定世界书，点击世界书名称
- **预期**：导航到世界书详情页（WorldBookView）
- **验证**：跳转后世界书详情正确加载

### AC-5：测试匹配功能
- **场景**：世界书详情页，点击"测试匹配"按钮，输入测试文本
- **预期**：显示所有条目的匹配结果（命中/未命中），命中条目显示触发的触发词，未命中条目显示原因
- **验证**：结果与实际对话中的匹配行为一致

### AC-6：匹配结果增强
- **场景**：对话中查看世界书匹配详情
- **预期**：每个匹配条目显示：触发的触发词、注入位置、是否为 always_active、是否递归触发
- **验证**：信息准确反映后端匹配逻辑

---

## 四、实现方案

### 4.1 技术路径

#### 阶段一：角色卡-世界书快捷绑定（后端 + 前端）

**后端改动**：
- `backend/src/modules/worldBooks.js`：新增 `createWorldBookFromCharacter(database, userId, characterId)` 函数
  - 读取角色的 worldview 字段
  - 创建世界书，name = "{角色名}的世界观"，description = worldview
  - 自动调用 `linkWorldBookToCharacter` 绑定
  - 返回新创建的世界书
- `backend/src/routes/worldBooks.js`：新增 `POST /from-character` 路由
  - 接收 `{ characterId }`
  - 调用上述模块函数
  - 返回新世界书

**前端改动**：
- `frontend/src/api.js`：新增 `createFromCharacterWorldBook(characterId)` API 调用
- `frontend/src/views/CharacterFormView.vue`：
  - 在世界书选择区域添加"从世界观创建"按钮
  - 调用 API 后自动刷新世界书列表并选中新创建的世界书

#### 阶段二：触发词智能建议（后端 + 前端）

**后端改动**：
- `backend/src/services/worldBookAssistant.js`：扩展现有 AI 助手
  - 新增 `suggestTriggerKeys(settings, { entryContent, characterWorldview })` 函数
  - 利用 LLM 分析条目内容，结合角色世界观上下文，生成触发词建议
- `backend/src/routes/worldBooks.js`：新增 `POST /entries/suggest-triggers` 路由

**前端改动**：
- `frontend/src/views/WorldBookView.vue`：
  - 条目编辑区域添加"AI 建议触发词"按钮
  - 调用 API 后将建议填入 triggerKeys 字段

#### 阶段三：注入内容可视化（前端为主）

**前端改动**：
- `frontend/src/views/ChatView.vue` 或匹配结果显示组件：
  - 匹配条目列表支持展开/折叠
  - 展开后显示：条目内容（截取前 200 字）、触发词、注入位置、激活类型
- `backend/src/routes/conversations.js`：
  - `summarizeWorldBookMatches` 增加返回字段：`triggeredKey`, `position`, `alwaysActive`, `recursive`
  - 返回条目内容摘要（content 前 200 字）

#### 阶段四：测试匹配功能（后端 + 前端）

**后端改动**：
- `backend/src/modules/worldBooks.js`：新增 `testMatchWorldBook(database, userId, bookId, testText)` 函数
  - 接收单本世界书 ID 和测试文本
  - 运行匹配逻辑但不更新状态
  - 返回所有条目的匹配结果（命中/未命中 + 原因）
- `backend/src/routes/worldBooks.js`：新增 `POST /:id/test-match` 路由

**前端改动**：
- `frontend/src/views/WorldBookView.vue`：
  - 详情页添加"测试匹配"面板
  - 输入文本框 + 触发按钮
  - 结果列表：每条显示匹配状态、触发词、未命中原因

#### 阶段五：角色卡跳转（前端）

**前端改动**：
- `frontend/src/views/CharacterFormView.vue`：
  - 已绑定的世界书名称改为可点击链接
  - 点击后 `emit('navigate', { page: 'world-book', params: { id: bookId } })`

### 4.2 涉及文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `backend/src/modules/worldBooks.js` | 修改 | 新增 createWorldBookFromCharacter, testMatchWorldBook |
| `backend/src/routes/worldBooks.js` | 修改 | 新增 2-3 个路由 |
| `backend/src/services/worldBookAssistant.js` | 修改 | 新增 suggestTriggerKeys |
| `backend/src/routes/conversations.js` | 修改 | 增强 summarizeWorldBookMatches 返回字段 |
| `backend/src/validations/schemas.js` | 修改 | 新增请求验证 schema |
| `frontend/src/api.js` | 修改 | 新增 API 调用函数 |
| `frontend/src/views/WorldBookView.vue` | 修改 | 测试匹配面板、触发词建议按钮 |
| `frontend/src/views/CharacterFormView.vue` | 修改 | 一键创建按钮、跳转链接 |
| `frontend/src/views/ChatView.vue` | 修改 | 匹配详情展开 |
| `backend/src/tests/backend.test.js` | 修改 | 新增测试用例 |
| `backend/src/tests/worldBookOwnershipRoutes.test.js` | 修改 | 新增路由测试 |

### 4.3 数据库改动

无需新增表或列。所有功能基于现有数据库结构实现。

---

## 五、风险评估

### 5.1 影响范围

| 风险项 | 等级 | 说明 | 缓解措施 |
|--------|------|------|----------|
| 世界书匹配逻辑变更 | 中 | testMatch 和 suggestTriggerKeys 调用匹配逻辑，需确保不影响现有状态 | testMatch 使用"只读"模式，不更新 entry_state |
| AI 助手超时 | 低 | suggestTriggerKeys 需要 LLM 调用 | 复用现有超时控制和 abort 机制 |
| 前端路由导航 | 低 | 角色卡跳转世界书涉及路由变更 | 复用现有 navigate emit 模式 |
| 匹配结果数据量 | 低 | 增强 summarizeWorldBookMatches 可能增加响应大小 | 限制 content 摘要长度为 200 字 |
| 向后兼容性 | 低 | 新增路由和字段，不修改现有行为 | 所有新增均为附加功能 |

### 5.2 不受影响的功能

- 现有世界书 CRUD 操作
- 现有条目匹配和注入逻辑
- 现有角色-世界书绑定关系
- 现有会话 lorebook 选择
- 现有 AI 世界书生成功能

---

## 六、实施建议

### 6.1 推荐实施顺序

1. **阶段五（角色卡跳转）** — 最小改动，快速交付价值
2. **阶段一（一键创建）** — 核心体验提升
3. **阶段四（测试匹配）** — 开发调试工具
4. **阶段三（注入可视化）** — 用户体验增强
5. **阶段二（触发词建议）** — AI 增强功能

### 6.2 工作量估算

| 阶段 | 预估 | 说明 |
|------|------|------|
| 阶段一：一键创建关联世界书 | S | 后端 1 函数 + 1 路由，前端 1 按钮 |
| 阶段二：触发词智能建议 | M | 涉及 LLM prompt 设计和流式响应 |
| 阶段三：注入内容可视化 | S | 主要是前端 UI 改动 |
| 阶段四：测试匹配功能 | M | 需要只读匹配模式，前端交互较多 |
| 阶段五：角色卡跳转 | S | 前端路由改动 |
| **总计** | **M** | 可拆分为 2-3 个独立迭代 |

### 6.3 前置依赖

- 无外部依赖
- 无需数据库迁移
- 复用现有 AI 助手基础设施（worldBookAssistant.js）

---

## 七、参考

- 当前 backlog 条目：`automation/backlog.md` → Ready → 新增：AI风月参考功能（高优先级）
- 世界书核心模块：`backend/src/modules/worldBooks.js`
- 世界书路由：`backend/src/routes/worldBooks.js`
- 世界书 AI 助手：`backend/src/services/worldBookAssistant.js`
- 对话集成：`backend/src/routes/conversations.js`（buildModelMessagesV2, summarizeWorldBookMatches）
- 前端视图：`frontend/src/views/WorldBookView.vue`
- 角色表单：`frontend/src/views/CharacterFormView.vue`
- 聊天设置：`frontend/src/components/chat/ChatSettingsDrawer.vue`
