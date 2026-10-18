# FLAI TavernAI

基于 Vue、Vite、Express 和 Node.js 24 `node:sqlite` 的网页应用，提供角色卡、聊天、世界书、会话记忆和会话游戏系统。

## 启动与验证

需要 Node.js 24 或更新版本。分别在 `backend` 和 `frontend` 执行 `npm ci` 安装依赖，再各开一个终端启动：

```powershell
npm --prefix backend run dev
npm --prefix frontend run dev
```

前端默认端口为 5173，后端默认端口为 3001。Windows 局域网启动入口为 `start-lan.bat`；它调用 `scripts/start-dev.ps1`，会重启开发进程并在端口占用时选择可用端口。生产环境配置和私网 Provider 要求见 [AI 运行时](docs/ai-runtime.md#连接与故障排查)。

修改完成后统一执行相关验证：

```powershell
npm --prefix backend test
npm --prefix frontend run test:unit
npm --prefix frontend run build
npm --prefix frontend run test:e2e
node scripts/check-encoding.mjs
```

完整审核入口为 `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`。历史测试结果与当前未清零问题见 [维护记录](docs/maintenance.md#历史验证记录)，旧报告中的通过数字不代表当前工作区状态。

## 文档入口

| 文档 | 内容 |
| --- | --- |
| [Agent 规则](AGENTS.md) | 仓库安全边界、编码和验证要求 |
| [架构与所有权](docs/architecture.md) | 功能调用链、唯一写入口、分层规则和遗留账本 |
| [对话运行时](docs/conversation.md) | 聊天页面、时间线、快照、后台处理、上下文预算和记忆工具 |
| [AI 运行时](docs/ai-runtime.md) | Provider、工具校验、世界书助手工作区与故障排查 |
| [维护记录与后续计划](docs/maintenance.md) | 历史安全修复、工程待办、测试隔离、NPC 移除和验证结果 |
| [变更日志](CHANGELOG.md) | 面向用户和部署者的可见变更 |

## 文档维护约定

- 每个主题维护一份正式文档，更新功能时修改对应章节；不为每次任务新增计划、总结和最终报告。
- 面向用户的变化写入 `CHANGELOG.md`；实现约定写入主题文档；未完成事项和带日期的历史验证集中到 `docs/maintenance.md`。
- 验证结果注明日期、范围和失败项；临时日志、截图和测试计数不当作永久契约。已清理的检查缓存无需恢复。
- 合并或删除文档后更新本页及所有仓库内引用，保留有效约束、未完成事项和素材授权声明。`AGENTS.md` 继续单独维护。
