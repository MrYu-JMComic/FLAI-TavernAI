# Markdown 换行渲染统一计划

## 目标

统一聊天消息、思考内容和角色助手中 Markdown 文本的换行表现：单个源换行显示为一次换行，空行形成有间距的独立段落，并让不同页面使用相同的 Markdown 块间距。

## 范围

- 以共享的 `MarkdownContent` 和 MarkdownIt 渲染器为准处理消息正文。
- 为实际生成的段落、标题、列表和引用应用现有 Markdown 样式，并清除与 `<br>` 重复的 `pre-wrap` 行为。
- 保留代码块、输入框、调试文本等非 Markdown 原始文本的换行策略。
- 清理本次统一后失效或重复的相关规则与测试预期。

## 检查清单

- [x] 检查工作区状态、共享 Markdown 渲染入口及相关样式和测试。
- [x] 统一 Markdown 块样式和源换行显示，避免聊天与角色助手表现不同。
- [x] 增加覆盖单换行、空行段落及 MarkdownContent 实际 DOM 的定向测试。
- [x] 运行前端构建、相关单元/E2E 检查、编码检查及差异检查。
- [x] 在桌面与手机视口检查聊天消息换行并记录截图与结果。
- [x] 记录验证结果、剩余风险并完成计划。

## 验收标准

- Markdown 单换行只产生一次可见换行；段落空行产生一致的段落间距。
- 聊天消息和角色助手共享一致的 Markdown 块样式。
- 数学公式、代码块、列表、引用、对白高亮和安全清洗继续正常。
- 桌面及手机视口无换行造成的重复空行、内容溢出或布局重叠。
- 编码检查、前端构建及相关测试通过；截图位置和检查结果已记录。

## 验证命令

- 在 `frontend` 执行 `npm run build`。
- 在 `frontend` 执行定向 Vitest 和聊天 Playwright 检查。
- 在仓库根目录执行 `node scripts/check-encoding.mjs` 和 `git diff --check`。

## 验证记录

- 初始检查发现工作区已有大量改动；本任务限定于 Markdown 共用渲染样式、定向测试和本计划，不覆盖其他现有修改。
- `MarkdownContent` 在渲染及折叠插件扫描前把 CRLF 和 CR 统一为 LF；单个源换行仍由 MarkdownIt 输出一个 `<br>`，空行保留为独立段落。
- 为 MarkdownIt 实际输出的段落、标题、列表和引用启用共用样式；段落与引用使用正常空白折叠，避免 `<br>` 后的 HTML 格式换行被 `pre-wrap` 再显示一次。移除了聊天气泡对所有段落的 `pre-wrap` 与零间距覆盖。
- 全量前端 Vitest 通过：32 个文件、324 项测试；定向聊天浏览器检查通过：1/1；前端生产构建通过。构建仍报告 KaTeX chunk 超过 500 kB 的既有体积提示。
- 编码检查通过，扫描 718 个文件；本次文件的 `git diff --check` 通过。
- 桌面 1440x900 截图：`.runtime-check/playwright-results/chat-newline-rendering-ren-1fea5-ently-on-desktop-and-mobile-chromium/chat-newlines-desktop.png`。手机 390x844 截图：`.runtime-check/playwright-results/chat-newline-rendering-ren-1fea5-ently-on-desktop-and-mobile-chromium/chat-newlines-mobile.png`。已检查两张截图：单换行只呈现一行间隔，段落间有稳定留白，聊天与输入区没有溢出或遮挡。
- 后端未改动；未运行后端测试或全量审核门禁。
