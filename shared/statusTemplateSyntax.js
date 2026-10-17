import { STATUS_EXPRESSION_FUNCTIONS, STATUS_TEMPLATE_BUILTINS } from './statusTemplateExpression.js';
import { STATUS_TEMPLATE_ACTIONS } from './statusTemplateActions.js';
import { STATUS_TEMPLATE_FILTER_NAMES } from './statusTemplateRenderer.js';
import { STATUS_TEMPLATE_LOOP_COLLECTIONS } from './statusTemplateTokens.js';
import { STATUS_VARIABLE_TYPES } from './statusVariables.js';

// Single source of the status-bar template reference. The editors render it as
// a cheat sheet and the AI assistants turn it into tool instructions, so what
// the AI is told always matches what the renderer implements (backend tests
// compare the lists below with the renderer, the expression engine and the
// sanitiser).

export const STATUS_VARIABLE_TYPE_GUIDE = Object.freeze([
  { type: 'meter', label: '数值条', example: '{"name":"体力","value":80,"max":100,"color":"#27ae60"}', summary: '带进度条的数值；可加 min（如好感 -100~100）与 unit' },
  { type: 'number', label: '计数', example: '{"name":"金币","type":"number","value":1250,"unit":"G"}', summary: '没有上限的数字，如金币、天数、击杀数；不要写 max' },
  { type: 'text', label: '文本', example: '{"name":"所在地","value":"青石镇"}', summary: '短文本，最多 200 字' },
  { type: 'list', label: '列表', example: '{"name":"随身物品","type":"list","value":"长剑、药水、地图"}', summary: '用 、 , ; | 或换行分隔的条目，内置视图显示为标签' }
]);

export const STATUS_TEMPLATE_PLACEHOLDER_GUIDE = Object.freeze([
  { code: '{{体力}}  {体力}  {{getvar::体力}}', summary: '变量当前值；三种写法等价' },
  { code: '{{体力.max}} {{体力.min}} {{体力.percent}} {{体力.remaining}}', summary: '数值条上限、下限、百分比、剩余量' },
  { code: '{{体力.color}} {{体力.display}} {{金币.unit}} {{随身物品.count}}', summary: '颜色、内置显示文本（72/100）、单位、列表条目数' },
  { code: '{{林晚.好感}}  {{林晚.好感.percent}}', summary: '带点的变量名：末段不是属性名时整段都是变量名，适合多角色' },
  { code: '{{= 体力 * 2 + 10}}  {{= 体力 < 30 ? "虚弱" : "正常"}}', summary: '安全表达式：运算、比较、三元与函数，不执行任何 JavaScript' },
  { code: '{{user}} {{char}} {{date}} {{time}} {{weekday}}', summary: '内置值：用户名、角色名、日期、时间、星期，不会被识别为变量' }
]);

export const STATUS_TEMPLATE_FILTER_GUIDE = Object.freeze([
  { names: ['default'], code: 'default:"待定"', summary: '值为空时显示回退文本' },
  { names: ['prefix', 'suffix'], code: 'prefix:"Lv." · suffix:"点"', summary: '值非空时加前缀 / 后缀' },
  { names: ['upper', 'lower', 'trim'], code: 'upper · lower · trim', summary: '大小写转换、去掉首尾空白' },
  { names: ['truncate', 'slice', 'replace'], code: 'truncate:12 · slice:0:4 · replace:"旧":"新"', summary: '截断（加 …）、截取、替换文字' },
  { names: ['round', 'fixed', 'number'], code: 'round:1 · fixed:2 · number', summary: '四舍五入、固定小数位、千分位（12,500）' },
  { names: ['plus', 'minus', 'times', 'divide'], code: 'plus:10 · minus:5 · times:2 · divide:4', summary: '四则运算' },
  { names: ['abs', 'sign', 'clamp', 'pad'], code: 'abs · sign · clamp:0:100 · pad:3', summary: '绝对值、正数加 +、限制范围、左侧补零' },
  { names: ['max', 'min', 'percent', 'percentage', 'ratio', 'remaining'], code: 'max · min · percent · percentage · remaining', summary: '读取数值条属性（与 .max 等写法相同）' },
  { names: ['color', 'display', 'unit', 'name', 'type'], code: 'color · display · unit · name · type', summary: '读取变量属性；unit 会在值后追加单位' },
  { names: ['bar', 'stars', 'repeat'], code: 'bar:10 · stars:5 · repeat:"❤":10', summary: '文字进度条 ███░░、星级 ★★★☆☆、按数值重复符号' },
  { names: ['tier', 'map', 'if'], code: 'tier:"低,中,高" · map:"探索=🧭;战斗=⚔;*=？" · if:"是":"否"', summary: '按百分比分档、值映射（* 为兜底）、真假显示' },
  { names: ['join', 'first', 'last', 'count'], code: 'join:" / " · first · last · count', summary: '列表合并、首项、末项、条目数' },
  { names: ['json'], code: 'json', summary: '输出 JSON 文本（调试用）' }
]);

export const STATUS_TEMPLATE_BLOCK_GUIDE = Object.freeze([
  { code: '{{#if 体力 > 50 && 心情 != "低落"}}…{{else if 体力 > 20}}…{{else}}…{{/if}}', summary: '条件块；支持 > < >= <= == != && || ! contains 与括号' },
  { code: '{{#unless 事件}}暂无事件{{/unless}}', summary: '变量为空或为“待定 / 无 / 未知 / 否”等占位词时显示' },
  { code: `{{#each meters}}{{@name}} {{@percent}}{{/each}}`, summary: `遍历变量集合：${STATUS_TEMPLATE_LOOP_COLLECTIONS.join(' · ')}` },
  { code: '{{#each 随身物品}}{{@value}}{{#unless @last}}、{{/unless}}{{/each}}', summary: '遍历列表变量的每一项' },
  { code: '@name @value @display @max @min @percent @color @unit @index @first @last @total', summary: '循环内可用字段（@index 从 1 开始）' }
]);

export const STATUS_EXPRESSION_FUNCTION_GUIDE = Object.freeze([
  { names: ['min', 'max', 'clamp'], code: 'min(a, b) · max(a, b) · clamp(x, 0, 100)', summary: '最小、最大、限制范围' },
  { names: ['round', 'floor', 'ceil', 'abs', 'fixed'], code: 'round(x, 1) · floor(x) · ceil(x) · abs(x) · fixed(x, 2)', summary: '取整与小数位' },
  { names: ['percent', 'number', 'text', 'len'], code: 'percent(值, 总数) · number(x) · text(x) · len(x)', summary: '百分比、转数字、转文本、文本长度' },
  { names: ['count', 'contains', 'join', 'item'], code: 'count(列表) · contains(列表, "钥匙") · join(列表, "/") · item(列表, 1)', summary: '列表条目数、是否包含、合并、取第 n 项（负数从末尾）' },
  { names: ['upper', 'lower', 'trim'], code: 'upper(x) · lower(x) · trim(x)', summary: '文本处理' },
  { names: ['if', 'default', 'var'], code: 'if(条件, 是, 否) · default(x, "无") · var("变量 1")', summary: '条件取值、空值回退、按名称读取含空格的变量' }
]);

export { STATUS_TEMPLATE_ACTIONS };

export const STATUS_TEMPLATE_STYLE_GUIDE = Object.freeze([
  { classes: ['sb-card', 'sb-title', 'sb-subtitle'], code: 'sb-card · sb-title · sb-subtitle', summary: '卡片容器、标题、副标题' },
  { classes: ['sb-grid', 'sb-cols', 'sb-stack'], code: 'sb-grid · sb-cols · sb-stack', summary: '自适应网格、两列、纵向堆叠' },
  { classes: ['sb-row', 'sb-label', 'sb-val'], code: 'sb-row > sb-label + sb-val', summary: '标签 + 值一行；值节点会自动同步同名变量' },
  { classes: ['sb-track', 'sb-fill'], code: 'sb-track > sb-fill', summary: '进度条：style="--p:{{体力.percentage}};--c:{{体力.color}}"' },
  { classes: ['sb-ring'], code: 'sb-ring', summary: '环形进度：style="--p:{{体力.percentage}};--c:{{体力.color}}"，内部写数值' },
  { classes: ['sb-stat', 'sb-stat-label'], code: 'sb-stat > strong + sb-stat-label', summary: '大号数字指标卡' },
  { classes: ['sb-chips', 'sb-chip', 'sb-badge'], code: 'sb-chips > sb-chip · sb-badge', summary: '标签组、徽标' },
  { classes: ['sb-tabs', 'sb-tab', 'sb-panel'], code: 'sb-tabs > sb-tab · sb-panel', summary: '标签页按钮与面板，配合 data-sb-action="tab"' },
  { classes: ['sb-actions', 'sb-note', 'sb-divider', 'sb-muted'], code: 'sb-actions · sb-note · sb-divider · sb-muted', summary: '按钮区、说明文字、分隔线、弱化文字' },
  { classes: ['sb-good', 'sb-warn', 'sb-bad', 'sb-accent'], code: 'sb-good · sb-warn · sb-bad · sb-accent', summary: '语义色（绿 / 黄 / 红 / 主题色）' },
  { classes: ['sb-hidden'], code: 'sb-hidden', summary: '初始隐藏，配合 toggle / tab 显示' },
  { classes: ['sb-theme-glass', 'sb-theme-parchment', 'sb-theme-terminal', 'sb-theme-neon'], code: 'sb-theme-glass · sb-theme-parchment · sb-theme-terminal · sb-theme-neon', summary: '整体主题：毛玻璃、羊皮纸、终端、霓虹' }
]);

export const STATUS_SCRIPT_API = Object.freeze([
  { code: 'conversation · character · user · provider · settings · messages', summary: '当前会话、角色、用户、供应商、外观设置与消息列表的只读快照' },
  { code: 'statusBar', summary: '状态栏快照 { name, variables:[{name,value,type,min,max,unit,color}], template }' },
  { code: 'getVar(name)', summary: '读取变量当前值（数值条、计数返回数字）' },
  { code: 'await setVar(name, value) · await adjustVar(name, delta)', summary: '写入变量 / 数值加减并保存；数值条自动限制在 min~max' },
  { code: 'await updateStatusVariables([{ name, value, max }])', summary: '批量写入变量，不存在的变量会新建' },
  { code: 'on("status", fn) · onAction(name, fn)', summary: '变量变化时回调；响应模板按钮 data-sb-action="script" data-sb-script="name"' },
  { code: 'insertText(text) · await sendMessage(text)', summary: '把文字填入输入框 / 直接发送一条消息' },
  { code: 'notify(text, type) · setCssVar(name, value) · scrollToBottom()', summary: '提示（info/success/warning/error）、设置聊天区 CSS 变量、滚到底部' },
  { code: 'openSidebar / closeSidebar / openSettings / closeSettings', summary: '打开或收起侧栏与设置面板' },
  { code: 'await query(selector) · await queryAll(selector)', summary: '查询聊天区元素摘要 { tag, text, className }（沙箱内拿不到 DOM 节点）' },
  { code: 'await wait(ms) · await requestPaint() · state', summary: '延时、等待下一帧、本次运行内的临时状态对象（重新应用脚本后重置）' },
  { code: 'onCleanup(fn) 或 return () => {}', summary: '离开会话或重新应用脚本时执行清理' }
]);

// Documented names, flattened for the consistency tests.
export function documentedStatusTemplateFilters() {
  return STATUS_TEMPLATE_FILTER_GUIDE.flatMap((item) => item.names);
}

export function documentedStatusExpressionFunctions() {
  return STATUS_EXPRESSION_FUNCTION_GUIDE.flatMap((item) => item.names);
}

export function documentedStatusStyleClasses() {
  return STATUS_TEMPLATE_STYLE_GUIDE.flatMap((item) => item.classes);
}

// Groups rendered by the template editors' cheat sheet.
export function buildStatusTemplateReferenceGroups() {
  return [
    { key: 'placeholders', title: '占位符', items: STATUS_TEMPLATE_PLACEHOLDER_GUIDE },
    {
      key: 'types',
      title: '变量类型',
      items: STATUS_VARIABLE_TYPE_GUIDE.map((item) => ({ code: `${item.label} · ${item.type}`, summary: item.summary }))
    },
    { key: 'filters', title: '过滤器', items: [{ code: '{{称号 | prefix:"Lv." | upper}}', summary: '多个过滤器用 | 串联' }, ...STATUS_TEMPLATE_FILTER_GUIDE] },
    { key: 'blocks', title: '条件与循环', items: STATUS_TEMPLATE_BLOCK_GUIDE },
    { key: 'expressions', title: '表达式函数', items: STATUS_EXPRESSION_FUNCTION_GUIDE },
    {
      key: 'actions',
      title: '按钮动作',
      items: STATUS_TEMPLATE_ACTIONS.map((item) => ({
        code: `data-sb-action="${item.action}"${item.attrs.map((attr) => ` ${attr}="…"`).join('')}`,
        summary: item.summary
      }))
    },
    { key: 'styles', title: '内置样式类', items: STATUS_TEMPLATE_STYLE_GUIDE }
  ];
}

// Concise instructions for AI tools that write status-bar blueprints. Kept in
// Chinese to match the rest of the assistant prompts.
export function buildStatusTemplateAiGuide() {
  const filters = STATUS_TEMPLATE_FILTER_GUIDE.map((item) => item.code).join('；');
  const functions = STATUS_EXPRESSION_FUNCTION_GUIDE.map((item) => item.code).join('；');
  const actions = STATUS_TEMPLATE_ACTIONS
    .map((item) => (item.attrs.length ? `"${item.action}"（${item.attrs.join('、')}）` : `"${item.action}"`))
    .join('、');
  const styles = documentedStatusStyleClasses().join('、');
  return [
    `变量类型（variables[].type，可省略；省略时数字+max 视为数值条，其余视为文本）：${STATUS_VARIABLE_TYPE_GUIDE.map((item) => `${item.type}=${item.label}：${item.summary}，示例 ${item.example}`).join('；')}。`,
    `占位符：${STATUS_TEMPLATE_PLACEHOLDER_GUIDE.map((item) => `${item.code}（${item.summary}）`).join('；')}。`,
    `过滤器用 | 串联，参数用 : 分隔：${filters}。`,
    `条件与循环：${STATUS_TEMPLATE_BLOCK_GUIDE.map((item) => item.code).join('；')}；块必须成对闭合。`,
    `表达式 {{= …}} 与条件可用运算符 + - * / % == != > < >= <= && || ! contains ?: 和函数：${functions}；只能引用变量与内置值，不能写任何 JavaScript。`,
    `内置值 ${STATUS_TEMPLATE_BUILTINS.map((name) => `{{${name}}}`).join(' ')} 由系统填充，不要为它们创建变量。`,
    `按钮只能使用声明式动作 data-sb-action：${actions}。`,
    `内置样式类可直接使用：${styles}；也可以在 <style> 中自写 CSS（支持 @media、@keyframes、CSS 变量和 data:image 图片），样式会自动限定在状态栏内。`
  ];
}

// One-line summary of the custom JS sandbox API for tool descriptions.
export function buildStatusScriptAiGuide() {
  return STATUS_SCRIPT_API.map((item) => `${item.code}：${item.summary}`).join('；');
}

// Exported for tests that keep the documentation in step with the runtime.
export const STATUS_TEMPLATE_RUNTIME_LISTS = Object.freeze({
  filters: STATUS_TEMPLATE_FILTER_NAMES,
  functions: STATUS_EXPRESSION_FUNCTIONS,
  variableTypes: STATUS_VARIABLE_TYPES
});
