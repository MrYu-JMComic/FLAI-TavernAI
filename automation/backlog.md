# Autonomous Backlog

The autonomous loop should choose one small item per run. Add new findings here instead of making broad, speculative rewrites.

## Ready

### 原有任务
- Improve empty, loading, and error states in the Vue views.
- Add backend tests for provider settings, character CRUD, and streaming error paths.
- Improve frontend API error handling and user-facing messages.
- Add lightweight accessibility checks for forms and chat controls.
- Document production startup and backup/restore steps for local SQLite data.
- Review dependency versions and record upgrade candidates before changing them.

### 新增：AI风月参考功能（高优先级）
- **世界书系统：** 角色卡附加世界观设定，触发词自动注入上下文
- **角色卡标签：** 标签系统，支持筛选和分类浏览
- **会话存档/读档：** 保存对话进度，支持多存档位
- **对话模板/预设：** 系统提示词+参数组合预设

### 新增：AI风月参考功能（中优先级）
- **角色卡导入/导出：** JSON 格式分享
- **Mod 系统：** 用户自定义扩展（提示词注入、文风增强）
- **自定义状态栏：** 对话中嵌入 UI 元素（HP/MP/好感度）
- **正则规则增强：** 分组、优先级、批量管理

## Needs Human Decision

- External channel integration such as Telegram, Discord, Slack, or WhatsApp.
- Automatic Git commits, remote pushes, release tags, deployments, or PR creation.
- Data migration touching `backend/data/flai.sqlite`.
- Any change that stores or transmits user conversations outside the local machine.

## Done

- 2026-05-25: Added autonomous iteration guardrails, scripts, and reporting structure.
