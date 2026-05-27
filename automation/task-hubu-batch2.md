## 批次2 户部任务：数据加固

**项目位置：** D:\Cat\FLAI-TavernAI
**禁止修改：** .env、backend/data、node_modules、governance.md

### 1. SQLite WAL 模式
- 启用 WAL 模式：PRAGMA journal_mode=WAL
- 设置 busy_timeout=5000
- 在数据库连接初始化时执行
- 确保所有数据库连接都应用这些 PRAGMA

### 2. 数据备份机制
- 实现每日自动备份脚本
- 备份文件保留 7 天，自动清理过期备份
- 添加手动备份 API 端点（如 POST /api/admin/backup）
- 备份文件命名含时间戳
- 备份存储位置：D:\Cat\FLAI-TavernAI\backups\

### 3. API Key 加密升级
- 将 API Key 加密从 AES-256-CBC 升级到 AES-256-GCM
- GCM 模式提供认证加密（AEAD），同时保证机密性和完整性
- 确保向后兼容：能解密旧的 CBC 加密数据
- 新加密统一使用 GCM

### 验证要求
- npm test 必须通过
- npm run build 必须通过
- 写报告到 D:\Cat\FLAI-TavernAI\automation\reports\batch2-hubu-data.md

### ⚠️ 禁止
- 不动 .env
- 不动 backend/data（数据库运行时文件除外，但不删除已有数据）
- 不动 node_modules（通过 npm install 自然修改除外）
- 不动 governance.md
