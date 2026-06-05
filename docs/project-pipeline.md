# 项目完整链路说明

本文档说明 FLAI-TavernAI 从前端到后端的完整请求流程和数据流。

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户浏览器                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Vue 3 SPA (Vite 开发服务器 / 静态构建)                   │   │
│  │  http://localhost:5173                                    │   │
│  └──────────────────────┬──────────────────────────────────┘   │
└─────────────────────────┼───────────────────────────────────────┘
                          │ HTTP (fetch + SSE)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Vite Proxy                                  │
│  /api/*  →  http://127.0.0.1:3001                               │
│  /uploads/* → http://127.0.0.1:3001                             │
└─────────────────────────┼───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Express 后端 (port 3001)                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Middleware:                                              │   │
│  │  - CORS (credentials: true)                               │   │
│  │  - Compression (gzip)                                     │   │
│  │  - Cookie Parser                                          │   │
│  │  - CSRF Protection (Double-Submit Cookie)                 │   │
│  │  - Rate Limiting (100 req/15min, auth 5/min)              │   │
│  │  - Auth Session Resolution                                │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Route Modules:                                           │   │
│  │  /api/auth         → 认证路由                              │   │
│  │  /api/characters   → 角色路由                              │   │
│  │  /api/conversations → 对话路由                             │   │
│  │  /api/world-books  → 世界书路由                            │   │
│  │  /api/presets      → 预设路由                              │   │
│  │  /api/mods         → Mod 路由                              │   │
│  │  /api/tags         → 标签路由                              │   │
│  │  /api/talent-pools → 天赋池路由                            │   │
│  │  /api/regex-rules  → 正则规则路由                          │   │
│  │  /api/messages     → 消息滑动路由                          │   │
│  │  /api/settings     → 设置路由                              │   │
│  │  /api/saves        → 存档路由                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Services:                                                │   │
│  │  - providers.js (AI Provider 通信)                         │   │
│  │  - avatars.js (头像管理)                                    │   │
│  │  - backup.js (数据库备份)                                   │   │
│  │  - csrf.js (CSRF 防护)                                     │   │
│  │  - macros.js (宏替换)                                       │   │
│  │  - sanitize.js (内容消毒)                                   │   │
│  │  - promptVariables.js (提示词变量)                          │   │
│  │  - accessoryAgents.js (附属代理)                            │   │
│  │  - characterAssistant.js (角色助手)                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Modules:                                                 │   │
│  │  - characters.js (角色 CRUD + 正则)                        │   │
│  │  - worldBooks.js (世界书引擎)                               │   │
│  │  - conversations.js (对话管理)                              │   │
│  │  - messages.js (消息管理)                                    │   │
│  │  - presets.js (预设管理)                                     │   │
│  │  - mods.js (Mod 系统)                                       │   │
│  │  - talents.js (天赋系统)                                     │   │
│  │  - economy.js (经济系统)                                     │   │
│  │  - npcs.js (NPC 引擎)                                       │   │
│  │  - statusBars.js (状态栏)                                    │   │
│  │  - saves.js (存档系统)                                       │   │
│  │  - swipes.js (消息滑动)                                      │   │
│  │  - branches.js (对话分支)                                    │   │
│  │  - tags.js (标签系统)                                        │   │
│  │  - advancedSettings.js (高级设置)                            │   │
│  │  - characterImages.js (角色立绘)                             │   │
│  │  - conversationAppearance.js (对话外观)                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  node:sqlite (DatabaseSync)                               │   │
│  │  数据库文件: backend/data/flai.sqlite                      │   │
│  │  WAL 模式 | 外键开启 | busy_timeout 5000ms                 │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 完整请求流程

### 1. 用户登录流程

```
用户输入用户名/密码
    ↓
前端 api.js → POST /api/auth/login
    ↓
Vite Proxy → Express 后端
    ↓
auth 路由 → authLimiter (5次/分钟)
    ↓
security.js → verifyPassword (scrypt)
    ↓
验证通过 → createSession → 写入 sessions 表
    ↓
setSessionCookie (HttpOnly, SameSite=Lax)
    ↓
返回 { user: { id, username, displayName, ... } }
    ↓
前端存储 user 状态 → 跳转首页
```

### 2. 角色聊天流程（核心链路）

```
用户选择角色 → 进入聊天界面
    ↓
前端 ChatView.vue → 加载对话历史
    ↓
GET /api/conversations/:id/messages
    ↓
返回消息列表 → 渲染到 VirtualMessageList
    ↓
用户输入消息
    ↓
前端 streamMessage() → POST /api/conversations/:id/messages (stream: true)
    ↓
后端处理流程:
    ├── 1. 验证会话 (requireAuth)
    ├── 2. 获取角色信息 (getCharacter)
    ├── 3. 获取预设 (getDefaultPreset / getPreset)
    ├── 4. 应用正则规则 (applyRegexRules) - 输入阶段
    ├── 5. 构建世界书上下文 (buildWorldBookContext)
    │       ├── 扫描触发关键词
    │       ├── 正则匹配
    │       ├── 概率激活
    │       ├── Selective 过滤
    │       ├── Token 预算管理
    │       └── 深度注入 (at_depth)
    ├── 6. 构建 Mod 系统提示词 (buildModSystemPrompt)
    ├── 7. 构建天赋系统提示词 (buildTalentSystemPrompt)
    ├── 8. 构建 NPC 代理提示词
    ├── 9. 应用宏替换 (macros.js)
    ├── 10. 组装完整 prompt
    ├── 11. 调用 AI Provider (providers.js)
    │       ├── 流式请求 (SSE)
    │       ├── 解析 reasoning / content / usage
    │       └── 错误处理
    ├── 12. 流式返回 SSE 事件
    └── 13. 保存消息到数据库
    ↓
前端接收 SSE 事件:
    ├── reasoning → 显示思考过程
    ├── content → 流式渲染 Markdown
    ├── usage → 显示 token 用量
    └── done → 完成
    ↓
应用输出正则规则 (applyRegexRules) - 输出阶段
    ↓
渲染到 VirtualMessageList (markdown-it + highlight.js)
```

### 3. AI Provider 通信流程

```
providers.js → providerWithSecret()
    ↓
解密 API Key (security.js → decryptSecret)
    ├── v2: AES-256-GCM + scrypt 密钥
    └── v1: AES-256-GCM + SHA-256 密钥 (兼容)
    ↓
构建请求:
    ├── base_url + /chat/completions
    ├── Authorization: Bearer <api_key>
    ├── model: 用户配置的模型
    ├── messages: 组装好的对话
    ├── stream: true
    ├── temperature / top_p / max_tokens (来自 preset)
    └── extra_body (用户自定义参数)
    ↓
发送请求到 AI Provider:
    ├── OpenAI: https://api.openai.com/v1
    ├── DeepSeek: https://api.deepseek.com
    ├── Gemini: https://generativelanguage.googleapis.com
    └── 自定义网关: 用户配置的 base_url
    ↓
接收流式响应 (SSE):
    ├── 解析 delta.content → content 事件
    ├── 解析 delta.reasoning → reasoning 事件
    ├── 解析 usage → usage 事件
    └── [DONE] → done 事件
    ↓
标准化输出格式:
    {
      meta: { ... },
      reasoning: "思考过程...",
      content: "回复内容...",
      usage: { prompt_tokens, completion_tokens },
      done: true,
      error: null
    }
```

### 4. 世界书引擎流程

```
buildWorldBookContext(db, userId, characterId, messages)
    ↓
1. 获取角色关联的世界书 (character_world_books)
    ↓
2. 获取世界书条目 (world_book_entries)
    ↓
3. 获取最近 N 条消息 (scan_depth)
    ↓
4. 匹配触发关键词:
    ├── 普通 key: 文本包含匹配
    ├── 正则 key: /pattern/flags 内联检测
    └── regex_mode: 全条目正则模式
    ↓
5. Selective 过滤:
    ├── selective=1: 需要同时匹配 primary + secondary keys
    └── selective_logic: AND / OR / NOT
    ↓
6. 概率激活:
    ├── use_probability=1: 按 probability% 概率激活
    └── inclusion_group: 组内互斥，按 group_weight 权重选择
    ↓
7. Sticky / Cooldown / Delay:
    ├── sticky: 激活后持续 N 条消息
    ├── cooldown: 激活后冷却 N 条消息
    └── delay: 前 N 条消息不激活
    ↓
8. Token 预算管理:
    ├── 计算预算 = context_size × lorebookContextPercent / 100
    ├── 按 order_index 升序排列
    ├── 逐条插入，累计 token
    └── 超出预算则截断
    ↓
9. 深度注入 (at_depth):
    ├── position='before_char': 角色卡之前
    ├── position='after_char': 角色卡之后
    └── position='at_depth': 在对话的指定深度插入
    ↓
返回注入后的上下文文本
```

---

## 数据流图

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  用户输入  │ ──→ │  前端处理  │ ──→ │  API 请求  │ ──→ │  后端路由  │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                       │                                    │
                       ▼                                    ▼
                 ┌──────────┐                         ┌──────────┐
                 │ 正则输入   │                         │  认证检查  │
                 │ 规则应用   │                         │  速率限制  │
                 └──────────┘                         │  CSRF 验证 │
                                                      └──────────┘
                                                           │
                           ┌───────────────────────────────┤
                           ▼                               ▼
                     ┌──────────┐                   ┌──────────┐
                     │ SQLite   │                   │ 业务逻辑  │
                     │ 数据读写  │                   │ 模块处理  │
                     └──────────┘                   └──────────┘
                                                           │
                           ┌───────────────────────────────┤
                           ▼                               ▼
                     ┌──────────┐                   ┌──────────┐
                     │ 世界书   │                   │ AI Provider│
                     │ 上下文构建│                   │ 流式请求   │
                     └──────────┘                   └──────────┘
                                                           │
                           ┌───────────────────────────────┤
                           ▼                               ▼
                     ┌──────────┐                   ┌──────────┐
                     │ SSE 流式  │                   │ 消息保存   │
                     │ 响应返回  │                   │ 到数据库   │
                     └──────────┘                   └──────────┘
                           │
                           ▼
                     ┌──────────┐
                     │ 前端渲染  │
                     │ Markdown │
                     └──────────┘
```

---

## 关键模块关系图

```
App.vue
├── BaseLayout.vue (布局框架)
├── HomeView.vue (首页)
│   ├── 角色列表
│   ├── 筛选/排序
│   └── 角色卡片
├── ChatView.vue (聊天)
│   ├── VirtualMessageList.vue (虚拟滚动消息列表)
│   ├── StatusBar.vue (状态栏)
│   ├── EconomyPanel.vue (经济面板)
│   ├── NpcPanel.vue (NPC 面板)
│   ├── CharacterImagePanel.vue (立绘面板)
│   ├── TalentBadge.vue (天赋徽章)
│   ├── SaveLoadPanel.vue (存档面板)
│   └── ExtensionManager.vue (扩展管理)
├── CharacterFormView.vue (角色编辑)
├── SettingsView.vue (设置)
│   ├── Provider 配置
│   ├── 个人资料
│   └── 扩展管理
├── WorldBookView.vue (世界书编辑)
├── LoginView.vue (登录)
└── RegisterView.vue (注册)

后端模块依赖关系:
server.js
├── security.js (认证/加密)
├── db.js (数据库初始化)
├── routes/
│   ├── auth.js → users, sessions
│   ├── characters.js → characters, character_tags, character_images
│   ├── conversations.js → conversations, messages, swipes, branches
│   ├── worldBooks.js → world_books, world_book_entries
│   ├── presets.js → presets
│   ├── mods.js → mods
│   ├── tags.js → tags
│   ├── talents.js → talent_pools, character_talents
│   ├── regex.js → regex_rules
│   ├── settings.js → provider_settings
│   └── swipes.js → message_swipes
├── services/
│   ├── providers.js (AI 通信)
│   ├── avatars.js (头像管理)
│   ├── backup.js (备份)
│   ├── csrf.js (CSRF)
│   ├── macros.js (宏替换)
│   ├── sanitize.js (消毒)
│   ├── promptVariables.js (变量)
│   ├── accessoryAgents.js (附属代理)
│   └── characterAssistant.js (角色助手)
└── modules/
    ├── characters.js (角色逻辑)
    ├── worldBooks.js (世界书引擎)
    ├── presets.js (预设逻辑)
    ├── mods.js (Mod 逻辑)
    ├── talents.js (天赋逻辑)
    ├── economy.js (经济逻辑)
    ├── npcs.js (NPC 引擎)
    ├── statusBars.js (状态栏)
    ├── saves.js (存档)
    ├── swipes.js (滑动)
    ├── branches.js (分支)
    ├── tags.js (标签)
    ├── advancedSettings.js (高级设置)
    ├── characterImages.js (立绘)
    └── conversationAppearance.js (外观)
```

---

## 环境配置

### 开发环境

| 服务 | 地址 | 说明 |
|------|------|------|
| 前端 | http://localhost:5173 | Vite 开发服务器 |
| 后端 | http://localhost:3001 | Express 服务器 |
| 数据库 | backend/data/flai.sqlite | SQLite 文件 |

### 代理配置

```javascript
// vite.config.js
const proxy = {
  '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true },
  '/uploads': { target: 'http://127.0.0.1:3001', changeOrigin: true }
};
```

### 环境变量

```bash
# backend/.env
PORT=3001
CLIENT_ORIGIN=http://127.0.0.1:5173,http://localhost:5173
ALLOW_PRIVATE_NETWORK_ORIGINS=true
APP_SECRET=replace-with-a-long-random-secret
```

### 生产环境

- 前端构建: `npm run build` → `frontend/dist/`
- 后端启动: `npm start` → `node src/server.js`
- 数据库: SQLite WAL 模式，自动备份到 `backend/data/backups/`
