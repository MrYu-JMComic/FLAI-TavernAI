# WB-INCLUSION-GROUP 实现报告

**日期**: 2026-05-30
**任务**: WB-INCLUSION-GROUP: 包含组互斥
**状态**: ✅ 完成

## 变更内容

### 1. `backend/src/db.js`
- 新增 `inclusion_group` (TEXT DEFAULT '') 和 `group_weight` (INTEGER DEFAULT 0) 列到 `world_book_entries` 表
- 注：列名使用 `inclusion_group` 而非 `group`，因 `group` 是 SQL 保留关键字，会导致 `ensureColumn` 存在性检查失败

### 2. `backend/src/modules/worldBooks.js`
- **normalizeEntryPayload()**: 新增 `group` (string, max 100) 和 `groupWeight` (int, min 0) 字段处理
- **toEntry()**: 映射 `inclusion_group` → `group` 和 `group_weight` → `groupWeight`
- **createEntry()**: INSERT SQL 包含 `inclusion_group`, `group_weight` 列
- **updateEntry()**: UPDATE SQL SET 包含 `inclusion_group = ?`, `group_weight = ?`
- **matchWorldBookEntries()**: Phase 2 后新增 Phase 2.5 — 按 `inclusion_group` 分组，同组多条目按 `group_weight` 加权随机选一，权重为 0 时视为 1

### 3. `backend/src/tests/backend.test.js`
- 新增 1 个测试：`world book group inclusion keeps only one entry per group`
- 创建 3 个同组 always_active 条目，验证 `matchWorldBookEntries` 仅返回 1 条

## 验证结果

| 检查项 | 结果 |
|--------|------|
| 编码检查 | ✅ 通过 |
| 后端测试 (151) | ✅ 全部通过 |
| 前端构建 | ✅ 通过 |
| 门下省审核 | ✅ PASS |

## DoD 核对

- [x] `world_book_entries` 表新增 `inclusion_group`、`group_weight` 列
- [x] 同组多条目同时激活时按权重随机选一
- [x] ≥1 个新增后端测试全通过
- [x] 现有测试不回归 (151/151)
- [x] 编码检查通过

## 技术说明

SQL 保留关键字 `group` 作为列名会导致 `ensureColumn` 存在性检查引号不匹配（`PRAGMA table_info` 返回不带引号的列名，但调用传入带引号的名称）。解决方案：DB 列名使用 `inclusion_group`，API 字段名保持 `group` 不变，前端无需修改。

## 下一步建议

- **WB-STICKY-COOLDOWN**: 粘性/冷却/延迟机制（下一个 Ready 队列任务）
