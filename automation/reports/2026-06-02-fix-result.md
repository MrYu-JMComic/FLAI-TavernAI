# 2026-06-02 Regex Rules 修复报告

## 变更摘要

### 1. 新增 `testRegexRule` 函数 (`backend/src/modules/characters.js`)

- 支持 4 种模式: `contain`、`exact`、`regex`、`preset`
- 返回 `{ pass: boolean, matches: string[] }`
- `contain`: 使用 `String.indexOf` 判断文本是否包含 pattern
- `exact`: 使用 `===` 判断文本是否完全匹配 pattern
- `regex`: 使用 `new RegExp` 匹配，返回所有匹配结果
- `preset`: 始终返回 `{ pass: true, matches: [] }`
- 默认模式为 `regex`

### 2. 新增 `POST /test` 端点 (`backend/src/routes/regex.js`)

- 路由: `POST /test`
- 请求体: `{ rule: { pattern, mode?, flags? }, text }`
- Zod 验证: `testRegexSchema` 校验 rule 和 text 字段
- 需要认证 (`requireAuth`)
- 返回 `testRegexRule` 的结果

### 3. `applyRegexRules` 支持 `scriptMode` (`backend/src/modules/characters.js`)

- 当 `rule.scriptMode` 为真值且 `rule.jsScript` 非空时，执行 `jsScript` 代替简单替换
- `jsScript` 接收 3 个参数: `text`(当前文本)、`matches`(正则匹配结果)、`rule`(规则对象)
- 脚本返回值作为新的文本
- 脚本执行失败时静默回退，保留原文本

## 测试结果

```
✔ testRegexRule contain mode passes when text contains pattern
✔ testRegexRule contain mode fails when text does not contain pattern
✔ testRegexRule exact mode passes when text matches exactly
✔ testRegexRule exact mode fails when text does not match exactly
✔ testRegexRule regex mode passes when pattern matches
✔ testRegexRule regex mode fails when pattern does not match
✔ testRegexRule regex mode returns empty matches on invalid regex
✔ testRegexRule preset mode always passes
✔ testRegexRule defaults to regex mode when mode is not specified
✔ applyRegexRules applies jsScript when scriptMode is enabled
✔ applyRegexRules falls back to replacement when scriptMode is disabled
✔ applyRegexRules falls back to replacement when jsScript is empty
✔ applyRegexRules scriptMode receives text, matches, and rule args
✔ applyRegexRules handles script errors gracefully

tests 14 | pass 14 | fail 0
```

现有后端测试 (82 个) 全部通过，无回归。

## 修改文件

| 文件 | 变更 |
|------|------|
| `backend/src/modules/characters.js` | 新增 `testRegexRule` 函数；`applyRegexRules` 增加 `scriptMode` 支持 |
| `backend/src/routes/regex.js` | 新增 `POST /test` 端点和 `testRegexSchema` 验证 |
| `backend/src/tests/regex-rules.test.js` | 新增 14 个测试用例 |
