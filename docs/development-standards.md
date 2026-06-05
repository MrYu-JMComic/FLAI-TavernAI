# 项目开发规范

本文档定义 FLAI-TavernAI 项目的编码标准、提交规范和质量要求。

---

## 代码风格

### ESLint 规则

项目当前未配置 ESLint，但遵循以下约定：

- **缩进**: 2 空格（与 `.editorconfig` 一致）
- **引号**: 单引号 `'`（JavaScript / Vue）
- **分号**: 使用分号
- **尾逗号**: 多行结构使用尾逗号
- **最大行宽**: 建议 120 字符

### 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 文件名（组件） | PascalCase | `ChatView.vue`、`BaseLayout.vue` |
| 文件名（模块） | camelCase | `worldBooks.js`、`providers.js` |
| 文件名（路由） | camelCase | `conversations.js`、`characters.js` |
| Vue 组件 | PascalCase | `<ChatView />`、`<BaseLayout />` |
| JavaScript 函数 | camelCase | `buildWorldBookContext()`、`getRegexRules()` |
| 常量 | UPPER_SNAKE_CASE | `sessionCookieName`、`csrfHeaderName` |
| 数据库表 | snake_case | `world_book_entries`、`character_tags` |
| 数据库列 | snake_case | `created_at`、`user_id`、`order_index` |
| CSS 类名 | kebab-case | `.chat-message`、`.world-book-entry` |
| API 路径 | kebab-case | `/api/world-books`、 `/api/regex-rules` |

### Vue 组件规范

- 使用 `<script setup>` 语法（Composition API）
- Props 使用 `defineProps()` 声明
- Emits 使用 `defineEmits()` 声明
- 异步组件使用 `defineAsyncComponent()` 懒加载

```vue
<script setup>
import { ref, computed, onMounted } from 'vue';

const props = defineProps({ id: String });
const emit = defineEmits(['navigate', 'saved']);

const data = ref(null);
const isLoading = computed(() => !data.value);
</script>
```

### 后端模块规范

- 使用 ES Modules（`"type": "module"`）
- 路由模块导出工厂函数：`export function createXxxRouter(ctx)`
- 数据库操作使用 `node:sqlite` 的 `DatabaseSync` API
- 错误处理使用 `asyncRoute()` 包装

```javascript
// 路由模块示例
export function createWorldBooksRouter(ctx) {
  const router = Router();
  const { db, requireAuth, asyncRoute, newId, nowIso } = ctx;
  // ...
  return router;
}
```

---

## 文件编码要求

### 强制 UTF-8

所有源代码和文档文件**必须**使用 UTF-8 编码保存。

**禁止**使用以下编码：
- ❌ GBK / GB2312
- ❌ ANSI
- ❌ PowerShell 默认遗留编码

### 编码检查

每次代码变更完成后，必须运行编码检查：

```bash
node scripts/check-encoding.mjs
```

该脚本会扫描项目中所有 `.js`、`.vue`、`.css`、`.html`、`.json`、`.md`、`.mjs`、`.cjs`、`.ps1`、`.ts`、`.tsx`、`.jsx` 文件，检测常见的中文乱码特征字符。

### 编码检查集成

编码检查已集成到以下流程：

- `backend/package.json` → `pretest` 脚本自动运行
- `frontend/package.json` → `prebuild` 脚本自动运行
- `scripts/review-gate.ps1` → 门下省审核时自动运行

### .editorconfig 配置

```ini
root = true

[*]
charset = utf-8
end_of_line = crlf
insert_final_newline = true

[*.{js,jsx,ts,tsx,vue,css,html,json,md,py,ps1,mjs,cjs}]
charset = utf-8
```

---

## Git 提交规范

### 提交消息格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type 类型

| Type | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复 bug |
| `docs` | 文档变更 |
| `style` | 代码格式调整（不影响逻辑） |
| `refactor` | 重构（不新增功能、不修复 bug） |
| `test` | 测试相关 |
| `chore` | 构建、工具链变更 |

### Scope 范围

| Scope | 说明 |
|-------|------|
| `frontend` | 前端变更 |
| `backend` | 后端变更 |
| `db` | 数据库相关 |
| `auth` | 认证/安全相关 |
| `wb` | 世界书引擎 |
| `chat` | 聊天功能 |
| `ui` | UI/UX 变更 |

### 示例

```
feat(backend): 添加世界书 token 预算管理

根据 context size 和 lorebookContextPercent 计算世界书 token 预算，
按 order 升序插入，超出截断。

Closes #42
```

---

## 测试要求

### 后端测试

```bash
cd backend
npm test
```

- 测试文件位于 `backend/src/tests/`
- 使用 Node.js 内置测试框架（`node:test`）
- 测试运行前自动执行编码检查（`pretest` 脚本）
- **所有测试必须通过**才能报告任务完成

### 现有测试文件

| 文件 | 覆盖范围 |
|------|----------|
| `backend.test.js` | 核心后端功能 |
| `accessoryAgents.test.js` | 附属代理系统 |
| `characterImages.test.js` | 角色立绘系统 |
| `economy.test.js` | 经济系统 |
| `npcs.test.js` | NPC 代理引擎 |

### 前端构建验证

```bash
cd frontend
npm run build
```

- 构建前自动执行编码检查（`prebuild` 脚本）
- 构建产物输出到 `frontend/dist/`
- **构建必须成功**才能报告任务完成

---

## 编码检查流程

### 完整验证清单

每次代码变更后，按以下顺序验证：

```bash
# 1. 编码检查
node scripts/check-encoding.mjs

# 2. 后端测试
cd backend && npm test

# 3. 前端构建
cd frontend && npm run build
```

### 门下省审核

门下省审核时运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1
```

该脚本会自动执行：
1. 编码检查
2. 后端测试
3. 前端构建
4. 生成审核报告

### 编码修复指南

如果编码检查失败：

1. 检查报告中指出的文件和行号
2. 用 UTF-8 编码重新保存文件
3. 确保编辑器设置为 UTF-8 模式
4. 重新运行 `node scripts/check-encoding.mjs` 验证

---

## 依赖管理

### 后端依赖

```json
{
  "express": "5.2.1",
  "dotenv": "17.4.2",
  "cors": "2.8.6",
  "cookie-parser": "^1.4.7",
  "compression": "^1.8.1",
  "express-rate-limit": "^8.5.2",
  "csrf": "^3.1.0",
  "dompurify": "^3.4.5",
  "jsdom": "^29.1.1",
  "zod": "^4.4.3"
}
```

### 前端依赖

```json
{
  "vue": "3.5.34",
  "@lucide/vue": "1.16.0",
  "@tanstack/vue-virtual": "^3.13.2",
  "markdown-it": "^14.1.0",
  "highlight.js": "^11.11.1",
  "dompurify": "^3.4.5"
}
```

### 开发依赖

```json
{
  "vite": "8.0.14",
  "@vitejs/plugin-vue": "6.0.7"
}
```

### 版本升级规则

- 升级前记录当前版本和目标版本
- 升级后运行完整测试套件
- 升级报告写入 `automation/reports/`
