// Section labels shared by the AI workbench scope pickers and the plan review
// card, so a plan step and its scope checkbox always read the same.
export const CHARACTER_AI_SECTION_LABELS = Object.freeze({
  profile: '基础资料',
  background: '背景',
  worldview: '世界观',
  persona: '人设',
  openingMessage: '开场白',
  tags: '标签',
  regexRules: '正则',
  renderPlugins: '渲染插件',
  worldBook: '世界书创建',
  advancedSettings: '高阶设置',
  modSuggestions: 'Mod 建议'
});

export const WORLD_BOOK_AI_SECTION_LABELS = Object.freeze({
  profile: '世界书资料',
  entries: '条目内容',
  triggers: '触发条件',
  cleanup: '清理与合并'
});

export function aiSectionLabel(labels, key) {
  return labels?.[key] || key || '';
}
