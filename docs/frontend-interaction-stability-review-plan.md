# 前端交互稳定性审查计划

## 目标

检测整个项目中前端交互的确定性稳定性缺陷，覆盖聊天、首页/世界书、角色与设置、认证、管理、公共组件、路由和全局布局等主要用户路径，并为每个缺陷保留代码依据或可复现步骤。

## 范围

- 以整个 `frontend/src`、`frontend/e2e` 和相关路由/公共组件为审查范围；现有未提交前端修改作为重点回归风险，但不限制审查范围。
- 检查异步请求竞态、重复操作、导航与模态状态、焦点/键盘/移动端视口、事件监听和组件卸载。
- 运行前端单元测试；根据结果决定是否运行针对性 E2E 或静态检查。
- 不在本次审查中修改产品源代码。

## 检查清单

- [x] 检查 Git 状态、前端入口和现有回归用例。
- [x] 审查聊天与消息流交互。
- [x] 审查首页、世界书和会话侧栏交互。
- [x] 审查角色编辑、助手、认证、设置和管理页面交互。
- [x] 审查公共组件、路由切换、全局布局和跨页面状态。
- [x] 运行前端单元测试和完整 Playwright E2E；对两个不稳定结果做单 worker 复核。
- [x] 记录每个缺陷的严重程度、文件位置、触发条件、实际影响和验证证据。

## 验收标准

- 缺陷按严重程度排序，避免把纯样式偏好当作稳定性问题。
- 每个缺陷都能由代码路径或测试/浏览器行为解释，且说明当前工作树改动是否相关。
- 明确记录未运行或受环境限制的验证项。

## 验证命令

- `npm run test:unit`（`frontend`）
- `npm run build`（`frontend`，如不覆盖用户产物且时间允许）
- 针对性 `npm run test:e2e -- <spec>`（如需要真实交互复现）
- `node scripts/check-encoding.mjs`
- `git diff --check`

## 审查结果

- `npm run test:unit`：通过，34 个测试文件、331 项测试。
- `npm run test:e2e -- --output ../.runtime-check/frontend-stability-20261023`：首轮 102/109 通过，7 项失败。头像保存用例单 worker 定向重跑通过；`character-assistant-viewport` 的导航断言单 worker 下仍失败，测试查询 `个人设置分区`，而页面 `aria-label` 实际为 `个人设置`，这是过期选择器。其余失败包含焦点样式、页面标签/标题假设及主题对比度断言，不能都视为交互稳定性缺陷。产物目录：`.runtime-check/frontend-stability-20261023`；单项复核：`.runtime-check/frontend-stability-targeted-20261024`。
- Home 深色主题主要按钮前景 `#fffaf7`、背景 `#d98775` 的对比度为 2.64:1，低于 4.5:1。此项是可验证的可访问性问题，单独列出，不计入交互稳定性缺陷数量。
- 已检查聊天/助手/世界书/Home/设置/管理/全局布局和公共状态生命周期，覆盖整个前端而非仅限当前未提交文件。确认以下交互稳定性缺陷（P2）：
  - `frontend/src/views/WorldBookView.vue:235`、`frontend/src/composables/worldbook/useWorldBookAi.js:41`：世界书列表和详情各自持有 AI 草稿、计划和历史；路由切换会重建视图实例，卸载时取消 AI，导致尚未应用的工作丢失。复现：在列表生成未应用结果或计划后打开一本书。
  - `frontend/src/views/HomeView.vue:730`、`frontend/src/views/HomeView.vue:813`：列表请求 token 不会因收藏/点赞保存而失效，较早的筛选响应可覆盖 reaction 响应，界面显示回退。复现：延迟筛选响应期间收藏或点赞同一角色。
  - `frontend/src/views/WorldBookView.vue:753`：换序通过两个独立请求交换 `orderIndex`；任一请求失败时只显示错误、不重载数据，服务端可能只完成一半交换。复现：让两项更新中的一个失败后移动条目。
  - `frontend/src/composables/character/useCharacterAssistantSessions.js:124`、`frontend/src/composables/character/useCharacterAssistantSessions.js:248`：切换助手会话时旧版本请求会继续占用 `versionsLoading`；新会话打开历史时加载被跳过，旧响应又因会话 ID 不匹配被丢弃，历史列表保持空白。复现：A 会话历史请求未完成时切换到 B 并立即打开历史。
  - `frontend/src/components/CharacterImagePanel.vue:333`：设置默认立绘先清除旧默认、再设置新默认；第二个请求失败时没有默认立绘。复现：使设置新默认的第二个 API 请求失败。
  - `frontend/src/views/ChatView.vue:1266`：首屏消息加载完成后 composer 已可交互，但视口/键盘监听要等侧栏和余额等串行请求全部完成才注册。慢网络下打开手机键盘时聊天区暂时不能跟随 visual viewport。复现依据：`loadConversation` 在 `:702` 解除 loading 后仍等待辅助请求（`:711-718`）。
  - `frontend/src/components/chat/ChatComposer.vue:80`、`frontend/src/views/ChatView.vue:964`：响应模式菜单的 Escape handler 关闭菜单但不停止事件传播，事件继续到 window 并关闭桌面侧栏。复现：桌面侧栏打开时展开响应模式菜单并按一次 Escape。
- 上述 ChatView 是当前有未提交改动的审查文件；其余列出的缺陷文件在本次状态检查中没有未提交改动。报告仅记录当前工作树观察结果，未修改产品源代码。
- 不运行前端构建：构建会覆盖现有 `frontend/dist`，该目录受仓库指示保护。
