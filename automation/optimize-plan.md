# FLAI-TavernAI 深度优化方案

> 中书省拟，门下省审。基于 P1-P12 已完成功能，针对性能、安全、技术栈和新功能四个维度进行深度优化。
>
> 参考来源：SillyTavern (GitHub)、AI风月 (aisearches.xyz)、VectFox RAG 系统
>
> 拟旨时间：2026-05-25

---

## 批次1：性能与体验优化（工部 + 礼部）

### 1.1 聊天虚拟滚动 — 解决长对话卡顿

**问题**：当前 `ChatView.vue` 将所有消息一次性渲染到 DOM，当对话超过 200 条时明显卡顿、内存飙升。

**技术方案**：
- 引入 `@tanstack/vue-virtualizer`（或手写轻量虚拟列表），仅渲染可视区域 ± 缓冲区的消息
- 为每条消息维护预估高度（首次渲染后测量缓存），滚动时动态回收/复用 DOM 节点
- 保留当前的 `isScrollPinned` 逻辑，虚拟滚动与自动吸底兼容

**涉及文件**：
- `frontend/src/views/ChatView.vue` — 核心改造
- `frontend/src/components/VirtualMessageList.vue` — 新建虚拟列表组件
- `frontend/package.json` — 新增依赖 `@tanstack/vue-virtualizer`

**预估收益**：500 条消息场景下 DOM 节点减少 80%，滚动 FPS 从 ~20 恢复到 60。

---

### 1.2 消息分页加载 — 首屏秒开

**问题**：`GET /api/conversations/:id/messages` 一次性返回全部消息，对话越长首屏越慢。

**技术方案**：
- 后端新增 `?before=<messageId>&limit=50` 分页参数，按 `created_at DESC` 倒序返回
- 前端首屏仅加载最近 50 条，向上滚动时触发 `IntersectionObserver` 加载更早消息
- 加载过程中显示骨架屏（Skeleton），保持滚动锚点不跳

**涉及文件**：
- `backend/src/server.js` — 修改 `getMessages` 支持分页
- `backend/src/modules/characters.js` 或新建 `backend/src/modules/messages.js`
- `frontend/src/views/ChatView.vue` — 分页加载逻辑
- `frontend/src/api.js` — 新增 `fetchMessagesPaged()`

**预估收益**：万条消息对话首屏加载从 3s+ 降至 <500ms。

---

### 1.3 Markdown 渲染优化 — 消除大段文本卡顿

**问题**：`MarkdownContent.vue` 对每条消息实时解析 Markdown，长文本（>2000 字）解析卡顿。

**技术方案**：
- 引入 `markdown-it`（替代手写解析）+ `highlight.js` 代码高亮
- 使用 `v-memo` 指令缓存已渲染消息，仅在 `text` 变化时重新渲染
- 流式输出阶段使用增量渲染（仅重绘最后一段变化的文本节点）

**涉及文件**：
- `frontend/src/components/MarkdownContent.vue` — 核心重写
- `frontend/package.json` — 新增 `markdown-it`、`highlight.js`

**预估收益**：长文本渲染耗时减少 60%，流式输出更流畅。

---

### 1.4 后端请求压缩与缓存

**问题**：角色卡列表、世界书等接口返回未压缩 JSON，首次加载慢。

**技术方案**：
- 启用 Express `compression` 中间件（gzip/brotli）
- 为 `/api/characters`、`/api/world-books`、`/api/tags` 等列表接口添加 `ETag` / `Last-Modified` 缓存头
- 前端 `apiRequest` 增加 `If-None-Match` 条件请求，304 时复用本地缓存

**涉及文件**：
- `backend/src/server.js` — 添加 compression 中间件 + 缓存头
- `backend/package.json` — 新增 `compression`
- `frontend/src/api.js` — 条件请求逻辑

---

### 1.5 流式输出打字机效果优化

**问题**：当前 `appendStreamText` 使用 `Intl.Segmenter` 逐字追加，长回复体感延迟。

**技术方案**：
- 自适应 chunk 大小：前 100 字快速弹出（10ms/字），后续减速至 22ms/字
- 标点符号后增加停顿（已有），新增段落换行后增加更长停顿（200ms）
- 流式过程中使用 `requestAnimationFrame` 批量更新，避免逐字符触发 Vue 响应式

**涉及文件**：
- `frontend/src/views/ChatView.vue` — `appendStreamText` / `waitTypingCadence` 优化

---

### 1.6 移动端体验增强

**问题**：移动端虽已有基础适配，但侧边栏、设置面板交互仍有痛点。

**技术方案**：
- 侧边栏改为底部抽屉（Bottom Sheet）+ 滑动手势关闭
- 设置面板使用全屏模态而非侧拉抽屉
- 输入框自动跟随虚拟键盘（已有 `visualViewport` 监听，需优化 `updateComposerDock` 的抖动）
- CG 立绘面板在移动端改为全屏查看模式

**涉及文件**：
- `frontend/src/views/ChatView.vue` — 移动端布局重构
- `frontend/src/styles.css` — 新增移动端断点样式

---

## 批次2：安全与数据加固（户部 + 兵部）

### 2.1 SQLite 并发安全 — WAL 模式 + 连接池

**问题**：当前使用 `DatabaseSync`（同步 API），高并发写入时可能死锁或性能瓶颈。

**技术方案**：
- 启用 SQLite WAL（Write-Ahead Logging）模式：`PRAGMA journal_mode=WAL`
- 设置 `PRAGMA busy_timeout=5000` 避免锁冲突
- 对于高频写入路径（消息插入、状态栏更新），使用事务批处理
- 长期考虑：引入 `better-sqlite3` 替代 `node:sqlite`（更成熟、性能更优）

**涉及文件**：
- `backend/src/db.js` — 添加 WAL pragma + busy_timeout
- `backend/src/server.js` — 事务批处理（消息插入 + 时间戳更新）

---

### 2.2 输入验证与 SQL 注入防护

**问题**：部分接口直接拼接用户输入到 SQL（如 `listCharacters` 的搜索参数），虽使用了参数化查询，但缺少长度/格式校验。

**技术方案**：
- 引入 `zod` 做请求体 schema 校验，统一错误格式
- 所有文本输入添加长度限制（角色名 50 字、人设 10000 字等）
- 搜索输入过滤特殊字符，防 LIKE 注入

**涉及文件**：
- `backend/package.json` — 新增 `zod`
- `backend/src/server.js` — 添加校验中间件
- 新建 `backend/src/validation.js` — 集中定义 schema

---

### 2.3 API Key 加密增强

**问题**：当前 `encryptSecret` 使用 AES-256-CBC，密钥派生方式未明确。

**技术方案**：
- 升级为 AES-256-GCM（认证加密，防篡改）
- 使用 `scrypt` 从 `app-secret` 派生加密密钥（而非直接使用）
- 添加密钥轮换机制：旧密钥加密的数据自动迁移

**涉及文件**：
- `backend/src/security.js` — 加密算法升级

---

### 2.4 会话安全加固

**问题**：Session cookie 未设置 `SameSite`、`HttpOnly` 属性不够严格。

**技术方案**：
- Cookie 设置 `SameSite=Lax`（或 `Strict`）、`HttpOnly=true`、`Secure=true`（生产环境）
- Session 过期时间从默认值改为可配置（当前无明确过期逻辑）
- 添加登录失败速率限制（5 次/分钟）

**涉及文件**：
- `backend/src/security.js` — Cookie 属性 + 速率限制
- `backend/src/server.js` — 登录端点添加限流

---

### 2.5 数据备份与恢复

**问题**：SQLite 单文件存储，无自动备份机制。

**技术方案**：
- 启动时自动创建 `data/flai.sqlite.bak`（每日一次，保留 7 天）
- 提供 `/api/admin/backup` 端点（仅 root_admin），触发手动备份
- 导出为 `.zip`（含 SQLite + uploads 目录）

**涉及文件**：
- `backend/src/db.js` — 自动备份逻辑
- `backend/src/server.js` — 备份端点
- 新建 `src/backup.js`

---

## 批次3：技术栈升级（工部 + 兵部）

### 3.1 前端路由系统 — 从 hash 到 History API

**问题**：当前使用自定义 `emit('navigate')` 事件总线路由，无 URL 同步、无浏览器前进/后退支持。

**技术方案**：
- 引入 `vue-router@4`，定义路由表：
  - `/` → HomeView
  - `/chat/:id` → ChatView
  - `/character/new` → CharacterFormView
  - `/character/:id/edit` → CharacterFormView
  - `/settings` → SettingsView
  - `/world-books` → WorldBookView
- 保留当前的 `emit('navigate')` 作为 programmatic navigation
- 深链接支持：分享对话链接可直接打开

**涉及文件**：
- `frontend/package.json` — 新增 `vue-router`
- `frontend/src/main.js` — 路由注册
- `frontend/src/App.vue` — `<router-view>` 替换手动视图切换
- 所有 `*.vue` 视图 — 适配路由参数

---

### 3.2 状态管理 — 引入 Pinia

**问题**：当前用户信息、角色列表、预设列表等在多个视图中重复 fetch，无全局状态。

**技术方案**：
- 引入 `pinia`，定义 Store：
  - `useUserStore` — 用户信息、登录状态
  - `useCharacterStore` — 角色列表、标签
  - `useConversationStore` — 当前对话、消息列表
  - `useProviderStore` — AI 供应商配置
  - `useUIStore` — 侧边栏、设置面板状态
- 减少重复 API 调用，组件间共享数据

**涉及文件**：
- `frontend/package.json` — 新增 `pinia`
- `frontend/src/main.js` — Pinia 注册
- 新建 `frontend/src/stores/*.js` — 各 Store
- 所有 `*.vue` — 迁移到 Store

---

### 3.3 TypeScript 渐进迁移

**问题**：全项目纯 JS，缺乏类型安全，重构风险高。

**技术方案**：
- 第一步：`jsconfig.json` → `tsconfig.json`，启用严格模式
- 第二步：新文件用 `.ts` / `.vue`（`<script setup lang="ts">`）
- 第三步：逐步迁移 `api.js`、`stores/*.js` 等核心模块
- 后端：`server.js` 保持 JS，但为模块添加 `.d.ts` 类型声明

**涉及文件**：
- 新建 `tsconfig.json`
- `frontend/package.json` — 新增 `typescript`、`vue-tsc`
- `vite.config.js` — TypeScript 插件

---

### 3.4 后端模块化重构 — 拆分巨型 server.js

**问题**：`server.js` 超过 1000 行，路由、业务逻辑、工具函数混在一起。

**技术方案**：
- 使用 Express Router 按功能域拆分：
  - `routes/auth.js` — 认证路由
  - `routes/characters.js` — 角色 CRUD
  - `routes/conversations.js` — 对话 + 消息
  - `routes/worldBooks.js` — 世界书
  - `routes/presets.js` — 预设
  - `routes/mods.js` — Mod
  - `routes/talents.js` — 天赋
  - `routes/economy.js` — 经济
  - `routes/npcs.js` — NPC
  - `routes/settings.js` — 设置
  - `routes/admin.js` — 管理端点
- 抽取公共函数（`buildModelMessages`、`streamAssistantResponse` 等）到 `services/`

**涉及文件**：
- `backend/src/server.js` — 精简为中间件注册 + Router 挂载
- 新建 `backend/src/routes/*.js`
- `backend/src/services/chatEngine.js` — 聊天核心逻辑

---

### 3.5 前端构建优化

**问题**：单 chunk 打包，首屏加载所有代码。

**技术方案**：
- Vite 代码分割：路由级懒加载（`defineAsyncComponent` / 动态 `import()`）
- 第三方库分 chunk：`vue`、`pinia`、`vue-router` 独立 vendor chunk
- 图片优化：角色头像使用 `<picture>` + WebP 格式
- 启用 `vite-plugin-compression` 预压缩 gzip/brotli

**涉及文件**：
- `vite.config.js` — 分割策略
- `frontend/src/App.vue` — 懒加载视图

---

## 批次4：新功能 P13-P16（户部 + 礼部）

### P13: RAG 记忆增强系统（参考 SillyTavern Data Bank + VectFox）

**目标**：解决长对话中 AI 遗忘早期内容的问题。

**功能设计**：
- **对话摘要**：每 50 条消息自动生成摘要（调用 AI），存入 `conversation_summaries` 表
- **向量检索**：用户上传文档/知识片段，使用 Embedding API 向量化存储
- **上下文注入**：发送消息时，自动检索最相关的 3 条历史摘要/文档片段注入 prompt
- **记忆深度控制**：用户可调节 1-5 档记忆深度（影响摘要频率和检索数量）

**数据库变更**：
```sql
CREATE TABLE conversation_summaries (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  message_range_start INTEGER,
  message_range_end INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE knowledge_chunks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT,
  content TEXT NOT NULL,
  embedding_json TEXT,
  source_type TEXT NOT NULL DEFAULT 'document',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

**涉及文件**：
- `backend/src/modules/summaries.js` — 新建
- `backend/src/modules/knowledge.js` — 新建
- `backend/src/services/embeddings.js` — Embedding API 调用
- `backend/src/server.js` — 新增摘要/知识库端点
- `frontend/src/components/KnowledgePanel.vue` — 新建
- `frontend/src/views/ChatView.vue` — 集成知识面板

**技术参考**：
- SillyTavern Data Bank: https://docs.sillytavern.app/usage/core-concepts/data-bank/
- VectFox RAG: https://github.com/Blocky-mint/VectFox

---

### P14: 多模型切换 + 模型系数管理

**目标**：支持同一对话中切换不同 AI 模型，并显示消耗预估。

**功能设计**：
- 聊天输入栏新增模型下拉选择（覆盖预设中的默认模型）
- 模型系数配置表：不同模型的 token 单价系数
- 消耗预估：发送前根据消息长度预估 token 数和费用
- 模型兼容性检测：自动检测当前模型是否支持 function calling / thinking

**数据库变更**：
```sql
CREATE TABLE model_coefficients (
  id TEXT PRIMARY KEY,
  model_pattern TEXT NOT NULL,
  input_coefficient REAL NOT NULL DEFAULT 1.0,
  output_coefficient REAL NOT NULL DEFAULT 1.0,
  supports_tools INTEGER NOT NULL DEFAULT 1,
  supports_reasoning INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
```

**涉及文件**：
- `backend/src/modules/modelCoefficients.js` — 新建
- `backend/src/services/providers.js` — 消耗预估逻辑
- `backend/src/server.js` — 系数管理端点
- `frontend/src/views/SettingsView.vue` — 系数配置 UI
- `frontend/src/views/ChatView.vue` — 模型切换下拉

---

### P15: 对话分支（Branching）系统

**目标**：支持从任意消息创建分支，探索不同剧情走向（参考 SillyTavern 的 branch 功能）。

**功能设计**：
- 消息操作菜单新增「从此分支」按钮
- 分支创建时复制当前消息快照到新对话
- 分支对话标记来源分支点，支持在分支间跳转
- 分支树可视化（可选，后期迭代）

**数据库变更**：
```sql
ALTER TABLE conversations ADD COLUMN branched_from_id TEXT;
ALTER TABLE conversations ADD COLUMN branched_at_message_id TEXT;
```

**涉及文件**：
- `backend/src/server.js` — 分支创建端点
- `frontend/src/views/ChatView.vue` — 分支按钮 + 分支导航
- `frontend/src/components/BranchIndicator.vue` — 新建

---

### P16: 插件市场 + 社区分享

**目标**：将现有 Mod 系统升级为可分享的插件生态。

**功能设计**：
- Mod 导出为 `.flai-mod.json` 格式（含元数据、版本号、作者）
- Mod 导入支持文件拖拽
- 角色卡 + Mod 打包导出（`.flai-pack.json`）
- 本地插件目录扫描（`mods/` 文件夹自动发现）
- 未来：社区广场 API（可选，需后端服务）

**Mod JSON 格式**：
```json
{
  "_flai_mod_version": 1,
  "name": "文艺复兴文风",
  "author": "某用户",
  "version": "1.0.0",
  "description": "将 AI 回复风格改为文艺复兴时期",
  "type": "prompt_inject",
  "content": "请用文艺复兴时期的语言风格回复...",
  "tags": ["文风", "角色扮演"]
}
```

**涉及文件**：
- `backend/src/modules/mods.js` — 导入/导出逻辑
- `backend/src/server.js` — Mod 导入/导出端点
- `frontend/src/views/SettingsView.vue` — Mod 管理增强
- `frontend/src/components/ModImportDialog.vue` — 新建

---

## 执行顺序与依赖

```
阶段 1（性能优先，立即开始）
├── 1.1 虚拟滚动 ───────────── 独立，可并行
├── 1.2 消息分页 ───────────── 1.1 的前置依赖
├── 1.4 后端压缩缓存 ───────── 独立，可并行
└── 3.4 后端模块化重构 ─────── 1.2 之前完成（减少合并冲突）

阶段 2（技术债清理）
├── 2.1 SQLite WAL ─────────── 独立
├── 2.2 输入验证 ───────────── 独立
├── 2.3 API Key 加密 ───────── 独立
├── 2.4 会话安全 ───────────── 独立
└── 3.5 前端构建优化 ────────── 依赖 3.1/3.2

阶段 3（架构升级）
├── 3.1 Vue Router ─────────── 独立，但影响所有视图
├── 3.2 Pinia 状态管理 ──────── 依赖 3.1（路由集成）
├── 3.3 TypeScript 迁移 ─────── 依赖 3.1/3.2（新文件用 TS）
└── 1.3 Markdown 优化 ───────── 独立

阶段 4（新功能）
├── P13 RAG 记忆 ───────────── 依赖 3.4（后端模块化）
├── P14 多模型切换 ──────────── 依赖 2.2（输入验证）
├── P15 对话分支 ───────────── 依赖 1.2（分页加载）
└── P16 插件市场 ───────────── 依赖 3.4（后端模块化）

阶段 5（体验打磨）
├── 1.5 流式输出优化 ────────── 独立
└── 1.6 移动端增强 ─────────── 依赖 3.1（路由）
```

### 关键路径

```
3.4 后端重构 → 1.2 消息分页 → 1.1 虚拟滚动 → P15 对话分支
3.1 Vue Router → 3.2 Pinia → 3.3 TypeScript → P13 RAG
```

### 里程碑

| 里程碑 | 内容 | 预估工期 |
|--------|------|----------|
| M1 | 批次1 性能优化（1.1-1.6） | 2 周 |
| M2 | 批次2 安全加固（2.1-2.5） | 1 周 |
| M3 | 批次3 技术栈升级（3.1-3.5） | 2 周 |
| M4 | 批次4 新功能（P13-P16） | 3 周 |

---

## 附录：参考项目

| 项目 | 链接 | 参考点 |
|------|------|--------|
| SillyTavern | https://github.com/SillyTavern/SillyTavern | RAG Data Bank、扩展系统、向量检索 |
| VectFox | https://github.com/Blocky-mint/VectFox | 向量数据库驱动的长期记忆 |
| SillyTavern Docs | https://docs.sillytavern.app | 架构设计、功能文档 |
| AI风月 | https://aisearches.xyz | 产品功能参考 |
| @tanstack/vue-virtualizer | https://tanstack.com/virtual | 虚拟滚动实现 |
| vue-router@4 | https://router.vuejs.org | 前端路由 |
| Pinia | https://pinia.vuejs.org | 状态管理 |
| zod | https://zod.dev | 运行时 schema 校验 |
| markdown-it | https://github.com/markdown-it/markdown-it | Markdown 渲染 |

---

*中书省 拟 2026-05-25 · 呈门下省审议*
