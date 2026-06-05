# WB-CHAT-LOREBOOK 实现报告

**日期**: 2026-06-02  
**任务**: 为单个对话绑定专属世界书（chat lorebook），条目仅在该对话中激活

## 变更文件列表

| 文件 | 变更说明 |
|------|---------|
| `backend/src/db.js` | 新增 `chat_lorebook_id` TEXT 列到 `conversations` 表（通过 `ensureColumn`） |
| `backend/src/routes/helpers.js` | `toConversation()` 返回对象新增 `chatLorebookId` 字段 |
| `backend/src/routes/conversations.js` | `PUT /:id/settings` 端点支持读写 `chatLorebookId`；消息发送时传递 `conversationId` 给 `matchWorldBookEntries` |
| `backend/src/modules/worldBooks.js` | `matchWorldBookEntries` 新增 `options.conversationId` 参数，从 `conversations.chat_lorebook_id` 获取聊天专属世界书 |
| `backend/src/validations/schemas.js` | `saveConversationSettingsSchema` 新增 `chatLorebookId` 字段（nullable string） |
| `backend/src/tests/backend.test.js` | 新增 2 个测试：聊天世界书隔离性、聊天世界书与角色世界书共存 |
| `frontend/src/views/ChatView.vue` | 设置面板新增聊天世界书下拉选择器，支持加载世界书列表、保存绑定 |
| `frontend/src/styles.css` | 新增 `.chat-lorebook-hint` 样式 |

## 实现细节

### 数据库层
- `conversations` 表通过 `ensureColumn` 迁移添加 `chat_lorebook_id TEXT` 列
- 该列为 nullable，外键逻辑通过应用层校验（world_books.id 为 TEXT UUID）

### 后端 API
- `PUT /api/conversations/:id/settings` 现在接受 `chatLorebookId` 字段
- 保存时校验指定世界书是否存在（属于当前用户）
- 返回值中包含 `chatLorebookId` 字段

### 世界书激活逻辑
- `matchWorldBookEntries` 函数新增第三个参数源：当 `options.conversationId` 存在时，从 `conversations.chat_lorebook_id` 获取世界书 ID
- 三个来源合并：角色直接绑定、character_world_books 关联表、对话级 chat_lorebook_id
- 消息发送路由已更新，传入 `conversationId`

### 前端
- ChatView.vue 设置面板新增「聊天世界书」区域
- 下拉列表显示所有用户世界书（含条目数量），支持「无（不绑定）」选项
- 打开设置面板时懒加载世界书列表
- 保存设置时一并提交 `chatLorebookId`

## 验证结果

| 检查项 | 结果 |
|--------|------|
| `npm test`（后端，82 项） | ✅ 全部通过 |
| `node scripts/check-encoding.mjs` | ✅ 通过 |
| `npm run build`（前端） | ✅ 构建成功（585ms） |

### 新增测试
1. **chat lorebook entries activate only in the bound conversation** — 创建世界书和条目，绑定到对话 A，验证 `matchWorldBookEntries` 在对话 A 上下文中找到条目，在对话 B 和无 conversationId 时不触发
2. **chat lorebook coexists with character world books** — 创建两个世界书（一个角色绑定，一个对话绑定），验证两者条目在绑定对话中同时激活，且对话 A 的聊天世界书不影响对话 B

## 遇到的问题

1. **opencode 过度修改**: opencode 在实现过程中对多个无关文件做了大规模修改（26 个文件，含前端重构、CSS 大改等），需要手动 revert 17 个无关文件并清理不相关的测试代码
2. **PowerShell `&&` 不支持**: Windows PowerShell 不支持 `&&` 连接符，需使用 `;` 替代
3. **npm 执行策略限制**: `npm.ps1` 被系统策略阻止，前端构建通过直接调用 `node node_modules/vite/bin/vite.js build` 完成
