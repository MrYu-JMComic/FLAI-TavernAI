# WB-TOKEN-BUDGET — Token 预算管理 实施报告

**日期**: 2026-06-02  
**状态**: ✅ 已完成

---

## 概述

为世界书引擎增加 Token 预算管理功能：根据 context size 和 lorebookContextPercent 计算世界书 token 预算，按 order 升序插入条目，超出预算时截断后续条目。

---

## Definition of Done 核对

| # | 条目 | 状态 | 说明 |
|---|------|------|------|
| 1 | `lorebookContextPercent` 全局设置字段 | ✅ | `world_books` 表新增 `lorebook_context_percent` 列 (INTEGER NOT NULL DEFAULT 25)，通过 `ensureColumn` 迁移 |
| 2 | `matchWorldBookEntries()` 按 order 排序 + 预算截断 | ✅ | Phase 5: 按 `orderIndex` ASC 排序，累加 token 估算，超出 budget 后 `splice` 截断 |
| 3 | Token 估算: `Math.ceil(content.length / 4)` | ✅ | 简单字符数 / 4 向上取整 |
| 4 | 100 token 预算注入 150 token 条目时截断 | ✅ | 测试 `world book token budget truncates entries exceeding budget` 验证通过 |
| 5 | ≥1 个新增后端测试验证截断 | ✅ | 2 个新增测试: token budget 截断 + lorebookContextPercent 持久化 |
| 6 | 所有现有测试通过 | ✅ | 86/86 pass, 0 fail |
| 7 | 前端构建通过 | ✅ | Vite build 成功 (553ms) |
| 8 | 写报告 | ✅ | 本文件 |

---

## 实现详情

### 数据库 Schema (`backend/src/db.js`)
```sql
-- 通过 ensureColumn 迁移
ALTER TABLE world_books ADD COLUMN lorebook_context_percent INTEGER NOT NULL DEFAULT 25;
```

### 世界书模块 (`backend/src/modules/worldBooks.js`)

**createWorldBook** — 新增 `lorebookContextPercent` 参数:
```js
const lorebookContextPercent = Math.max(1, Math.min(100, Number(payload.lorebookContextPercent) || 25));
```

**updateWorldBook** — 支持更新 `lorebookContextPercent`:
```js
const lorebookContextPercent = payload.lorebookContextPercent !== undefined
  ? Math.max(1, Math.min(100, Number(payload.lorebookContextPercent) || 25))
  : (existing.lorebookContextPercent ?? 25);
```

**toWorldBook** — 映射新字段:
```js
lorebookContextPercent: Number(row.lorebook_context_percent || 25)
```

**matchWorldBookEntries** — Phase 5 Token Budget 截断:
```
1. 读取 options.contextSize（模型 context 大小，token 数）
2. 确定 percent: options.lorebookContextPercent > 书中存储值 > 默认 25
3. budget = Math.floor(contextSize * percent / 100)
4. 按 orderIndex ASC 排序 matched 条目
5. 逐条累加 Math.ceil(content.length / 4)，超出 budget 后 splice 截断
6. 若未提供 contextSize，跳过截断（向后兼容）
```

**matched 条目对象** — 所有 Phase (0/1/2) 的 push 均包含 `orderIndex: entry.order_index`

### 验证层 (`backend/src/validations/schemas.js`)
```js
lorebookContextPercent: z.number().int().min(1).max(100).optional().default(25)
```
`updateWorldBookSchema` 通过 `.partial()` 自动继承。

---

## 测试覆盖 (2 个新增测试)

1. **Token Budget 截断** — 创建 3 个各 200 字符 (50 token) 条目，设置 budget=100 token，验证仅返回前 2 个条目，第 3 个被截断；无 budget 时全部返回
2. **lorebookContextPercent 持久化** — 验证默认值 25、自定义值、更新、超限钳位 (150→100)

---

## 测试结果

```
ℹ tests 86
ℹ pass 86
ℹ fail 0
ℹ duration_ms 1112
```

---

## 前端构建

```
✓ built in 553ms
```
无新增前端组件需求（设置字段通过现有 world book API 返回）。

---

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `backend/src/db.js` | 修改 | `ensureColumn` 添加 `lorebook_context_percent` |
| `backend/src/modules/worldBooks.js` | 修改 | create/update/toWorldBook + Phase 5 截断 + orderIndex 字段 |
| `backend/src/validations/schemas.js` | 修改 | Zod schema 新增 `lorebookContextPercent` |
| `backend/src/tests/backend.test.js` | 修改 | 2 个新增测试 |
| `backend/src/routes/worldBooks.js` | 无变更 | 已有 schema 验证自动覆盖 |

---

## 备注

- Token 估算使用 `Math.ceil(content.length / 4)` 作为简单近似，适用于中英文混合场景
- 预算截断在 Phase 4 (状态更新) 之后执行，确保 sticky/cooldown 状态正确更新后再截断
- 当 `contextSize` 未提供时完全跳过截断，保持向后兼容
- `lorebookContextPercent` 存储在 `world_books` 表中（per-book 设置），支持每本世界书独立配置
