# CG 立绘系统实现报告

**日期**: 2026-05-25  
**执行者**: libu (礼部执行 agent)

---

## 概述

为 FLAI-TavernAI 实现了完整的「CG 立绘系统」，包括后端 API、数据库表、前端管理面板和聊天场景自动切换。

---

## 后端实现

### 1. 数据库表 `character_images`

在 `db.js` 中新增表：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 唯一标识 |
| character_id | TEXT FK | 关联角色 (ON DELETE CASCADE) |
| image_url | TEXT | 图片 URL/data URL |
| scene_tag | TEXT | 场景标签 (如: 日常/学校/战斗) |
| emotion_tag | TEXT | 情绪标签 (如: 开心/悲伤/愤怒) |
| is_default | INTEGER | 是否默认立绘 |
| order_index | INTEGER | 排序序号 |
| created_at | TEXT | 创建时间 |

索引: `idx_character_images_character(character_id)`

### 2. 新模块 `characterImages.js`

**文件**: `backend/src/modules/characterImages.js`

**CRUD 函数**:
- `listCharacterImages(database, characterId)` — 获取角色所有立绘
- `createCharacterImage(database, { characterId, imageUrl, sceneTag, emotionTag, isDefault })` — 创建立绘 (限 20 张/角色)
- `updateCharacterImage(database, characterId, imageId, { sceneTag, emotionTag, isDefault })` — 更新标签
- `deleteCharacterImage(database, characterId, imageId)` — 删除并自动重排序
- `reorderCharacterImages(database, characterId, orderedIds)` — 批量排序

**场景检测**:
- `detectSceneAndEmotion(text)` — 从 AI 回复文本中检测场景和情绪关键词
  - 12 种场景: 日常、学校、街道、家里、餐厅、战斗、夜晚、雨天、雪天、海边、森林、节日
  - 10 种情绪: 开心、悲伤、愤怒、惊讶、害羞、害怕、温柔、严肃、困倦、得意
- `findBestMatch(images, sceneTag, emotionTag)` — 按优先级匹配: 场景+情绪 > 场景 > 情绪 > 默认 > 第一张

### 3. API 端点 (在 `server.js` 中)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/characters/:id/images` | 获取角色所有立绘 |
| POST | `/api/characters/:id/images` | 上传立绘 (需拥有者权限) |
| PUT | `/api/characters/:id/images/:imageId` | 更新立绘标签 |
| DELETE | `/api/characters/:id/images/:imageId` | 删除立绘 |
| PUT | `/api/characters/:id/images/order` | 批量排序 |

所有端点要求登录认证，写操作要求角色拥有者权限。

### 4. 场景自动切换

在 `saveAssistantResult` 函数中:
1. AI 回复保存后，自动调用 `detectSceneAndEmotion(content)`
2. 使用 `findBestMatch` 查找最佳匹配立绘
3. 将匹配的立绘信息附加到 `assistantMessage._cgImage`
4. 流式和非流式响应均会返回 CG 信息

---

## 前端实现

### 1. API 函数 (`api.js`)

新增:
- `fetchCharacterImages(characterId)`
- `createCharacterImage(characterId, payload)`
- `updateCharacterImage(characterId, imageId, payload)`
- `deleteCharacterImage(characterId, imageId)`
- `reorderCharacterImages(characterId, orderedIds)`

### 2. 管理面板 (`CharacterImagePanel.vue`)

**文件**: `frontend/src/components/CharacterImagePanel.vue`

功能:
- **图片网格展示**: 响应式网格布局，显示缩略图、场景/情绪标签
- **多图上传**: 支持同时选择多张图片，自动校验格式 (PNG/JPG/WebP) 和大小 (≤4MB)
- **标签编辑**: 场景和情绪标签通过下拉选择器编辑 (12 种场景 + 10 种情绪)
- **拖拽排序**: HTML5 原生拖拽实现排序，松手后自动保存
- **默认设置**: 星标按钮设为默认立绘
- **删除**: 带确认对话框的删除操作

集成: 在 `CharacterFormView.vue` 中仅编辑模式显示，位于正则替换面板下方。

### 3. 聊天展示 (`ChatView.vue`)

新增功能:
- **CG 立绘显示**: 在聊天区域顶部显示当前角色立绘
- **场景自动切换**: AI 回复中包含 `_cgImage` 时自动更新显示的立绘
- **预加载**: 加载对话时预加载角色所有立绘到浏览器缓存
- **默认回退**: 无匹配场景时显示默认立绘或第一张

### 4. CSS 样式

在 `styles.css` 中新增 `.cg-portrait-panel` 样式:
- 最大高度 340px，居中裁剪显示
- 底部渐变遮罩
- 标签半透明浮动显示
- 平滑过渡动画

---

## 测试

### 后端测试

**文件**: `backend/src/tests/characterImages.test.js`

8 个测试全部通过:
- ✔ character images CRUD operations
- ✔ character images reorder
- ✔ character images max limit (20 张限制)
- ✔ scene and emotion detection from text
- ✔ findBestMatch selects by scene, emotion, default, or first
- ✔ delete reorders remaining images
- ✔ character images tag normalization
- ✔ character images belong to character, not user

### 验证结果

| 检查项 | 结果 |
|--------|------|
| `npm test` (后端) | ✅ 108/108 通过 (新增 8 个) |
| `npm run build` (前端) | ✅ 构建成功 |

---

## 文件变更清单

### 新增文件
- `backend/src/modules/characterImages.js` — 立绘模块 (CRUD + 场景检测)
- `backend/src/tests/characterImages.test.js` — 单元测试
- `frontend/src/components/CharacterImagePanel.vue` — 管理面板组件

### 修改文件
- `backend/src/db.js` — 新增 `character_images` 表
- `backend/src/server.js` — 新增 5 个 API 端点 + 场景检测集成
- `frontend/src/api.js` — 新增 5 个 API 函数
- `frontend/src/views/CharacterFormView.vue` — 集成立绘管理面板
- `frontend/src/views/ChatView.vue` — 聊天中 CG 立绘显示和自动切换
- `frontend/src/styles.css` — CG 立绘样式

---

## 设计决策

1. **存储方式**: 使用 data URL 存储图片，复用现有 avatars 服务模式
2. **场景检测**: 基于关键词匹配而非 AI 调用，零延迟零成本
3. **每角色限制**: 20 张立绘，避免滥用
4. **标签系统**: 预定义 12 种场景 + 10 种情绪，兼顾覆盖度和简洁性
5. **权限控制**: 仅角色拥有者可管理立绘，所有登录用户可查看 (遵循现有 canEdit/canUse 模型)
