# API 端点参考

本文档列出 FLAI-TavernAI 后端提供的所有 API 端点。

---

## 基础信息

- **基础路径**: `/api`
- **认证方式**: Cookie-based Session (`flai_session`)
- **CSRF 防护**: Double-Submit Cookie (`flai_csrf` + `X-CSRF-Token` header)
- **速率限制**: 100 请求/15分钟 (IP 或用户维度)
- **内容类型**: `application/json; charset=utf-8`

---

## 健康检查

### GET /api/health

检查服务状态。

**响应**:
```json
{
  "ok": true,
  "service": "flai-tavern-backend"
}
```

---

## 认证 (/api/auth)

### POST /api/auth/register

注册新用户。

**请求体**:
```json
{
  "username": "string",
  "password": "string"
}
```

**响应**:
```json
{
  "user": {
    "id": "uuid",
    "username": "string",
    "displayName": "",
    "permissionGroup": "user",
    "permissionLabel": "用户组",
    "isRootAdmin": false,
    "avatarUrl": "",
    "createdAt": "ISO8601"
  }
}
```

### POST /api/auth/login

用户登录。

**请求体**:
```json
{
  "username": "string",
  "password": "string"
}
```

**响应**: 同注册响应，设置 `flai_session` Cookie。

### POST /api/auth/logout

用户登出。

**响应**:
```json
{
  "ok": true
}
```

### GET /api/auth/me

获取当前用户信息。

**响应**:
```json
{
  "user": {
    "id": "uuid",
    "username": "string",
    "displayName": "string",
    "permissionGroup": "user",
    "permissionLabel": "用户组",
    "isRootAdmin": false,
    "avatarUrl": "/api/avatars/asset-id",
    "createdAt": "ISO8601"
  }
}
```

---

## CSRF Token

### GET /api/csrf-token

获取 CSRF Token。

**响应**:
```json
{
  "csrfToken": "base64url-string"
}
```

---

## 用户 (/api/users)

### PUT /api/users/me/avatar

更新用户头像。

**请求体**:
```json
{
  "image": "data:image/png;base64,..."
}
```

### GET /api/users/me/profile

获取用户资料和统计。

**响应**:
```json
{
  "user": { ... },
  "stats": {
    "ownedAiCount": 0,
    "publicAiCount": 0,
    "privateAiCount": 0,
    "likeCount": 0,
    "totalUseCount": 0,
    "userCount": 0
  },
  "ownedCharacters": [...]
}
```

### PUT /api/users/me/profile

更新用户资料。

**请求体**:
```json
{
  "displayName": "string"
}
```

---

## 角色 (/api/characters)

### GET /api/characters

获取角色列表。

**查询参数**:
- `search` - 搜索关键词
- `sort` - 排序方式 (`created` | `name` | `popular`)
- `tag` - 标签筛选

### POST /api/characters

创建新角色。

**请求体**:
```json
{
  "name": "string",
  "gender": "string",
  "age": "string",
  "background": "string",
  "worldview": "string",
  "persona": "string",
  "openingMessage": "string",
  "visibility": "private",
  "tags": ["tag1", "tag2"]
}
```

### GET /api/characters/:id

获取单个角色详情。

### PATCH /api/characters/:id

更新角色信息。

### DELETE /api/characters/:id

删除角色。

### POST /api/characters/import

导入角色。

### GET /api/characters/:id/export

导出角色。

### POST /api/characters/complete-draft

AI 辅助完成角色草稿。

### PUT /api/characters/:id/favorite

收藏/取消收藏角色。

**请求体**:
```json
{
  "favorited": true
}
```

### PUT /api/characters/:id/like

点赞/取消点赞角色。

**请求体**:
```json
{
  "liked": true
}
```

---

## 角色立绘 (/api/characters/:id/images)

### GET /api/characters/:id/images

获取角色立绘列表。

### POST /api/characters/:id/images

添加立绘。

**请求体**:
```json
{
  "imageUrl": "string",
  "sceneTag": "string",
  "emotionTag": "string",
  "isDefault": false
}
```

### PUT /api/characters/:id/images/:imageId

更新立绘。

### DELETE /api/characters/:id/images/:imageId

删除立绘。

### PUT /api/characters/:id/images/order

重新排序立绘。

**请求体**:
```json
{
  "orderedIds": ["id1", "id2", "id3"]
}
```

---

## 对话 (/api/conversations)

### GET /api/conversations

获取对话列表。

**查询参数**:
- `characterId` - 按角色筛选

### POST /api/conversations

创建新对话。

**请求体**:
```json
{
  "characterId": "uuid"
}
```

### DELETE /api/conversations/:id

删除对话。

### POST /api/conversations/bulk-delete

批量删除对话。

**请求体**:
```json
{
  "ids": ["id1", "id2"]
}
```

### GET /api/conversations/:id/messages

获取对话消息列表。

### POST /api/conversations/:id/messages

发送消息（支持流式响应）。

**请求体**:
```json
{
  "content": "string",
  "stream": true
}
```

**流式响应** (SSE):
```
event: reasoning
data: {"text": "思考中..."}

event: content
data: {"text": "回复内容"}

event: usage
data: {"prompt_tokens": 100, "completion_tokens": 50}

event: done
data: {}
```

### PATCH /api/conversations/:id/messages/:messageId

更新消息内容。

### DELETE /api/conversations/:id/messages/:messageId

删除消息。

### GET /api/conversations/:id/settings

获取对话设置。

### PUT /api/conversations/:id/settings

更新对话设置。

**请求体**:
```json
{
  "desktopBackgroundUrl": "string",
  "mobileBackgroundUrl": "string",
  "customCss": "string",
  "customJs": "string",
  "userAdvancedSettings": {}
}
```

---

## 对话分支 (/api/conversations/:id/branch)

### POST /api/conversations/:id/branch

从指定消息创建分支对话。

**请求体**:
```json
{
  "messageId": "uuid"
}
```

### GET /api/conversations/:id/branches

获取对话的所有分支。

---

## 消息滑动 (/api/messages)

### GET /api/messages/:id/swipes

获取消息的所有滑动回复。

### POST /api/messages/:id/swipes

为消息生成新的滑动回复。

### PUT /api/messages/:id/swipes/active

设置活跃的滑动回复。

**请求体**:
```json
{
  "swipeId": "uuid"
}
```

---

## 存档 (/api/saves)

### GET /api/conversations/:id/saves

获取对话的存档列表。

### POST /api/conversations/:id/saves

创建存档。

**请求体**:
```json
{
  "name": "存档名称"
}
```

### GET /api/saves/:id

获取存档详情。

### POST /api/saves/:id/load

加载存档。

### PUT /api/saves/:id

重命名存档。

### DELETE /api/saves/:id

删除存档。

---

## 世界书 (/api/world-books)

### GET /api/world-books

获取世界书列表。

### POST /api/world-books

创建世界书。

**请求体**:
```json
{
  "name": "string",
  "description": "string"
}
```

### GET /api/world-books/:id

获取世界书详情（含条目）。

### PUT /api/world-books/:id

更新世界书。

**请求体**:
```json
{
  "name": "string",
  "description": "string",
  "scanDepth": 2,
  "lorebookContextPercent": 25
}
```

### DELETE /api/world-books/:id

删除世界书。

### POST /api/world-books/:id/entries

创建世界书条目。

**请求体**:
```json
{
  "name": "string",
  "triggerKeys": "key1, key2",
  "content": "string",
  "position": "before_char",
  "enabled": true,
  "alwaysActive": false,
  "regexMode": false,
  "selective": false,
  "selectiveLogic": 0,
  "keysSecondary": "",
  "probability": 100,
  "useProbability": false,
  "inclusionGroup": "",
  "groupWeight": 0,
  "role": 0,
  "depth": 0,
  "sticky": null,
  "cooldown": null,
  "delay": null
}
```

### PUT /api/world-books/:id/entries/:entryId

更新世界书条目。

### DELETE /api/world-books/:id/entries/:entryId

删除世界书条目。

### POST /api/world-books/:id/link/:characterId

将世界书关联到角色。

### DELETE /api/world-books/:id/link/:characterId

取消世界书与角色的关联。

### GET /api/world-books/by-character/:characterId

获取角色关联的所有世界书。

---

## 预设 (/api/presets)

### GET /api/presets

获取预设列表。

### POST /api/presets

创建预设。

**请求体**:
```json
{
  "name": "string",
  "systemPrompt": "string",
  "temperature": 1.0,
  "maxTokens": 4096,
  "topP": 1.0,
  "frequencyPenalty": 0,
  "presencePenalty": 0
}
```

### GET /api/presets/:id

获取预设详情。

### PUT /api/presets/:id

更新预设。

### DELETE /api/presets/:id

删除预设。

### POST /api/presets/:id/set-default

设置默认预设。

---

## 正则规则 (/api/regex-rules)

### GET /api/regex-rules

获取正则规则列表。

**查询参数**:
- `group` - 按分组筛选

### POST /api/regex-rules

创建正则规则。

**请求体**:
```json
{
  "label": "string",
  "pattern": "string",
  "replacement": "string",
  "flags": "g",
  "scope": "input",
  "enabled": true,
  "characterId": "",
  "groupName": "全局",
  "priority": 0,
  "scriptMode": false,
  "jsScript": ""
}
```

### PUT /api/regex-rules/:id/toggle

切换规则启用状态。

### PUT /api/regex-rules/order

重新排序规则。

**请求体**:
```json
{
  "orderedIds": ["id1", "id2"]
}
```

### POST /api/regex-rules/import

导入正则规则集。

### POST /api/regex-rules/test

测试正则规则。

**请求体**:
```json
{
  "pattern": "string",
  "flags": "g",
  "input": "test string",
  "replacement": "string"
}
```

---

## Mod (/api/mods)

### GET /api/mods

获取 Mod 列表。

### POST /api/mods

创建 Mod。

**请求体**:
```json
{
  "name": "string",
  "description": "string",
  "type": "prompt_inject",
  "content": "string",
  "enabled": true
}
```

### PUT /api/mods/:id

更新 Mod。

### DELETE /api/mods/:id

删除 Mod。

### PUT /api/mods/order

重新排序 Mod。

---

## 标签 (/api/tags)

### GET /api/tags

获取标签列表。

### POST /api/tags

创建标签。

**请求体**:
```json
{
  "name": "string",
  "color": "#hex"
}
```

### DELETE /api/tags/:id

删除标签。

---

## 天赋池 (/api/talent-pools)

### GET /api/talent-pools

获取天赋池列表。

### POST /api/talent-pools

创建天赋池。

**请求体**:
```json
{
  "name": "string",
  "description": "string",
  "talentsJson": [...]
}
```

### PUT /api/talent-pools/:id

更新天赋池。

### DELETE /api/talent-pools/:id

删除天赋池。

---

## 角色天赋 (/api/characters/:id/talents)

### POST /api/characters/:id/roll-talent

为角色抽取天赋。

**请求体**:
```json
{
  "poolId": "uuid"
}
```

### GET /api/characters/:id/talents

获取角色的天赋列表。

### DELETE /api/characters/:id/talents/:talentId

删除角色天赋。

### DELETE /api/characters/:id/talents

清空角色所有天赋。

---

## 经济系统 (/api/conversations/:id/economy)

### GET /api/conversations/:id/economy

获取对话的经济账户。

**查询参数**:
- `ensure` - 是否自动创建 (`0` 禁用)

### POST /api/conversations/:id/economy/transaction

创建经济交易。

**请求体**:
```json
{
  "currencyType": "gold",
  "amount": 10.5,
  "type": "earn",
  "description": "完成任务",
  "relatedNpc": "商人"
}
```

### GET /api/conversations/:id/economy/history

获取交易历史。

**查询参数**:
- `limit` - 返回数量
- `offset` - 偏移量
- `currencyType` - 货币类型

---

## 状态栏 (/api/conversations/:id/status-bar)

### GET /api/conversations/:id/status-bar

获取对话状态栏配置。

### PUT /api/conversations/:id/status-bar

更新状态栏配置。

**请求体**:
```json
{
  "name": "状态栏",
  "variables": [...],
  "template": "string"
}
```

### DELETE /api/conversations/:id/status-bar

删除状态栏。

---

## NPC 代理 (/api/conversations/:id/npcs)

### GET /api/conversations/:id/npcs

获取对话中的 NPC 列表。

### GET /api/conversations/:id/npcs/:name/memories

获取 NPC 记忆。

### POST /api/conversations/:id/npcs/:name/memories

添加 NPC 记忆。

### DELETE /api/conversations/:id/npcs/:name/memories/:memoryId

删除 NPC 记忆。

### GET /api/conversations/:id/npcs/:name/behaviors

获取 NPC 行为配置。

### POST /api/conversations/:id/npcs/:name/behaviors

添加 NPC 行为。

### PUT /api/conversations/:id/npcs/:name/behaviors/:behaviorId

更新 NPC 行为。

### DELETE /api/conversations/:id/npcs/:name/behaviors/:behaviorId

删除 NPC 行为。

---

## AI Provider (/api/providers)

### POST /api/providers/models

获取可用模型列表。

**请求体**:
```json
{
  "providerType": "openai",
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "sk-..."
}
```

### GET /api/providers/deepseek/balance

查询 DeepSeek 账户余额。

---

## 设置 (/api/settings)

### GET /api/settings/provider

获取当前用户的 AI Provider 配置。

### PUT /api/settings/provider

更新 AI Provider 配置。

**请求体**:
```json
{
  "providerType": "openai",
  "gatewayName": "OpenAI",
  "baseUrl": "https://api.openai.com/v1",
  "model": "gpt-4.1-mini",
  "apiKey": "sk-...",
  "supportsReasoning": false,
  "extraBody": {}
}
```

---

## 管理员 (/api/admin)

### POST /api/admin/backup

手动创建数据库备份（需要 root admin 权限）。

### GET /api/admin/backups

获取备份列表（需要 root admin 权限）。

---

## 错误响应格式

所有错误响应遵循统一格式：

```json
{
  "error": "错误描述信息"
}
```

### 常见 HTTP 状态码

| 状态码 | 含义 |
|--------|------|
| 200 | 成功 |
| 201 | 创建成功 |
| 304 | 未修改 (ETag 缓存) |
| 400 | 请求错误 |
| 401 | 未登录 |
| 403 | CSRF 验证失败或权限不足 |
| 404 | 资源不存在 |
| 429 | 请求过于频繁 |
| 500 | 服务器错误 |
