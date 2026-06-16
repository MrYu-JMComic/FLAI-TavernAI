# 开发工作规范 (CONTRIBUTING)

> **先读这一篇。** 无论你是人类开发者还是 AI Agent，开始改动 FLAI-TavernAI 之前都应先通读本规范。
>
> 本文是工作规范的**统一入口**：把「环境与命令、代码与结构、Git 与提交、测试与治理」四块的关键规则汇集在一处，每块给出可直接照做的要点，并链接到对应的详细文档。**详细标准以被链接文档为准，本文负责把它们串起来并提供一份统一的提交前检查清单。**

## 阅读顺序

1. 本文（`CONTRIBUTING.md`）—— 总览与检查清单
2. `ENVIRONMENT.md` —— 执行任何 shell 命令前必读（Windows/PowerShell 约束）
3. `AGENTS.md` —— AI Agent 自治迭代规则与安全边界
4. `governance.md` + `governance-permissions.md` —— 三省六部分权与写入权限矩阵
5. 按需查阅 `docs/` 下的专题文档（见下表）

## 文档地图

| 主题 | 权威文档 |
|------|----------|
| 运行环境、命令语法 | `ENVIRONMENT.md` |
| 代码风格、命名、提交消息、依赖 | `docs/development-standards.md` |
| 仓库目录结构与文件职责 | `docs/project-structure.md` |
| 三省六部协作与 PR 流程 | `docs/ai-dev-workflow.md` |
| 权限等级与写入矩阵 | `governance-permissions.md` |
| API 端点 | `docs/api-reference.md` |
| 生产启动 / 备份 / 恢复 | `docs/production-runbook.md` |
| 性能优化基线 | `docs/performance-best-practices.md` |
| Markdown 存放规则 | `docs/markdown-organization.md` |

---

## 一、环境与命令

> 完整对照表见 `ENVIRONMENT.md`，执行命令前**务必**先读那一篇。

- **操作系统 / Shell**：Windows 10，PowerShell 5.x —— **不是 bash**。
- **链式执行**：用 `;` 或分行，**不要用 `&&` / `||`**（PowerShell 不支持）。
- **Python**：只有 `py.exe` 可用，命令写 `py script.py`，**不要写 `python` / `python3`**。
- **Node.js**：v24（后端依赖内置实验模块 `node:sqlite`，低版本无法运行）。
- **路径**：用反斜杠 `\`，绝对路径；`~` 不展开，需要 home 用 `$HOME`。
- **常用别名差异**：`cat`→`Get-Content`、`ls`→`Get-ChildItem`、`grep`→`Select-String`、`rm -rf`→`Remove-Item -Recurse -Force`。

启动本地开发（前端 5173 / 后端 3001，端口固定，被占用会直接报错而非静默换端口）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-dev.ps1
```

| 服务 | 地址 |
|------|------|
| 前端 dev | `http://127.0.0.1:5173/#/` |
| 后端健康检查 | `http://127.0.0.1:3001/api/health` |

> 保存真实 API Key 前，先在 `backend/.env` 设置强 `APP_SECRET`（可从 `backend/.env.example` 复制）。

---

## 二、代码与结构

> 命名规范、Vue / 后端代码范式、依赖清单见 `docs/development-standards.md`；完整目录树见 `docs/project-structure.md`。

仓库形态：

| 层 | 目录 | 技术栈 | 验证方式 |
|----|------|--------|----------|
| 前端 | `frontend/` | Vue 3 + Vite | `npm run build` |
| 后端 | `backend/` | Express + Node 24 + `node:sqlite` | `npm test` |
| 工具脚本 | `scripts/` | `.mjs` / `.ps1` | — |
| 自动化产物 | `automation/` | Markdown | — |
| 文档 | `docs/` | Markdown | — |

代码风格要点（细节见 development-standards）：

- 缩进 2 空格，单引号，使用分号，多行结构带尾逗号，建议行宽 ≤ 120。
- 文件编码**强制 UTF-8**，换行 **CRLF**，文件末尾留空行（见 `.editorconfig`）。**禁止** GBK / ANSI / 乱码字符。
- 命名：组件 `PascalCase`、模块/路由文件 `camelCase`、常量 `UPPER_SNAKE_CASE`、数据库表/列 `snake_case`、CSS 类 `kebab-case`、API 路径 `kebab-case`。
- 前端组件用 `<script setup>`（Composition API），`defineProps` / `defineEmits`，重组件用 `defineAsyncComponent` 懒加载。
- 后端用 ES Modules；路由模块导出工厂函数 `export function createXxxRouter(ctx)`；数据库走 `node:sqlite` 的 `DatabaseSync`；异步路由用 `asyncRoute()` 包装。

**改动落点限制（见 `AGENTS.md` 安全规则）**：不要改 `backend/data`、`backend/uploads`、`.env` / `.env.*`、`node_modules`、构建产物（`dist/`）。

> **AI Agent 注意**：源代码（`.js` / `.mjs` / `.vue` / `.css` / `.html`、`vite.config.js`、`package.json`、`scripts/`）的修改必须通过 Claude Code / OpenCode 完成，**不要用内置 edit/write 直接覆盖源码**（见 `docs/ai-dev-workflow.md`）。纯文档 `.md` 可用普通工具创建。

---

## 三、Git 与提交

### 受控暂存：不要 `git add -A`

提交前用受控脚本暂存，避免误提交本地数据、上传文件、`.env`、构建产物、日志和临时文件：

```powershell
# 1) 干跑：检查 UTF-8 编码并展示工作区（含被忽略的本地文件）
.\scripts\prepare-commit.ps1

# 2) 暂存指定的、已审阅的文件（首选）
.\scripts\prepare-commit.ps1 -Stage -Path README.md,scripts\prepare-commit.ps1

# 3) 仅当整个工作区都已审阅时，才暂存全部允许项
.\scripts\prepare-commit.ps1 -Stage -AllAllowed -IncludeUntracked
```

该脚本会拦截 `.env`、`backend/data`、`backend/uploads`、`dist`、日志、依赖目录、生成的 prompt 草稿等敏感/无关路径。**优先用 `-Path` 提交逐个审阅过的文件**，`-AllAllowed` 仅用于完全审阅过的工作区。

### 提交消息格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

- **type**：`feat` / `fix` / `docs` / `style` / `refactor` / `test` / `chore`
- **scope**（示例）：`frontend` / `backend` / `db` / `auth` / `wb`（世界书） / `chat` / `ui`

```
feat(backend): 添加世界书 token 预算管理

根据 context size 与 lorebookContextPercent 计算预算，按 order 升序插入，超出截断。

Closes #42
```

### 仓库卫生

- 被 git 忽略的内容：`node_modules/`、`dist/`、`backend/data/`、`backend/uploads/`、`.env`、`*.sqlite`、`*.log` 等（见 `.gitignore`）。
- 移动已跟踪的 Markdown 用 `git mv` 保留历史；同一次改动里同步更新脚本/文档中的路径引用（见 `docs/markdown-organization.md`）。
- **未经皇上（用户）明确同意**：不删除文件、不重置 Git 状态、不强制 checkout、不 push、不创建外部 PR、不安装/卸载依赖、不改数据库 schema。

---

## 四、测试与治理

### 提交前三步验证

按顺序执行，**全部通过**才能报告完成：

```powershell
# 1) 编码检查（扫描乱码；pretest / prebuild 已自动集成）
node scripts/check-encoding.mjs

# 2) 后端测试（node --test，测试文件在 backend/src/tests/）
cd backend; npm test

# 3) 前端构建
cd frontend; npm run build
```

> `check-encoding.mjs` 跳过 `.git` / `.runtime-check` / `build` / `dist` / `node_modules` / `uploads`，扫描其余 `.js/.vue/.css/.html/.json/.md/.mjs/.cjs/.ps1/.ts/.tsx/.jsx`。

### 门下省审核关卡

合并前由门下省运行审核（自动跑编码检查 + 后端测试 + 前端构建，返回 0=PASS / 1=FAIL）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1
```

### 三省六部分权（要点）

| 角色 | 职责 | 红线 |
|------|------|------|
| 中书省 zhongshu | 规划、写 backlog | 只能规划，不能执行 |
| 门下省 menxia | 审议封驳、质量把关 | 只能审核，可打回 |
| 尚书省 shangshu | 派发协调 | 不自己写代码 |
| 六部 hubu/libu/bingbu/xingbu/gongbu/libu_hr | 执行 | 只改各自职责范围 |

核心制衡：**中书省未立项 → 尚书省不可行动；门下省未审核 → 变更不可合并；同一人不得兼任中书省与门下省。** 各角色对目录的写入权限以 `governance-permissions.md` 的权限矩阵为准；越权时立即停止并上报。

---

## 提交前检查清单（Definition of Done）

- [ ] 改动范围小、可一次审阅；未触碰 `backend/data` / `uploads` / `.env` / `node_modules` / 构建产物。
- [ ] 未保留他人未完成的改动（`git status --short` 无不明文件被覆盖）。
- [ ] 没有任何密钥/敏感信息写入仓库。
- [ ] `node scripts/check-encoding.mjs` 通过（无乱码、UTF-8）。
- [ ] `cd backend; npm test` 全部通过。
- [ ] `cd frontend; npm run build` 成功。
- [ ] 用 `scripts/prepare-commit.ps1` 受控暂存，提交消息符合 `type(scope): subject` 格式。
- [ ] （AI Agent）自治运行已在 `automation/reports/` 写入报告：变更文件、验证证据、下一步建议。

---

*维护：本文是工作规范入口。当 `ENVIRONMENT.md` / `docs/development-standards.md` / `governance-permissions.md` 等被链接文档更新时，请同步本文的对应要点，避免出现不一致。*
