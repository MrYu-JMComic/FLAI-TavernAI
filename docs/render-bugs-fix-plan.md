# 渲染问题修复计划

## 目标

修复项目审查确认的世界书助手 Markdown 展示、状态栏长标签窄屏裁切问题，并更新 Markdown 换行改动后失效的静态契约测试。

## 范围

- 世界书助手的用户输入继续保留原始换行；助手回复复用共享 Markdown 渲染组件。
- 自定义状态栏标签在窄屏可换行并给数值保留可读空间。
- 共享 Markdown 渲染入口识别模型输出的单/双反斜杠换行标记，同时保留行内和围栏代码中的标记。
- MarkdownContent 折叠插件测试验证当前 LF 归一化实现，不再要求旧 CR 扫描结构。
- 为两处渲染行为增加浏览器回归覆盖。

## 检查清单

- [x] 检查已有未提交改动，保护用户工作。
- [x] 世界书助手按消息角色渲染文本，并覆盖 Markdown 和源换行行为。
- [x] 状态栏标签在窄屏换行、不裁切数值，并添加长标签浏览器覆盖。
- [x] 规范化字面 `\n` / `\\n` 换行及空行，同时不改写行内代码和围栏代码。
- [x] 更新 MarkdownContent 折叠渲染静态契约测试。
- [x] 运行前端构建、受影响单元/E2E 测试、后端测试、编码及差异检查。
- [x] 检查桌面与手机截图并记录路径、视口和结果；更新本计划。
- [x] 运行项目 review gate 并记录结果。

## 验收标准

- 助手回复中的粗体、列表、引用和单换行按共享 Markdown 规则显示；用户需求仍以纯文本显示并保留换行。
- 状态栏长标签可读，不覆盖或裁掉数值；桌面与手机无横向溢出。
- 字面单/双反斜杠换行标记显示为换行；代码中的相同标记保持原样。
- MarkdownContent 相关后端契约测试与后端全量测试通过。
- 前端构建和新增浏览器回归测试通过，截图检查无裁切、重叠或间距异常。
- UTF-8 编码检查与 `git diff --check` 通过。

## 验证命令

- 在 `frontend` 执行 `npm run build`、相关 Vitest 与 Playwright 测试。
- 在 `backend` 执行 `npm test`。
- 在仓库根目录执行 `node scripts/check-encoding.mjs` 和 `git diff --check`。

## 验证记录

- 初始审查：全量 Playwright E2E 98 项通过；后端全量测试因 `frontendMarkdownContent.test.js` 仍断言旧 CR 扫描源码结构而失败。
- 当前变更前确认工作区包含大量未提交改动；仅编辑本计划列明的相关组件、样式与测试。
- `MarkdownContent` 单测 7/7 通过；前端全量单测 32 个文件、326/326 通过；`npm run build` 通过，只有既有的大 chunk 体积警告。
- 相关 Playwright 测试 6/6 通过：聊天换行、世界书助手 4 项、状态栏长标签；桌面/手机截图显示模型转义换行、代码示例和窄屏状态栏正常。
- 后端全量测试 1,670/1,670 通过；编码检查扫描 720 个文件通过；`git diff --check` 通过（Git 提示工作区文件可能由 LF 转回 CRLF）。
- 截图检查视口：聊天 1440x900 / 390x844；世界书助手 1440x1000 / 390x844；状态栏长标签 1440x900 / 390x844。
- 聊天截图：`.runtime-check/playwright-results/chat-newline-rendering-ren-1fea5-ently-on-desktop-and-mobile-chromium/chat-newlines-desktop.png`、`chat-newlines-mobile.png`。
- 世界书助手截图：`.runtime-check/playwright-results/worldbook-assistant-select-bd14e--atomic-apply-and-follow-up-chromium/worldbook-desktop.png`、`worldbook-mobile-conversation.png`。
- 状态栏截图：`.runtime-check/playwright-results/status-bar-long-label-long-7b767-alues-on-desktop-and-mobile-chromium/status-bar-long-label-desktop.png`、`status-bar-long-label-mobile.png`。
- Review gate：99/99 项 Playwright E2E、前端单测、构建、后端测试通过；gate 最终因前端依赖审计失败。审计报告 `markdown-it` 15.0.0-15.0.2 与 `vite` 8.2.0-8.2.2 各有高危公告，修复 Vite 需要升级到当前声明范围外的 8.3.5，本次没有改动已有依赖文件。
- Review gate 另报告两个潜在未引用组件及 `AiPlanReview.vue:98` textarea 缺少可访问标签；这些诊断不属于本次渲染修复范围。
