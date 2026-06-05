# DB 初始化顺序修复 + 前端构建修复 — 2026-05-29

## 问题

所有 5 个测试文件均失败，报错 `no such table: world_books`。
前端 `npm run build` 失败，报错 `Invalid empty selector`。

## 根因分析

### 后端 (db.js)

`ensureColumn(database, 'world_books', ...)` 和 `ensureColumn(database, 'world_book_entries', ...)` 在 `CREATE TABLE IF NOT EXISTS world_books` 之前调用。
使用 `:memory:` 数据库运行测试时，表尚未创建，`PRAGMA table_info(world_books)` 失败。

### 前端 (ChatView.vue + styles.css)

1. `ChatView.vue` 第 44 行重复导入 `fetchConversationMessages`，导致编译报错。
2. `styles.css` 文件开头存在 UTF-8 BOM (`\xEF\xBB\xBF`)，导致 lightningcss 解析出空选择器。

## 修复内容

| 文件 | 修改 |
|------|------|
| `backend/src/db.js` | 将 `world_books` / `world_book_entries` 的 `ensureColumn` 调用移至 `CREATE TABLE` 之后 |
| `frontend/src/views/ChatView.vue` | 删除重复的 `fetchConversationMessages` 导入 |
| `frontend/src/styles.css` | 移除 UTF-8 BOM 头 |

## 验证

```
后端测试: 128/128 通过
前端构建: ✓ 成功 (457ms)
```

## 改动文件清单

- `backend/src/db.js` — 重新排列 `ensureColumn` 调用顺序
- `frontend/src/views/ChatView.vue` — 删除重复导入
- `frontend/src/styles.css` — 移除 BOM
