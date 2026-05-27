# 兵部报告 · 批次2 安全与数据加固

> 执行时间：2026-05-25 23:11 GMT+8
> 执行者：兵部（subagent）
> 状态：✅ 全部完成

---

## 任务完成情况

### 1. XSS 防护 ✅

**安装依赖**：`dompurify` + `jsdom`

**新建文件**：`backend/src/services/sanitize.js`
- `sanitizeText(value)` — 严格模式，去除所有 HTML 标签，用于角色名、标签名等短文本
- `sanitizeRichText(value)` — 宽松模式，保留基本格式标签（b/i/em/strong/a/p/br 等），用于人设、背景等富文本
- `sanitizeMessage(value)` — 消息内容 sanitize，去除危险标签
- `sanitizeCharacterPayload(body)` — 角色创建/更新的完整 sanitize
- `sanitizeMessagePayload(body)` — 消息内容 sanitize

**集成位置**：
- `routes/characters.js` — POST/PATCH 角色时调用 `sanitizeCharacterPayload`
- `routes/worldBooks.js` — POST/PUT 世界书时 sanitize name
- `routes/mods.js` — POST/PUT Mod 时 sanitize name
- `routes/tags.js` — POST 标签时 sanitize name
- `routes/talents.js` — POST/PUT 天赋池时 sanitize name

### 2. CSRF 防护 ✅

**实现方式**：Double Submit Cookie 模式（不依赖 csurf 包，csurf 已 deprecated）

**新建文件**：`backend/src/services/csrf.js`
- `generateCsrfToken()` — 生成 32 字节随机 token
- `setCsrfCookie(response, token)` — 设置 CSRF cookie（httpOnly=false 以便前端读取）
- `csrfProtection(request, response, next)` — 中间件，校验 POST/PUT/DELETE 请求的 `X-CSRF-Token` header
- `csrfTokenEndpoint(request, response)` — `GET /api/csrf-token` 端点

**前端集成**（`frontend/src/api.js`）：
- 页面加载时自动获取 CSRF token
- 所有 mutation 请求（POST/PUT/PATCH/DELETE）自动携带 `X-CSRF-Token` header
- 流式请求也携带 CSRF token

**安全特性**：
- 使用 `crypto.timingSafeEqual` 防止时序攻击
- GET/HEAD/OPTIONS 请求不校验（幂等操作）
- cookie 设置 `SameSite=Lax`、生产环境 `Secure=true`

### 3. 输入验证强化 ✅

**安装依赖**：`zod`

**新建文件**：`backend/src/validations/schemas.js`

**定义的 Schema**（共 25+ 个）：
| Schema | 用途 |
|--------|------|
| `registerSchema` / `loginSchema` | 用户注册/登录 |
| `updateProfileSchema` | 用户资料更新 |
| `createCharacterSchema` / `updateCharacterSchema` | 角色 CRUD |
| `importCharacterSchema` | 角色导入 |
| `sendMessageSchema` / `updateMessageSchema` | 消息发送/编辑 |
| `createWorldBookSchema` / `updateWorldBookSchema` | 世界书 CRUD |
| `createWorldBookEntrySchema` / `updateWorldBookEntrySchema` | 世界书条目 |
| `createPresetSchema` / `updatePresetSchema` | 预设 CRUD |
| `createModSchema` / `updateModSchema` | Mod CRUD |
| `createTagSchema` | 标签创建 |
| `saveProviderSchema` | Provider 设置 |
| `saveStatusBarSchema` | 状态栏 |
| `saveConversationSettingsSchema` | 对话设置 |
| `economyTransactionSchema` | 经济交易 |
| `createTalentPoolSchema` / `updateTalentPoolSchema` | 天赋池 |
| `addNpcMemorySchema` / `addNpcBehaviorSchema` / `updateNpcBehaviorSchema` | NPC |
| `createSaveSchema` / `renameSaveSchema` | 存档 |

**验证中间件**：`validate(schema, source)` — 工厂函数，支持 body/query/params 验证

**关键限制**：
- 角色名：50 字
- 人设/背景/世界观：10,000 字
- 消息内容：32,000 字
- 用户名：3-32 位
- 密码：6-128 位
- 标签名：30 字

### 4. 会话安全加固 ✅

**Cookie 设置**（已有，确认合规）：
- `SameSite=Lax` ✅
- `HttpOnly=true` ✅
- `Secure=true`（生产环境）✅
- `maxAge=30天` ✅

**安装依赖**：`express-rate-limit` + `cookie-parser`

**速率限制**：
- 全局 API：100 requests / 15 min（per user/IP）
- 登录/注册：5 requests / 1 min（更严格防暴力破解）

---

## 文件变更清单

### 新建文件
| 文件 | 说明 |
|------|------|
| `backend/src/services/sanitize.js` | XSS 防护 sanitize 服务 |
| `backend/src/services/csrf.js` | CSRF 防护服务 |
| `backend/src/validations/schemas.js` | Zod 输入验证 schema |

### 修改文件
| 文件 | 变更 |
|------|------|
| `backend/package.json` | 新增 dompurify, jsdom, zod, express-rate-limit, cookie-parser |
| `backend/src/server.js` | 添加 cookie-parser、rate-limit、CSRF 中间件 |
| `backend/src/routes/auth.js` | 集成 Zod 验证 |
| `backend/src/routes/characters.js` | 集成 Zod 验证 + XSS sanitize |
| `backend/src/routes/conversations.js` | 集成 Zod 验证（消息、设置、状态栏、经济、NPC、存档） |
| `backend/src/routes/worldBooks.js` | 集成 Zod 验证 + XSS sanitize |
| `backend/src/routes/presets.js` | 集成 Zod 验证 |
| `backend/src/routes/mods.js` | 集成 Zod 验证 + XSS sanitize |
| `backend/src/routes/tags.js` | 集成 Zod 验证 + XSS sanitize |
| `backend/src/routes/talents.js` | 集成 Zod 验证 + XSS sanitize |
| `backend/src/routes/settings.js` | 集成 Zod 验证 |
| `backend/src/routes/regex.js` | 添加 schema 导入 |
| `frontend/src/api.js` | CSRF token 自动获取与携带 |

### 未修改（确认无需修改）
| 文件 | 原因 |
|------|------|
| `.env` | 权限限制，不动 |
| `backend/data/` | 权限限制，不动 |
| `governance.md` | 权限限制，不动 |
| `backend/src/security.js` | Cookie 设置已合规（SameSite=Lax, HttpOnly, Secure） |

---

## 验证结果

```
npm test: 123/123 通过 ✅
npm run build: 构建成功 ✅
```

---

## 安全架构总结

```
请求流程：
  客户端
    ↓ (携带 Cookie + X-CSRF-Token)
  CORS 校验
    ↓
  cookie-parser
    ↓
  JSON body 解析
    ↓
  attachAuth（Session 解析）
    ↓
  CSRF 校验（POST/PUT/DELETE）
    ↓
  API 速率限制（100/15min）
    ↓
  登录速率限制（5/min，仅 auth 路由）
    ↓
  Zod 输入验证（schema 校验）
    ↓
  XSS sanitize（角色名、标签名等）
    ↓
  业务逻辑
```

---

*兵部 报 2026-05-25 · 呈尚书省*
