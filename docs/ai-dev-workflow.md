# AI 开发与 PR 流程

本文档说明 FLAI-TavernAI 项目中 AI Agent 的协作开发流程。

---

## 三省六部制运作流程

本项目采用"三省六部制"多 Agent 协作体系，模拟古代中国行政架构。

### 架构总览

```
皇上 (用户) → 太子 (分拣) → 中书省 (规划) → 门下省 (审议) → 尚书省 (派发) → 六部 (执行) → 回奏
```

### 三省职责

| 省 | 角色 | 执掌 | 职责 |
|---|---|---|---|
| 中书省 | zhongshu | 📜 规划 | 立项、草拟方案、写 backlog |
| 门下省 | menxia | ⚖️ 审议 | 审核封驳、质量把关、pass/fail 判定 |
| 尚书省 | shangshu | 🏛️ 派发 | 任务派发、协调六部执行 |

### 六部职责

| 部 | 角色 | 专业领域 |
|---|---|---|
| 户部 hubu | 💰 | 数据层、数据库、SQLite |
| 礼部 libu | 🎭 | 前端、UI/UX、Vue 组件 |
| 兵部 bingbu | ⚔️ | 安全、认证、CSRF、加密 |
| 刑部 xingbu | ⚖️ | 测试、纠错、质量验证 |
| 工部 gongbu | 🔨 | 工程、基建、构建流程 |
| 吏部 libu_hr | 👤 | 人事、协调 |

### 核心制衡规则

1. **中书省未立项** → 尚书省不可行动
2. **门下省未审核** → 变更不可合并
3. **任何人不得兼任中书省和门下省**
4. 六部只能执行，不能越权决策
5. 门下省审核命令: `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

---

## AI Agent 如何接任务、执行、审核、合并

### 完整流程

```
1. 皇上下达圣旨（用户发起请求）
   ↓
2. 太子接旨、分拣任务性质
   ↓
3. 中书省草拟方案（zhongshu agent）
   - 分析需求
   - 拆分子任务
   - 写入 automation/backlog.md
   ↓
4. 门下省审议（menxia agent）
   - 审核方案可行性
   - 检查安全风险
   - 通过 / 封驳（打回）
   ↓
5. 尚书省派发（shangshu agent）
   - 根据任务类型分配到对应六部
   - 前端 → 礼部
   - 数据库 → 户部
   - 安全 → 兵部
   - 测试 → 刑部
   - 工程 → 工部
   ↓
6. 六部执行（对应 agent）
   - 使用 Claude Code / OpenCode 编写代码
   - 遵循编码规范
   - 运行测试验证
   ↓
7. 门下省终审
   - 运行 review-gate.ps1
   - 检查编码、测试、构建
   - 通过 → 合并
   - 不通过 → 打回重做
   ↓
8. 回奏（报告结果）
```

### 任务状态流转

| 状态 | 含义 |
|------|------|
| 📋 Ready | 已立项，等待执行 |
| 🔄 In Progress | 执行中 |
| ⏸️ Blocked | 阻塞，等待依赖 |
| ✅ Done | 完成 |
| ❌ Rejected | 被门下省封驳 |

---

## Claude Code / OpenCode 使用规范

### 何时使用

所有**源代码变更**必须通过 Claude Code 或 OpenCode 执行：

- `.js` / `.mjs` / `.cjs` 文件的编写和修改
- `.vue` 文件的编写和修改
- `.css` / `.html` 文件的编写和修改
- 配置文件的修改（`vite.config.js`、`package.json` 等）
- 脚本文件的编写（`scripts/` 目录）

### 何时不使用

以下场景可直接使用 OpenClaw 内置工具：

- 读取文件内容（`read`）
- 列出目录结构（`dir_list`）
- 搜索文件内容（`exec` + `rg` / `findstr`）
- 创建纯文档 `.md` 文件（非源代码）
- 查看日志和报告

### 使用方式

```bash
# Claude Code（首选）
claude-code

# OpenCode（备选）
opencode-acp-control
```

两者均需在项目根目录 `D:\Cat\FLAI-TavernAI\` 下启动。

---

## 禁止事项

### 严禁使用内置 edit/write 工具修改源代码

以下操作**必须**通过 Claude Code / OpenCode：

- ❌ 使用 `edit` 工具修改 `.js`、`.vue`、`.css`、`.html` 文件
- ❌ 使用 `write` 工具覆盖源代码文件
- ❌ 直接用 `exec` + `echo` / `Set-Content` 修改代码文件

### 其他禁止事项

- ❌ 不得跳过门下省审核直接合并
- ❌ 不得在未运行测试的情况下报告完成
- ❌ 不得在未运行编码检查的情况下报告完成
- ❌ 不得修改 `scripts/review-gate.ps1` 绕过审核
- ❌ 不得直接操作 `.git` 目录
- ❌ 不得修改他人的 Agent 配置文件

---

## 报告格式要求

### 标准报告结构

所有任务完成报告必须包含以下字段：

```markdown
## 任务报告

- **任务 ID**: [从 backlog.md 中获取]
- **执行人**: [Agent 名称]
- **结果**: ✅ 完成 / ❌ 失败 / ⏸️ 阻塞

### 变更文件
- `path/to/file1.js` — [变更说明]
- `path/to/file2.vue` — [变更说明]

### 验证证据
- 编码检查: `node scripts/check-encoding.mjs` → 通过
- 测试: `npm test` → [X] passed
- 构建: `npm run build` → 成功

### 阻塞项（如有）
- [描述阻塞原因和需要的解锁条件]
```

### 报告存放

完成报告写入 `automation/reports/` 目录，文件名格式：

```
YYYY-MM-DD-[task-slug].md
```

示例：`2026-06-02-docs-setup.md`

### 飞书回执要求

通过飞书入口接旨时：

1. 先文字回"已接旨"（不使用 reaction）
2. 长任务先登记、回短消息，然后转派后台
3. 完成后回摘要 + 报告路径
4. 复杂报告写入 `reports/` 后回摘要和路径
