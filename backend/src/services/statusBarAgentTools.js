import { normalizeStatusBarPayload, STATUS_BAR_VARIABLE_LIMIT } from '../modules/statusBars.js';
import { normalizeStatusVariableKey, STATUS_VARIABLE_TYPES, STATUS_VARIABLE_UNIT_LIMIT } from '../../../shared/statusVariables.js';
import { parseStatusBarRuntime, serializeStatusBarRuntime } from '../../../shared/statusBarRuntime.js';
import { isStatusBarAgentToolEnabled } from '../../../shared/statusBarAgentTools.js';

const TEMPLATE_LIMIT = 50000;
const valueSchema = { type: ['string', 'number'], maxLength: 200 };
const variableProperties = {
  value: valueSchema,
  type: { type: 'string', enum: STATUS_VARIABLE_TYPES },
  min: { type: 'number' }, max: { type: 'number' },
  unit: { type: 'string', maxLength: STATUS_VARIABLE_UNIT_LIMIT },
  color: { type: 'string', maxLength: 30 }
};

export function statusBarEditingTools(skill = {}) {
  return [
    tool('read_status_bar', 'Read the complete current status bar, all variable metadata, raw template and parsed runtime code before making a precise edit.', {}),
    tool('upsert_status_bar_variable', 'Create or edit exactly one variable identified by name. Only supplied fields change. renameTo renames an existing variable. New variables require value.', {
      name: { type: 'string', maxLength: 40 }, renameTo: { type: 'string', maxLength: 40 }, ...variableProperties
    }, ['name']),
    tool('remove_status_bar_variable', 'Remove exactly one named variable only when the author rules explicitly require removal. Template references must be edited separately.', {
      name: { type: 'string', maxLength: 40 }
    }, ['name']),
    tool('update_status_bar_metadata', 'Update only supplied status-bar metadata. template replaces the entire template; prefer precise replacement or code-section tools for small edits.', {
      name: { type: 'string', maxLength: 50 }, template: { type: 'string', maxLength: TEMPLATE_LIMIT }
    }),
    tool('replace_status_bar_template', 'Replace exact literal text in the template or one runtime code section. The match count must equal expectedOccurrences (default 1), otherwise nothing changes. Read the current source and retry on mismatch.', {
      section: { type: 'string', enum: ['template', 'html', 'css', 'javascript'] },
      search: { type: 'string', minLength: 1, maxLength: TEMPLATE_LIMIT }, replacement: { type: 'string', maxLength: TEMPLATE_LIMIT },
      expectedOccurrences: { type: 'integer', minimum: 1, maximum: 1000 }
    }, ['search', 'replacement']),
    tool('update_status_bar_code', 'Edit executable HTML/Vue runtime sections. Only supplied sections change. When converting a legacy template, its source becomes html. JavaScript can use api, Vue, variables, values and context; api.onCleanup releases listeners and timers.', {
      framework: { type: 'string', enum: ['html', 'vue'] }, html: { type: 'string', maxLength: TEMPLATE_LIMIT },
      css: { type: 'string', maxLength: TEMPLATE_LIMIT }, javascript: { type: 'string', maxLength: TEMPLATE_LIMIT }
    })
  ].filter(definition => isStatusBarAgentToolEnabled(skill, definition.function.name));
}

export function executeStatusBarEdit(statusBar, toolName, args = {}, skill = {}) {
  const current = { ...statusBar, variables: (statusBar?.variables || []).map(variable => ({ ...variable })) };
  if (!isStatusBarAgentToolEnabled(skill, toolName)) return failure('TOOL_DISABLED', '此工具已在状态栏 Agent 设置中禁用。', current);
  if (toolName === 'read_status_bar') return { ok: true, changed: false, statusBar: current, runtime: parseStatusBarRuntime(current.template) };
  const next = { ...current, variables: current.variables.slice() };
  if (toolName === 'upsert_status_bar_variable' || toolName === 'remove_status_bar_variable') {
    const key = normalizeStatusVariableKey(args.name);
    if (!key) return failure('VARIABLE_NAME_REQUIRED', '请提供非空变量名称。', current);
    const index = next.variables.findIndex(variable => normalizeStatusVariableKey(variable.name) === key);
    if (toolName === 'remove_status_bar_variable') {
      if (index === -1) return failure('VARIABLE_NOT_FOUND', '未找到该变量，请先读取状态栏并使用已有名称。', current);
      next.variables.splice(index, 1);
    } else {
      if (index === -1 && !Object.hasOwn(args, 'value')) return failure('VARIABLE_VALUE_REQUIRED', '创建新变量必须提供 value。', current);
      if (index === -1 && next.variables.length >= STATUS_BAR_VARIABLE_LIMIT) return failure('VARIABLE_LIMIT', '变量数量已达到上限，请编辑已有变量。', current);
      const variable = index >= 0 ? { ...next.variables[index] } : { name: String(args.name).trim() };
      if (Object.hasOwn(args, 'renameTo')) {
        const renamedKey = normalizeStatusVariableKey(args.renameTo);
        if (!renamedKey) return failure('VARIABLE_NAME_REQUIRED', 'renameTo 不能是空名称。', current);
        if (next.variables.some((item, itemIndex) => itemIndex !== index && normalizeStatusVariableKey(item.name) === renamedKey)) {
          return failure('VARIABLE_NAME_CONFLICT', '目标变量名已存在，请选择其他名称。', current);
        }
        variable.name = String(args.renameTo).trim();
      }
      for (const field of Object.keys(variableProperties)) if (Object.hasOwn(args, field)) variable[field] = args[field];
      if (index === -1) next.variables.push(variable);
      else next.variables[index] = variable;
    }
  } else if (toolName === 'update_status_bar_metadata') {
    if (!Object.hasOwn(args, 'name') && !Object.hasOwn(args, 'template')) return failure('NO_FIELDS', '请至少指定 name 或 template。', current);
    if (Object.hasOwn(args, 'name')) next.name = args.name;
    if (Object.hasOwn(args, 'template')) next.template = args.template;
  } else if (toolName === 'update_status_bar_code') {
    const fields = ['framework', 'html', 'css', 'javascript'];
    if (!fields.some(field => Object.hasOwn(args, field))) return failure('NO_FIELDS', '请至少指定一个代码分区或 framework。', current);
    const runtime = parseStatusBarRuntime(current.template) || { renderer: 'runtime', framework: 'html', html: current.template || '', css: '', javascript: '' };
    for (const field of fields) if (Object.hasOwn(args, field)) runtime[field] = args[field];
    next.template = serializeStatusBarRuntime(runtime);
  } else if (toolName === 'replace_status_bar_template') {
    const section = args.section || 'template';
    const runtime = section === 'template' ? null : parseStatusBarRuntime(current.template);
    if (section !== 'template' && !runtime) return failure('RUNTIME_REQUIRED', '当前模板不是代码模式，请选择 template 分区或先用 update_status_bar_code 转换。', current);
    const source = section === 'template' ? current.template || '' : runtime[section];
    const search = String(args.search || '');
    if (!search) return failure('SEARCH_REQUIRED', 'search 不能是空字符串。', current);
    const occurrences = source.split(search).length - 1;
    const expected = args.expectedOccurrences ?? 1;
    if (occurrences !== expected) return { ...failure('MATCH_COUNT_MISMATCH', '匹配次数不符，尚未修改。请读取当前源码，更新 search 或 expectedOccurrences 后重试。', current), occurrences, expectedOccurrences: expected };
    const replacement = source.split(search).join(String(args.replacement ?? ''));
    if (runtime) {
      runtime[section] = replacement;
      next.template = serializeStatusBarRuntime(runtime);
    } else next.template = replacement;
  } else return failure('UNSUPPORTED_TOOL', `不支持的状态栏工具：${toolName}`, current);
  if (String(next.template || '').length > TEMPLATE_LIMIT) return failure('TEMPLATE_TOO_LARGE', '模板总长度超过 50000 字符，请缩短源码后重试。', current);
  const normalized = normalizeStatusBarPayload(next);
  // Legacy placeholders recreate referenced variables when persisted or read.
  if (toolName === 'remove_status_bar_variable' || Object.hasOwn(args, 'renameTo')) {
    const inferred = normalized.variables.filter(variable => !next.variables.some(item => normalizeStatusVariableKey(item.name) === normalizeStatusVariableKey(variable.name)));
    if (inferred.length) return failure('VARIABLE_REFERENCED', '展示模板仍引用此变量。请先用 replace_status_bar_template 修改或移除引用，再重试变量操作。', current);
  }
  const changed = JSON.stringify(normalized) !== JSON.stringify({ name: current.name, template: current.template, variables: current.variables });
  return { ok: true, changed, statusBar: { ...current, ...normalized }, ...(toolName === 'upsert_status_bar_variable' ? { updates: [normalized.variables.find(variable => normalizeStatusVariableKey(variable.name) === normalizeStatusVariableKey(args.renameTo || args.name))] } : {}) };
}

function failure(error, message, statusBar) {
  return { ok: false, error, message, recoverable: true, statusBar, suggestion: '调用 read_status_bar 读取当前状态，再仅修改需要的字段。' };
}

function tool(name, description, properties, required = []) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}
