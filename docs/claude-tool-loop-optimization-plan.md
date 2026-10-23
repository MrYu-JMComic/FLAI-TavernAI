# Claude 工具循环优化计划

## 目标

修正 Claude/CCMax 在角色助手必需工具工作流中连续输出普通文本、最终进入“模型未按工具协议完成验收”状态的问题；让 AI 完善过程可呈现“文字说明、工具调用、读取结果后的新决策、最终任务汇报”，而不是只看到连续工具和最后总结。

## 范围

- 为角色助手的规划/执行模式传递必需工具选择；自由对话继续允许自然语言结束。
- 修正 Anthropic `required` 工具选择到原生 `tool_choice` 的映射，并覆盖 OpenAI-compatible Claude/CCMax 路径。
- 将各模型轮次的可见正文安全地保留在执行轨迹中，并提示模型在有实质进展时简短汇报。
- 核对 Anthropic 多轮工具结果消息、事件重放和请求计数，避免重复推送推理或隐藏真实内部轮次。
- 增加后端回归测试，记录前端构建与编码检查结果；不修改用户已有的无关工作区改动。

## 清单

- [x] 阅读现有 Provider、角色助手和执行轨迹实现，确认失败路径。
- [x] 实现必需工具选择和 Anthropic 兼容映射。
- [x] 将安全处理后的模型正文显示在各轮过程轨迹中，并更新工作流提示。
- [x] 修正 Anthropic 多轮流式事件重放行为。
- [x] 添加工具选择、中间文字、多轮工具结果和事件顺序测试。
- [x] 运行后端测试、前端构建、编码检查、diff 检查；完成 review gate 和 E2E 检查。
- [x] 更新本计划的验证结果与剩余风险。

## 验收标准

- 非对话角色助手请求在支持工具的模型上发送必需工具选择，Claude/CCMax 不会仅因一次普通文本回复就结束工具工作流。
- Anthropic 原生请求使用合法的 `tool_choice: { type: "any" }`；OpenAI-compatible 请求保留合法的 `tool_choice: "required"`。
- 模型完成工具调用后，服务端继续发送下一轮并正确附带 `tool_result`；自然语言对话仍可在无工具回复后正常结束。
- AI 完善轨迹可显示模型在工具调用前后返回的安全正文；执行文字和工具结果按各自模型轮次排列。
- 流式执行轨迹中的每个模型步骤、工具调用、推理和结果只出现一次，前端请求仍保持单个 SSE 入口。

## 验证命令

- `npm test`（`backend`）
- `npm run build`（`frontend`）
- `node scripts/check-encoding.mjs`
- `git diff --check`
- `powershell -ExecutionPolicy Bypass -File scripts/review-gate.ps1`

## 验证记录

- `backend`: `npm test` 通过，1661/1661。
- `frontend`: `npm run build` 通过，Vite 构建 2127 个模块；保留既有 KaTeX 大 chunk 警告。
- 编码检查通过，扫描 705 个文件；`git diff --check` 通过（仅报告 Windows 换行转换提示）。
- `review-gate.ps1` 的编码、后端测试、构建、前端单元测试和 95 项 Playwright E2E 均通过；门禁最终因现有 `markdown-it` 与 `vite` 依赖审计告警返回失败，未在本任务中升级无关依赖。
- 视觉检查截图：`.runtime-check/assistant-workspace-desktop.png`（1440x900）、`.runtime-check/assistant-workspace-mobile.png`（390x844）、`.runtime-check/assistant-mobile-keyboard-recovered.png`（390x844 键盘恢复）。助手页的标题、对话区、执行轨迹折叠条和底部输入框无重叠或溢出，移动端输入框和长文本保持可用。

## 请求流说明

浏览器仍然只发起一次 `/api/characters/complete-draft` SSE 请求，这是一次用户操作的传输入口；服务端在该请求内部按模型轮次向 Claude/CCMax 发起多次 provider 请求，并把每轮 `step`、正文、工具调用和结果按顺序推回。执行轨迹中的“次数决策”就是这些内部模型轮次，因此不会把一次用户操作拆成几十个浏览器请求，也不会丢失多轮工具过程。

## 剩余风险

- 外部 Claude/CCMax 网关的实际返回仍受模型是否遵守工具 schema 影响；首轮 `required` 会降低普通文本提前结束的概率，后续轮次仍允许模型在验收后自然结束。
- 依赖审计告警来自当前工作区已有的 `markdown-it` 和 `vite` 版本，升级会扩大本次范围，留作独立依赖维护任务。

## 追加任务：多 Provider 实时活动流与消息式轨迹

### 目标

修复 Claude/OpenAI 生成过程中长时间停留在一个空决策的问题，并让 Anthropic Messages、OpenAI Responses API 与 OpenAI-compatible Chat Completions 的模型文字和工具活动按实际发生顺序连续呈现，接近 Codex/Claude 的“助手文字、工具活动、助手继续文字”节奏。

### 范围与清单

- [x] 为角色助手默认启用 provider 流式，同时保留用户显式关闭的设置。
- [x] Anthropic 工具循环每轮通过 Messages SSE 请求；实时转发正文/推理增量，在完整解析工具参数后执行工具，再将 `tool_result` 送入下一轮。
- [x] OpenAI Responses API 工具循环每轮通过真实 SSE 请求；增量解析正文、推理及 function call 参数，执行工具后通过 response id 和工具结果继续下一轮。
- [x] 验证 OpenAI-compatible Chat Completions 工具流也实时推送各轮正文，并正确累积调用参数与结果。
- [x] 将每轮文本、工具调用与结果转换为前端可顺序渲染的活动项，保留已有完整参数/结果展开能力。
- [x] 增加三种 Provider SSE 的多轮工具调用、事件时序、错误和取消回归测试。
- [x] 运行后端全测、前端构建/单测/E2E、编码与 diff 检查，并复查桌面/移动端轨迹。

### 验收标准

- Anthropic Messages 与 OpenAI Responses API 请求体使用 `stream: true`，开始模型轮次后不等待整段 JSON 响应才创建步骤；OpenAI-compatible Chat Completions 使用其 SSE endpoint。
- 每个模型文本增量、已完成工具调用和下一轮模型文字均按事件发生顺序可见且只出现一次。
- OpenAI Responses 的工具调用 id 与 `function_call_output.call_id` 正确对应，工具执行后使用上一轮 response id 继续。
- 新消息式轨迹展示为可扫描的对话活动列表；工具参数与结果仍可展开。
- 取消、流中断恢复、错误处理和已有非流式回退保持可用。

### 验证记录

- Provider 定向测试：`backend/src/tests/providers.test.js` 37/37；新增真实 Anthropic Messages SSE 与 OpenAI Responses SSE 两轮工具测试，并覆盖 Chat Completions 工具轮文字与 activity。
- 兼容性回归：`aiToolContracts.test.js` 12/12、`characterAssistantImages.test.js` 20/20；网关忽略 `stream: true` 返回 JSON 时仍保留稳定回退解析。
- 后端完整测试：最新 `npm test` 通过，1666/1666；门禁首次运行命中了已被时间线重构替换的旧占位文案断言，更新断言后静态测试 31/31 通过。
- 前端单元测试：32 个文件、322/322 通过；构建通过（Vite 2127 模块）。
- 编码检查通过（716 文件）；`git diff --check` 通过（仅 Windows 换行转换提示）。
- 浏览器视觉检查：本地助手页展开执行轨迹后确认 5 个步骤按“模型文字 → 工具 → 下一轮文字”顺序显示；桌面截图与 390x844 移动视口均无文字重叠或工具卡片溢出。页面仍保持单个浏览器 SSE 入口，内部 Provider 请求按轮次递进。

## 追加修正：按真实代理时间线呈现

用户反馈指出，简单的“文字 → 工具 → 文字”标签化排列仍不像 Codex/Claude 的实际工作流。验收重点调整为连续活动时间线：每段助手说明是独立消息节点，连续工具合并为可展开操作批次，工具参数与结果默认收起，推理独立放在收起区域，最终回复不在执行轨迹中重复。

- [x] 移除步骤卡、步骤编号和嵌套“模型活动”展示，改为跨轮 flatten 的助手活动时间线。
- [x] 连续工具显示为操作批次，保留单条参数/结果展开；加载中只显示一个当前活动节点。
- [x] 将最终助手正文从轨迹尾部去重，保留历史记录中的完整助手消息。
- [x] 完成桌面与移动端截图，核对活动顺序、折叠行为、溢出和最终回复重复问题。

## 追加修正：助手活动面板布局

用户在 364x725 移动视口反馈，活动面板内部出现独立滚动条，挤压了对话区与固定输入栏。运行中的助手消息也需要在最后阶段显示任务汇报。

- [x] 确认截图中的蓝框由时间线 `max-height` 与 `overflow:auto` 形成的嵌套滚动区导致。
- [x] 移除时间线内层滚动，让对话转录区承担唯一纵向滚动。
- [x] 为无操作的启动阶段隐藏零计数，保留单个当前活动状态。
- [x] 将完成汇报放到运行消息的时间线之后，避免与历史最终正文重复。
- [x] 补充移动视口布局和实时最终汇报验证，并更新截图记录。

## 最终验证记录

- 前端全量单元测试：32 个文件、323 项通过。
- 角色助手工作流 E2E：1/1 通过；额外断言 364x725 下时间线 `max-height: none`、`overflow-y: visible` 且不产生独立滚动。
- 定向 Provider 与角色助手后端测试：65/65 通过；前端构建通过（Vite 2127 个模块）。
- 编码检查通过，扫描 716 个文件；`git diff --check` 通过（仅保留 Windows 换行转换提示）。
- 视觉截图：`.runtime-check/playwright-results/character-assistant-workfl-ba8af-keeps-the-final-answer-last-chromium/assistant-workflow-desktop.png`、`assistant-workflow-mobile-364x725.png`；桌面与 364x725 移动视口均确认单一对话滚动、输入栏不被活动面板挤压，工具详情可展开且无横向溢出。

## 已知限制

- 浏览器对一次角色助手操作仍只有一个 `/api/characters/complete-draft` SSE 请求；多轮 Provider 请求发生在服务端 Agent Loop 内，这是传输边界而不是丢失模型轮次。
- review gate 的 97 项 Playwright E2E 全部通过。首次门禁还命中旧的面板占位文案断言；更新断言后，完整后端测试通过 1666/1666。门禁的生产依赖审计仍报告 `markdown-it` 与 `vite` 告警。
