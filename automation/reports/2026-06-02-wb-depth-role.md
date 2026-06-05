# WB-DEPTH-ROLE 完成报告

**日期**: 2026-06-02  
**任务**: 世界书 `at_depth` 模式新增 `role` 字段

## 变更摘要

### 数据库层 (`src/db.js`)
- `world_book_entries` 表新增 `role` 列（INTEGER，默认 0），通过 `ensureColumn` 迁移

### 世界书模块 (`src/modules/worldBooks.js`)
- `normalizeEntryPayload`: 解析并验证 `role` 字段（0/1/2，默认 0=system）
- `createEntry`: INSERT 语句包含 `role`
- `updateEntry`: UPDATE 语句包含 `role`
- `toEntry`: 映射 `row.role` 到返回对象
- `matchPass` & always_active: 匹配结果包含 `role` 字段
- `buildWorldBookContext`: **不再将 `at_depth` 条目拼入系统提示**（它们通过独立消息注入）
- 新增 `injectAtDepthEntries(messages, entries)`: 将 `at_depth` 条目按 `role` 和 `depth` 插入消息数组

### 对话路由 (`src/routes/conversations.js`)
- 导入 `injectAtDepthEntries`
- `buildModelMessagesV2` 接收 `worldBookEntries` 参数
- 返回前调用 `injectAtDepthEntries` 将 `at_depth` 条目插入消息流

### 验证层 (`src/validations/schemas.js`)
- `createWorldBookEntrySchema` 新增 `role: z.number().int().min(0).max(2)`

### 角色导出/导入 (`src/routes/characters.js`)
- 导出 SQL 查询包含 `role` 列
- 导入时读取并传递 `role` 字段

## 测试
- 新增 1 个测试: `world book at_depth entry role field controls injected message role`
  - 验证 role=0/1/2 的条目匹配后保留角色信息
  - 验证 `at_depth` 条目不进入 `buildWorldBookContext` 系统提示
  - 验证 `injectAtDepthEntries` 按正确位置和角色插入消息
- 全量测试: **79 pass / 0 fail**（含其他 4 个测试文件 73 pass）

## DoD 核对
| 要求 | 状态 |
|------|------|
| `world_book_entries` 表新增 `role` 列（INTEGER，默认 0） | ✅ |
| `matchWorldBookEntries()` 的 `at_depth` 注入逻辑使用 `role` 字段 | ✅ |
| depth=2, role=system 的条目在倒数第 2 条消息后以 system 角色注入 | ✅ |
| 含 1 个后端测试验证 role 字段生效 | ✅ |
| 现有测试全部通过 | ✅ |
