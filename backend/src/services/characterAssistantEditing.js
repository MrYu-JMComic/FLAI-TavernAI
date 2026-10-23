import { CHARACTER_CONTENT_LIMITS } from '../domain/characters/limits.js';
import { normalizeAdvancedSettings } from '../modules/advancedSettings.js';
import { compileSafeRegex } from './regexSafety.js';
import { parseStatusBarRuntime, serializeStatusBarRuntime } from '../../../shared/statusBarRuntime.js';

const TEXT_LIMITS = Object.freeze({
  name: 50, gender: 20, age: 20, visibility: 7,
  ...CHARACTER_CONTENT_LIMITS,
  statusBarPrompt: 50000,
  'statusBarBlueprint.name': 50,
  'statusBarBlueprint.template': 50000,
  'statusBarBlueprint.html': 50000,
  'statusBarBlueprint.css': 50000,
  'statusBarBlueprint.javascript': 50000,
  customCss: 50000, customJs: 50000,
  desktopBackgroundUrl: 6000000, mobileBackgroundUrl: 6000000
});
const STRUCTURED_PATHS = new Set([
  'tags', 'regexRules', 'renderPlugins', 'modSuggestions',
  'statusBarBlueprint', 'statusBarBlueprint.variables', 'accessorySkills', 'authorAdvancedSettings'
]);
const TEXT_PATHS = Object.keys(TEXT_LIMITS);
const READ_PATHS = [...TEXT_PATHS, ...STRUCTURED_PATHS];
const RUNTIME_PATHS = new Set(['statusBarBlueprint.html', 'statusBarBlueprint.css', 'statusBarBlueprint.javascript']);
const ADVANCED_TEXT_PATHS = new Set([
  'statusBarPrompt', 'customCss', 'customJs', 'desktopBackgroundUrl', 'mobileBackgroundUrl'
]);
const MAX_READ_CHARACTERS = 12000;
const MAX_READ_LINES = 120;
const MAX_SEARCH_RESULTS = 30;

export const CHARACTER_DRAFT_READ_TOOLS = new Set(['read_character_field', 'search_character_draft']);
export const CHARACTER_DRAFT_EDIT_TOOL = 'edit_character_text';

export const characterDraftEditingTools = [
  tool('read_character_field', 'Read one current character field before editing. Text is returned verbatim; structured fields are JSON. offset and nextOffset paginate long or minified sources without repeating the whole draft. At most 120 lines and 12000 characters are returned.', {
    path: { type: 'string', enum: READ_PATHS },
    offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: MAX_READ_CHARACTERS }
  }, ['path']),
  tool('search_character_draft', 'Find literal text in the current draft or one path. Returns bounded snippets with field paths, character offsets and line numbers. Read the matching field for precise source. No regular expressions are accepted.', {
    query: { type: 'string', minLength: 1, maxLength: 1000 },
    path: { type: 'string', enum: READ_PATHS },
    caseSensitive: { type: 'boolean', default: true },
    maxResults: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_RESULTS }
  }, ['query']),
  tool(CHARACTER_DRAFT_EDIT_TOOL, 'Apply exact literal text edits atomically. Read first and copy oldText exactly. Each edit must match once unless replaceAll=true explicitly requests every occurrence. All edits succeed together or nothing changes. Only changed snippets are needed; do not repeat complete fields. Use patch_character_data for structured lists and settings.', {
    edits: {
      type: 'array', minItems: 1, maxItems: 30,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          path: { type: 'string', enum: TEXT_PATHS },
          oldText: { type: 'string', minLength: 1, maxLength: 50000 },
          newText: { type: 'string', maxLength: 50000 },
          replaceAll: { type: 'boolean', default: false }
        },
        required: ['path', 'oldText', 'newText']
      }
    }
  }, ['edits'])
];

export function executeCharacterDraftEdit(name, args = {}, draft = {}, { enabledSections = {}, excludeCharacterContext = false } = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return failure('TOOL_ARGUMENTS_INVALID', '工具参数必须是对象。');
  if (CHARACTER_DRAFT_READ_TOOLS.has(name)) {
    if (excludeCharacterContext) return failure('CHARACTER_CONTEXT_EXCLUDED', '本次请求未授权读取现有角色内容。');
    return name === 'read_character_field' ? readField(draft, args) : searchDraft(draft, args);
  }
  if (name !== CHARACTER_DRAFT_EDIT_TOOL) return failure('UNSUPPORTED_TOOL', '不支持的角色编辑工具。');
  if (!Array.isArray(args.edits) || !args.edits.length || args.edits.length > 30) {
    return failure('TOOL_ARGUMENTS_INVALID', 'edits 必须包含 1 至 30 项修改。');
  }

  const next = structuredClone(draft);
  const touched = new Set();
  const changes = [];
  for (let index = 0; index < args.edits.length; index += 1) {
    const edit = args.edits[index];
    const path = edit?.path;
    if (STRUCTURED_PATHS.has(path)) {
      return failure('STRUCTURED_FIELD_REQUIRES_PATCH', '结构化字段请使用 patch_character_data 修改单个属性或列表项。', { path, editIndex: index });
    }
    if (!Object.hasOwn(TEXT_LIMITS, path)) return failure('INVALID_PATH', '不支持此文本字段路径。', { editIndex: index });
    if (enabledSections[sectionForPath(path)] === false) {
      return failure('SECTION_NOT_ENABLED', '目标字段未在本次任务中启用，整批修改未写入。', { path, editIndex: index });
    }
    if (typeof edit.oldText !== 'string' || !edit.oldText || edit.oldText.length > 50000
      || typeof edit.newText !== 'string' || edit.newText.length > 50000
      || (edit.replaceAll !== undefined && typeof edit.replaceAll !== 'boolean')) {
      return failure('TOOL_ARGUMENTS_INVALID', 'oldText 必须非空，newText 必须是文本，每段最多 50000 字符。', { path, editIndex: index });
    }
    const current = fieldSource(next, path);
    if (!current.ok) return { ...current, editIndex: index };
    const occurrences = countOccurrences(current.content, edit.oldText);
    if (!occurrences || (occurrences !== 1 && edit.replaceAll !== true)) {
      return failure(occurrences ? 'AMBIGUOUS_MATCH' : 'TEXT_NOT_FOUND', '精确匹配失败，整批修改未写入。请重新读取当前字段，提供唯一上下文后重试；只有确需全部替换时才设置 replaceAll。', {
        path, editIndex: index, occurrences, expectedOccurrences: edit.replaceAll === true ? 'one-or-more' : 1
      });
    }
    const value = current.content.split(edit.oldText).join(edit.newText);
    writeTextField(next, path, value);
    touched.add(path);
    changes.push({ path, replacements: occurrences, beforeLength: current.content.length, afterLength: value.length });
  }

  for (const path of touched) {
    const current = fieldSource(next, path);
    if (!current.ok) return current;
    if (current.content.length > TEXT_LIMITS[path]) {
      return failure('FIELD_TOO_LARGE', '修改后的字段超过长度上限，整批修改未写入。', { path, length: current.content.length, maxLength: TEXT_LIMITS[path] });
    }
    if (path === 'visibility' && !['private', 'public'].includes(current.content.trim())) {
      return failure('INVALID_VISIBILITY', '展示权限只能是 private 或 public，整批修改未写入。', { path });
    }
  }
  const advancedTouched = [...touched].some(isAdvancedPath);
  const originalAdvanced = draft.authorAdvancedSettings || draft.advancedSettings || {};
  const advancedChanged = advancedTouched && JSON.stringify(next.authorAdvancedSettings || next.advancedSettings || {}) !== JSON.stringify(originalAdvanced);
  if (advancedChanged) {
    const template = next.authorAdvancedSettings?.statusBarBlueprint?.template || '';
    if (touched.has('statusBarBlueprint.template') && parseStatusBarRuntime(originalAdvanced.statusBarBlueprint?.template)
      && !parseStatusBarRuntime(template)) {
      return failure('INVALID_RUNTIME_TEMPLATE', '修改会使代码模式模板失效，整批修改未写入。请使用代码分区路径编辑；切换展示模式请使用完整更新工具。', { path: 'statusBarBlueprint.template' });
    }
    if (template.length > 50000) {
      return failure('TEMPLATE_TOO_LARGE', '序列化后的完整模板超过 50000 字符，整批修改未写入。', { path: 'statusBarBlueprint.template', length: template.length, maxLength: 50000 });
    }
    const rawAdvanced = next.authorAdvancedSettings;
    try {
      next.authorAdvancedSettings = {
        ...next.authorAdvancedSettings,
        ...normalizeAdvancedSettings(next.authorAdvancedSettings)
      };
    } catch (error) {
      return failure('INVALID_ADVANCED_SETTINGS', error.publicMessage || '扩展设置校验失败，整批修改未写入。');
    }
    for (const path of touched) {
      if (ADVANCED_TEXT_PATHS.has(path) && path.endsWith('BackgroundUrl')) {
        const expected = fieldSource(next, path).content;
        if (!expected && String(rawAdvanced[path] || '').trim()) {
          return failure('INVALID_BACKGROUND_URL', '背景图片地址无效，整批修改未写入。', { path });
        }
      }
    }
  }
  for (const path of touched) if (!isAdvancedPath(path)) next[path] = next[path].trim();
  const changed = [...touched].some(path => !isAdvancedPath(path) && next[path] !== draft[path])
    || (advancedChanged && JSON.stringify(next.authorAdvancedSettings) !== JSON.stringify(originalAdvanced));
  if (changed) {
    for (const path of touched) if (!isAdvancedPath(path)) draft[path] = next[path];
    if (advancedChanged) draft.authorAdvancedSettings = next.authorAdvancedSettings;
  }
  return { ok: true, changed, sections: changed ? [...new Set([...touched].map(sectionForPath))] : [], changes };
}

function readField(draft, args) {
  const source = fieldSource(draft, args.path);
  if (!source.ok) return source;
  const offset = args.offset ?? 0;
  const limit = args.limit ?? 4000;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.content.length
    || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_READ_CHARACTERS) {
    return failure('INVALID_READ_RANGE', 'offset 必须位于字段范围内；limit 必须为 1 至 12000。', { path: args.path, totalLength: source.content.length });
  }
  let content = source.content.slice(offset, offset + limit);
  let cursor = -1;
  for (let line = 0; line < MAX_READ_LINES; line += 1) {
    cursor = content.indexOf('\n', cursor + 1);
    if (cursor < 0) break;
    if (line === MAX_READ_LINES - 1) content = content.slice(0, cursor + 1);
  }
  const endOffset = offset + content.length;
  const truncated = endOffset < source.content.length;
  return {
    ok: true, changed: false, path: args.path, format: source.format, content,
    offset, endOffset, nextOffset: truncated ? endOffset : null,
    totalLength: source.content.length, startLine: 1 + countNewlines(source.content, offset),
    lineCount: content ? countNewlines(content) + (content.endsWith('\n') ? 0 : 1) : 0,
    truncated
  };
}

function searchDraft(draft, args) {
  if (typeof args.query !== 'string' || !args.query || args.query.length > 1000
    || (args.caseSensitive !== undefined && typeof args.caseSensitive !== 'boolean')) {
    return failure('TOOL_ARGUMENTS_INVALID', 'query 必须包含 1 至 1000 个字符，且只按原样文本搜索。');
  }
  if (args.path !== undefined && !READ_PATHS.includes(args.path)) return failure('INVALID_PATH', '不支持此字段路径。');
  const maxResults = args.maxResults ?? 20;
  if (!Number.isSafeInteger(maxResults) || maxResults < 1 || maxResults > MAX_SEARCH_RESULTS) {
    return failure('TOOL_ARGUMENTS_INVALID', 'maxResults 必须为 1 至 30。');
  }
  const regex = compileSafeRegex(args.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), args.caseSensitive === false ? 'giu' : 'gu');
  if (!regex) return failure('TOOL_ARGUMENTS_INVALID', '无法搜索此文本，请缩短 query 后重试。');
  const matches = [];
  // Broad searches use leaf paths to avoid duplicate copies of nested settings.
  const runtime = parseStatusBarRuntime((draft.authorAdvancedSettings || draft.advancedSettings)?.statusBarBlueprint?.template);
  const paths = args.path ? [args.path] : READ_PATHS.filter(path => !['statusBarBlueprint', 'authorAdvancedSettings'].includes(path)
    && !(runtime && path === 'statusBarBlueprint.template'));
  for (const path of paths) {
    const source = fieldSource(draft, path);
    if (!source.ok) {
      if (args.path) return source;
      continue;
    }
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(source.content))) {
      if (matches.length === maxResults) return { ok: true, changed: false, matches, truncated: true };
      const offset = match.index;
      const snippetStart = Math.max(0, offset - 60);
      const snippetEnd = Math.min(source.content.length, offset + Math.min(match[0].length, 120) + 60);
      matches.push({ path, offset, line: 1 + countNewlines(source.content, offset), snippet: source.content.slice(snippetStart, snippetEnd), snippetOffset: snippetStart });
    }
  }
  return { ok: true, changed: false, matches, truncated: false };
}

function fieldSource(draft, path) {
  if (!READ_PATHS.includes(path)) return failure('INVALID_PATH', '不支持此字段路径。');
  const advanced = draft.authorAdvancedSettings || draft.advancedSettings || {};
  let value;
  if (RUNTIME_PATHS.has(path)) {
    const runtime = parseStatusBarRuntime(advanced.statusBarBlueprint?.template);
    if (!runtime) return failure('RUNTIME_REQUIRED', '此分区仅适用于代码模式。请读取 statusBarBlueprint.template，并直接编辑当前模板。', { path });
    value = runtime[path.slice('statusBarBlueprint.'.length)];
  } else if (path === 'authorAdvancedSettings') value = advanced;
  else if (path === 'accessorySkills') value = advanced.accessorySkills || {};
  else if (path === 'statusBarBlueprint') value = advanced.statusBarBlueprint || {};
  else if (path.startsWith('statusBarBlueprint.')) value = advanced.statusBarBlueprint?.[path.slice('statusBarBlueprint.'.length)];
  else if (ADVANCED_TEXT_PATHS.has(path)) value = advanced[path];
  else value = draft[path];
  return { ok: true, content: STRUCTURED_PATHS.has(path) ? JSON.stringify(value ?? [], null, 2) : String(value ?? ''), format: STRUCTURED_PATHS.has(path) ? 'json' : 'text' };
}

function writeTextField(draft, path, value) {
  if (!isAdvancedPath(path)) {
    draft[path] = value;
    return;
  }
  draft.authorAdvancedSettings ||= structuredClone(draft.advancedSettings || {});
  const advanced = draft.authorAdvancedSettings;
  if (RUNTIME_PATHS.has(path)) {
    const runtime = parseStatusBarRuntime(advanced.statusBarBlueprint.template);
    runtime[path.slice('statusBarBlueprint.'.length)] = value;
    advanced.statusBarBlueprint.template = serializeStatusBarRuntime(runtime);
  } else if (path.startsWith('statusBarBlueprint.')) {
    advanced.statusBarBlueprint ||= {};
    advanced.statusBarBlueprint[path.slice('statusBarBlueprint.'.length)] = value;
  } else advanced[path] = value;
}

function isAdvancedPath(path) {
  return ADVANCED_TEXT_PATHS.has(path) || path.startsWith('statusBarBlueprint.');
}

function sectionForPath(path) {
  return isAdvancedPath(path) ? 'advancedSettings' : ['name', 'gender', 'age', 'visibility'].includes(path) ? 'profile' : path;
}

function countOccurrences(source, query) {
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(query, offset)) !== -1) {
    count += 1;
    offset += query.length;
  }
  return count;
}

function countNewlines(source, end = source.length) {
  let count = 0;
  let offset = -1;
  while ((offset = source.indexOf('\n', offset + 1)) !== -1 && offset < end) count += 1;
  return count;
}

function failure(error, message, details = {}) {
  return { ok: false, changed: false, error, message, recoverable: true, ...details };
}

function tool(name, description, properties, required) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } };
}
