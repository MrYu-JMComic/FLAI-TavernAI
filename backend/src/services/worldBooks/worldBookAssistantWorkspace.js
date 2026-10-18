import { newId } from '../../security.js';
import { WORLD_BOOK_ENTRY_FIELDS, WORLD_BOOK_PROFILE_FIELDS, worldBookRevision } from '../../domain/worldBooks/revision.js';
import { listOwnedWorldBookCharacterLinks } from '../../repositories/worldBookRepository.js';
import { getWorldBook, listWorldBooks } from './worldBookService.js';
import {
  WORLD_BOOK_DRAFT_SCHEMA,
  WORLD_BOOK_DRAFT_TOOLS,
  isUsableWorldBookEntry,
  mergeWorldBookProfile,
  normalizeWorldBookEntry
} from '../worldBookDraftTools.js';
import { objectOrEmpty } from '../assistantUtils.js';
import { WORLD_BOOK_ASSISTANT_ENTRY_LIMIT } from '../../domain/worldBooks/limits.js';
import { buildWorldBookMatchPreview } from './worldBookMatchPreview.js';

const PROFILE_FIELDS = WORLD_BOOK_PROFILE_FIELDS;
const ENTRY_FIELDS = WORLD_BOOK_ENTRY_FIELDS;
const TARGET_SCHEMA = { type: 'string', description: '工作区目标 ref；省略时使用当前活动目标。' };
const READ_TOOLS = [
  tool('search_world_books', '检索当前用户已有世界书的名称、描述、关联角色和条目。只返回目录；找到目标后用 select_world_book/read_world_book 读取。', {
    query: { type: 'string', maxLength: 200 },
    offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 30 }
  }),
  tool('select_world_book', '选择已有世界书为本次活动目标，不修改数据，也不改变角色长期关联。其他书的草稿继续保留。', {
    bookId: { type: 'string', minLength: 1 }, targetRef: TARGET_SCHEMA
  }),
  tool('read_world_book', '读取目标的资料和条目目录；提供 entryIds 读取指定正文，或 query 检索条目正文。目录和正文都支持分页。返回最新未应用草稿。', {
    targetRef: TARGET_SCHEMA, bookId: { type: 'string' },
    entryIds: { type: 'array', items: { type: 'string' }, maxItems: 30 },
    query: { type: 'string', maxLength: 200 },
    includeContent: { type: 'boolean', description: '设为 true 读取一页正文；有 query 或 entryIds 时默认返回正文，设为 false 只返回目录。' },
    offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 30 }
  })
];

function tool(name, description, properties, required = []) {
  return { type: 'function', function: { name, description, parameters: {
    type: 'object', properties, required, additionalProperties: false
  } } };
}

export function worldBookWorkspaceTools({ planPhase = false } = {}) {
  const reads = [...READ_TOOLS, withTarget(WORLD_BOOK_DRAFT_TOOLS.find((item) => item.function.name === 'preview_world_book_entries'))];
  if (planPhase) return reads;
  return [
    ...reads,
    tool('create_world_book', '创建独立的新世界书草稿并切换为活动目标。无论是否选中了已有书都可以调用；追加结果，不覆盖或修改原书。可先建资料再分批写条目。', {
      ...WORLD_BOOK_DRAFT_SCHEMA.properties,
      localId: { type: 'string', description: '重试同一创建操作时复用该 ID；通常省略由系统生成。' }
    }),
    ...WORLD_BOOK_DRAFT_TOOLS.filter((item) => item.function.name !== 'preview_world_book_entries').map(withTarget),
    tool('finish_world_book_task', '本轮完成后提交回复并结束。可以只回答查询或提出必要的简短澄清，无需产生变更。', {
      reply: { type: 'string', maxLength: 8000 }
    }, ['reply'])
  ];
}

function withTarget(source) {
  const copy = structuredClone(source);
  copy.function.parameters.properties.targetRef = TARGET_SCHEMA;
  if (copy.function.name === 'replace_world_book_entries') {
    copy.function.description = '完整替换新建草稿的条目，最多 30 条。已有世界书必须按条目 ID 使用 upsert/remove，不能用未列出的条目推断删除。';
  }
  return copy;
}

// The serialized workspace contains only pending changes and target identity.
// Existing full books stay in a request-local cache, never in the model prompt.
export function createWorldBookWorkspace({ database, userId, selectedBookIds = [], workspace: raw, current } = {}) {
  const source = objectOrEmpty(raw);
  const workspace = { version: 1, activeRef: '', selectedBookIds: [], targets: [] };
  Object.defineProperties(workspace, {
    _database: { value: database }, _userId: { value: userId },
    _books: { value: new Map() }, _finished: { value: false, writable: true },
    _reply: { value: '', writable: true }
  });
  for (const candidate of Array.isArray(source.targets) ? source.targets : []) {
    const item = objectOrEmpty(candidate);
    if (item.bookId) {
      const target = addExistingTarget(workspace, String(item.bookId));
      if (!target) throw workspaceError('对话中的世界书已不存在或不可访问，请刷新目标后继续。', 404);
      target.baseRevision = String(item.baseRevision || target.baseRevision);
      // Keep the original profile for an accurate before/after preview across turns.
      if (item.profile && typeof item.profile === 'object') target.profile = pick(item.profile, PROFILE_FIELDS);
      mergeWorldBookProfile(target.profilePatch, pick(item.profilePatch, PROFILE_FIELDS));
      for (const upsert of Array.isArray(item.upserts) ? item.upserts : []) {
        if (!upsert?.entryId && !upsert?.localId) continue;
        const currentEntry = readBook(workspace, target.bookId)?.entries.find((entry) => entry.id === upsert.entryId);
        const fields = pick(upsert.patch, ENTRY_FIELDS);
        const normalized = normalizeWorldBookEntry({ ...objectOrEmpty(upsert.before), ...currentEntry, ...fields, id: upsert.entryId || upsert.localId });
        // Keep the original intended patch even if another editor removed this
        // entry. Applying must report the revision conflict instead of silently
        // forgetting a pending change while restoring the conversation.
        target.upserts.push({
          ...(upsert.entryId ? { entryId: String(upsert.entryId) } : { localId: String(upsert.localId) }),
          patch: pick(normalized, upsert.entryId ? Object.keys(fields) : ENTRY_FIELDS),
          ...(upsert.before ? { before: pick(upsert.before, ENTRY_FIELDS) } : {})
        });
      }
      for (const removal of Array.isArray(item.removals) ? item.removals : []) {
        const entryId = typeof removal === 'string' ? removal : removal?.entryId;
        const before = typeof removal === 'object' ? removal.before : undefined;
        if (!entryId) continue;
        target.removals.push({ entryId, ...(before ? { before: pick(before, ENTRY_FIELDS) } : {}) });
      }
    } else if (typeof item.ref === 'string' && item.ref.startsWith('new:')) {
      const target = newTarget(item.ref.slice(4), item.profile);
      target.entries = (Array.isArray(item.entries) ? item.entries : []).map((entry, index) => normalizeWorldBookEntry(entry, index));
      workspace.targets.push(target);
    }
  }
  workspace.selectedBookIds = [...new Set((Array.isArray(selectedBookIds) ? selectedBookIds : []).map(String).filter(Boolean))];
  for (const bookId of workspace.selectedBookIds) {
    if (!addExistingTarget(workspace, bookId)) throw workspaceError('所选世界书不存在或已不可访问。', 404);
  }
  if (!database && !workspace.targets.length && current !== undefined) {
    const target = newTarget(newId(), current);
    // Compatibility input is still a draft, but retaining every entry avoids truncation.
    target.entries = (Array.isArray(current?.entries) ? current.entries : []).map((entry, index) => normalizeWorldBookEntry(entry, index));
    workspace.targets.push(target);
  }
  workspace.activeRef = workspace.targets.some((target) => target.ref === source.activeRef)
    ? source.activeRef
    : workspace.targets.find((target) => target.bookId === workspace.selectedBookIds[0])?.ref || workspace.targets[0]?.ref || '';
  return workspace;
}

function newTarget(localId, profile) {
  const normalized = { name: '', description: '', scanDepth: 4, lorebookContextPercent: 25 };
  mergeWorldBookProfile(normalized, objectOrEmpty(profile));
  return { ref: `new:${localId}`, bookId: null, baseRevision: null, profile: normalized, linkedCharacterCount: 0, entries: [], profilePatch: {}, upserts: [], removals: [] };
}

function readBook(workspace, bookId) {
  if (!workspace._database) return null;
  if (!workspace._books.has(bookId)) workspace._books.set(bookId, getWorldBook(workspace._database, workspace._userId, bookId));
  return workspace._books.get(bookId);
}

function addExistingTarget(workspace, bookId) {
  const present = workspace.targets.find((target) => target.bookId === bookId);
  if (present) return present;
  const book = readBook(workspace, bookId);
  if (!book) return null;
  const target = { ref: `existing:${book.id}`, bookId: book.id, baseRevision: book.revision || worldBookRevision(book), profile: pick(book, PROFILE_FIELDS), linkedCharacterCount: book.linkedCharacters?.length || 0, profilePatch: {}, upserts: [], removals: [] };
  workspace.targets.push(target);
  return target;
}

export function serializeWorldBookWorkspace(workspace) {
  return structuredClone({ version: 1, activeRef: workspace.activeRef, selectedBookIds: workspace.selectedBookIds, targets: workspace.targets });
}

export function worldBookWorkspaceContext(workspace) {
  return {
    activeRef: workspace.activeRef,
    selectedBookIds: workspace.selectedBookIds,
    targets: workspace.targets.map((target) => {
      const entries = effectiveEntries(workspace, target);
      return { ref: target.ref, bookId: target.bookId, baseRevision: target.baseRevision, profile: effectiveProfile(target), linkedCharacterCount: target.linkedCharacterCount, entryCount: entries.length, entries: entries.slice(0, 60).map(entryDirectory), directoryHasMore: entries.length > 60, pending: changeCounts(target) };
    })
  };
}

export function buildWorldBookChanges(workspace) {
  const changes = [];
  for (const target of workspace.targets) {
    if (!target.bookId) {
      if (!target.profile.name) continue;
      changes.push({ ref: target.ref, bookId: null, baseRevision: null, name: target.profile.name, profile: structuredClone(target.profile), entries: structuredClone(target.entries), upserts: [], removals: [], linkedCharacterCount: 0 });
    } else if (Object.keys(target.profilePatch).length || target.upserts.length || target.removals.length) {
      changes.push({ ref: target.ref, bookId: target.bookId, baseRevision: target.baseRevision, name: effectiveProfile(target).name, profile: structuredClone(target.profilePatch), before: structuredClone(target.profile), upserts: structuredClone(target.upserts), removals: target.removals.map((entry) => entry.entryId), removedEntries: structuredClone(target.removals), linkedCharacterCount: target.linkedCharacterCount });
    }
  }
  return changes;
}

export function executeWorldBookWorkspaceTool(workspace, name, args = {}) {
  const input = objectOrEmpty(args);
  if (name === 'finish_world_book_task') {
    workspace._finished = true;
    workspace._reply = String(input.reply || '').trim();
    return { ok: true, stop: true, reply: workspace._reply };
  }
  if (name === 'search_world_books') return searchBooks(workspace, input);
  if (name === 'create_world_book' || name === 'create_character_world_book') {
    const localId = String(input.localId || newId());
    const existing = workspace.targets.find((target) => target.ref === `new:${localId}`);
    if (existing) { workspace.activeRef = existing.ref; return { ok: true, targetRef: existing.ref, reused: true }; }
    const target = newTarget(localId, input);
    if (Array.isArray(input.entries)) {
      const result = replaceEntries(target, input.entries);
      if (!result.ok) return result;
    }
    workspace.targets.push(target);
    workspace.activeRef = target.ref;
    return { ok: true, targetRef: target.ref, profile: target.profile, count: target.entries.length };
  }
  if (name === 'select_world_book') {
    const target = input.bookId ? addExistingTarget(workspace, String(input.bookId)) : resolveTarget(workspace, input);
    if (!target) return { ok: false, error: 'WORLD_BOOK_NOT_FOUND', message: '目标世界书不存在，请检索目录或简短澄清。' };
    workspace.activeRef = target.ref;
    return { ok: true, targetRef: target.ref, ...targetSummary(workspace, target) };
  }
  const target = input.bookId ? addExistingTarget(workspace, String(input.bookId)) : resolveTarget(workspace, input);
  if (!target) return { ok: false, error: 'WORLD_BOOK_TARGET_REQUIRED', message: '请先 select_world_book 选择已有书，或 create_world_book 创建独立新书。' };
  if (name === 'read_world_book') return readTarget(workspace, target, input);
  if (name === 'set_world_book_profile') {
    const next = effectiveProfile(target);
    mergeWorldBookProfile(next, pick(input, PROFILE_FIELDS));
    if (!next.name && Object.hasOwn(input, 'name')) return { ok: false, error: 'WORLD_BOOK_NAME_INVALID' };
    if (!target.bookId) target.profile = next;
    else target.profilePatch = diff(target.profile, next, PROFILE_FIELDS);
    return { ok: true, targetRef: target.ref, applied: pick(next, Object.keys(pick(input, PROFILE_FIELDS))) };
  }
  if (name === 'replace_world_book_entries') {
    if (target.bookId) return { ok: false, error: 'USE_INCREMENTAL_EDITS', message: '已有书仅按 ID 增改删；完整替换会丢失未读取条目。请使用 upsert/remove。' };
    return { ...replaceEntries(target, input.entries), targetRef: target.ref };
  }
  if (name === 'upsert_world_book_entry') return upsertEntry(workspace, target, input);
  if (name === 'remove_world_book_entry') return removeEntry(workspace, target, input.entryId);
  if (name === 'preview_world_book_entries') {
    const preview = buildWorldBookMatchPreview({ ...effectiveProfile(target), entries: effectiveEntries(workspace, target) }, { text: input.text });
    return { ok: true, targetRef: target.ref, matchCount: preview.matchCount, matches: preview.matches.slice(0, 30), explanations: preview.explanations.slice(0, 30), groups: preview.groups.slice(0, 30), truncated: preview.explanations.length > 30 };
  }
  return { ok: false, error: `Unknown world book tool: ${name}` };
}

function resolveTarget(workspace, input) {
  return workspace.targets.find((target) => target.ref === (input.targetRef || workspace.activeRef));
}

function effectiveProfile(target) { return { ...target.profile, ...target.profilePatch }; }

function effectiveEntries(workspace, target) {
  if (!target.bookId) return target.entries;
  const removed = new Set(target.removals.map((entry) => entry.entryId));
  const patches = new Map(target.upserts.filter((entry) => entry.entryId).map((entry) => [entry.entryId, entry.patch]));
  const entries = (readBook(workspace, target.bookId)?.entries || []).filter((entry) => !removed.has(entry.id)).map((entry) => ({ ...entry, ...patches.get(entry.id) }));
  for (const entry of target.upserts) if (!entry.entryId) entries.push({ id: entry.localId, ...entry.patch });
  return entries;
}

function upsertEntry(workspace, target, input) {
  const entries = effectiveEntries(workspace, target);
  const existing = input.entryId ? entries.find((entry) => entry.id === input.entryId) : null;
  if (input.entryId && !existing) return { ok: false, error: 'ENTRY_NOT_FOUND' };
  const fields = pick(input.changes, ENTRY_FIELDS);
  if (!Object.keys(fields).length) return { ok: false, error: 'WORLD_BOOK_ENTRY_INVALID' };
  const nextOrder = entries.reduce((maximum, entry) => Math.max(maximum, Number(entry.orderIndex) || 0), -1) + 1;
  const next = normalizeWorldBookEntry({ ...existing, ...fields, id: existing?.id || newId() }, existing?.orderIndex ?? nextOrder);
  if (!isUsableWorldBookEntry(next) && (!existing || isUsableWorldBookEntry(existing))) return { ok: false, error: 'WORLD_BOOK_ENTRY_INVALID', message: '新增或改写条目需有名称、正文与必要触发词。' };
  if (!target.bookId) {
    if (existing) target.entries[target.entries.findIndex((entry) => entry.id === existing.id)] = next;
    else target.entries.push(next);
  } else {
    const pending = input.entryId ? target.upserts.find((entry) => entry.entryId === input.entryId || entry.localId === input.entryId) : null;
    if (existing && (pending?.entryId || !pending)) {
      const original = readBook(workspace, target.bookId)?.entries.find((entry) => entry.id === existing.id);
      const patch = diff(original || existing, { ...existing, ...pick(next, Object.keys(fields)) }, ENTRY_FIELDS);
      target.upserts = target.upserts.filter((entry) => entry.entryId !== existing.id);
      if (Object.keys(patch).length) target.upserts.push({ entryId: existing.id, patch, before: pick(original || existing, ENTRY_FIELDS) });
    } else if (pending) pending.patch = pick(next, ENTRY_FIELDS);
    else target.upserts.push({ localId: next.id, patch: pick(next, ENTRY_FIELDS) });
  }
  return { ok: true, targetRef: target.ref, entry: next, count: effectiveEntries(workspace, target).length };
}

function removeEntry(workspace, target, entryId) {
  const existing = effectiveEntries(workspace, target).find((entry) => entry.id === entryId);
  if (!existing) return { ok: false, error: 'ENTRY_NOT_FOUND' };
  if (!target.bookId) target.entries = target.entries.filter((entry) => entry.id !== entryId);
  else {
    const added = target.upserts.some((entry) => entry.localId === entryId);
    target.upserts = target.upserts.filter((entry) => entry.entryId !== entryId && entry.localId !== entryId);
    if (!added) {
      const original = readBook(workspace, target.bookId)?.entries.find((entry) => entry.id === entryId);
      target.removals.push({ entryId, before: pick(original || existing, ENTRY_FIELDS) });
    }
  }
  return { ok: true, targetRef: target.ref, removedEntryId: entryId, count: effectiveEntries(workspace, target).length };
}

function replaceEntries(target, raw) {
  if (!Array.isArray(raw) || raw.length > WORLD_BOOK_ASSISTANT_ENTRY_LIMIT) return { ok: false, error: 'ENTRY_LIMIT', message: '每批最多生成 30 条，请分批补充。' };
  const entries = raw.map((entry, index) => normalizeWorldBookEntry(entry, index));
  if (entries.some((entry) => !isUsableWorldBookEntry(entry))) return { ok: false, error: 'WORLD_BOOK_ENTRIES_INVALID' };
  target.entries = entries;
  return { ok: true, count: entries.length };
}

function readTarget(workspace, target, input) {
  const ids = Array.isArray(input.entryIds) ? new Set(input.entryIds) : null;
  const query = String(input.query || '').trim().toLocaleLowerCase();
  const entries = effectiveEntries(workspace, target).filter((entry) => (!ids || ids.has(entry.id)) && (!query || `${entry.name}\n${entry.triggerKeys}\n${entry.content}`.toLocaleLowerCase().includes(query)));
  const offset = clamp(input.offset, 0, Number.MAX_SAFE_INTEGER, 0);
  const limit = clamp(input.limit, 1, 30, 20);
  const includeContent = input.includeContent === true || (input.includeContent !== false && (ids || query));
  return { ok: true, targetRef: target.ref, profile: effectiveProfile(target), linkedCharacterCount: target.linkedCharacterCount, total: entries.length, offset, hasMore: offset + limit < entries.length, entries: entries.slice(offset, offset + limit).map((entry) => includeContent ? structuredClone(entry) : entryDirectory(entry)) };
}

function searchBooks(workspace, input) {
  if (!workspace._database) return { ok: true, books: [], total: 0 };
  const query = String(input.query || '').trim().toLocaleLowerCase();
  const results = [];
  for (const item of listWorldBooks(workspace._database, workspace._userId)) {
    const book = readBook(workspace, item.id);
    const linkedCharacters = listOwnedWorldBookCharacterLinks(workspace._database, workspace._userId, item.id).map(({ id, name }) => ({ id, name }));
    const haystack = `${book.name}\n${book.description}\n${linkedCharacters.map((character) => character.name).join('\n')}\n${book.entries.map((entry) => `${entry.name}\n${entry.triggerKeys}\n${entry.content}`).join('\n')}`.toLocaleLowerCase();
    if (query && !haystack.includes(query)) continue;
    results.push({ bookId: book.id, ref: `existing:${book.id}`, name: book.name, description: book.description, entryCount: book.entries.length, linkedCharacters, entryNames: book.entries.slice(0, 12).map((entry) => entry.name) });
  }
  const offset = clamp(input.offset, 0, Number.MAX_SAFE_INTEGER, 0);
  const limit = clamp(input.limit, 1, 30, 20);
  return { ok: true, books: results.slice(offset, offset + limit), total: results.length, hasMore: offset + limit < results.length };
}

function targetSummary(workspace, target) { return { profile: effectiveProfile(target), linkedCharacterCount: target.linkedCharacterCount, entryCount: effectiveEntries(workspace, target).length }; }
function entryDirectory(entry) { return { id: entry.id, name: entry.name, triggerKeys: entry.triggerKeys, enabled: entry.enabled, orderIndex: entry.orderIndex, contentLength: entry.content?.length || 0 }; }
function changeCounts(target) { return { added: target.bookId ? target.upserts.filter((entry) => !entry.entryId).length : target.entries.length, updated: target.upserts.filter((entry) => entry.entryId).length, removed: target.removals.length, profile: Object.keys(target.profilePatch).length }; }
function pick(value, fields) { const source = objectOrEmpty(value); return Object.fromEntries(fields.filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]])); }
function diff(before, after, fields) { return Object.fromEntries(fields.filter((key) => Object.hasOwn(after, key) && after[key] !== before[key]).map((key) => [key, after[key]])); }
function clamp(value, min, max, fallback) { const number = Number(value); return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback; }
function workspaceError(message, status) { const error = new Error(message); error.status = status; error.publicMessage = message; return error; }
