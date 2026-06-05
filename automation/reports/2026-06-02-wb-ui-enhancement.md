# WB-UI-ENHANCEMENT 世界书前端编辑器增强报告

**日期**: 2026-06-02
**任务**: 为 WorldBookView.vue 编辑器添加高级字段支持

## 变更摘要

### 1. 后端验证 Schema (`backend/src/validations/schemas.js`)
- 在 `createWorldBookEntrySchema` 中添加了 8 个缺失的字段定义：
  - `selective` (boolean, 默认 false)
  - `selectiveLogic` (int 0-2, 默认 0)
  - `keysSecondary` (string, 默认 '')
  - `probability` (int 0-100, 默认 100)
  - `useProbability` (boolean, 默认 false)
  - `group` (string, 默认 '')
  - `groupWeight` (int, 默认 0)
  - `orderIndex` (int, 可选)

### 2. 前端 (`frontend/src/views/WorldBookView.vue`)

#### 世界书级别
- 新增 `lorebookContextPercent` 字段（数字输入 1-100, 默认 25）
- 保存/加载/重置逻辑完整

#### 条目编辑表单 — 新增字段
| 字段 | UI 控件 | 条件显示 |
|------|---------|----------|
| `selective` | 复选框 | 始终显示 |
| `keysSecondary` | 文本输入 | selective=true |
| `selectiveLogic` | 下拉选择 | selective=true |
| `useProbability` | 复选框 | 始终显示 |
| `probability` | 范围滑块 (0-100) | useProbability=true |
| `group` | 文本输入 | 始终显示 |
| `groupWeight` | 数字输入 | 始终显示 |
| `role` | 下拉选择 (System/User/Assistant) | position=at_depth |
| `orderIndex` | 数字输入 | 高级折叠区 |
| `sticky` | 数字输入 (0-9999) | 高级折叠区 |
| `cooldown` | 数字输入 (0-9999) | 高级折叠区 |
| `delay` | 数字输入 (0-9999) | 高级折叠区 |

#### 条目列表 Badge
- `selective` → 蓝色 "过滤" 标签
- `useProbability` → 橙色 "XX%" 标签
- `group` → 青色分组名标签
- `sticky/cooldown/delay` → 灰色标签
- `role` (at_depth 时) → 紫色角色标签

#### CSS 新增样式
- `.entry-badge.selective` (蓝)
- `.entry-badge.probability` (橙)
- `.entry-badge.group` (青)
- `.entry-badge.timing` (灰)
- `.entry-badge.role` (紫)
- `.advanced-section` (details/summary 折叠)

## 验证结果

| 检查项 | 结果 |
|--------|------|
| `npm run build` (前端) | ✅ 通过 |
| `node scripts/check-encoding.mjs` | ✅ 通过 |
| `npm test` (后端, 159 tests) | ✅ 全部通过 |

## 修复的问题
- saveEntry payload 中 `inclusion_group` 改为 `group`，与 Zod schema 和后端 `normalizeEntryPayload` 对齐

## 未改动文件
- `frontend/src/api.js` — API 函数使用通用 JSON 传递，无需修改
- 后端路由/模块 — 已完整支持所有字段，无需改动
