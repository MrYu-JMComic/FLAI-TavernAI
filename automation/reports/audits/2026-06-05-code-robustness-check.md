# FLAI-TavernAI 代码健壮性检查报告

**日期：** 2026-06-05  
**检查人：** 太子三省联合巡检  
**项目：** D:\Cat\FLAI-TavernAI\  
**范围：** 后端（Express + SQLite）、前端（Vue 3）、基础设施

---

## 📊 总览

| 严重程度 | 数量 |
|---------|------|
| 🔴 高风险 | 4 |
| 🟡 中风险 | 9 |
| 🟢 低风险 | 6 |

**整体评价：** 项目代码质量较高，Zod 验证覆盖全面，SQLite 操作有 WAL 模式和事务保护，异步路由有 `asyncRoute` 包装。以下是需要关注的健壮性问题。

---

## 🔴 高风险问题

### 1. economy.js — 交易操作无事务保护

**位置：** `backend/src/modules/economy.js` → `createTransaction()`

**问题：** 交易扣款操作分两步执行——先插入交易记录，再更新余额——但没有用数据库事务包裹。如果第二步失败（如进程被杀），会出现交易记录已写入但余额未更新的数据不一致。

```js
// 当前代码（无事务）
database.prepare('INSERT INTO economy_transactions ...').run(...);
database.prepare('UPDATE economy_accounts SET balance = ? ...').run(...);
```

**风险等级：** 🔴 高 — 余额数据不一致，用户可能丢失金币

**建议修复：**
```js
database.exec('BEGIN');
try {
  database.prepare('INSERT INTO economy_transactions ...').run(...);
  database.prepare('UPDATE economy_accounts SET balance = ? ...').run(...);
  database.exec('COMMIT');
} catch (error) {
  database.exec('ROLLBACK');
  throw error;
}
```

### 2. saves.js — loadSave 删除旧消息+插入新消息无事务

**位置：** `backend/src/modules/saves.js` → `loadSave()`

**问题：** 存档加载时先 DELETE 所有旧消息，再 INSERT 恢复消息。如果中间出错，对话消息会全部丢失且无法恢复。

```js
// 当前代码（无事务）
database.prepare('DELETE FROM messages WHERE user_id = ? AND conversation_id = ?').run(...);
// 如果这里崩溃，消息全部丢失
for (const msg of snapshot.messages) {
  insert.run(...);
}
```

**风险等级：** 🔴 高 — 可能导致对话消息永久丢失

**建议修复：** 包裹在事务中，失败时 ROLLBACK 恢复旧消息。

### 3. branches.js — branchConversation 多表操作无事务

**位置：** `backend/src/modules/branches.js` → `branchConversation()`

**问题：** 分支创建涉及插入新对话、复制消息、复制 swipes、复制状态栏等多步操作，没有事务保护。中途失败会留下不完整的分支数据。

**风险等级：** 🔴 高 — 可能产生不完整的对话分支

**建议修复：** 整个操作包裹在 `BEGIN/COMMIT/ROLLBACK` 事务中。

### 4. characters.js — replaceRegexRules 先删后插无事务

**位置：** `backend/src/modules/characters.js` → `replaceRegexRules()`

**问题：** 先 DELETE 所有正则规则，再 INSERT 新规则。如果插入中途失败，角色的所有正则规则会被清空。

```js
database.prepare('DELETE FROM regex_rules WHERE user_id = ? AND character_id = ?').run(...);
// 如果这里崩溃，规则全部丢失
normalizeRegexRules(rules).forEach((rule, index) => {
  insert.run(...);
});
```

**风险等级：** 🔴 高 — 角色正则规则可能被意外清空

**建议修复：** 包裹在事务中。

---

## 🟡 中风险问题

### 5. applyRegexRules — js_script 执行无沙箱

**位置：** `backend/src/modules/characters.js` → `applyRegexRules()`

**问题：** 当 `rule.scriptMode` 开启时，使用 `new Function()` 执行用户提供的 JS 脚本。虽然这是设计意图，但没有超时保护，恶意或错误的脚本可能阻塞事件循环。

```js
if (rule.scriptMode && rule.jsScript) {
  const fn = new Function('text', 'matches', 'rule', rule.jsScript);
  return String(fn(value, ...) ?? value);
}
```

**风险等级：** 🟡 中 — 可能导致服务器无响应（仅影响脚本作者自己的数据）

**建议修复：** 考虑添加执行超时（如 100ms），或在文档中明确这是高级功能。

### 6. server.js — 错误处理中间件统一返回 400

**位置：** `backend/src/server.js` → 错误处理中间件

**问题：** 全局错误处理中间件将所有未捕获错误统一返回 HTTP 400，但有些错误（如数据库损坏）应该是 500。

```js
app.use((error, _request, response, _next) => {
  const message = error?.message || '服务器错误';
  response.status(400).json({ error: message });
});
```

**风险等级：** 🟡 中 — 错误状态码不准确，影响前端错误处理逻辑

**建议修复：** 根据错误类型返回不同状态码：
```js
const status = error.status || (error.message?.includes('SQLITE') ? 500 : 400);
response.status(status).json({ error: message });
```

### 7. 世界书消息计数器非持久化

**位置：** `backend/src/modules/worldBooks.js` → `_messageCounter`

**问题：** 世界书的 sticky/cooldown/delay 功能使用内存中的 `_messageCounter` 计数器。服务器重启后计数器归零，导致 sticky 状态和 cooldown 时间判断错误。

```js
let _messageCounter = 0;
function getNextMessageCount(database) {
  return ++_messageCounter;
}
```

**风险等级：** 🟡 中 — 服务器重启后世界书激活逻辑可能异常

**建议修复：** 将消息计数持久化到 `_schema_meta` 表，或从数据库 MAX(created_at) 推算。

### 8. SQLite 同步 API 阻塞事件循环

**位置：** 全局 — 使用 `node:sqlite` 的 `DatabaseSync`

**问题：** 项目使用 Node.js 内置的同步 SQLite API (`DatabaseSync`)。所有数据库操作都是同步的，在高并发时可能阻塞事件循环。对于当前的单用户/少量用户场景尚可接受，但扩展性有限。

**风险等级：** 🟡 中 — 当前场景可接受，但并发扩展受限

**建议修复：** 当前无需修改，但需注意不要在数据库操作中放入大量数据处理。未来考虑异步 SQLite 驱动。

### 9. 前端 SSE 流式处理 — 未处理 ReadableStream 取消错误

**位置：** `frontend/src/api.js` → `streamSSE()`

**问题：** SSE 流读取中，`reader.read()` 的 catch 块只处理了 AbortError，但如果流被浏览器或网络层取消（非用户主动），可能抛出其他类型的错误。

**风险等级：** 🟡 中 — 流式对话中断时可能出现未处理的异常

**建议修复：** 在 catch 块中增加对 `ReadableStream` 相关错误的处理。

### 10. 前端 localStorage 读取无异常处理

**位置：** `frontend/src/composables/chat/useChatSubmit.js` → `readLocalBoolean()`

**问题：** 直接读取 localStorage，如果存储配额已满或数据损坏可能抛出异常。

```js
function readLocalBoolean(key, fallback) {
  const value = window.localStorage.getItem(key);
  // 无 try-catch
}
```

**风险等级：** 🟡 中 — 隐私模式或存储异常时可能导致页面崩溃

**建议修复：** 包裹在 try-catch 中。

### 11. db.js — ensureStorageDirs 无错误处理

**位置：** `backend/src/db.js` → `ensureStorageDirs()`

**问题：** `fs.mkdirSync` 在权限不足或磁盘满时会抛出异常，但没有捕获。

```js
export function ensureStorageDirs() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(avatarUploadDir, { recursive: true });
}
```

**风险等级：** 🟡 中 — 启动时如果目录创建失败，服务器会崩溃

**建议修复：** 捕获异常并给出有意义的错误信息。

### 12. customJs 执行风险（前端）

**位置：** 前端 `chatAppearance.js`（推测） — 对话设置中的 `customJs` 字段

**问题：** 对话设置允许用户输入自定义 JS 代码并执行。虽然这是设计功能，但没有沙箱隔离。Zod 验证限制了长度（50000字符），但不限制代码内容。

**风险等级：** 🟡 中 — 仅影响用户自己的浏览器环境

### 13. parseExtraBody — JSON.parse 无保护

**位置：** `backend/src/routes/settings.js` → `parseExtraBody()`

**问题：** 当 `extraBody` 是字符串时直接 `JSON.parse`，如果格式错误会抛出未捕获异常。

```js
function parseExtraBody(value) {
  if (typeof value === 'string') {
    return JSON.parse(value); // 可能抛出异常
  }
  return value;
}
```

**风险等级：** 🟡 中 — 无效 JSON 输入会导致 500 错误

**建议修复：** 使用 try-catch 包裹，返回空对象作为降级。

---

## 🟢 低风险问题

### 14. 前端表单 — 登录/注册缺少客户端实时校验

**位置：** `frontend/src/views/LoginView.vue`、`RegisterView.vue`

**问题：** 表单使用了 HTML5 属性（`minlength`、`maxlength`）和 `novalidate`，但没有在提交前做 JavaScript 层面的校验。后端有 Zod 验证兜底，但用户体验不佳（提交后才知道错误）。

**风险等级：** 🟢 低 — 后端验证兜底，仅影响用户体验

### 15. backup.js — 备份并发竞态

**位置：** `backend/src/services/backup.js` → `createBackup()`

**问题：** 使用 `fs.copyFileSync` 复制 SQLite 文件，在 WAL 模式下如果恰好有写操作进行中，可能得到不一致的备份。没有使用 SQLite 的 `.backup()` API。

**风险等级：** 🟢 低 — 每日备份，竞态窗口很小

**建议修复：** 考虑使用 SQLite 的 `VACUUM INTO` 或 `sqlite3_backup` API。

### 16. CSRF token 生命周期不一致

**位置：** `backend/src/services/csrf.js` vs `backend/src/security.js`

**问题：** 两个文件都实现了 CSRF 功能。`csrf.js` 中 cookie 有效期是 24 小时，但 `security.js` 中是 30 天。`server.js` 实际使用的是 `csrf.js` 的版本（`csrfProtection` + `csrfTokenEndpoint`），但 `security.js` 中也导出了同名函数，可能造成混淆。

**风险等级：** 🟢 低 — 当前不会导致运行时错误，但代码可维护性差

**建议修复：** 统一到一个文件，移除重复实现。

### 17. 前端 — 缺少空数组/空状态的 loading 骨架屏

**位置：** 多个视图组件

**问题：** 数据加载期间缺少骨架屏或 loading 状态展示（部分视图有 `v-if="loading"` 但样式简单）。

**风险等级：** 🟢 低 — 仅影响用户体验

### 18. 前端 — 超长输入的 textarea 自动高度无上限保护

**位置：** `frontend/src/views/ChatView.vue` → `resizeComposerTextarea()`

**问题：** textarea 自动调整高度的逻辑虽然有 `maxHeight` 限制（112px/180px），但如果 CSS 变量 `--composer-textarea-max-height` 被 customCss 修改为极大值，textarea 可能撑满屏幕。

**风险等级：** 🟢 低 — 仅当用户自己设置了极端 CSS 值

### 19. 前端 — SSE 连接未设置最大重连次数

**位置：** `frontend/src/api.js` → `streamSSE()`

**问题：** SSE 流断开后没有自动重连机制。虽然当前设计是单次请求-响应模式，但如果网络不稳定，用户需要手动重试。

**风险等级：** 🟢 低 — 设计选择，非 bug

---

## ✅ 做得好的地方

1. **Zod 验证覆盖全面** — 所有 API 端点都有 schema 验证，包括类型、范围、长度限制
2. **CSRF 防护完善** — Double Submit Cookie + timingSafeEqual
3. **asyncRoute 包装** — 所有异步路由都有 Promise rejection 捕获
4. **密码哈希安全** — 使用 scrypt + timingSafeEqual
5. **SQLite WAL 模式** — 提高并发读写性能
6. **输入长度限制** — 前端 maxlength + 后端 Zod + 模块层 slice 三重保护
7. **前端事件监听器清理** — ChatView.vue 的 onBeforeUnmount 中正确清理了所有监听器和 ResizeObserver
8. **流式响应超时保护** — 60 秒空闲超时自动中断
9. **正则规则验证** — 创建前先 `new RegExp()` 验证合法性
10. **头像大小限制** — 2MB 上限 + 格式白名单

---

## 📋 修复优先级建议

| 优先级 | 问题编号 | 简述 |
|--------|---------|------|
| P0 (立即) | #1, #2, #3, #4 | 多步数据库操作添加事务保护 |
| P1 (本周) | #6, #7, #13 | 错误处理改进 |
| P2 (下周) | #5, #9, #10, #11 | 健壮性增强 |
| P3 (后续) | #8, #12, #14-19 | 架构优化和体验改进 |

---

*报告完毕。如烟~*
