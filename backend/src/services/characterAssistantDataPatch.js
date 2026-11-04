import { isDeepStrictEqual } from 'node:util';
import { createDefaultAccessorySkills } from '../modules/advancedSettings.js';
import { compileSafeRegex } from './regexSafety.js';
import { THINKING_LEVELS } from '../../../shared/providerThinking.js';
import { MEMORY_EMBEDDING_FIELDS, MEMORY_POLICY_FIELDS, normalizeMemoryEmbedding, normalizeMemoryPolicy } from '../../../shared/memoryPolicy.js';
import { STATUS_VARIABLE_LIMIT, STATUS_VARIABLE_TYPES, STATUS_VARIABLE_UNIT_LIMIT } from '../../../shared/statusVariables.js';

const ROOTS = {
  tags: { path: ['tags'], section: 'tags', limit: 20 },
  regexRules: { path: ['regexRules'], section: 'regexRules', limit: 40 },
  renderPlugins: { path: ['renderPlugins'], section: 'renderPlugins', limit: 20 },
  modSuggestions: { path: ['modSuggestions'], section: 'modSuggestions', limit: 8 },
  accessorySkills: { path: ['authorAdvancedSettings', 'accessorySkills'], section: 'advancedSettings' },
  'statusBarBlueprint.variables': { path: ['authorAdvancedSettings', 'statusBarBlueprint', 'variables'], section: 'advancedSettings', limit: STATUS_VARIABLE_LIMIT }
};
const ITEM_FIELDS = {
  regexRules: ['id', 'label', 'pattern', 'replacement', 'flags', 'scope', 'enabled', 'groupName', 'priority', 'scriptMode', 'jsScript'],
  renderPlugins: ['id', 'label', 'type', 'pattern', 'flags', 'titleTemplate', 'enabled'],
  modSuggestions: ['name', 'description', 'type', 'content', 'enabled'],
  'statusBarBlueprint.variables': ['name', 'type', 'value', 'min', 'max', 'unit', 'color']
};
const SKILLS = Object.keys(createDefaultAccessorySkills());
const SKILL_FIELDS = ['enabled', 'modelOverride', 'providerProfileId', 'thinkingLevel', 'tools', 'memoryPolicy', 'embedding'];
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const characterDataPatchTool = {
  type: 'function',
  function: {
    name: 'patch_character_data',
    // 该工具说明直接作为模型指令发送；运行时校验消息仍面向中文界面。
    description: 'Edit structured character data precisely while preserving other list items. Use JSON Pointer paths such as /regexRules/0/replacement, /tags/-, /accessorySkills/statusBarAgent/enabled, and /statusBarBlueprint/variables/0/value. For replace and remove, provide the exact oldValue you just read. For add, append to an array with /- or add a field that does not exist. All edits are atomic; if any edit conflicts, none are applied. Use edit_character_text to change text passages.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['edits'],
      properties: {
        edits: {
          type: 'array', minItems: 1, maxItems: 32,
          items: {
            type: 'object', additionalProperties: false, required: ['op', 'path'],
            properties: {
              op: { type: 'string', enum: ['replace', 'add', 'remove'] },
              path: { type: 'string', maxLength: 300 },
              oldValue: { description: 'Exact previous JSON value; required for replace and remove. Shape depends on the allowlisted JSON Pointer target and is checked by the handler.' },
              value: { description: 'New JSON value; required for replace and add. Shape depends on the allowlisted JSON Pointer target and is checked by the handler.' }
            }
          }
        }
      }
    }
  }
};

export function applyCharacterDataPatch(args, draft, enabledSections, normalizeDraft) {
  let editIndex;
  let currentPath;
  try {
    requireValid(Array.isArray(args?.edits) && args.edits.length > 0 && args.edits.length <= 32, 'edits 必须包含 1 至 32 项修改。');
    const candidate = structuredClone(draft);
    const touchedRoots = new Set();
    const removals = [];
    const changes = [];
    for (editIndex = 0; editIndex < args.edits.length; editIndex += 1) {
      const edit = args.edits[editIndex];
      currentPath = typeof edit?.path === 'string' ? edit.path : '';
      requireValid(isObject(edit) && ['replace', 'add', 'remove'].includes(edit.op), '修改操作必须是 replace、add 或 remove。');
      const { root, segments } = parsePath(currentPath);
      const definition = ROOTS[root];
      if (enabledSections?.[definition.section] === false) fail('该角色分区未启用编辑。', 'DATA_PATCH_SECTION_DISABLED');
      requireValid(edit.op !== 'remove' || segments.length > 0, '不能移除整个数据根节点；清空列表请使用 replace 和空数组。');
      const fullPath = [...definition.path, ...segments];
      const { parent, key } = resolveParent(candidate, fullPath, edit.op);
      const exists = Object.hasOwn(parent, key);
      if (edit.op === 'add') {
        requireValid(!Array.isArray(parent) || key === parent.length, '数组新增只能使用 /- 追加。');
        requireValid(!exists, 'add 的目标已存在，请读取原值后使用 replace。');
      } else {
        requireValid(Object.hasOwn(edit, 'oldValue'), 'replace/remove 必须提供 oldValue。');
        if (!exists || !isDeepStrictEqual(parent[key], edit.oldValue)) fail('原值不匹配，草稿未更改；请重新读取目标后重试。', 'DATA_PATCH_CONFLICT');
      }
      if (edit.op !== 'remove') {
        requireValid(Object.hasOwn(edit, 'value') && isJsonValue(edit.value), 'replace/add 必须提供有效 JSON value，且不能包含原型属性。');
        requirePreservedIds(exists ? parent[key] : undefined, edit.value);
      }
      if (edit.op === 'remove') {
        if (Array.isArray(parent)) parent.splice(key, 1);
        else {
          delete parent[key];
          removals.push(fullPath);
        }
      } else if (Array.isArray(parent) && edit.op === 'add') parent.push(structuredClone(edit.value));
      else parent[key] = structuredClone(edit.value);
      touchedRoots.add(root);
      changes.push({ path: currentPath, op: edit.op });
    }

    editIndex = undefined;
    currentPath = undefined;
    for (const root of touchedRoots) validateRoot(root, readPath(candidate, ROOTS[root].path), readPath(draft, ROOTS[root].path));
    const normalized = normalizeDraft(structuredClone(candidate));
    // Normalizers may fill omitted defaults, but must never truncate, discard,
    // coerce, or reorder explicitly supplied values in the edited roots.
    for (const root of touchedRoots) {
      const path = ROOTS[root].path;
      requireValid(retainsValues(readPath(candidate, path), readPath(normalized, path)), `修改 ${root} 后会丢失或转换数据，请检查字段类型、长度与模板引用。`);
    }
    for (const path of removals) {
      if (readPath(candidate, path) === undefined) requireValid(readPath(normalized, path) === undefined, '该字段是必需默认值，不能移除；请用 replace 设置所需值。');
    }
    const changed = [...touchedRoots].some((root) => !isDeepStrictEqual(readPath(draft, ROOTS[root].path), readPath(normalized, ROOTS[root].path)));
    if (changed) {
      for (const root of touchedRoots) {
        const path = ROOTS[root].path;
        let parent = draft;
        for (const key of path.slice(0, -1)) parent = parent[key] ||= {};
        parent[path.at(-1)] = structuredClone(readPath(normalized, path));
      }
    }
    return { ok: true, changed, sections: changed ? [...new Set([...touchedRoots].map((root) => ROOTS[root].section))] : [], changes };
  } catch (error) {
    return {
      ok: false, changed: false, error: error.code || 'DATA_PATCH_INVALID', recoverable: true,
      message: error.code ? error.message : '修改数据无效，草稿未更改；请检查目标结构和字段值。',
      ...(editIndex !== undefined ? { editIndex } : {}),
      ...(currentPath ? { path: currentPath } : {})
    };
  }
}

function parsePath(path) {
  requireValid(typeof path === 'string' && path.startsWith('/') && path.length <= 300, 'path 必须是有效的 JSON Pointer。');
  const tokens = path.slice(1).split('/').map((part) => {
    requireValid(!/~(?:[^01]|$)/.test(part), 'JSON Pointer 转义无效。');
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    requireValid(key && !UNSAFE_KEYS.has(key), '不允许该路径字段。');
    return key;
  });
  const root = tokens[0] === 'statusBarBlueprint' && tokens[1] === 'variables' ? 'statusBarBlueprint.variables' : tokens[0];
  requireValid(Object.hasOwn(ROOTS, root), '该数据根节点不支持精确结构化修改。');
  const segments = tokens.slice(root === 'statusBarBlueprint.variables' ? 2 : 1);
  if (root === 'accessorySkills') {
    requireValid(segments.length <= 3 && (!segments.length || SKILLS.includes(segments[0])), '未知附属 Agent。');
    requireValid(segments.length < 2 || SKILL_FIELDS.includes(segments[1]), '未知 Agent 设置字段。');
    requireValid(segments.length < 3 ||
      (segments[1] === 'tools' && /^[a-z][a-z0-9_.]{0,39}$/.test(segments[2])) ||
      (segments[0] === 'memoryAgent' && segments[1] === 'memoryPolicy' && MEMORY_POLICY_FIELDS.includes(segments[2])) ||
      (segments[0] === 'memoryAgent' && segments[1] === 'embedding' && MEMORY_EMBEDDING_FIELDS.includes(segments[2])), '未知 Agent 工具设置路径。');
  } else {
    requireValid(segments.length <= (root === 'tags' ? 1 : 2), '不支持该嵌套字段。');
    requireValid(!segments.length || /^(?:0|[1-9]\d*|-)$/.test(segments[0]), '数组路径必须使用有效索引。');
    requireValid(segments.length < 2 || (segments[0] !== '-' && ITEM_FIELDS[root]?.includes(segments[1]) && segments[1] !== 'id'), '未知或不可变的条目字段。');
  }
  return { root, segments };
}

function resolveParent(target, path, op) {
  let parent = target;
  for (const key of path.slice(0, -1)) {
    requireValid(parent !== null && typeof parent === 'object' && Object.hasOwn(parent, key), '目标路径不存在，请先读取父节点。');
    parent = parent[key];
  }
  requireValid(parent !== null && typeof parent === 'object', '目标父节点不是对象或数组。');
  let key = path.at(-1);
  if (Array.isArray(parent)) {
    if (key === '-') {
      requireValid(op === 'add', '/- 只可用于数组追加。');
      key = parent.length;
    } else {
      requireValid(/^(?:0|[1-9]\d*)$/.test(key) && Number.isSafeInteger(Number(key)) && Number(key) < parent.length, '数组索引超出范围。');
      requireValid(op !== 'add', '数组新增必须使用 /-，避免索引偏移。');
      key = Number(key);
    }
  }
  return { parent, key };
}

function validateRoot(root, value, previous) {
  if (root === 'accessorySkills') {
    validateObject(value, SKILLS);
    for (const [name, skill] of Object.entries(value)) {
      if (isDeepStrictEqual(skill, previous?.[name])) continue;
      validateObject(skill, SKILL_FIELDS);
      if (Object.hasOwn(skill, 'enabled')) requireValid(typeof skill.enabled === 'boolean' || skill.enabled === 'auto', 'Agent enabled 必须为布尔值或 auto。');
      validateStrings(skill, { modelOverride: 100, providerProfileId: 160, thinkingLevel: 20 }, previous?.[name]);
      if (skill.thinkingLevel !== undefined) requireValid(skill.thinkingLevel === '' || THINKING_LEVELS.includes(skill.thinkingLevel), 'Agent 思考等级无效。');
      if (skill.tools !== undefined) {
        requireValid(isObject(skill.tools) && Object.keys(skill.tools).length <= 24, 'Agent 工具配置最多 24 项。');
        for (const [key, enabled] of Object.entries(skill.tools)) requireValid(/^[a-z][a-z0-9_.]{0,39}$/.test(key) && !UNSAFE_KEYS.has(key) && typeof enabled === 'boolean', 'Agent 工具名称或权限值无效。');
      }
      if (skill.memoryPolicy !== undefined || skill.embedding !== undefined) {
        requireValid(name === 'memoryAgent', '仅记忆 Agent 支持记忆策略和向量设置。');
        if (skill.memoryPolicy !== undefined) {
          validateObject(skill.memoryPolicy, MEMORY_POLICY_FIELDS);
          requireValid(retainsValues(skill.memoryPolicy, normalizeMemoryPolicy(skill.memoryPolicy)), '记忆策略字段类型或范围无效。');
        }
        if (skill.embedding !== undefined) {
          validateObject(skill.embedding, MEMORY_EMBEDDING_FIELDS);
          requireValid(retainsValues(skill.embedding, normalizeMemoryEmbedding(skill.embedding)), '向量设置字段类型或范围无效。');
        }
      }
    }
    return;
  }
  requireValid(Array.isArray(value) && (value.length <= ROOTS[root].limit || value.length <= (previous?.length || 0)), `${root} 列表超过数量限制或类型无效。`);
  if (root === 'tags') {
    for (const tag of value) if (!previous?.includes(tag)) requireValid(typeof tag === 'string' && tag.trim() && tag.length <= 30, '标签必须为 1 至 30 字符的文本。');
    return;
  }
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const original = previous?.find((entry) => isDeepStrictEqual(entry, item) || item?.id !== undefined && entry?.id === item.id) || previous?.[index];
    if (isDeepStrictEqual(item, original)) continue;
    validateObject(item, ITEM_FIELDS[root]);
    if (Object.hasOwn(item, 'id')) requireValid(typeof item.id === 'string' && item.id.length <= 160, '条目 id 无效。');
    if (item.enabled !== undefined) requireValid(typeof item.enabled === 'boolean', 'enabled 必须为布尔值。');
    if (root === 'regexRules' || root === 'renderPlugins') {
      validateStrings(item, { label: 60, pattern: root === 'renderPlugins' ? 260 : 2000, flags: 10, replacement: 1000, titleTemplate: 120, groupName: 60, jsScript: 10000 }, original);
      const scripted = root === 'regexRules' && item.scriptMode === true && typeof item.jsScript === 'string' && item.jsScript.trim();
      requireValid(typeof item.pattern === 'string' && (item.pattern.trim() || scripted), '规则需要有效 pattern，或启用脚本并提供 jsScript。');
      if (item.pattern) requireValid(Boolean(compileSafeRegex(item.pattern, item.flags ?? (root === 'renderPlugins' ? 'u' : 'g'))), '正则表达式无效或不安全。');
      if (item.scope !== undefined) requireValid(['input', 'output', 'both', 'display'].includes(item.scope), '正则 scope 无效。');
      if (item.type !== undefined) requireValid(item.type === 'fold', '渲染插件仅支持 fold 类型。');
      if (item.scriptMode !== undefined) requireValid(typeof item.scriptMode === 'boolean', 'scriptMode 必须为布尔值。');
      if (item.priority !== undefined) requireValid(Number.isSafeInteger(item.priority) && item.priority >= 0, 'priority 必须为非负整数。');
    } else if (root === 'modSuggestions') {
      validateStrings(item, { name: 80, description: 500, content: 6000 }, original);
      requireValid((item.name === undefined || typeof item.name === 'string' && item.name.trim()) && typeof item.content === 'string' && item.content.trim(), 'Mod 建议必须包含 content，name 留空时使用默认名称。');
      if (item.type !== undefined) requireValid(['prompt_inject', 'style_enhance', 'custom'].includes(item.type), 'Mod 建议类型无效。');
    } else {
      validateStrings(item, { name: 40, unit: STATUS_VARIABLE_UNIT_LIMIT, color: 30 }, original);
      requireValid(typeof item.name === 'string' && item.name.trim(), '状态变量需要有效名称。');
      requireValid(item.value === undefined || typeof item.value === 'number' && Number.isFinite(item.value) || typeof item.value === 'string' && item.value.length <= 200, '状态变量 value 必须为有限数字或不超过 200 字符的文本。');
      if (item.type !== undefined) requireValid(STATUS_VARIABLE_TYPES.includes(item.type), '状态变量类型无效。');
      for (const key of ['min', 'max']) if (item[key] !== undefined) requireValid(typeof item[key] === 'number' && Number.isFinite(item[key]), '状态变量范围必须为有限数字。');
      if (item.color !== undefined) requireValid(item.color === '' || /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(item.color), '状态变量颜色必须为十六进制颜色。');
    }
  }
}

function validateObject(value, fields) {
  requireValid(isObject(value) && Object.keys(value).every((key) => fields.includes(key) && !UNSAFE_KEYS.has(key)), '对象包含未知字段或类型无效。');
}

function validateStrings(value, limits, previous) {
  for (const [key, limit] of Object.entries(limits)) if (value[key] !== undefined && !isDeepStrictEqual(value[key], previous?.[key])) requireValid(typeof value[key] === 'string' && value[key].length <= limit, `${key} 必须为文本且不超过 ${limit} 字符。`);
}

function requirePreservedIds(previous, value) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) requirePreservedIds(Array.isArray(previous) ? previous[index] : undefined, value[index]);
  } else if (isObject(value)) {
    requireValid(!Object.hasOwn(value, 'id') || isObject(previous) && value.id === previous.id, '条目 id 不可新增或修改。');
    requireValid(!isObject(previous) || !Object.hasOwn(previous, 'id') || value.id === previous.id, '已有条目 id 不可移除。');
  }
}

function retainsValues(candidate, normalized) {
  if (Array.isArray(candidate)) return Array.isArray(normalized) && candidate.length === normalized.length && candidate.every((value, index) => retainsValues(value, normalized[index]));
  if (isObject(candidate)) return isObject(normalized) && Object.entries(candidate).every(([key, value]) => Object.hasOwn(normalized, key) && retainsValues(value, normalized[key]));
  return isDeepStrictEqual(candidate, normalized);
}

function readPath(value, path) {
  for (const key of path) value = value !== null && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined;
  return value;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function isJsonValue(value, depth = 0) {
  if (depth > 10) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  return isObject(value) && Object.entries(value).every(([key, item]) => !UNSAFE_KEYS.has(key) && isJsonValue(item, depth + 1));
}

function requireValid(condition, message) {
  if (!condition) fail(message, 'DATA_PATCH_INVALID');
}

function fail(message, code) {
  throw Object.assign(new Error(message), { code });
}
