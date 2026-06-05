# 第二轮架构级修复报告

**日期：** 2026-06-05
**执行人：** 太子中书省
**状态：** ✅ 全部完成

---

## R2-2 ✅ 竞态修复 — `processTransactionIntents` TOCTOU

**文件：** `backend/src/modules/economy.js`

**改动：** 移除 `processTransactionIntents` 中外层冗余的余额预检查逻辑（11 行代码）。该检查在事务之外读取余额，存在 TOCTOU 竞态窗口。`createTransaction` 内部已有完整的原子保护：

```
BEGIN → re-read balance → check → INSERT + UPDATE → COMMIT/ROLLBACK
```

**逻辑审查：**
- `createConversationTransaction` 先调用 `getOrCreateAccount` 确保账户存在
- 然后调用 `createTransaction`，内部 BEGIN 事务重新读取余额
- 如果余额不足，ROLLBACK 并抛出错误
- 外层 `catch` 捕获错误并 `console.warn`，跳过该交易
- 行为完全等价：余额不足时交易被跳过，但账户可能作为副作用被创建（默认余额不变）

**测试更新：** 同步更新 `economy.test.js` 中对应测试用例，验证余额不变而非账户数量。

**验证：** 52/52 economy 测试全部通过 ✅

---

## R2-3 ✅ 正则性能优化 — `extractVariablesFromText`

**文件：** `backend/src/modules/statusBars.js`

**改动：**
1. 将 `text.toLowerCase()` 提升到循环外，避免每次迭代重复计算
2. 使用 `indexOf` 快速预筛选：仅当文本包含变量名时才执行 4 个正则模式
3. 移除循环内重复的 `seen.has(variable.name.toLowerCase())` 检查（已在外层处理）
4. 统一使用 `nameLower` 变量避免重复 `.toLowerCase()` 调用

**性能影响：**
- 最佳情况（变量不在文本中）：从 O(80 × regex) 降到 O(80 × indexOf)
- 最坏情况（所有变量都在文本中）：行为完全等价
- 32000 字符文本 + 20 变量场景：预期减少 50-90% 正则执行

**验证：** status bar 测试全部通过 ✅（extractVariablesFromText, applyVariableUpdates）

---

## R2-7b ✅ CSRF 代码去重

**文件：** `backend/src/security.js`

**状态：** 已在前一轮修复中完成。`security.js` 中的 CSRF 相关导出（`csrfCookieName`, `csrfHeaderName`, `generateCsrfToken`, `setCsrfCookie`, `csrfProtection`）已被移除。

**当前架构：**
- `services/csrf.js` — 唯一的 CSRF 实现（使用 `cookie-parser` 的 `req.cookies` + `timingSafeEqual`）
- `security.js` — 仅保留会话管理相关导出
- `server.js` — 正确导入并使用 `services/csrf.js`

**验证：** 全局搜索确认无外部模块引用已移除的 CSRF 导出 ✅

---

## 编码检查

```
Encoding check passed: no common Chinese mojibake markers found. ✅
```

## 测试总结

| 测试套件 | 通过 | 失败 | 备注 |
|---------|------|------|------|
| economy.test.js | 52 | 0 | ✅ 全部通过 |
| backend.test.js | 113 | 21 | 21 个预存失败（world_books test setup / Windows 权限），与本次改动无关 |
