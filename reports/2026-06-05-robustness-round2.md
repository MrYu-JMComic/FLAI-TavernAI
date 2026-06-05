# FLAI-TavernAI 第二轮代码健壮性检查报告

**日期：** 2026-06-05  
**检查人：** 太子三省联合巡检  
**项目：** D:\Cat\FLAI-TavernAI\  
**范围：** 第一轮修复验证 + 遗漏问题 + 新发现问题

---

## 📊 总览

| 类别 | 数量 |
|------|------|
| ✅ 第一轮修复已正确应用 | 14 |
| ⚠️ 第一轮修复存在隐患 | 1 |
| 🟡 新发现中风险 | 2 |
| 🟢 新发现低风险 | 4 |

**整体评价：** 第一轮 19 个问题中 14 个已正确修复，5 个作为设计选择保留。修复引入了事务保护、错误处理增强、超时守卫等关键改进，**未引入新的高风险问题**。整体健壮性显著提升。以下是本轮发现的细节。

---

## ✅ 第一轮修复验证

| # | 原问题 | 修复状态 | 验证结果 |
|---|--------|---------|---------|
| 1 | economy.js 交易无事务 | ✅ 已修复 | `BEGIN/COMMIT/ROLLBACK` 正确包裹 INSERT + UPDATE |
| 2 | saves.js loadSave 无事务 | ✅ 已修复 | `BEGIN/COMMIT/ROLLBACK` 正确包裹 DELETE + INSERT |
| 3 | branches.js 无事务 | ✅ 已修复 | 整个分支操作包裹在事务中，含 ROLLBACK |
| 4 | characters.js replaceRegexRules 无事务 | ✅ 已修复 | `BEGIN/COMMIT/ROLLBACK` 正确包裹 DELETE + INSERT |
| 5 | applyRegexRules js_script 无超时 | ✅ 已修复 | 添加 100ms deadline 守卫 + console.warn |
| 6 | 错误处理统一返回 400 | ✅ 已修复 | 区分 SQLITE/database/disk 错误返回 500 |
| 7 | 世界书消息计数器非持久化 | ✅ 已修复 | `getNextMessageCount` 添加 lazy-init，从 `world_book_entry_state` 恢复 |
| 8 | SQLite 同步 API 阻塞 | ℹ️ 保留 | 设计选择，当前场景可接受 |
| 9 | SSE 流未处理取消错误 | ✅ 已修复 | 添加 TypeError/cancel/closed/network 错误识别 |
| 10 | localStorage 无异常处理 | ✅ 已修复 | `readLocalBoolean` 已包裹 try-catch |
| 11 | ensureStorageDirs 无错误处理 | ✅ 已修复 | 分别包裹 try-catch，抛出有意义的错误信息 |
| 12 | customJs 执行风险 | ℹ️ 保留 | 设计功能，仅影响用户自己浏览器 |
| 13 | parseExtraBody JSON.parse 无保护 | ✅ 已修复 | try-catch 包裹，失败返回空对象 |
| 14-19 | 低风险体验/架构问题 | ℹ️ 保留 | 设计选择或后续优化 |

---

## ⚠️ 第一轮修复隐患

### R2-1. 🟡 替换规则事务与外层调用者无嵌套保护

**位置：** `backend/src/modules/characters.js` → `replaceRegexRules()` 及其调用者 `createCharacter()`/`updateCharacter()`

**问题：** `replaceRegexRules` 内部使用 `database.exec('BEGIN')`，而 `createCharacter`/`updateCharacter` 未使用事务。如果未来有调用者在外层已经开启了事务，再调用 `replaceRegexRules` 会触发嵌套 `BEGIN`，导致 SQLite 抛出 `cannot start a transaction within a transaction` 错误。

**当前风险：** 🟡 低 — 当前代码路径无嵌套，但属于潜在维护隐患。

**建议：** 在 `replaceRegexRules` 开头检查是否已在事务中（可通过 `_tableColumnCache` 模式或简单标志位），或改为使用 `SAVEPOINT`/`RELEASE SAVEPOINT` 语法以支持安全嵌套。

---

## 🟡 新发现中风险问题

### R2-2. 🟡 processTransactionIntents 余额检查存在 TOCTOU 竞态

**位置：** `backend/src/modules/economy.js` → `processTransactionIntents()`

**问题：** 余额检查在事务之外执行：

```js
if (intent.amount < 0) {
  const existingAccount = database
    .prepare('SELECT balance FROM economy_accounts WHERE conversation_id = ? AND currency_type = ?')
    .get(conversationId, intent.currencyType);
  const available = existingAccount?.balance ?? (DEFAULT_INITIAL_BALANCE[intent.currencyType] ?? 0);
  if (available + intent.amount < 0) {
    continue; // 跳过
  }
}
// 此时余额可能已被其他操作改变
const result = createConversationTransaction(...);
```

在检查和实际执行之间，另一个并发请求可能已经修改了余额。虽然 `createTransaction` 内部有 `account.balance + signedAmount < 0` 二次检查，但外层 `catch` 静默吞掉了错误，导致行为不一致。

**风险等级：** 🟡 中 — 当前为单用户场景影响小，但多用户扩展时会出现问题。

**建议：** 移除外层冗余的余额检查，依赖 `createTransaction` 内部的事务保护。或在外层 catch 中添加日志记录。

---

### R2-3. 🟡 extractVariablesFromText 正则注入风险

**位置：** `backend/src/modules/statusBars.js` → `extractVariablesFromText()`

**问题：** 变量名通过 `escapeRegex()` 转义后用于构建正则表达式。虽然 `escapeRegex` 正确转义了特殊字符，但如果变量名极长（Zod 限制 40 字符），生成的正则模式可能在大文本上产生显著的回溯开销。

```js
const patterns = [
  new RegExp(`【${varName}】\\s*(\\d+(?:\\.\\d+)?)...`, 'i'),
  // ...4 个模式
];
```

每个变量生成 4 个正则模式，20 个变量最多 80 个正则，在 32000 字符的消息上执行。

**风险等级：** 🟡 中 — 极端场景可能导致消息处理延迟数百毫秒。非阻塞但影响响应时间。

**建议：** 考虑对变量名长度添加更严格的限制（如 20 字符），或在匹配前先用 `indexOf` 做快速预筛选，仅对包含变量名的文本执行正则。

---

## 🟢 新发现低风险问题

### R2-4. 🟢 writeLocalBoolean 缺少 try-catch

**位置：** `frontend/src/composables/chat/useChatSubmit.js` → `writeLocalBoolean()`

**问题：** `readLocalBoolean` 已添加 try-catch，但对应的 `writeLocalBoolean` 没有。在 localStorage 配额已满或隐私模式下，`setItem` 可能抛出异常。

```js
function writeLocalBoolean(key, value) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, String(Boolean(value))); // 无 try-catch
}
```

**风险等级：** 🟢 低 — 仅影响用户偏好保存，不影响核心功能。

**建议：** 添加 try-catch 包裹，与 `readLocalBoolean` 保持一致。

---

### R2-5. 🟢 对话设置保存缺少多字段事务

**位置：** `backend/src/routes/conversations.js` → 对话设置保存路由（调用 `saveConversationSettings`）

**问题：** 对话设置保存涉及多个字段的 UPDATE（background URL、CSS、JS、lorebook ID 等），如果中途失败可能只保存部分字段。当前使用单条 UPDATE 语句，风险较低，但如果未来拆分为多条语句则需要事务保护。

**风险等级：** 🟢 低 — 当前单条 UPDATE，影响极小。

---

### R2-6. 🟢 数据库无优雅关闭钩子

**位置：** `backend/src/db.js` + `backend/src/server.js`

**问题：** 进程退出时没有显式关闭数据库连接（`database.close()`）。虽然 `node:sqlite` 的 `DatabaseSync` 会在进程退出时自动清理，且 WAL 模式保证了数据一致性，但缺少 `process.on('SIGINT')` / `process.on('SIGTERM')` 处理。

**风险等级：** 🟢 低 — WAL 模式保证一致性，但显式关闭是最佳实践。

**建议：** 在 `server.js` 添加 shutdown 钩子，在 SIGINT/SIGTERM 时执行 WAL checkpoint 并关闭数据库。

---

### R2-7. 🟢 安全模块 CSRF 实现仍然存在两份

**位置：** `backend/src/security.js` vs `backend/src/services/csrf.js`

**问题：** 第一轮报告 #16 指出两份 CSRF 实现。当前 `server.js` 使用的是 `services/csrf.js`（通过 cookie-parser），但 `security.js` 中仍保留了另一套实现（使用手动 `parseCookies`）。虽然不导致运行时错误，但增加了维护成本和混淆风险。

**风险等级：** 🟢 低 — 不影响运行，但降低代码可维护性。

**建议：** 移除 `security.js` 中的 CSRF 相关导出，统一到 `services/csrf.js`。

---

## ✅ 做得好的地方（相比第一轮的改进）

1. **事务保护覆盖全面** — 经济系统、存档加载、分支创建、正则规则替换均包裹在 `BEGIN/COMMIT/ROLLBACK` 中
2. **错误状态码区分** — 全局错误处理器正确区分 400/500 状态码
3. **脚本执行超时守卫** — `applyRegexRules` 中的 `new Function()` 有 100ms budget 监控
4. **SSE 流错误分类** — 正确识别 AbortError、TypeError、cancel/closed/network 等错误类型
5. **前端 localStorage 读取保护** — `readLocalBoolean` 包裹 try-catch
6. **目录创建错误处理** — `ensureStorageDirs` 分别捕获异常并抛出有意义的错误
7. **世界书消息计数持久化** — 从数据库恢复计数器，避免重启后状态丢失
8. **ChatView 清理完善** — `onBeforeUnmount` 正确清理所有事件监听器、定时器和 composable

---

## 📋 修复优先级建议

| 优先级 | 问题编号 | 简述 |
|--------|---------|------|
| P2 (下周) | R2-2, R2-3 | 经济系统竞态检查优化、正则匹配性能优化 |
| P3 (后续) | R2-1, R2-4, R2-5, R2-6, R2-7 | 事务嵌套安全、写入容错、优雅关闭、代码去重 |

---

## 📈 健壮性提升评估

| 维度 | 第一轮后 | 第二轮后 | 变化 |
|------|---------|---------|------|
| 数据库事务保护 | 0/4 关键操作 | 4/4 关键操作 | ✅ +100% |
| 错误处理（try-catch） | 部分覆盖 | 高覆盖 | ✅ 提升 |
| 空值/undefined 处理 | 良好 | 良好 | ➡️ 维持 |
| 异步 Promise 处理 | asyncRoute 包装 | asyncRoute 包装 | ➡️ 维持 |
| 前端输入容错 | 基础 | 增强 | ✅ 提升 |
| 竞态/并发保护 | 无 | 基础 | ✅ 提升 |

**结论：** 项目健壮性从第一轮的「可接受」提升到「良好」水平。剩余问题均为低-中风险的优化项，不影响正常使用。

---

*报告完毕。如烟~*
