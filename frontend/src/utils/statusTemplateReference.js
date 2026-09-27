import { STATUS_BAR_TEMPLATE_ACTIONS } from './statusBarTemplateSecurity.js';

// Quick reference rendered inside the template editors. Kept as data so the
// chat drawer and the character blueprint editor show the same grammar.
const actionItems = [];
for (const action of STATUS_BAR_TEMPLATE_ACTIONS) {
  const attrs = action.attrs.length ? ` ${action.attrs.map((attr) => `${attr}="…"`).join(' ')}` : '';
  actionItems.push({ code: `data-sb-action="${action.action}"${attrs}`, summary: action.summary });
}

export const STATUS_TEMPLATE_REFERENCE = Object.freeze([
  {
    title: '占位符',
    items: [
      { code: '{{体力}}', summary: '变量当前值；单花括号 {体力} 也可以' },
      { code: '{{体力.max}} {{体力.percent}} {{体力.remaining}}', summary: '数值条的上限、百分比、剩余量' },
      { code: '{{体力.color}} {{体力.display}}', summary: '数值条颜色、内置显示文本（72/100）' }
    ]
  },
  {
    title: '过滤器',
    items: [
      { code: '{{姓名 | default:"待定"}}', summary: '空值时显示回退文本' },
      { code: '{{体力 | bar:10}}', summary: '文字进度条 ███░░，可指定宽度' },
      { code: '{{称号 | prefix:"Lv." | upper}}', summary: '多个过滤器用 | 串联' },
      { code: 'truncate:12 · round:1 · pad:3 · replace:旧:新 · lower · trim · suffix', summary: '其他可用过滤器' }
    ]
  },
  {
    title: '条件与循环',
    items: [
      { code: '{{#if 体力 > 50}}…{{else}}…{{/if}}', summary: '支持 > < >= <= == !=，或直接判断是否为空' },
      { code: '{{#unless 事件}}暂无事件{{/unless}}', summary: '变量为空 / 待定 / 无时显示' },
      { code: '{{#each meters}}{{@name}} {{@percent}}{{/each}}', summary: '遍历 variables · meters · texts；循环内可用 @name @value @max @percent @color @index' }
    ]
  },
  {
    title: '按钮动作',
    items: actionItems
  },
  {
    title: '内置样式类',
    items: [
      { code: 'sb-card · sb-title · sb-grid · sb-cols', summary: '卡片、标题、两列 / 自适应网格' },
      { code: 'sb-row · sb-label · sb-val', summary: '标签 + 值一行；值节点会自动同步变量' },
      { code: 'sb-track > sb-fill', summary: '进度条，配合 style="width:{{体力.percent}}"' },
      { code: 'sb-chips · sb-chip · sb-actions · sb-note · sb-divider · sb-good/sb-warn/sb-bad', summary: '标签组、按钮区、说明文字、分隔线、语义色' }
    ]
  }
]);
