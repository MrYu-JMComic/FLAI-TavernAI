// Declarative status-template button actions: `data-sb-action="<name>"` plus
// the listed companion attributes. This is a leaf module on purpose — the
// renderer, the sanitiser and the documentation all read the same list without
// pulling each other in.
export const STATUS_TEMPLATE_ACTIONS = Object.freeze([
  { action: 'quick-reply', attrs: ['data-sb-text'], summary: '把文字填入输入框，由用户决定是否发送' },
  { action: 'send', attrs: ['data-sb-text'], summary: '直接把文字作为一条消息发送' },
  { action: 'copy', attrs: ['data-sb-copy'], summary: '复制文字到剪贴板' },
  { action: 'set', attrs: ['data-sb-var', 'data-sb-value'], summary: '把变量设为指定值' },
  { action: 'adjust', attrs: ['data-sb-var', 'data-sb-delta'], summary: '给数值变量加减，数值条自动限制在 min~max' },
  { action: 'cycle', attrs: ['data-sb-var', 'data-sb-options'], summary: '在“探索|战斗|休息”等选项间循环切换' },
  { action: 'toggle', attrs: ['data-sb-target'], summary: '显示 / 隐藏模板内匹配选择器的元素' },
  { action: 'tab', attrs: ['data-sb-target', 'data-sb-group'], summary: '标签页：显示目标，隐藏同组其他面板' },
  { action: 'script', attrs: ['data-sb-script', 'data-sb-value'], summary: '调用扩展 JS 里 onAction 注册的函数' },
  { action: 'collapse', attrs: [], summary: '收起状态栏' },
  { action: 'open-settings', attrs: [], summary: '打开会话设置面板' }
]);
