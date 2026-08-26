# FLAI TavernAI Backend Review and Upgrade Plan

审查日期：2026-08-25

实施完成日期：2026-08-25（P0-P3）

## 1. 范围与结论

本次审查和升级以 `backend` 为主；供应商多配置优化同时修改了 `frontend` 设置界面。范围覆盖启动流程、路由、认证与会话、CSRF/CORS、Provider 网络访问、SQLite 架构与迁移、长任务、正则处理、依赖、备份、诊断、测试和文档。

后端已有较好的业务覆盖和回归基础。本计划列出的 P0-P3 已按兼容优先的方式完成，当前结论如下：

1. 已移除正则规则中服务端执行用户 JavaScript 的路径。该路径原本可直接访问 Node.js 进程，属于严重代码执行风险。
2. 已为用户正则增加长度边界和基础 ReDoS 检测。该检测是防御层，不是形式化安全证明，后续仍应考虑隔离执行或受限 DSL。
3. 生产依赖审计已从 4 个漏洞降为 0 个，并移除了未使用的 `csrf` 直接依赖。
4. Provider SSRF、LAN CORS 默认值、会话绑定 CSRF、生产错误脱敏、会话存储和迁移版本化均已完成并有回归测试。
5. 应用工厂、持久化任务、Provider 韧性、FTS5 检索、游标分页、备份恢复、导入控制、管理配额和自动化审计已落地；旧 API 默认响应保持兼容。

## 2. 当前规模与基线

| 项目 | 当前值 |
| --- | ---: |
| 生产 JavaScript 文件 | 194 |
| 生产 JavaScript 行数 | 约 42,572 |
| Express 路由声明 | 239 |
| 审查基线测试 | 1,251 |
| 基线测试 | 1,251 通过，0 失败 |
| 实施后测试 | 1,313 通过，0 失败 |
| 初始生产依赖漏洞 | 2 high、1 moderate、1 low |
| 整理后生产依赖漏洞 | 0 |

主要代码体量集中在：

| 文件 | 约行数 | 风险 |
| --- | ---: | --- |
| `src/services/cast/castCommandService.js` | 1,508 | 已增加命令族 facade 和共享变更服务，旧入口仍是兼容聚合点 |
| `src/modules/worldBooks.js` | 924 | 已抽取 repository、matcher 和 state service，旧 module 保留兼容 facade |
| `src/db/migrations/castDomainV1.js` | 1,175 | 一次性迁移复杂，回归成本高 |
| `src/services/promptPipeline.js` | 813 | 上下文编排逐渐成为中心模块 |
| `src/db/schema.js` | 817 | 旧 schema bootstrap 仍较大，新升级由版本化迁移账本承接 |
| `src/services/accessoryAgents.js` | 774 | 多代理职责集中 |
| `src/modules/townSimulation.js` | 702 | 已抽取 repository、clock、memory 和 simulation service |

## 3. 现有优势

- 所有权隔离测试较充分，角色、会话、世界书、cast、城镇和资产均有跨用户测试。
- SQLite 已启用外键、WAL、锁等待和高价值复合索引。
- 多个写路径使用 SAVEPOINT 或显式事务，并测试了失败回滚。
- Provider 层已拆分请求体、流解析、能力、诊断、工具调用和多个供应商协议。
- 长 AI 请求普遍有 AbortController、超时、SSE 心跳和部分结果处理。
- 诊断导出有密钥、Cookie、Token 和 Data URL 脱敏。
- cast 领域已经形成 domain/repository/service/route 的清晰分层，可作为其他领域的迁移模板。
- 每日 SQLite 在线备份使用 `VACUUM INTO`，保留最近 7 份。

## 4. 审查发现

| ID | 等级 | 状态 | 发现与影响 |
| --- | --- | --- | --- |
| B-01 | Critical | 已修复 | `regex_rules.js_script` 曾通过动态函数在后端执行。任意已登录用户可访问 `process` 和文件系统，影响整个服务进程。现在脚本字段仅为数据兼容保留，后端不会执行。 |
| B-02 | High | 已缓解 | 用户可提交灾难性回溯正则并阻塞 Node 事件循环。现已限制模式为 2,000 字符、处理文本为 200,000 字符，并用 `safe-regex2` 拒绝常见危险模式。该库存在误报和漏报，残余风险需通过 DSL 或隔离执行消除。 |
| B-03 | High | 已修复 | DOMPurify、body-parser、ip-address、undici 的依赖树存在已知漏洞。当前分别升级到 DOMPurify 3.4.14、body-parser 2.3.0、ip-address 10.5.0、undici 7.29.0，`npm audit --omit=dev` 为 0。 |
| B-04 | High | 已修复 | Provider 请求及每次重定向都会重新校验协议、凭据、端口、DNS 结果和目标 IP；私网 Provider 仅在部署配置显式允许且操作者为 root admin 时可保存。 |
| B-05 | High/Medium | 已修复 | 私网 Origin 默认关闭。带凭据 CORS 只信任明确配置的 Origin，并暴露必要的分页、废弃和请求追踪响应头。 |
| B-06 | Medium | 已修复 | CSRF Token 现在由 HMAC 签名并绑定 Session，同时校验状态变更请求的 `Origin` 和 `Sec-Fetch-Site`。 |
| B-07 | Medium | 已修复 | 统一 `AppError` 和错误 envelope；生产响应使用稳定公开消息和请求 ID，详细原因只进入结构化脱敏日志。 |
| B-08 | Medium | 已修复 | 注册、默认 Provider 和 Session 写入已事务化；数据库只保存 Session Token 哈希，并实现登录轮换、过期清理、注册开关和 root 初始化。 |
| B-09 | Medium | 已修复 | 已增加带 checksum 的 `schema_migrations` 账本和 0001-0009 迁移；升级前备份，迁移事务化并校验外键。 |
| B-10 | Medium/Low | 已修复 | `/health/live` 保持轻量，`/health/ready` 使用缓存的数据库和存储检查；详细诊断继续受权限和脱敏约束。 |
| B-11 | Maintenance | 已修复 | `createApp(context)` 无基础设施副作用；`server.js` 只拥有数据库、任务、监听和有序 shutdown 生命周期。 |
| B-12 | Maintenance | 已整理 | 认证请求增加统一 Zod 边界，核心端点使用具体 schema；OpenAPI、废弃遥测和兼容响应已补齐，worldBooks、town 与 cast 已按领域边界拆分。 |
| B-13 | Maintenance | 待处理 | `src/services/backend/src/services/toolSchemaOptimizer.js` 是未引用的误嵌套文件，且与正式实现内容不同。根据仓库规则本轮未删除，后续需明确删除。 |
| B-14 | Maintenance | 待处理 | `backend/docs` 中多份工具优化报告包含已失效文件、行号和模型信息。应保留一份当前运维文档，其余归档或删除。 |

## 5. 实施结果

- P0 安全：完成 Provider URL/重定向 SSRF 策略、私网权限开关、显式 CORS allowlist、会话绑定 HMAC CSRF、稳定错误 envelope、脱敏结构化日志、事务化注册、Session 哈希与轮换。
- P1 平台：完成无副作用 `createApp`、有序 shutdown、0001-0009 迁移账本与升级前备份、Zod 请求边界、OpenAPI、兼容别名废弃遥测，以及 worldBooks、town、cast 的领域拆分。
- P2 可靠性：完成 SQLite 持久化 job queue、租约与崩溃恢复、SSE 事件游标、幂等键、Provider 并发/超时/重试预算/circuit breaker、模型回退和成本记录。
- P2 检索与性能：完成消息、记忆、世界书 FTS5，BM25/时效/重要度排序，上下文来源预算与证据，作用域绑定的不透明游标分页、耗时指标和分层健康检查。
- P3 运维：完成带 SHA-256、schema 版本和完整性结果的备份，root 恢复预检与离线恢复流程，版本化导入 dry-run/冲突策略/配额/审计，以及用户、Session、任务、存储、成本和 Provider 管理 API。
- P3 审计与配额：完成每用户 AI 并发、上传空间、请求速率和日成本限制；世界、经济、任务、城镇和 cast 自动变更复用带来源、计划、版本和 rollback 关系的审计协议。
- 正则安全：`applyRegexRules` 不再执行 `jsScript`；正则测试、保存和导入共用长度限制与 `safe-regex2` 检查。
- 依赖：升级受影响依赖，移除未使用的 `csrf` 包；生产依赖审计为 0 个漏洞。

前端协作注意：`scriptMode` 和 `jsScript` 暂时仍会出现在兼容数据中，但后端不再执行。前端应隐藏或标记脚本模式为已停用，并逐步迁移到普通 replacement 或未来的声明式变换规则。

## 6. 分阶段升级计划

### P0：完成安全边界

目标：后端可以安全地从单机应用扩展到受控 LAN 或多用户部署。

状态：已完成（2026-08-25）。

1. Provider URL 策略
   - 只允许 `http:` 和 `https:`。
   - 每次请求和每次重定向都解析 DNS，并拒绝 loopback、link-local、multicast、unspecified、私网和 IPv4-mapped IPv6。
   - 本地模型网关通过单独配置显式开启，默认仅 root admin 可用。
   - 禁止 URL 中的用户名和密码，限制端口和重定向次数。
2. CORS 与 CSRF
   - 私网 Origin 默认关闭，只信任 `CLIENT_ORIGIN` 明确列表。
   - 对状态变更请求再校验 `Origin`/`Sec-Fetch-Site`。
   - CSRF Token 使用 HMAC 绑定 session，并支持轮换和失效。
3. 错误与日志
   - 引入稳定 `AppError`：`status`、`code`、`publicMessage`、`cause`。
   - 生产响应不返回数据库和 Provider 原始错误。
   - 使用结构化日志并让 `LOG_LEVEL` 真正生效。
4. 认证与会话
   - 注册写入改为一个事务，正确映射唯一键冲突。
   - 数据库只保存 Session Token 哈希；登录后轮换，增加过期清理。
   - 增加 `REGISTRATION_ENABLED` 和 root admin 初始化流程。

验收标准：SSRF 地址矩阵、跨 Origin、CSRF 重放、注册回滚、错误脱敏均有集成测试；`npm audit --omit=dev` 为 0。

### P1：平台基础与后端整理

目标：让后续功能升级不继续堆叠在 `server.js`、`schema.js` 和超大模块上。

状态：已完成（2026-08-25）。

1. 应用生命周期
   - 新建 `createApp(context)`，只构造 Express 应用。
   - `server.js` 只负责配置、数据库、后台任务、listen 和 shutdown。
   - 后台任务返回可停止句柄，shutdown 时先停止接单，再停止任务、checkpoint、关闭数据库。
2. 数据库迁移
   - 增加 `schema_migrations(version, name, checksum, applied_at)`。
   - 每个迁移单文件、幂等、事务化，并在迁移后运行 `foreign_key_check`。
   - 启动前自动备份，失败时报告具体版本且不启动 HTTP 服务。
3. API 契约
   - 所有 body/query/params 使用 Zod；统一分页、ID、布尔值和时间字段。
   - 生成 OpenAPI 文档并固定错误 envelope。
   - 统计兼容别名调用，先标记废弃，再在版本化 API 中移除。
4. 领域拆分
   - 先拆 `worldBooks` 为 repository、matcher、state service。
   - 再拆 `townSimulation` 为 repository、clock、memory、simulation service。
   - `castCommandService` 按 member、memory、behavior、appearance、item 命令拆分，但共享事务和审计组件。
5. 测试结构
   - 后端测试与读取前端源码的契约测试分开执行，保留总 review gate。
   - 增加覆盖率报告、迁移测试模板和 API 契约测试。

验收标准：导入应用不会创建数据库、启动 timer 或监听端口；全量测试通过；每个新迁移可在空库、旧库和重复执行场景通过。

### P2：可靠性与性能升级

目标：长 AI 任务可恢复、可观测，不依赖单次 HTTP 连接存活。

状态：已完成（2026-08-25）。

1. 持久化任务系统
   - 城镇生成、cast 整理、记忆提取、世界书助手进入 SQLite job queue。
   - 支持 queued/running/succeeded/failed/cancelled、进度事件、租约和崩溃恢复。
   - SSE 只订阅任务事件，断线后可用 cursor 恢复。
2. Provider 韧性
   - 增加每 Provider/模型超时、并发、重试预算和 circuit breaker。
   - 支持按任务配置主模型和回退模型，记录实际路由与成本。
   - 重试只用于明确幂等步骤，写入使用 idempotency key。
3. 检索与上下文
   - 使用 SQLite FTS5 为消息、记忆和世界书建立全文索引。
   - 先做 BM25 + recency + importance；语义向量作为可选扩展，不阻塞本地部署。
   - 上下文预览显示每个来源的预算、截断原因和命中证据。
4. 查询性能
   - 大列表统一 cursor pagination，减少高 offset 扫描。
   - 为慢查询和 Provider 调用记录耗时直方图、行数和错误分类。
   - `/health/live` 只做进程检查，`/health/ready` 缓存数据库和存储检查。

验收标准：长任务在客户端断线和进程重启后可恢复；重复提交不会产生重复业务写入；关键列表和上下文构建有性能基准。

### P3：功能能力升级

目标：补齐可运维、可迁移和多用户管理能力。

状态：已完成（2026-08-25）。

1. 备份与恢复
   - 备份增加 SHA-256、schema 版本、大小和完整性检查。
   - 提供 root admin 恢复预检和离线恢复流程，并定期做恢复演练。
2. 导入导出
   - 所有 envelope 有明确 `schemaVersion`、兼容范围和迁移器。
   - 导入提供 dry-run、冲突策略、资源配额和审计报告。
3. 管理与配额
   - 增加用户、Session、任务、存储、Token 成本和 Provider 状态的管理 API。
   - 按用户限制并发 AI 任务、上传空间、请求速率和日成本。
4. 可审计自动化
   - AI 自动变更统一记录来源消息、模型、计划摘要、前后版本和 rollback 关系。
   - 对 cast 之外的世界、经济、任务和城镇变更复用同一审计协议。

## 7. 实际执行顺序

1. 已先完成 P0 的 SSRF、CORS/CSRF、错误脱敏和会话事务。
2. 已实施 `createApp` 与迁移账本，再在该基础上接入后续平台能力。
3. 已以 `worldBooks` 验证非 cast 领域分层，并继续拆分 town 与 cast 命令族。
4. 已建立持久化 job queue，再接入城镇生成、cast 整理、记忆提取和世界书助手。
5. 已完成 FTS5、Provider 回退、恢复流程、管理配额和共享自动化审计。

每一步都应保持现有 API 可运行，并满足以下门禁：

```powershell
Set-Location backend
npm test
npm audit --omit=dev
Set-Location ..
node scripts/check-encoding.mjs
powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1
```

## 8. 明确的暂留项

- 未删除误嵌套的 `src/services/backend/src/services/toolSchemaOptimizer.js`，因为仓库规则要求删除必须有明确授权。
- 未合并或删除旧的工具优化报告；它们需要先确认是否仍有发布或支持价值。
- 未修改任何前端文件。

## 9. 验证记录

2026-08-25 最终实现验证：

- `npm test`：1,313 通过，0 失败，0 跳过。
- `npm run test:coverage`：行覆盖率 85.73%，分支覆盖率 72.89%，函数覆盖率 84.91%。
- `npm audit --omit=dev`：0 个漏洞。
- `node scripts/check-encoding.mjs`：扫描 572 个文件，通过。
- `scripts/review-gate.ps1`：后端测试、生产依赖审计、前端构建和仓库检查全部通过。
