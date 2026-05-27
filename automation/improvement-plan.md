# FLAI-TavernAI 完善计划

参考 AI风月 (aisearches.xyz) 核心功能，分阶段实施。
仅参考功能逻辑，不参考配色布局。

---

## 第一阶段：核心体验（高优先级）

### P1: 世界书系统 (World Book)
- 世界书 CRUD（条目名、触发键、内容、插入位置）
- 与角色卡关联
- 按触发词自动匹配注入上下文
- 支持递归扫描（条目间引用）

### P2: 角色卡标签与分类
- 角色卡添加标签（纯爱、角色扮演、大世界等）
- 按标签筛选浏览
- 标签云 / 热门标签

### P3: 会话存档/读档 (Save/Load)
- 保存当前对话为存档（含消息历史、世界书状态）
- 多存档位（存档1、存档2...）
- 读档恢复
- 存档预览（最后一条消息、时间戳）

### P4: 对话模板/预设 (Presets)
- 系统提示词模板
- 温度/max_tokens 等参数预设
- 预设导入/导出

---

## 第二阶段：体验提升（中优先级）

### P5: 角色卡导入/导出
- JSON 格式导出
- 导入角色卡

### P6: Mod 系统
- Mod 目录结构（提示词注入、文风增强）
- Mod 启用/禁用
- Mod 与角色卡解耦

### P7: 自定义状态栏
- 状态栏模板（HP/MP/好感度等变量）
- 变量自动更新（从 AI 回复中提取）
- 动态 UI 渲染

### P8: 正则规则增强
- 正则规则分组（全局 / 角色专属）
- 规则优先级排序
- 启用/禁用单条规则

---

## 技术约束

- 前端: Vue 3 + Vite
- 后端: Express + Node 24 (node:sqlite)
- 不动: backend/data, uploads, .env, node_modules
- 每个功能需通过门下省审核（测试通过）
- 保持向后兼容

---

## 参考来源

- AI风月: https://aisearches.xyz/zh/explore/apps?ranking=recommended
- 项目: D:\Cat\FLAI-TavernAI
- 路线图: D:\Cat\FLAI-TavernAI\automation\feature-roadmap.md
- Backlog: D:\Cat\FLAI-TavernAI\automation\backlog.md
