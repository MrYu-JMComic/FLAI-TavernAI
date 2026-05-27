# 户部执行报告 — 批次2：安全与数据加固

> 执行时间：2026-05-25 23:06 GMT+8
> 执行者：户部（subagent hubu-batch2-data）
> 状态：✅ 全部完成

---

## 任务清单

| # | 任务 | 状态 | 说明 |
|---|------|------|------|
| 1 | SQLite WAL 模式 | ✅ 完成 | `PRAGMA journal_mode=WAL` + `busy_timeout=5000` |
| 2 | 数据备份机制 | ✅ 完成 | 每日自动备份 + 手动API + 7天保留 |
| 3 | API Key 加密升级 | ✅ 完成 | SHA-256 → scrypt 密钥派生，v1/v2 向后兼容 |

---

## 详细变更

### 1. SQLite WAL 模式 — `backend/src/db.js`

**变更内容**：在 `createAppDatabase()` 中新增两条 PRAGMA：

```javascript
database.exec('PRAGMA journal_mode = WAL');
database.exec('PRAGMA busy_timeout = 5000');
```

**技术说明**：
- WAL（Write-Ahead Logging）模式允许读写并发，避免写操作阻塞读操作
- `busy_timeout=5000` 在锁冲突时等待 5 秒后重试，而非立即报错
- 对现有数据无迁移需求，SQLite 自动创建 `-wal` 和 `-shm` 文件

### 2. 数据备份机制 — `backend/src/services/backup.js`（新建）

**新建文件**：`backend/src/services/backup.js`

**功能**：
- `createBackup()` — 复制 `flai.sqlite`（含 WAL/SHM 文件）到 `data/backups/` 目录
- `scheduleDailyBackup()` — 启动时执行一次，之后每小时检查是否需要当日备份
- `pruneOldBackups()` — 自动删除超过 7 天的旧备份
- `listBackups()` — 返回备份列表（供管理 API 使用）

**API 端点**（已添加到 `server.js`）：
- `POST /api/admin/backup` — 手动触发备份（需 root_admin 权限）
- `GET /api/admin/backups` — 查看备份列表（需 root_admin 权限）

**备份文件命名**：`flai-YYYY-MM-DD.sqlite`，存储在 `backend/data/backups/`

### 3. API Key 加密升级 — `backend/src/security.js`

**变更内容**：

| 项目 | 旧（v1） | 新（v2） |
|------|----------|----------|
| 密钥派生 | SHA-256（单次哈希） | scrypt（N=16384, r=8, p=1） |
| 加密算法 | AES-256-GCM | AES-256-GCM（不变） |
| 格式前缀 | `v1:` | `v2:` |
| 密钥长度 | 32 字节 | 32 字节 |

**向后兼容**：
- `encryptSecret()` 新加密数据使用 `v2:` 前缀 + scrypt 密钥
- `decryptSecret()` 同时支持 `v1:` 和 `v2:` 格式解密
- 旧的 v1 加密数据无需迁移，可正常解密
- 新加密的数据自动使用 v2 格式

**性能优化**：scrypt 密钥计算结果被缓存，避免重复计算

---

## 验证结果

```
npm test: 123/123 通过 ✅
npm run build (frontend): 构建成功 ✅
```

---

## 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/src/db.js` | 修改 | 添加 WAL + busy_timeout pragma |
| `backend/src/services/backup.js` | 新建 | 备份服务（自动+手动+清理） |
| `backend/src/security.js` | 修改 | scrypt 密钥派生 + v2 格式 |
| `backend/src/server.js` | 修改 | 添加备份 API + 导入 path + 启动调度器 |

---

## 未触碰

- ✅ 未修改 `.env`
- ✅ 未修改 `backend/data/`
- ✅ 未修改 `node_modules/`
- ✅ 未修改 `governance.md`
- ✅ 未修改 `frontend/`

---

*户部 呈 2026-05-25*
