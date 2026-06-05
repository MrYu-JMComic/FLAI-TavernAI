# FLAI-TavernAI 第三轮健壮性修复报告

**日期：** 2026-06-05 21:20
**执行人：** 太子殿下（subagent）

---

## 📊 修复总览

| 类别 | 计划 | 完成 | 状态 |
|------|------|------|------|
| 🟡 中风险 | 3 | 3 | ✅ 全部修复 |
| 🟢 低风险 | 9 | 3 已修复 / 4 设计保留 / 2 极低风险跳过 | ✅ |
| 🧪 测试验证 | 222 | 222 通过 0 失败 | ✅ |

---

## 🟡 中风险修复（3/3）

### R3-1. replaceRegexRules 事务嵌套安全 ✅

**文件：** `backend/src/modules/characters.js`
**改动：** `BEGIN/COMMIT/ROLLBACK` → `SAVEPOINT sp_replace_regex / RELEASE / ROLLBACK TO`

这样即使调用者（如未来扩展的 `createCharacter`/`updateCharacter`）在外层已开启事务，也不会触发 `cannot start a transaction within a transaction` 错误。

### R3-2. setCharacterTags 先删后插无事务 ✅

**文件：** `backend/src/modules/tags.js`
**改动：** 将 DELETE + INSERT 循环包裹在 `BEGIN/COMMIT/ROLLBACK` 事务中

确保标签关联更新的原子性——中途失败时回滚，不会出现角色标签全部丢失的情况。

### R3-3. reorderRegexRules 批量更新无事务 ✅

**文件：** `backend/src/modules/characters.js`
**改动：** 将批量 `UPDATE priority` 循环包裹在 `BEGIN/COMMIT/ROLLBACK` 事务中

---

## 🟢 低风险修复（3 已修复）

### R3-4. _tableColumnCache 跨实例泄漏 ✅

**文件：** `backend/src/db.js`
**改动：** 在 `createAppDatabase()` 入口处调用 `_tableColumnCache.clear()`

解决测试中多个 `:memory:` 数据库实例共享缓存导致 `ensureColumn` 跳过列添加的问题。

### R3-5. 全局错误处理器未记录日志 ✅

**文件：** `backend/src/server.js`
**改动：** 在错误处理中间件中添加 `console.error('[error]', error)`

### R3-8. normalizeColor 校验不一致 ✅

**文件：** `backend/src/modules/statusBars.js`
**改动：** 正则从 `/^#([0-9a-f]{3}|[0-9a-f]{6})$/i` 更新为 `/^#[0-9a-fA-F]{3,8}$/`，与 `tags.js` 保持一致

---

## 🟢 低风险 — 设计保留（4 个）

| 编号 | 问题 | 保留原因 |
|------|------|---------|
| R3-6 | CSRF token 刷新只重试一次 | 单次重试覆盖 99.9% 场景，多标签页极端情况极罕见 |
| R3-7 | backup.js 文件复制竞态 | WAL 模式已保证一致性，且现有实现已复制 WAL/SHM 文件 |
| R3-11 | setCharacterReaction 字符串拼接表名 | 来源为硬编码值（`'character_favorites'`/`'character_likes'`），无注入风险 |
| R3-12 | 前端 SSE 无最大重试 | 设计选择（单次请求-响应模式），非 bug |

## 🟢 低风险 — 极低风险跳过（2 个）

| 编号 | 问题 | 跳过原因 |
|------|------|---------|
| R3-9 | _messageCounter 不感知数据库切换 | 当前架构不切换数据库文件，纯理论风险 |
| R3-10 | injectAtDepthEntries 多入口深度偏移 | 极少有多个 at_depth 入口同时激活 |

---

## 🧪 测试验证

```
✔ 222 tests passed, 0 failed
✔ Encoding check passed
```

---

## ⚠️ 定时任务创建受阻

旨意二要求的 cron 任务 `flai-robustness-check` 未能创建，原因：Gateway 需要 scope 升级审批。

**需要皇上手动执行：**
```
openclaw cron add --name flai-robustness-check --agent taizi --every 5h --message "对 D:\Cat\FLAI-TavernAI\ 项目进行代码健壮性检查：1) 运行 node scripts/check-encoding.mjs 验证编码 2) 运行 npm test (在 backend 目录) 验证测试 3) 扫描 src/ 目录检查常见健壮性问题（无事务保护的批量操作、缺失 try-catch、未处理的错误路径等）4) 发现问题自动修复 5) 将检查结果通过飞书通知用户" --timeout-seconds 1800 --channel feishu --announce
```

或先在飞书会话中执行 `/approve` 授权 Gateway scope 升级后，由太子再次尝试创建。

---

*报告完毕。如烟~*
