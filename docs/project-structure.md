# 项目文件结构说明

本文档列出 FLAI-TavernAI 项目的完整目录结构和每个关键文件的作用。

---

## 根目录结构

```
D:\Cat\FLAI-TavernAI\
├── .editorconfig              # 编辑器配置 (UTF-8, CRLF, 2空格缩进)
├── .openclaw/                 # OpenClaw Agent 配置
├── .runtime-check/            # 运行时截图和测试日志
├── AGENTS.md                  # AI Agent 协作指南 (三省六部制)
├── HEARTBEAT.md               # 心跳配置
├── IDENTITY.md                # Agent 身份配置
├── README.md                  # 项目说明文档
├── SOUL.md                    # Agent 灵魂配置
├── TOOLS.md                   # 工具配置
├── USER.md                    # 用户配置
├── automation/                # 自动化任务和报告
├── backend/                   # 后端代码 (Express + SQLite)
├── config/                    # OpenCode 配置
├── docs/                      # 项目文档
├── frontend/                  # 前端代码 (Vue + Vite)
├── governance.md              # 三省六部制完整框架
├── governance-permissions.md  # 权限治理
└── scripts/                   # 工具脚本
```

---

## backend/ 后端目录

```
backend/
├── .env                       # 环境变量 (不提交到 git)
├── .env.example               # 环境变量模板
├── dev-server.err.log         # 开发服务器错误日志
├── dev-server.out.log         # 开发服务器输出日志
├── package.json               # 后端依赖配置
├── package-lock.json          # 依赖锁定文件
│
├── data/                      # 数据存储目录 (git ignored)
│   ├── flai.sqlite            # 主数据库文件
│   ├── flai.sqlite-shm        # SQLite 共享内存文件
│   ├── flai.sqlite-wal        # SQLite WAL 日志
│   ├── app-secret             # 本地开发密钥 (自动生成)
│   └── backups/               # 数据库备份
│       ├── flai-2026-05-25.sqlite
│       ├── flai-2026-05-26.sqlite
│       └── ...
│
├── logs/                      # 生产日志
│   ├── server.err.log
│   └── server.out.log
│
├── uploads/                   # 上传文件目录 (git ignored)
│   └── avatars/               # 用户/角色头像
│
└── src/                       # 源代码
    ├── server.js              # 主服务器入口
    ├── db.js                  # 数据库初始化和 Schema
    ├── security.js            # 认证、加密、CSRF 防护
    │
    ├── routes/                # API 路由模块
    │   ├── auth.js            # 认证路由 (/api/auth/*)
    │   ├── characters.js      # 角色路由 (/api/characters/*)
    │   ├── conversations.js   # 对话路由 (/api/conversations/*)
    │   ├── worldBooks.js      # 世界书路由 (/api/world-books/*)
    │   ├── presets.js         # 预设路由 (/api/presets/*)
    │   ├── mods.js            # Mod 路由 (/api/mods/*)
    │   ├── tags.js            # 标签路由 (/api/tags/*)
    │   ├── talents.js         # 天赋路由 (/api/talent-pools/*)
    │   ├── regex.js           # 正则规则路由 (/api/regex-rules/*)
    │   ├── settings.js        # 设置路由 (/api/settings/*)
    │   ├── swipes.js          # 消息滑动路由 (/api/messages/*)
    │   ├── branches.js        # 对话分支路由
    │   └── helpers.js         # 路由辅助函数
    │
    ├── modules/               # 业务逻辑模块
    │   ├── characters.js      # 角色 CRUD、正则规则应用
    │   ├── worldBooks.js      # 世界书引擎 (触发匹配、token预算)
    │   ├── presets.js         # 预设管理
    │   ├── mods.js            # Mod 系统 (prompt 注入)
    │   ├── talents.js         # 天赋系统
    │   ├── economy.js         # 经济系统
    │   ├── npcs.js            # NPC 代理引擎
    │   ├── statusBars.js      # 状态栏系统
    │   ├── saves.js           # 存档系统
    │   ├── swipes.js          # 消息滑动 (多回复)
    │   ├── branches.js        # 对话分支
    │   ├── tags.js            # 标签系统
    │   ├── advancedSettings.js # 高级设置
    │   ├── characterImages.js # 角色立绘 (CG)
    │   └── conversationAppearance.js # 对话外观
    │
    ├── services/              # 服务层
    │   ├── providers.js       # AI Provider 通信 (OpenAI/DeepSeek/Gemini)
    │   ├── avatars.js         # 头像管理 (Base64 存储)
    │   ├── backup.js          # 数据库备份 (每日自动)
    │   ├── csrf.js            # CSRF 防护中间件
    │   ├── macros.js          # 宏替换引擎
    │   ├── sanitize.js        # 内容消毒 (DOMPurify)
    │   ├── promptVariables.js # 提示词变量处理
    │   ├── accessoryAgents.js # 附属代理系统
    │   └── characterAssistant.js # 角色助手 (AI 辅助创建)
    │
    ├── validations/           # 输入验证
    │   └── schemas.js         # Zod 验证 Schema
    │
    └── tests/                 # 测试文件
        ├── backend.test.js    # 核心后端测试
        ├── accessoryAgents.test.js # 附属代理测试
        ├── characterImages.test.js # 立绘系统测试
        ├── economy.test.js    # 经济系统测试
        └── npcs.test.js       # NPC 引擎测试
```

### 后端关键文件说明

#### server.js - 主服务器入口

- 初始化 Express 应用
- 配置中间件 (CORS, Compression, Cookie Parser, CSRF, Rate Limit)
- 挂载所有路由模块
- 启动定时备份
- 错误处理

#### db.js - 数据库管理

- 使用 `node:sqlite` 的 `DatabaseSync` API
- 定义所有表结构 (CREATE TABLE)
- 自动迁移 (ensureColumn)
- WAL 模式、外键约束
- 导出 `db` 实例供全局使用

#### security.js - 安全模块

- 密码哈希 (scrypt)
- 会话管理 (Cookie-based)
- API Key 加密 (AES-256-GCM)
- CSRF 防护 (Double-Submit Cookie)
- 会话解析和验证

---

## frontend/ 前端目录

```
frontend/
├── dev-server.err.log         # 开发服务器错误日志
├── dev-server.out.log         # 开发服务器输出日志
├── index.html                 # HTML 入口
├── package.json               # 前端依赖配置
├── package-lock.json          # 依赖锁定文件
├── vite.config.js             # Vite 配置 (代理、端口)
│
├── build/                     # 构建脚本 (如果有)
│
├── public/                    # 静态资源
│   ├── icons/                 # 图标文件
│   └── manifest.json          # PWA 清单
│
├── dist/                      # 构建产物 (git ignored)
│
└── src/                       # 源代码
    ├── main.js                # Vue 应用入口
    ├── App.vue                # 根组件 (路由、主题、通知)
    ├── api.js                 # API 请求封装 (fetch + SSE)
    ├── styles.css             # 全局样式
    │
    ├── views/                 # 页面视图组件
    │   ├── HomeView.vue       # 首页 (角色列表)
    │   ├── ChatView.vue       # 聊天页面
    │   ├── CharacterFormView.vue # 角色创建/编辑
    │   ├── SettingsView.vue   # 设置页面
    │   ├── WorldBookView.vue  # 世界书编辑
    │   ├── LoginView.vue      # 登录页面
    │   └── RegisterView.vue   # 注册页面
    │
    ├── components/            # 通用组件
    │   ├── BaseLayout.vue     # 基础布局框架
    │   ├── VirtualMessageList.vue # 虚拟滚动消息列表
    │   ├── StatusBar.vue      # 状态栏组件
    │   ├── EconomyPanel.vue   # 经济面板
    │   ├── NpcPanel.vue       # NPC 面板
    │   ├── CharacterImagePanel.vue # 角色立绘面板
    │   ├── TalentBadge.vue    # 天赋徽章
    │   ├── TalentRollDialog.vue # 天赋抽取对话框
    │   ├── SaveLoadPanel.vue  # 存档面板
    │   ├── ExtensionManager.vue # 扩展管理器
    │   ├── VariableEditor.vue # 变量编辑器
    │   ├── MarkdownContent.vue # Markdown 渲染
    │   └── MessageToasts.vue  # 消息提示
    │
    ├── composables/           # Vue 组合式函数
    │   └── useNotify.js       # 通知 composable
    │
    ├── services/              # 前端服务
    │   ├── extensions.js      # 扩展系统
    │   ├── extensionHooks.js  # 扩展钩子
    │   └── modExtension.js    # Mod 扩展
    │
    └── utils/                 # 工具函数
        └── chatAppearance.js  # 聊天外观工具
```

### 前端关键文件说明

#### App.vue - 根组件

- Hash-based 路由系统
- 用户会话管理
- 主题切换 (light/dark)
- 全局通知系统
- 异步组件懒加载

#### api.js - API 封装

- 统一的 `apiRequest()` 函数
- CSRF Token 自动管理
- SSE 流式请求 (`streamMessage`)
- 错误重试机制
- 开发环境自动回退到后端端口

#### ChatView.vue - 聊天页面

- 消息发送和接收
- 流式渲染
- 世界书上下文预览
- 角色立绘切换
- 状态栏显示
- 经济系统交互
- NPC 面板
- 存档/读档

---

## scripts/ 脚本目录

```
scripts/
├── check-encoding.mjs         # 编码检查脚本 (检测中文乱码)
├── check-workstation.ps1      # 工作站检查脚本
├── review-gate.ps1            # 门下省审核脚本
├── self-evolve.ps1            # 自动迭代脚本
└── start-ai-workstation.bat   # AI 工作站启动脚本
```

### 脚本说明

#### check-encoding.mjs

- 扫描项目中所有源文件
- 检测常见中文乱码特征字符
- 在 `pretest` 和 `prebuild` 中自动运行
- 失败时阻止测试/构建

#### review-gate.ps1

- 门下省审核入口
- 运行编码检查
- 运行后端测试
- 运行前端构建
- 生成审核报告

---

## automation/ 自动化目录

```
automation/
├── backlog.md                 # 自主任务 backlog
├── claude-prompt.txt          # Claude Code 提示词
├── plans/                     # 当前规划文件
│   └── legacy/                # 早期散落规划归档
├── prompts/                   # Agent/工具提示词
├── tasks/                     # 任务描述文件
└── reports/                   # 执行报告
    ├── audits/                # 审计、分析、鲁棒性报告
    ├── 2026-05-29-*.md
    ├── 2026-05-30-*.md
    ├── 2026-06-02-*.md
    └── ...
```

---

## docs/ 文档目录

```
docs/
├── ai-dev-workflow.md         # AI 开发与 PR 流程
├── development-standards.md   # 项目开发规范
├── project-pipeline.md        # 项目完整链路说明
├── project-structure.md       # 项目文件结构说明 (本文件)
├── api-reference.md           # API 端点列表
├── database-schema.md         # 数据库表结构
└── world-book-engine.md       # 世界书引擎架构
```

---

## config/ 配置目录

```
config/
└── opencode.json              # OpenCode 配置
```

---

## .openclaw/ Agent 配置目录

```
.openclaw/
└── workspace-state.json       # 工作区状态
```

---

## 数据库文件位置

| 文件 | 路径 | 说明 |
|------|------|------|
| 主数据库 | `backend/data/flai.sqlite` | SQLite 主文件 |
| WAL 日志 | `backend/data/flai.sqlite-wal` | Write-Ahead Log |
| 共享内存 | `backend/data/flai.sqlite-shm` | 共享内存索引 |
| 应用密钥 | `backend/data/app-secret` | 自动生成的加密密钥 |
| 备份目录 | `backend/data/backups/` | 每日自动备份 |

---

## Git 忽略规则

以下文件/目录被 git 忽略：

- `node_modules/` - 依赖包
- `backend/data/` - 数据库和密钥
- `backend/uploads/` - 上传文件
- `frontend/dist/` - 构建产物
- `.runtime-check/` - 运行时截图
- `*.log` - 日志文件
- `.env` - 环境变量
