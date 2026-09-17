# FLAI TavernAI 升级计划（2026-09）

> 2026-09-05：会话可靠性第一批进入实施，覆盖完整快照、历史版本与持久后台处理。
> 当前范围与验收清单见 `docs/conversation-reliability-batch-1.md`；以下旧基线数字不代表当前工作树。

> 基于 2026-09-02 分支 `MrYu/code-review-2026-09-02`（提交 `ad82630`）的实际状态制定。
> 状态规则沿用 `docs/NPC_REFACTOR_TASKS.md`：实现、清理、验证全部完成后才能勾选。

## 一、现状盘点

### 已经稳固的部分

- 安全审查 `docs/CODE_REVIEW_2026-09-02.md` 的 F-01～F-16 全部完成，仅 F-17（超大模块拆分）部分完成。
- 后端 Express 5 + Node 24 `node:sqlite`，10 个版本化迁移（最新 `0010 talent-pool-ownership`），DB 级持久任务队列（`services/jobs/`），SSE 流式，统一 Provider 配额门面。
- 后端 `node:test` 全量 1334/1334 通过（144 个测试文件）；Playwright E2E 16/16；生产依赖审计 0 漏洞。
- 本地 review gate（`scripts/review-gate.ps1`）与 GitHub Actions `ci.yml` 已覆盖编码、后端测试、前端审计/构建、E2E。
- 源码中 TODO/FIXME 为 0，由 `source-hygiene.test.js` 强制。

### 需要升级的部分

| 维度 | 现状 | 问题 |
| --- | --- | --- |
| 发布流程 | PR #5 因 GitHub 账号 billing lock 未跑 CI；两个包版本均为 `0.1.0`，无 CHANGELOG、无 tag | 没有可追溯的发布基线 |
| 依赖 | 待升级主版本：`vue-router 4.6→5.3`、`markdown-it 14→15`、`katex 0.16→0.18`、`jsdom 29→30`、`@lucide/vue 1.16→1.39`；小版本：`zod`、`vue`、`playwright`、`highlight.js` 等 | 主版本积压会越拖越难升 |
| 模块体量 | `WorldBookView.vue` 2340 行、`StatusBar.vue` 1924、`HomeView.vue` 1867、`ChatView.vue` 1741、`useChatSubmit.js` 1672、`castCommandService.js` 1508、`ChatContextInspector.vue` 1293；`backend.test.js` 10889 行 | 每次安全修复回归半径过大（F-17） |
| 前端测试 | 无 Vitest；前端逻辑由 `backend/src/tests/frontend*.test.js` 以契约方式在后端测试套件里跑；组件层无单测 | 前后端测试耦合，组件重构无保护 |
| 类型 | 0 个 TypeScript 文件，无 `checkJs` | 跨层数据契约只靠 Zod 与测试 |
| 可观测性 | 已有未鉴权 `/health/live`、`/health/ready`（`/api/health`），无 `/metrics`；诊断均在 root 管理接口下；日志为 36 行手写 JSON logger | 无成本/延迟时序数据 |
| 打包 | `packaging/windows/package.json` 中 `electron`、`electron-builder` 均为 `latest`；CI 无 Windows 打包 smoke | 打包结果不可复现 |
| 自定义 JS | 非拥有者已禁用，但拥有者路径仍用 `AsyncFunction` 在页面 origin 执行（`chatAppearance.js:198-230`） | F-01 建议 3（sandbox iframe + CSP）未做 |
| Town 模拟 | `docs/town-simulation-plan.md` 第 1～6 步完成；Tier A+ 批量 AI 回合未做；前端删除小镇/居民 UI 未接（后端端点已就绪） | 体验缺口 |
| Provider 能力 | 10 种 Provider，有生图；无 embeddings、无 TTS | 记忆检索只有 FTS + 打分，无语义检索 |
| 数据 | `backend/data` 264 MB（主库 41 MB + 备份）；有备份完整性校验，无自动恢复演练与保留策略 | 备份可用性未定期证明 |

## 二、升级目标

1. 建立可追溯的发布基线（v0.2.0），让后续每个阶段都能独立发版。
2. 清空依赖主版本积压，并让依赖更新常态化（自动 PR + gate）。
3. 完成 F-17：所有非测试源码文件 ≤ 800 行，`backend.test.js` 按领域拆分。
4. 前端拥有独立单测能力，组件重构有保护。
5. 部署与打包可观测、可复现。
6. 在上述工程升级之上，补齐 Town 与自定义 JS 两处已识别的产品/安全缺口。

每个阶段的通用验收：`cd backend && npm test`、`cd frontend && npm run build`、`node scripts/check-encoding.mjs`、review gate PASS。

## 三、阶段计划

### 阶段 0：收口与基线（0.5 天）

- [ ] 恢复 GitHub 账单后重跑 PR #5 CI；CI 通过后合并到 `main`，再合并阶段 0 分支并打 tag `v0.2.0`（需要外部账单恢复，无法本地完成）。
- [x] 新增 `CHANGELOG.md`（从 `26895fb` 模块化重构起摘要），三处 `package.json` 版本统一为 `0.2.0`；`config.js` 改为读取 `backend/package.json`，并由 `validation-scripts.test.js` 保证版本一致。
- [x] 两个 `package.json` 增加 `"engines": { "node": ">=24" }`，仓库根增加 `.nvmrc`（`24`）。
- [x] CI 与 review gate 增加后端 `npm audit --omit=dev --audit-level=moderate`。
- [x] 顺带修复：`providerUrlPolicyOptions` 二次归一化导致 `.test` 保留域名例外失效，Provider 契约测试在没有本地 DNS 代理的机器/CI 上会失败（65 项）。

验收：`main` 上 CI 绿；`git describe` 能得到 `v0.2.0`。

### 阶段 1：依赖升级（2～3 天，每项独立 PR）

按风险从低到高，每个 PR 跑完整 gate；出现行为差异时补回归测试再合并。

| 顺序 | 包 | 从 → 到 | 风险点 / 验证重点 |
| --- | --- | --- | --- |
| 1 | `express-rate-limit`、`zod`、`@tanstack/vue-virtual`、`highlight.js`、`vue 3.5.x`、`@playwright/test`、`@axe-core/playwright` | 小版本 | 一次性合并；Zod 4.5 注意 `z.record`/错误信息格式变化对 `apiContracts.js` 契约测试的影响 |
| 2 | `jsdom` | 29 → 30 | 后端 DOMPurify 服务端净化路径；跑 `frontendMarkdown*`/附件协议测试 |
| 3 | `katex` | 0.16 → 0.18 | 提交 `e7188c9` 处理过的转义 colorbox 场景必须有回归用例；对比渲染快照 |
| 4 | `markdown-it` | 14 → 15 | 确认 `@vscode/markdown-it-katex` 兼容；`linkify` 行为；`MarkdownContent.vue` |
| 5 | `@lucide/vue` | 1.16 → 1.39 | 图标重命名/移除；用 `find-unreferenced-vue-components.mjs` 思路写一个图标名校验脚本 |
| 6 | `vue-router` | 4 → 5 | 变更最大：路由守卫、`RouterView` 插槽、`history` API；11 个 view 全部走一遍 E2E |
| 7 | `packaging/windows`：`electron`、`electron-builder` | `latest` → 固定版本 | 固定后跑 `scripts/smoke-windows-package.ps1` |

- [x] 增加 `.github/dependabot.yml`：backend/frontend/packaging 三个目录，小版本分组周更，主版本单独 PR。

验收：`npm outdated` 在三个目录均为空（或仅剩有意保留的项并记录原因）；audit 0 漏洞。

### 阶段 2：测试基础设施（3～4 天）

- [x] 前端引入 Vitest 4 + `@vue/test-utils`（`frontend/package.json` 增加 `test:unit`，`vitest.config.js` 使用 jsdom 环境），CI `verify` job 与 review gate 第 7 步执行；首批用例覆盖 markdown 渲染管线与 lucide 图标名存在性。
- [ ] 将 `backend/src/tests/frontend*.test.js`（约 9 个文件、1.1 万行）迁移到 `frontend/src/**/__tests__`，保持断言不变；迁移完成后从 `run-tests.mjs` 的 contracts 集合移除。
- [ ] 拆分 `backend.test.js`（10889 行）为按路由领域的文件（auth、characters、conversations、worldBooks、towns、talents、admin、providers、backup……），每个 ≤ 1500 行；`node --test` 自动并行。
- [ ] review gate 第 2/3 步（未引用组件、控件可访问性）在基线清零后改为阻塞。
- [x] Playwright：`trace: 'retain-on-failure'` 已存在；CI 拆出独立 `e2e` job，按 `--shard=N/2` 分片，失败产物按分片命名上传。

验收：前端 `npm run test:unit` 独立可跑；后端测试数量不减（≥ 1334）；gate 9 步全部阻塞。

### 阶段 3：F-17 模块拆分（5～7 天，逐文件 PR）

目标：非测试源码单文件 ≤ 800 行；新增 `source-hygiene` 断言防止回涨（先以当前清单为白名单，逐个移出）。

| 文件 | 行数 | 拆分方向 |
| --- | ---: | --- |
| `frontend/src/views/WorldBookView.vue` | 2340 | 列表/条目编辑器/助手面板/导入导出四个子组件 + `useWorldBookEditor` 组合式函数 |
| `frontend/src/components/StatusBar.vue` | 1924 | 按状态模板 token（`shared/statusTemplateTokens.js`）拆为渲染器 + 编辑器 |
| `frontend/src/views/HomeView.vue` | 1867 | 角色网格、筛选栏、批量操作各自成组件 |
| `frontend/src/views/ChatView.vue` | 1741 | 抽出布局壳，业务下沉到已有 `composables/chat/*` |
| `frontend/src/composables/chat/useChatSubmit.js` | 1672 | 按“附件处理 / 请求构造 / 流式消费 / 错误恢复”拆为 4 个组合式函数 |
| `backend/src/services/cast/castCommandService.js` | 1508 | 按命令类型拆 handler，保留单一领域服务入口（符合 NPC 重构“同一领域服务”约束） |
| `frontend/src/components/chat/ChatContextInspector.vue` | 1293 | 每个上下文段落一个子组件 |
| `frontend/src/composables/chat/useChatAccessory.js`、`useChatMessageActions.js` | 1115 / 1011 | 按技能类别与消息操作类别拆分 |

规则：先有阶段 2 的单测覆盖再拆；每个 PR 只拆一个文件；不引入并行实现。

验收：`find` 统计无 > 800 行的非测试源码；E2E 与单测全部通过。

### 阶段 4：可观测性与运维（2～3 天）

- [x] 未鉴权探活已存在：`/health/live` 与 `/health/ready`（别名 `/api/health`，`services/runtimeHealth.js`），Windows 打包 smoke 已用它探活；盘点时误判为缺失，无需新增。
- [ ] 新增 root 管理接口 `GET /api/admin/metrics`（Prometheus 文本格式）：HTTP 时延分布、Provider 调用次数/失败/时延/成本微元、任务队列积压与租约恢复次数、SQLite WAL 大小。
- [ ] 日志：每条记录携带 request ID（已有 F-11 基础），增加日志轮转说明；保留手写 logger，不引入新依赖。
- [ ] 备份：新增 `scripts/backup-restore-drill.mjs`，用最新备份恢复到临时库并跑迁移校验；备份保留策略（按数量/天数）进入 `config.js`。
- [ ] 数据库维护：启动时 `PRAGMA optimize`，定时 `wal_checkpoint(TRUNCATE)`。

验收：`/api/health` 在打包版启动 5 秒内返回 200；恢复演练脚本进入 review gate 的可选步骤并有测试。

### 阶段 5：类型安全渐进引入（并行于阶段 3，不单独排期）

- [ ] 在 `shared/`、`backend/src/domain/`、`backend/src/validations/` 开启 `// @ts-check` + JSDoc，配 `jsconfig.json` 与 `tsc --noEmit` 检查步骤（无运行时改动）。
- [ ] 前端新建的组合式函数允许 `.ts`（Vite 已支持），旧文件不强制迁移。
- [ ] 从 Zod schema 用 `z.infer` 导出类型给前端 API 层（`frontend/src/api/*`）。

验收：`tsc --noEmit` 在上述目录 0 错误并进入 CI。

### 阶段 6：产品与安全缺口（各自独立，按需排期）

**6.1 自定义 JS 沙箱（F-01 建议 3，安全纵深）**

- [ ] 将 `chatAppearance.js` 的 `AsyncFunction` 执行迁入 `sandbox` iframe（`allow-scripts`，不含 `allow-same-origin`），严格 CSP，仅通过 `postMessage` 暴露白名单 API（读消息、改样式）。
- [ ] 保留 per-user 授权开关；新增 E2E：脚本无法访问 `document.cookie`、`fetch` 到应用 origin 与 `localStorage`。

**6.2 Town 模拟收尾（`docs/town-simulation-plan.md` 第七/八节遗留）**

- [ ] 前端接入删除小镇/居民的二次确认 UI（后端 `DELETE` 端点已就绪）。
- [ ] Tier A+ 批量 AI 回合：先定契约（一次模型调用产出 N 个 tick 的计划，N ≤ 24，复用 `expectedTick` 乐观并发与配额门面），再改 `townTurnAssistant.js`。**已决定不纳入本轮，见第六节。**
- [ ] 追赶截断时写入可见的 `town_events` 记录（第四节 4.1）。

**6.3 语义检索（可选增强）**

- [ ] `shared/providerCapabilities.js` 增加 `embeddings` 能力位；后端 `providerEmbeddings.js` 门面同样走配额。
- [ ] 为 `town_memories`、世界书条目、NPC 记忆增加向量列（SQLite BLOB + 余弦，或 `sqlite-vec`），检索改为 FTS 召回 + 向量重排。**已决定不纳入本轮，见第六节。**

### 阶段 7：发布工程（1 天，收尾）

- [x] CI 增加 `windows-latest` job：`scripts/package-windows.ps1 -NoPackage` 阶段化 + `smoke-windows-package.ps1`。
- [ ] 版本号策略：`backend`/`frontend`/`packaging/windows` 三处同步，由 `scripts/prepare-commit.ps1` 校验一致。
- [ ] 每阶段结束更新 `CHANGELOG.md` 并打 tag（`v0.3.0` 依赖升级、`v0.4.0` 测试/拆分、`v0.5.0` 可观测性……）。

## 四、执行顺序与依赖关系

```
阶段0 ─→ 阶段1 ─→ 阶段2 ─→ 阶段3 ─→ 阶段7
                     │         ↑
                     └→ 阶段4  │
                     └→ 阶段5 ─┘（与阶段3并行）
阶段6 各子项独立，可在阶段2之后任意时点插入
```

- 阶段 1 必须在阶段 3 之前：先在小文件面上把 `vue-router 5` 等主版本升完，避免拆分与升级混在同一 diff。
- 阶段 2 必须在阶段 3 之前：没有前端单测就拆大组件等于盲拆。
- 阶段 6.1 是安全项，建议不晚于阶段 4 完成。

粗略总量：约 15～20 个工作日，可拆成 30～40 个小 PR，每个 PR 满足 AGENTS.md “一次能看完”的要求。

## 五、明确不做的事

- 不引入 Pinia/Vuex：当前 `provide/inject` + 组合式函数够用，阶段 3 拆分后再评估是否有跨视图状态膨胀。
- 不做 TypeScript 大迁移：只做阶段 5 的渐进式 `@ts-check`。
- 不更换 `node:sqlite`、不引入 ORM：迁移账本与备份体系已围绕它建立。
- 不加 WebSocket：SSE 满足当前流式与任务事件需求。
- 不做 i18n 抽取：UI 目前面向中文用户；若后续要英文界面，单独立项。

## 六、已定决策（2026-09-02，用户委托后确定）

1. **Tier A+ 批量 AI 回合（6.2）不纳入本轮。** 它是产品特性，需要先定"一次调用产出 N 个 tick"的模型契约；本轮目标是工程升级，待阶段 7 结束后单独立项。6.2 中的删除 UI 与追赶截断事件仍纳入。
2. **embeddings 语义检索（6.3）不纳入本轮。** 会引入新的 Provider 成本与第二套检索路径，而现有 FTS + 打分没有已知缺陷；等有明确检索质量问题再评估。
3. **`vue-router 5` 本轮尝试，排在阶段 1 最后。** 先按迁移指南做定量评估；若预计超过 1 天，延后到下一轮，不阻塞其他依赖升级。
4. **`frontend*.test.js` 迁到 Vitest 后不保留后端副本。** 避免双份维护；后端 `contracts` 集合只保留真正跨层的契约测试（`apiContracts`、`source-hygiene` 等）。

## 七、进度记录

- 2026-09-02：完成现状盘点并建立本计划。
- 2026-09-02：四项待决策已确定（见第六节），开始执行阶段 0。
- 2026-09-02：阶段 0 本地项完成于分支 `MrYu/upgrade-phase-0`；review gate PASS（后端 1339/1339、前后端审计 0 漏洞、构建通过、E2E 16/16）。合并与打 tag 等待 CI 账单恢复。
- 2026-09-03：阶段 1 完成。`markdown-it` 15（23 例渲染语料与 14.3.1 逐字节一致，渲染管线抽出为 `utils/markdownRenderer.js`）、`@lucide/vue` 1.39（117 个图标名全部存在）、`vue-router` 5（E2E 16/16）、Electron 44.1.1 / electron-builder 26.15.3（`npm ci` 校验通过）、Dependabot、Windows 打包 CI job。
- 2026-09-03：阶段 2 第 1、5 项完成：Vitest 4 + jsdom 30 + @vue/test-utils 2.5 落地，`npm run test:unit` 8 例通过；CI 拆为 `verify` / `e2e`（2 分片）/ `windows-package` 三个 job；review gate 扩为 9 步。
- 2026-09-03：发现一个并行运行的 Codex 代理在同一工作树上改动共享文件；经用户确认由本会话接管，其改动逐项审查后按阶段拆分提交。
