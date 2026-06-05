# 任务规格：TAG-EDIT — 标签编辑功能（重命名 + 颜色修改）

## 任务ID
`TAG-EDIT`

## 标题
为角色卡标签系统添加编辑功能（重命名 + 颜色修改）

## 背景

FLAI-TavernAI 的标签系统已基本实现，包括：
- **后端**：`modules/tags.js` 提供 listTags / createTag / deleteTag / setCharacterTags / getCharacterTagNames
- **路由**：`routes/tags.js` 提供 GET /、POST /、DELETE /:id
- **数据库**：`tags` 表包含 `id, user_id, name, color, created_at` 字段
- **前端**：HomeView 支持标签筛选和颜色渲染，CharacterFormView 支持标签选择和创建，SettingsView 支持标签管理（创建 + 删除）

**但存在明确的功能缺口**：标签创建后无法编辑。具体表现为：
1. 后端缺少 `updateTag` 函数和 `PUT /:id` 路由
2. 前端 API（`api.js`）缺少 `updateTag` 调用
3. SettingsView 标签管理区域只有"创建"和"删除"按钮，无编辑入口
4. CharacterFormView 标签选择器不渲染标签颜色
5. 无颜色选择器组件供用户自定义标签颜色

用户创建标签后若想修改名称或颜色，只能删除重建，体验差且会丢失关联关系。

## DoD（完成定义）

- [ ] 后端 `modules/tags.js` 新增 `updateTag(database, userId, tagId, payload)` 函数，支持修改 `name` 和 `color`
- [ ] 后端 `routes/tags.js` 新增 `PUT /:id` 路由，调用 updateTag
- [ ] 前端 `api.js` 新增 `updateTag(id, payload)` 函数
- [ ] SettingsView 标签管理区域每个标签项显示编辑按钮（铅笔图标）
- [ ] 点击编辑按钮弹出内联编辑表单，支持修改标签名和颜色
- [ ] 颜色选择器使用 HTML `<input type="color">` 或简单的色板预设
- [ ] 编辑保存后标签列表即时更新，无需刷新
- [ ] 标签名去重校验：重命名为已存在的标签名时返回错误提示
- [ ] CharacterFormView 标签选择器渲染标签颜色（使用 `--tag-color` CSS 变量）
- [ ] `npm run build`（前端构建）通过
- [ ] `npm test`（后端测试）通过
- [ ] 编码检查 `node scripts/check-encoding.mjs` 通过

## 技术方案

### 1. 后端：`backend/src/modules/tags.js`

新增 `updateTag` 函数：

```javascript
export function updateTag(database, userId, tagId, payload) {
  const existing = database
    .prepare('SELECT * FROM tags WHERE id = ? AND user_id = ?')
    .get(tagId, userId);
  if (!existing) return null;

  const name = normalizeTagName(payload.name ?? existing.name);
  const color = normalizeColor(payload.color ?? existing.color);

  // 去重校验（排除自身）
  if (name !== existing.name) {
    const duplicate = database
      .prepare('SELECT id FROM tags WHERE user_id = ? AND name = ? AND id != ?')
      .get(userId, name, tagId);
    if (duplicate) throw new Error('标签名已存在');
  }

  database
    .prepare('UPDATE tags SET name = ?, color = ? WHERE id = ? AND user_id = ?')
    .run(name, color, tagId, userId);

  return { id: tagId, userId, name, color, usageCount: 0, createdAt: existing.created_at };
}
```

复用现有的 `normalizeTagName` 和 `normalizeColor` 辅助函数。

### 2. 后端路由：`backend/src/routes/tags.js`

新增 PUT /:id 路由：

```javascript
router.put('/:id', requireAuth, (request, response) => {
  try {
    const body = request.body;
    if (body.name != null) body.name = sanitizeText(body.name);
    const tag = updateTag(db, request.auth.user.id, request.params.id, body);
    if (!tag) {
      response.status(404).json({ error: '标签不存在' });
      return;
    }
    response.json(tag);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});
```

### 3. 前端 API：`frontend/src/api.js`

新增 `updateTag` 函数：

```javascript
export function updateTag(id, payload) {
  return apiRequest(`/api/tags/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}
```

### 4. 前端 UI：SettingsView 标签编辑

在 SettingsView 的标签管理区域：
- 每个标签项增加编辑按钮（Pencil 图标）
- 点击后切换为内联编辑模式：文本输入框 + 颜色选择器 + 保存/取消按钮
- 颜色选择器使用 `<input type="color">`，预设 8-12 个常用颜色色板
- 保存时调用 `updateTag(id, { name, color })`，成功后更新本地列表

### 5. 前端 UI：CharacterFormView 标签颜色

在 CharacterFormView 的标签选择器中：
- 标签徽章使用 `:style="tag.color ? { '--tag-color': tag.color } : {}"` 渲染颜色
- 与 HomeView 的渲染方式保持一致

### 涉及文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/src/modules/tags.js` | 修改 | 新增 updateTag 函数 |
| `backend/src/routes/tags.js` | 修改 | 新增 PUT /:id 路由 |
| `frontend/src/api.js` | 修改 | 新增 updateTag 函数 |
| `frontend/src/views/SettingsView.vue` | 修改 | 标签编辑 UI |
| `frontend/src/views/CharacterFormView.vue` | 修改 | 标签颜色渲染 |

## 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 标签重命名导致去重冲突 | 低 | 后端已有去重逻辑，updateTag 中排除自身 |
| 颜色值格式不合法 | 低 | 复用现有 normalizeColor 校验 |
| 编辑操作影响关联角色卡 | 无 | 修改标签名/颜色不影响 character_tags 关联关系 |
| 前端构建失败 | 低 | 改动范围小，仅新增函数和模板片段 |

**影响范围**：仅涉及标签相关模块，不影响角色卡、世界书、对话等核心功能。

## 预估工作量

**小**（约 1-2 小时）

- 后端改动：2 个文件，各新增约 15-25 行
- 前端改动：3 个文件，api.js 新增约 5 行，SettingsView 新增约 60-80 行编辑 UI，CharacterFormView 新增约 5 行颜色渲染
- 无需数据库迁移（tags 表已有 color 字段）
- 无需新增依赖
