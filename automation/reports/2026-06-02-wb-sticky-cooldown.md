# WB-STICKY-COOLDOWN — 世界书粘性/冷却/延迟 实施报告

**日期**: 2026-06-02  
**状态**: ✅ 已完成（代码已存在并通过验证）

---

## 概述

为世界书条目新增 `sticky`、`cooldown`、`delay` 三个 nullable integer 字段，实现精细化的条目激活控制。

---

## Definition of Done 核对

| # | 条目 | 状态 | 说明 |
|---|------|------|------|
| 1 | `world_book_entries` 表新增 sticky/cooldown/delay 列 | ✅ | `db.js` 中通过 `ensureColumn` 添加，类型为 `INTEGER` (nullable) |
| 2 | `matchWorldBookEntries()` 实现逻辑 | ✅ | 完整实现含 Phase 0 (sticky) / Phase 2 (cooldown+delay) / Phase 4 (状态更新) |
| 3 | sticky=3 保持 3 条消息激活 | ✅ | 测试 `world book sticky=3 keeps entry active for 3 messages after activation` 验证通过 |
| 4 | ≥2 个新增后端测试 | ✅ | 5 个专用测试：sticky、cooldown、delay、组合、CRUD 持久化 |
| 5 | 所有现有测试通过 | ✅ | 84/84 pass, 0 fail |
| 6 | 前端构建通过 | ✅ | Vite build 成功 (1.05s) |
| 7 | 写报告 | ✅ | 本文件 |

---

## 实现详情

### 数据库 Schema (`backend/src/db.js`)
```sql
-- 通过 ensureColumn 迁移
ALTER TABLE world_book_entries ADD COLUMN sticky INTEGER;   -- nullable
ALTER TABLE world_book_entries ADD COLUMN cooldown INTEGER;  -- nullable
ALTER TABLE world_book_entries ADD COLUMN delay INTEGER;     -- nullable
```

新增状态表：
```sql
CREATE TABLE world_book_entry_state (
  entry_id TEXT PRIMARY KEY,
  last_activated_message INTEGER DEFAULT 0,
  last_deactivated_message INTEGER DEFAULT 0,
  first_seen_message INTEGER DEFAULT 0,
  sticky_remaining INTEGER DEFAULT 0,
  was_active INTEGER DEFAULT 0
);
```

### 匹配逻辑 (`backend/src/modules/worldBooks.js`)

**Phase 0 — Sticky 保持**：检查 `sticky_remaining > 0`，直接加入匹配结果  
**Phase 1 — Always Active**：含 delay 检查  
**Phase 2 — Trigger Keys**：含 delay + cooldown 前置过滤  
**Phase 2.5 — Group Inclusion**：组内随机选择  
**Phase 3 — Recursive**：递归扫描  
**Phase 4 — 状态更新**：激活时设置 sticky_remaining，停用时记录 last_deactivated_message

### 字段语义
- **sticky**: `null` | 0~9999 — 激活后保持 N 条消息
- **cooldown**: `null` | 0~9999 — 停用后冷却 N 条消息才可再次激活
- **delay**: `null` | 0~9999 — 首次见到后第 N 条消息才可激活

### 验证层 (`backend/src/validations/schemas.js`)
```js
sticky: z.number().int().min(0).max(9999).nullable().optional()
cooldown: z.number().int().min(0).max(9999).nullable().optional()
delay: z.number().int().min(0).max(9999).nullable().optional()
```

### API 层 (`backend/src/routes/worldBooks.js`)
- `POST /:id/entries` — 创建条目支持 sticky/cooldown/delay
- `PUT /:id/entries/:entryId` — 更新条目支持 sticky/cooldown/delay
- `GET /:id` — 返回条目含 sticky/cooldown/delay 字段

---

## 测试覆盖 (5 个专用测试)

1. **sticky=3 持续激活** — msg1 触发 → msg2~4 保持 → msg5 失效
2. **cooldown=3 防止重复激活** — msg1 激活 → msg2 停用 → msg3~4 冷却中 → msg5 可再激活
3. **delay=3 延迟首次激活** — msg1 首见 → msg1~3 延迟中 → msg4 激活
4. **sticky+cooldown 组合** — sticky=2 + cooldown=2，验证完整生命周期
5. **CRUD 持久化** — 创建/更新含 sticky/cooldown/delay 字段的条目并验证

---

## 测试结果

```
ℹ tests 84
ℹ pass 84
ℹ fail 0
ℹ duration_ms 1158
```

---

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `backend/src/db.js` | 已有 | ensureColumn + world_book_entry_state 表 |
| `backend/src/modules/worldBooks.js` | 已有 | matchWorldBookEntries 完整实现 |
| `backend/src/validations/schemas.js` | 已有 | Zod schema |
| `backend/src/tests/backend.test.js` | 已有 | 5 个专用测试 |

---

## 备注

所有代码已存在于代码库中，本次任务为验证确认。实现质量良好，覆盖了 sticky/cooldown/delay 的完整生命周期，包括边界情况和组合使用场景。
