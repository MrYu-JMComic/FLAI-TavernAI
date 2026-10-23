export const STATUS_BAR_AGENT_TOOLS = Object.freeze([
  { name: 'read_status_bar', label: '读取完整状态栏', description: '读取名称、变量、模板与代码分区。', defaultEnabled: true },
  { name: 'update_status_bar', label: '批量更新变量值', description: '兼容原工具，按变量名批量更新本轮变化。', defaultEnabled: true },
  { name: 'upsert_status_bar_variable', label: '精确编辑变量', description: '按名称新增变量或修改值、类型、范围、单位、颜色与名称。', defaultEnabled: true },
  { name: 'remove_status_bar_variable', label: '移除指定变量', description: '仅移除指定名称的变量。', defaultEnabled: true },
  { name: 'update_status_bar_metadata', label: '编辑名称与模板', description: '只修改明确指定的状态栏名称或完整模板。', defaultEnabled: true },
  { name: 'replace_status_bar_template', label: '精确替换模板片段', description: '按原文与匹配次数替换模板或代码片段。', defaultEnabled: true },
  { name: 'update_status_bar_code', label: '编辑代码分区', description: '分别修改 HTML、CSS、JavaScript 或 Vue 模式，保留其他分区。', defaultEnabled: true }
].map(tool => Object.freeze(tool)));

export function isStatusBarAgentToolEnabled(skill = {}, name = '') {
  return name === 'skip_status_bar_update' || skill?.tools?.[name] !== false;
}
