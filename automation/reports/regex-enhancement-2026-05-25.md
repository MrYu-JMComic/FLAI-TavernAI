# 正则规则增强 — 实施报告

**日期**: 2026-05-25  
**状态**: ✅ 完成

---

## 变更概要

### 后端 (backend/src/)

#### 数据库 (`db.js`)
- `regex_rules` 表新增字段：
  - `group_name TEXT NOT NULL DEFAULT '全局'` — 规则分组名
  - `priority INTEGER NOT NULL DEFAULT 0` — 优先级（数字越小越先执行）
- 使用 `ensureColumn` 保证向后兼容（已有数据库自动迁移）
- 新增 `idx_regex_user` 索引

#### 角色模块 (`modules/characters.js`)
- `getRegexRules()` — 返回值新增 `groupName`、`priority` 字段，按 priority 排序
- `getRegexRulesByGroup(userId, group)` — **新函数**，按用户+分组查询所有规则
- `replaceRegexRules()` — INSERT 语句包含 `group_name`、`priority`
- `toggleRegexRule(userId, ruleId)` — **新函数**，切换启用/禁用状态
- `reorderRegexRules(userId, orderedIds)` — **新函数**，批量更新优先级
- `applyRegexRules()` — 按 priority 排序后执行，跳过 disabled 规则
- `normalizeRegexRules()` — 新增 `groupName`、`priority` 字段校验

#### API (`server.js`)
- `GET /api/regex-rules?group=xxx` — 查询正则规则，支持分组筛选
- `PUT /api/regex-rules/:id/toggle` — 切换单条规则启用/禁用
- `PUT /api/regex-rules/order` — 批量排序（传入 `{ orderedIds: [...] }`）

### 前端 (frontend/src/)

#### API (`api.js`)
- `fetchRegexRules(group)` — 获取正则规则列表
- `toggleRegexRule(ruleId)` — 切换规则启用/禁用
- `reorderRegexRules(orderedIds)` — 批量排序

#### 设置页 (`SettingsView.vue`)
- 新增「正则规则管理」面板：
  - 按分组筛选下拉
  - 每条规则显示：名称、正则、替换、分组标签、作用域标签、优先级
  - 启用/禁用切换按钮（Power 图标）
  - 拖拽排序（GripVertical 图标 + drag events）
  - 批量导出（JSON 文件下载）
  - 批量导入（文件选择）

#### 角色编辑页 (`CharacterFormView.vue`)
- 规则行新增字段：
  - `groupName` 输入框（分组名，默认 "全局"）
  - `priority` 数字输入框（优先级，默认 0）
- 新增规则时自动填充 `groupName: '全局'`, `priority: 0`

#### 样式 (`styles.css`)
- 新增 `.regex-rules-panel` 及相关样式
- 更新 `.rule-row` grid 布局，新增 `group` 和 `priority` 行
- 响应式布局同步更新

---

## 验证结果

| 项目 | 结果 |
|------|------|
| 后端测试 (`npm test`) | ✅ 41/42 通过（1 个预存失败：标签排序，与本次变更无关） |
| 前端构建 (`npm run build`) | ✅ 成功 |

## 向后兼容

- 所有新字段均有默认值（`group_name='全局'`, `priority=0`, `enabled=1`）
- 已有数据库通过 `ensureColumn` 自动添加新列
- 现有规则默认 `enabled=true`, `priority=0`, `groupName='全局'`
