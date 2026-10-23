import { getCharacter } from './characters.js';
import { normalizeAdvancedSettings } from './advancedSettings.js';
import { newId, nowIso } from '../security.js';
import { parseJson } from '../utils/json.js';
import { withSavepoint } from './savepoint.js';
import { prepareUserChatAttachmentsForStorage } from '../services/chatAttachments.js';
import { listOwnedLinkedBookIdsForCharacter } from '../repositories/worldBookRepository.js';
import { getCharacterTagsMap } from './tags.js';

const activeRuns = new WeakMap();
const DRAFT_VERSION_LIMIT = 30;
const DRAFT_VERSION_MAX_CHARS = 16_000_000;
const DRAFT_STATE_FIELDS = [
  'worldBookWorkspace', 'worldBookChanges', 'selectedWorldBookIds', 'worldBookLinkDraft', 'avatarDraft',
  'worldBookTargetOverride', 'worldBookAutomatic', 'modSuggestions'
];
const READ_ONLY_CHECKPOINT_TOOLS = new Set([
  'report_character_progress', 'finish_character_draft',
  'search_world_books', 'select_world_book', 'read_world_book', 'preview_world_book_entries'
]);
const SESSION_PREFERENCE_TYPES = {
  version: 'number', providerProfileId: 'string', modelOverride: 'string', thinkingLevel: 'string',
  providerStreaming: 'boolean', worldBookAutomatic: 'boolean'
};
const ASSISTANT_SECTION_KEYS = [
  'profile', 'background', 'worldview', 'persona', 'openingMessage', 'tags', 'regexRules',
  'renderPlugins', 'worldBook', 'advancedSettings', 'modSuggestions'
];

function sessionError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function objectValue(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw sessionError(`${field} 必须是对象。`);
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > 4000000) throw sessionError(`${field} 内容过长。`);
  return JSON.parse(serialized);
}

function editableCharacter(database, userId, characterId) {
  const character = getCharacter(database, userId, characterId);
  if (!character) throw sessionError('角色不存在。', 404);
  if (!character.canEdit) throw sessionError('只有角色拥有者可以维护角色助手会话。', 403);
  return character;
}

function settleInterruptedPlanPhase(state) {
  if (!['failed', 'paused'].includes(state.status)) return;
  if (state.planPhase === 'executing') state.planPhase = state.status;
  if (state.planPhase === 'planning') state.planPhase = state.plan?.steps?.length ? 'review' : 'idle';
}

function toSession(row, running = false) {
  if (!row) return null;
  const state = parseJson(row.state_json, {});
  // A process restart drops the in-memory reservation. Return recoverable
  // state without leaving the client locked by an abandoned persisted run.
  if (state.status === 'running' && !running) {
    state.status = 'paused';
    state.statusMessage = '上次运行已中断，阶段结果已恢复';
    state.lastRunStatus = 'cancelled';
  }
  settleInterruptedPlanPhase(state);
  return {
    id: row.id,
    characterId: row.character_id || null,
    title: row.title,
    character: parseJson(row.character_json, {}),
    messages: parseJson(row.messages_json, []),
    state,
    draftVersionCount: Number(row.draft_version_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function getCharacterAssistantSession(database, userId, sessionId) {
  const row = database.prepare(`SELECT sessions.*, (SELECT COUNT(*) FROM character_assistant_draft_versions versions
    WHERE versions.session_id = sessions.id AND versions.user_id = sessions.user_id) AS draft_version_count
    FROM character_assistant_sessions sessions WHERE sessions.id = ? AND sessions.user_id = ?`).get(sessionId, userId);
  if (row?.character_id) editableCharacter(database, userId, row.character_id);
  return toSession(row, activeRuns.get(database)?.has(sessionId));
}

export function listCharacterAssistantSessions(database, userId, { characterId, unbound } = {}) {
  let condition = '';
  const params = [userId];
  if (characterId && characterId !== 'unbound') {
    editableCharacter(database, userId, characterId);
    condition = ' AND sessions.character_id = ?';
    params.push(characterId);
  } else if (unbound || characterId === 'unbound') {
    condition = ' AND sessions.character_id IS NULL';
  }
  return database.prepare(`SELECT sessions.*, (SELECT COUNT(*) FROM character_assistant_draft_versions versions
      WHERE versions.session_id = sessions.id AND versions.user_id = sessions.user_id) AS draft_version_count
    FROM character_assistant_sessions sessions
    WHERE sessions.user_id = ?${condition}
      AND (sessions.character_id IS NULL OR EXISTS (
        SELECT 1 FROM characters WHERE characters.id = sessions.character_id AND characters.user_id = sessions.user_id
      ))
    ORDER BY sessions.updated_at DESC, sessions.rowid DESC`).all(...params)
    .map(row => toSession(row, activeRuns.get(database)?.has(row.id)));
}

export function createCharacterAssistantSession(database, userId, payload = {}) {
  const characterId = String(payload.characterId || '').trim() || null;
  const sourceCharacter = characterId ? editableCharacter(database, userId, characterId) : {};
  const character = payload.character === undefined ? sourceCharacter : objectValue(payload.character, '角色草稿');
  const state = payload.state === undefined ? {} : objectValue(payload.state, '会话设置');
  const title = String(payload.title || character.name || '新会话').trim().slice(0, 120) || '新会话';
  const id = newId();
  const timestamp = nowIso();
  database.prepare(`INSERT INTO character_assistant_sessions
    (id, user_id, character_id, title, character_json, messages_json, state_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?)`).run(id, userId, characterId, title, JSON.stringify(character), JSON.stringify(state), timestamp, timestamp);
  return getCharacterAssistantSession(database, userId, id);
}

function ensureIdle(database, sessionId) {
  if (activeRuns.get(database)?.has(sessionId)) throw sessionError('此会话正在生成，请先停止或等待完成。', 409);
}

export function assertCharacterAssistantSessionIdle(database, userId, sessionId) {
  const session = getCharacterAssistantSession(database, userId, sessionId);
  if (!session) return null;
  ensureIdle(database, sessionId);
  return session;
}

export function updateCharacterAssistantSession(database, userId, sessionId, payload = {}) {
  const session = getCharacterAssistantSession(database, userId, sessionId);
  if (!session) return null;
  ensureIdle(database, sessionId);
  if (Object.hasOwn(payload, 'characterId')) {
    const characterId = String(payload.characterId || '').trim() || null;
    if (characterId) editableCharacter(database, userId, characterId);
    if (session.characterId && characterId !== session.characterId) {
      throw sessionError('已绑定的会话不能改绑到其他角色。');
    }
    session.characterId = characterId;
  }
  if (Object.hasOwn(payload, 'title')) session.title = String(payload.title || '').trim().slice(0, 120) || '新会话';
  if (Object.hasOwn(payload, 'character')) session.character = objectValue(payload.character, '角色草稿');
  if (Object.hasOwn(payload, 'state')) session.state = objectValue(payload.state, '会话设置');
  // Validate only new input. Generated checkpoints and tool history already on
  // the server may be larger than the client write limit and need not be echoed.
  if (Object.hasOwn(payload, 'characterPatch')) {
    session.character = { ...session.character, ...objectValue(payload.characterPatch, '角色草稿') };
  }
  if (Object.hasOwn(payload, 'statePatch')) {
    const patch = objectValue(payload.statePatch, '会话设置');
    session.state = { ...session.state, ...patch };
    // World-book edits also belong to the saved continuation/plan snapshots.
    // Reuse their canonical fields so clients need not send every copy again.
    const worldBooks = Object.fromEntries(['worldBookWorkspace', 'worldBookChanges']
      .filter(key => Object.hasOwn(patch, key)).map(key => [key, patch[key]]));
    if (Object.keys(worldBooks).length && !Object.hasOwn(patch, 'checkpoint') && session.state.checkpoint?.character) {
      session.state.checkpoint = {
        ...session.state.checkpoint,
        character: { ...session.state.checkpoint.character, ...worldBooks }
      };
    }
    if (Object.hasOwn(patch, 'worldBookWorkspace') && !Object.hasOwn(patch, 'planContext') && session.state.planContext?.worldBookContext) {
      session.state.planContext = {
        ...session.state.planContext,
        worldBookContext: { ...session.state.planContext.worldBookContext, workspace: patch.worldBookWorkspace }
      };
    }
  }
  return saveSession(database, userId, session);
}

export function deleteCharacterAssistantSession(database, userId, sessionId) {
  if (!getCharacterAssistantSession(database, userId, sessionId)) return false;
  ensureIdle(database, sessionId);
  return database.prepare('DELETE FROM character_assistant_sessions WHERE id = ? AND user_id = ?').run(sessionId, userId).changes > 0;
}

function saveSession(database, userId, session) {
  database.prepare(`UPDATE character_assistant_sessions SET character_id = ?, title = ?, character_json = ?,
    messages_json = ?, state_json = ?, updated_at = ? WHERE id = ? AND user_id = ?`).run(
    session.characterId, session.title, JSON.stringify(session.character), JSON.stringify(session.messages),
    JSON.stringify(session.state), nowIso(), session.id, userId
  );
  return getCharacterAssistantSession(database, userId, session.id);
}

function draftSnapshot(session) {
  const state = {};
  for (const key of DRAFT_STATE_FIELDS) {
    if (Object.hasOwn(session.state, key)) state[key] = session.state[key];
    else if (['worldBookWorkspace', 'worldBookChanges', 'modSuggestions'].includes(key) && Object.hasOwn(session.character, key)) {
      state[key] = session.character[key];
    }
  }
  const character = { ...session.character };
  for (const key of ['worldBookWorkspace', 'worldBookChanges']) delete character[key];
  return JSON.parse(JSON.stringify({ character, state }));
}

function canonicalDraft(value) {
  if (Array.isArray(value)) return value.map(canonicalDraft);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalDraft(value[key])]));
  }
  return value;
}

function sameDraft(first, second) {
  return JSON.stringify(canonicalDraft(comparableDraft(first))) === JSON.stringify(canonicalDraft(comparableDraft(second)));
}

function comparableDraft({ character = {}, state = {} }) {
  const comparable = { ...character };
  for (const key of ['name', 'gender', 'age', 'background', 'worldview', 'persona', 'openingMessage']) {
    comparable[key] = String(character[key] || '');
  }
  comparable.visibility = character.visibility === 'public' ? 'public' : 'private';
  for (const key of ['tags', 'regexRules', 'renderPlugins', 'modSuggestions']) comparable[key] = character[key] || [];
  comparable.authorAdvancedSettings = normalizeAdvancedSettings(character.authorAdvancedSettings || character.advancedSettings || {});
  // Loading a book fills its workspace with read context. Only pending book edits
  // represent draft changes; fresh defaults and read context must not make versions.
  delete comparable.worldBookWorkspace;
  delete comparable.worldBookChanges;
  const draftState = {
    ...state, worldBookChanges: state.worldBookChanges || character.worldBookChanges || [],
    selectedWorldBookIds: state.selectedWorldBookIds || [], worldBookLinkDraft: state.worldBookLinkDraft || null,
    avatarDraft: state.avatarDraft || null,
    worldBookTargetOverride: state.worldBookTargetOverride || null, worldBookAutomatic: state.worldBookAutomatic === true,
    modSuggestions: state.modSuggestions || character.modSuggestions || []
  };
  delete draftState.worldBookWorkspace;
  return { character: comparable, state: draftState };
}

function turnVersionTitle(turn, label) {
  const requirement = String(turn.session.messages.findLast(message => message.role === 'user')?.content || '')
    .replace(/\s+/g, ' ').slice(0, 40);
  return requirement ? `${label} · ${requirement}` : label;
}

function preserveWorldBookLinkChoices(character, previousChanges) {
  if (!Array.isArray(character?.worldBookChanges)) return character;
  const choices = new Map((Array.isArray(previousChanges) ? previousChanges : [])
    .filter(change => !change.bookId && change.ref && typeof change.addToCharacter === 'boolean')
    .map(change => [change.ref, change.addToCharacter]));
  return {
    ...character,
    worldBookChanges: character.worldBookChanges.map(change => !change.bookId && choices.has(change.ref)
      ? { ...change, addToCharacter: choices.get(change.ref) }
      : change)
  };
}

function saveDraftVersion(database, userId, sessionId, snapshot, title) {
  const latest = database.prepare(`SELECT character_json, state_json FROM character_assistant_draft_versions
    WHERE session_id = ? AND user_id = ? ORDER BY rowid DESC LIMIT 1`).get(sessionId, userId);
  if (latest && sameDraft(snapshot, { character: parseJson(latest.character_json, {}), state: parseJson(latest.state_json, {}) })) return;
  database.prepare(`INSERT INTO character_assistant_draft_versions
    (id, session_id, user_id, title, character_json, state_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    newId(), sessionId, userId, title, JSON.stringify(snapshot.character), JSON.stringify(snapshot.state), nowIso()
  );
  // Keep the newest recoverable drafts within both the count and storage budget.
  const rows = database.prepare(`SELECT id, length(character_json) + length(state_json) AS chars
    FROM character_assistant_draft_versions WHERE session_id = ? AND user_id = ? ORDER BY rowid DESC`).all(sessionId, userId);
  let chars = 0;
  for (const [index, row] of rows.entries()) {
    chars += row.chars;
    if (index >= DRAFT_VERSION_LIMIT || chars > DRAFT_VERSION_MAX_CHARS) {
      database.prepare('DELETE FROM character_assistant_draft_versions WHERE id = ? AND user_id = ?').run(row.id, userId);
    }
  }
}

function preserveTurnBaseline(database, userId, turn) {
  if (turn.draftChanged || sameDraft(turn.baseline, draftSnapshot(turn.session))) return false;
  saveDraftVersion(database, userId, turn.session.id, turn.baseline, turnVersionTitle(turn, '修改前'));
  return true;
}

export function listCharacterAssistantDraftVersions(database, userId, sessionId) {
  if (!getCharacterAssistantSession(database, userId, sessionId)) return null;
  return database.prepare(`SELECT id, title, created_at AS createdAt FROM character_assistant_draft_versions
    WHERE session_id = ? AND user_id = ? ORDER BY rowid DESC`).all(sessionId, userId).map(row => ({ ...row }));
}

function idleDraftRuntimeState(statusMessage) {
  return {
    status: 'idle', statusMessage, lastError: '', lastRunStatus: '',
    checkpoint: null, checkpointUpdatedAt: '', continuation: null, plan: null, planPhase: 'idle',
    planContext: null, planProgress: null, planExtraRequirement: '', process: [], toolCalls: [], reasoning: '', warnings: [],
    context: null, worldBookApplyRequest: null
  };
}

export function resetCharacterAssistantDraftFromCharacter(database, userId, sessionId) {
  const session = assertCharacterAssistantSessionIdle(database, userId, sessionId);
  if (!session) return null;
  if (!session.characterId) throw sessionError('只有已绑定角色的助手会话才能读取已保存角色卡。');
  return withSavepoint(database, 'sp_reset_character_assistant_draft', () => {
    const saved = editableCharacter(database, userId, session.characterId);
    const selectedWorldBookIds = listOwnedLinkedBookIdsForCharacter(database, userId, saved.id).map(row => row.id);
    const characterTags = (getCharacterTagsMap(database, [saved.id]).get(saved.id) || [])
      .filter(row => row.user_id === userId).map(({ id, name, color }) => ({ id, name, color }));
    const character = { ...saved, worldBookId: selectedWorldBookIds[0] || null, characterTags };
    const preferences = Object.fromEntries(Object.entries(SESSION_PREFERENCE_TYPES)
      .filter(([key, type]) => typeof session.state[key] === type).map(([key]) => [key, session.state[key]]));
    if (session.state.options && typeof session.state.options === 'object') {
      preferences.options = Object.fromEntries(ASSISTANT_SECTION_KEYS
        .filter(key => typeof session.state.options[key] === 'boolean').map(key => [key, session.state.options[key]]));
    }
    const replacement = {
      ...session,
      character,
      state: {
        ...preferences, ...idleDraftRuntimeState('已用数据库中保存的角色卡替换当前草稿'),
        requirement: '', selectedWorldBookIds, avatarDraft: null, worldBookLinkDraft: null,
        worldBookWorkspace: null, worldBookChanges: [], worldBookTargetOverride: null, modSuggestions: [], conversationHistory: []
      }
    };
    const previous = draftSnapshot(session);
    if (!sameDraft(previous, draftSnapshot(replacement))) {
      saveDraftVersion(database, userId, session.id, previous, '读取已保存角色卡前的草稿');
    }
    return { session: saveSession(database, userId, replacement), character };
  });
}

export function restoreCharacterAssistantDraftVersion(database, userId, sessionId, versionId) {
  const session = getCharacterAssistantSession(database, userId, sessionId);
  if (!session) return null;
  ensureIdle(database, sessionId);
  const row = database.prepare(`SELECT character_json, state_json FROM character_assistant_draft_versions
    WHERE id = ? AND session_id = ? AND user_id = ?`).get(versionId, sessionId, userId);
  if (!row) throw sessionError('草稿历史版本不存在。', 404);
  const restored = { character: parseJson(row.character_json, {}), state: parseJson(row.state_json, {}) };
  return withSavepoint(database, 'sp_restore_character_assistant_draft', () => {
    const current = draftSnapshot(session);
    if (!sameDraft(current, restored)) saveDraftVersion(database, userId, session.id, current, '恢复前的草稿');
    session.character = restored.character;
    for (const key of DRAFT_STATE_FIELDS) delete session.state[key];
    Object.assign(session.state, restored.state, idleDraftRuntimeState('已恢复历史版本；保存角色后生效'));
    for (const key of ['worldBookWorkspace', 'worldBookChanges']) {
      if (Object.hasOwn(restored.state, key)) session.character[key] = restored.state[key];
    }
    if (session.characterId) {
      const savedAvatarUrl = String(editableCharacter(database, userId, session.characterId).avatarUrl || '');
      session.state.avatarDraft = String(session.character.avatarUrl || '') === savedAvatarUrl
        ? null
        : { version: 1, baselineUrl: savedAvatarUrl };
      const savedWorldBookIds = listOwnedLinkedBookIdsForCharacter(database, userId, session.characterId).map(row => row.id);
      const selectedWorldBookIds = session.state.selectedWorldBookIds;
      const selectedIds = new Set(Array.isArray(selectedWorldBookIds) ? selectedWorldBookIds : []);
      // Explicit history restores express link intent against today's saved links.
      // Legacy snapshots without a selection do not express an unlink request.
      session.state.worldBookLinkDraft = Array.isArray(selectedWorldBookIds)
        && (selectedIds.size !== savedWorldBookIds.length || savedWorldBookIds.some(id => !selectedIds.has(id)))
        ? { version: 1, baselineIds: savedWorldBookIds }
        : null;
    }
    return saveSession(database, userId, session);
  });
}

// A single server process owns each SQLite connection. Reserve before appending
// so parallel requests can neither duplicate the user turn nor overwrite history.
export function beginCharacterAssistantTurn(database, userId, sessionId, { requirement, character, state, attachments = [] } = {}) {
  ensureIdle(database, sessionId);
  const session = getCharacterAssistantSession(database, userId, sessionId);
  if (!session) throw sessionError('助手会话不存在。', 404);
  const history = session.messages.filter(message => ['user', 'assistant'].includes(message.role) && !['failed', 'cancelled'].includes(message.status))
    .map(({ role, content, attachments }) => ({ role, content, ...(attachments?.length ? { attachments } : {}) }));
  if (character !== undefined) session.character = objectValue(character, '角色草稿');
  if (state !== undefined) session.state = { ...session.state, ...objectValue(state, '会话设置') };
  const baseline = draftSnapshot(session);
  session.state = {
    ...session.state, requirement: String(requirement || '').trim(),
    status: 'running', statusMessage: '助手正在处理请求', lastError: '', process: [], toolCalls: []
  };
  const content = String(requirement || '').trim() || (attachments.length
    ? '请参考图片中的角色特征，帮助完善角色卡。'
    : '请根据现有设定完善角色卡。');
  if (!session.messages.length && session.title === '新会话') session.title = content.slice(0, 40);
  let running = activeRuns.get(database);
  if (!running) activeRuns.set(database, running = new Set());
  running.add(sessionId);
  try {
    return withSavepoint(database, 'sp_accept_character_assistant_input', () => {
      const prepared = prepareUserChatAttachmentsForStorage(database, userId, sessionId, attachments, {
        ownerType: 'character-assistant-session', source: 'character-assistant-message'
      });
      session.messages.push({
        id: newId(), role: 'user', content, createdAt: nowIso(),
        ...(prepared.storedAttachments.length ? { attachments: prepared.storedAttachments } : {})
      });
      saveSession(database, userId, session);
      return { session, history, attachments: prepared.modelAttachments, baseline, draftChanged: false };
    });
  } catch (error) {
    running.delete(sessionId);
    throw error;
  }
}

export function checkpointCharacterAssistantTurn(database, userId, turn, partial) {
  const { session } = turn;
  const character = preserveWorldBookLinkChoices(partial.character, session.state.worldBookChanges);
  const checkpoint = partial.checkpoint?.character ? {
    ...partial.checkpoint, character: preserveWorldBookLinkChoices(partial.checkpoint.character, session.state.worldBookChanges)
  } : partial.checkpoint;
  if (character) session.character = { ...session.character, ...character };
  session.state = {
    ...session.state,
    ...(partial.context ? { context: partial.context } : {}),
    ...(checkpoint ? { checkpoint, checkpointUpdatedAt: checkpoint.updatedAt } : {}),
    ...(partial.plan ? { plan: partial.plan, planPhase: 'review' } : {}),
    ...(character?.worldBookWorkspace ? { worldBookWorkspace: character.worldBookWorkspace } : {}),
    ...(character?.worldBookChanges ? { worldBookChanges: character.worldBookChanges } : {}),
    process: partial.process || [], toolCalls: partial.toolCalls || []
  };
  return withSavepoint(database, 'sp_checkpoint_character_assistant_draft', () => {
    // Read/progress tools also emit normalized checkpoints; they do not create versions.
    const lastTool = partial.checkpoint?.lastTool;
    const toolResult = partial.toolCalls?.findLast(tool => tool.name === lastTool)?.result;
    const baselineSaved = partial.character && !READ_ONLY_CHECKPOINT_TOOLS.has(lastTool)
      && toolResult?.ok !== false && toolResult?.skipped !== true
      && preserveTurnBaseline(database, userId, turn);
    const saved = saveSession(database, userId, session);
    if (baselineSaved) turn.draftChanged = true;
    return saved;
  });
}

export function finishCharacterAssistantTurn(database, userId, turn, result, errorMessage = '', cancelled = false) {
  const { session } = turn;
  try {
    const character = preserveWorldBookLinkChoices(result?.character, session.state.worldBookChanges);
    const checkpoint = result?.checkpoint?.character ? {
      ...result.checkpoint, character: preserveWorldBookLinkChoices(result.checkpoint.character, session.state.worldBookChanges)
    } : result?.checkpoint;
    if (character && result.changed !== false) session.character = { ...session.character, ...character };
    const status = errorMessage ? (cancelled ? 'cancelled' : 'failed') : 'completed';
    session.messages.push({
      id: newId(), role: 'assistant', createdAt: nowIso(), status,
      content: errorMessage || String(result?.assistantMessage || result?.summary || '已完成角色卡更新。'),
      ...(result?.process ? { process: result.process } : {}),
      ...(result?.toolCalls ? { toolCalls: result.toolCalls } : {}),
      ...(result?.context ? { context: result.context } : {}),
      ...(result?.plan ? { plan: result.plan } : {})
    });
    session.state = {
      ...session.state,
      // Completed messages live in history; only interrupted input remains a draft.
      requirement: errorMessage ? session.state.requirement : '',
      status: errorMessage ? (cancelled ? 'paused' : 'failed') : result?.phase === 'plan' ? 'review' : 'completed',
      statusMessage: errorMessage || String(result?.summary || '本轮对话已完成'),
      lastError: errorMessage,
      process: result?.process || [],
      toolCalls: result?.toolCalls || [],
      ...(result?.context ? { context: result.context } : {}),
      ...(checkpoint ? { checkpoint, checkpointUpdatedAt: checkpoint.updatedAt } : {}),
      ...(result?.warnings ? { warnings: result.warnings } : {}),
      ...(result?.continuation ? { continuation: result.continuation } : {}),
      ...(result?.plan ? { plan: result.plan, planPhase: 'review' } : {}),
      ...(result?.planProgress ? { planProgress: result.planProgress, planPhase: 'done' } : {}),
      ...(result?.worldBookWorkspace ? { worldBookWorkspace: result.worldBookWorkspace } : {}),
      ...(character?.worldBookWorkspace ? { worldBookWorkspace: character.worldBookWorkspace } : {}),
      ...(character?.worldBookChanges ? { worldBookChanges: character.worldBookChanges } : {}),
      ...(result?.worldBookState ? { worldBookState: result.worldBookState } : {}),
      lastRunStatus: status
    };
    settleInterruptedPlanPhase(session.state);
    return withSavepoint(database, 'sp_finish_character_assistant_draft', () => {
      const draftChanged = turn.draftChanged || (result?.character && result.changed !== false && result.phase !== 'plan'
        && preserveTurnBaseline(database, userId, turn));
      if (draftChanged) {
        saveDraftVersion(database, userId, session.id, draftSnapshot(session), turnVersionTitle(turn, errorMessage ? '中断时的草稿' : '修改后'));
      }
      const saved = saveSession(database, userId, session);
      if (draftChanged) turn.draftChanged = true;
      return saved;
    });
  } finally {
    activeRuns.get(database)?.delete(session.id);
  }
}
