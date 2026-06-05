## 批次2 兵部任务：安全加固

**项目位置：** D:\Cat\FLAI-TavernAI
**禁止修改：** .env、backend/data、node_modules、governance.md

### 1. XSS 防护
- 安装 DOMPurify: npm install dompurify
- 对所有用户输入做 sanitize（前端渲染用户内容前调用 DOMPurify.sanitize()）
- 重点区域：聊天消息显示、用户名显示、自定义输入框

### 2. CSRF 防护
- 添加 CSRF token 机制到所有状态变更请求（POST/PUT/DELETE）
- 使用 csurf 或自实现 token 生成+验证
- 在前端表单和 fetch 请求中携带 CSRF token
- 后端中间件验证 token

### 3. 输入验证强化
- 安装 zod: npm install zod
- 对 API 端点做 schema 验证（请求体、查询参数）
- 重点覆盖：登录、注册、消息发送、角色创建等关键端点
- 验证失败返回 400 + 明确错误信息

### 4. 会话安全加固
- Cookie 设置：SameSite=Lax + HttpOnly + Secure
- 添加速率限制：npm install express-rate-limit
- 登录端点限制（如 5次/15分钟）
- API 端点通用限制

### 验证要求
- npm test 必须通过
- npm run build 必须通过
- 写报告到 D:\Cat\FLAI-TavernAI\automation\reports\batch2-bingbu-security.md

### ⚠️ 禁止
- 不动 .env
- 不动 backend/data
- 不动 node_modules（通过 npm install 自然修改除外）
- 不动 governance.md
