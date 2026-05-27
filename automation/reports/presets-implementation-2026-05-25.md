# FLAI-TavernAI 对话模板/预设系统 (Presets) 实现报告

**日期**: 2026-05-25
**任务**: 为 FLAI-TavernAI 项目实现「对话模板/预设系统 (Presets)」

---

## 一、修改文件清单

### 后端 (7 文件)

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/src/modules/presets.js` | **新建** | 预设 CRUD 模块，包含 listPresets、getPreset、createPreset、updatePreset、deletePreset、setDefaultPreset、getDefaultPreset |
| `backend/src/db.js` | 修改 | 新增 `presets` 表（id, user_id, name, system_prompt, temperature, max_tokens, top_p, frequency_penalty, presence_penalty, is_default, created_at, updated_at） |
| `backend/src/server.js` | 修改 | 新增 6 个 API 路由 + 聊天时自动应用预设参数 + buildModelMessages 支持 presetSystemPrompt |
| `backend/src/services/providers.js` | 修改 | buildProviderBody 新增 temperature/maxTokens/topP/frequencyPenalty/presencePenalty 参数支持 |
| `backend/src/tests/backend.test.js` | 修改 | 新增 4 个测试：presets CRUD、name validation、ownership isolation、buildProviderBody preset params |

### 前端 (4 文件)

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/api.js` | 修改 | 新增 fetchPresets、createPreset、fetchPreset、updatePreset、deletePreset、setDefaultPreset |
| `frontend/src/views/SettingsView.vue` | 修改 | 新增「对话预设」管理区块（卡片列表、创建/编辑/删除、系统提示词编辑器、参数滑块、设为默认、导入/导出 JSON） |
| `frontend/src/views/ChatView.vue` | 修改 | 新增预设选择器下拉菜单，聊天时自动传递 presetId |
| `frontend/src/styles.css` | 修改 | 新增预设管理、预设卡片、预设选择器相关样式 |

---

## 二、API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/presets` | 列出当前用户的所有预设 |
| POST | `/api/presets` | 创建新预设 |
| GET | `/api/presets/:id` | 获取预设详情 |
| PUT | `/api/presets/:id` | 更新预设 |
| DELETE | `/api/presets/:id` | 删除预设 |
| POST | `/api/presets/:id/set-default` | 设为默认预设 |

---

## 三、测试结果

### 后端测试

```
✔ 30/30 全部通过 (292ms)
新增测试:
  - presets CRUD with default management
  - preset name validation and defaults
  - preset ownership isolation
  - buildProviderBody applies preset parameters
```

### 前端构建

```
✓ built in 414ms
所有模块正常编译，无错误。
```

---

## 四、功能特性

### 预设管理 (SettingsView)
- **卡片式列表**: 展示所有预设，默认预设有高亮边框
- **创建/编辑**: 表单包含名称、系统提示词（textarea）、参数滑块
- **参数滑块**: temperature (0-2)、max_tokens、top_p (0-1)、frequency_penalty (-2~2)、presence_penalty (-2~2)
- **设为默认**: 一键切换默认预设（互斥）
- **导入/导出**: JSON 格式，支持文件导入和下载导出

### 聊天应用 (ChatView)
- **预设选择器**: 下拉菜单位于聊天输入区，显示预设名称和默认标记
- **即时生效**: 选择预设后，下一条消息即使用该预设参数
- **自动默认**: 如果不手动选择，自动使用用户的默认预设
- **参数传递**: temperature、max_tokens、top_p、frequency_penalty、presence_penalty 传递到 API
- **系统提示词**: 预设的 system_prompt 作为额外的 system 消息注入

### 数据库设计
- `presets` 表使用外键关联 `users` 表，级联删除
- `is_default` 字段互斥：设为默认时自动清除其他默认标记
- 支持 user_id 索引优化查询

---

## 五、技术实现细节

### 预设应用流程
1. 用户发送消息时，前端传递 `presetId`（可选）
2. 后端解析 presetId：如果提供则加载指定预设，否则加载用户的默认预设
3. 预设的 `system_prompt` 作为额外的 system 消息注入到 modelMessages
4. 预设参数（temperature 等）通过 `aiOptions` 传递到 `buildProviderBody`
5. `buildProviderBody` 将参数写入 API 请求体

### 安全隔离
- 所有 API 端点都需要登录认证 (`requireAuth`)
- 用户只能操作自己的预设（user_id 过滤）
- 预设名称长度限制 80 字符，参数值有范围限制

---

## 六、下一步建议

1. **预设与对话绑定**: 可以在 conversations 表增加 `preset_id` 字段，记住每个对话使用的预设
2. **预设模板**: 内置几个常用预设模板（创意写作、精确翻译、代码助手等）
3. **预设分享**: 支持公开预设，用户可以浏览和复制他人的预设
4. **参数预览**: 在聊天界面显示当前生效的预设参数摘要
5. **预设分类**: 支持按用途分类（写作、编程、翻译等）
