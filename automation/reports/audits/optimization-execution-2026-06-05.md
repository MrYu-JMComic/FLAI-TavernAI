# FLAI-TavernAI 项目优化执行报告

**日期:** 2026-06-05
**执行人:** 太子殿下 (subagent)
**项目路径:** D:\Cat\FLAI-TavernAI\

---

## 已完成的优化任务

### ✅ 任务 #1 (P0): 数据库 `ensureColumn` PRAGMA 缓存 + 迁移版本号
- **文件:** `backend/src/db.js`
- **改动:**
  - 新增 `_tableColumnCache` Map 缓存表列信息
  - `ensureColumn` 从每次执行 `PRAGMA table_info` 改为使用缓存（30+ 次查询 → 按表名缓存，首次查询后直接命中）
  - 新增 `_schema_meta` 表记录迁移版本号
  - regex_rules 删表重建迁移只在首次执行时运行，后续启动跳过
  - `migrateTagsToUserScoped` 也使用缓存查询
- **预期效果:** 启动时间显著减少，避免每次启动的冗余 PRAGMA 查询和字符串匹配

### ✅ 任务 #2 (P0): 拆分 server.js 业务 helper
- **文件:** `backend/src/server.js` → `backend/src/modules/users.js`（新建）
- **改动:**
  - 提取 `publicUser`, `getUserProfile`, `getUserStats`, `getOwnedCharacterStats` 到独立模块
  - server.js 通过 ctx 包装函数保持向后兼容
  - 所有路由调用方式不变
- **预期效果:** server.js 行数减少 ~150 行，职责更清晰

### ✅ 任务 #3 (P0): 提取公共 SSE 流式函数
- **文件:** `frontend/src/api.js`
- **改动:**
  - 新建 `streamSSE` 共享函数，统一处理 CSRF、重试、SSE 解析
  - `streamMessage` 和 `streamAssistantDraft` 简化为单行调用
  - 所有导出函数签名不变
- **预期效果:** 消除 ~100 行重复代码，未来 SSE 逻辑修改只需改一处

### ✅ 任务 #4 (P1): 并行化 loadConversation
- **文件:** `frontend/src/views/ChatView.vue`
- **改动:**
  - `loadStatusBar`, `loadAccessorySkills`, `initMessageSwipes`, `loadConversationBranches` 从串行 4 个 await 改为 `Promise.all` 并行
- **预期效果:** 对话加载速度提升（4 次串行网络请求 → 1 次并行）

### ✅ 任务 #5 (P1): 优化批量删除和消息查询
- **文件:** `backend/src/routes/conversations.js`
- **改动:**
  - `deleteConversations`: 逐条删除改为 `IN` 子句单条 SQL
  - `getRecentMessages`: 去掉子查询，改用 `ORDER BY DESC` + `.reverse()`
- **预期效果:** 批量删除性能提升，消息查询减少一次子查询嵌套

### ✅ 任务 #6 (P1): 统一 isPhoneViewport
- **文件:** `frontend/src/composables/useViewport.js`（新建），`ChatView.vue`，`useChatAppearance.js`
- **改动:**
  - 新建共享 composable，提供 `isPhoneViewport` 函数和响应式 `useViewport` composable
  - 两处重复定义改为从共享模块导入
- **预期效果:** 消除代码重复，断点修改只需改一处

### ✅ 任务 #7 (P1): 优化 getUserStats 合并为单查询
- **文件:** `backend/src/modules/users.js`
- **改动:**
  - 3 个独立 SQL 查询合并为 1 个带子查询的 SELECT
- **预期效果:** 减少数据库往返次数（3 次 → 1 次）

---

## 未执行的任务（需要更多评估）

### ⏸️ P0 #4: ChatView 使用 VirtualMessageList
- VirtualMessageList.vue 存在但未在 ChatView 中使用
- 需要评估虚拟滚动与现有功能（Swipe、分支、编辑、滚动位置恢复）的兼容性
- **建议:** 作为独立任务，需要完整的集成测试

### ⏸️ P1: 合并消息发送后的刷新逻辑
- `refreshConversationChrome` + `scheduleAccessoryRefresh` 触发 6+ 次 API
- 需要设计批量接口或 WebSocket 推送方案
- **建议:** 需要后端配合新增批量接口

### ⏸️ P2: 考虑引入 vue-router
- 当前 7 个视图用 hash 路由足够
- 扩展到 10+ 视图时再考虑

---

## 验证结果

- ✅ 后端 `require('server.js')` 加载正常，服务启动正常
- ✅ 前端 `vite build` 构建通过（547ms）
- ✅ 编码检查通过（`check-encoding.mjs`）
- ✅ 所有导出接口签名不变，路由调用方式不变
- ✅ 无新增依赖

---

*如烟可传话给皇上，7 项优化已全部执行完毕并验证通过。*
