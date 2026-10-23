import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, reactive } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { useCharacterEditor } from '../useCharacterEditor.js';
import { apiRequest } from '../../../api/core.js';
import { onBeforeRouteLeave } from 'vue-router';

vi.mock('../../../api/core.js', () => ({ apiRequest: vi.fn(), streamAssistantDraft: vi.fn() }));
vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }));

const wrappers = [];
const clone = (value) => JSON.parse(JSON.stringify(value));
const savedCharacter = { id: 'role-1', name: 'Saved character', persona: 'Saved story', avatarUrl: '/uploads/saved.png', canEdit: true, renderPlugins: [] };
let sessions;
let currentSaved;
const draftKey = 'flai-character-form-draft:edit:role-1';
const handoffKey = (editing) => `flai-character-editor-handoff:owner:${editing ? 'role-1' : 'new'}`;

function mountEditor(editing = true, { assistant = false, owner = 'owner' } = {}) {
  let editor;
  const props = reactive({ route: { name: assistant ? (editing ? 'characterAssistant' : 'characterAssistantNew') : (editing ? 'characterEdit' : 'characterNew'), params: editing ? { id: 'role-1' } : {} }, user: { id: owner }, provider: null });
  const emit = vi.fn();
  const wrapper = mount(defineComponent({
    setup() {
      editor = useCharacterEditor({ props, emit });
      return () => h('div');
    }
  }));
  wrappers.push(wrapper);
  return { editor, wrapper, props, emit };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  currentSaved = clone(savedCharacter);
  sessions = [{
    id: 'session-1', characterId: 'role-1', character: { name: 'Assistant character', persona: 'Draft story' },
    state: { selectedWorldBookIds: ['saved-book', 'assistant-book'], worldBookChanges: [{ ref: 'new:pending', entries: [] }] },
    messages: [{ role: 'user', content: 'Keep this conversation' }]
  }];
  apiRequest.mockImplementation(async (url, options = {}) => {
    const body = JSON.parse(options.body || '{}');
    if (url === '/api/characters/role-1') return clone(currentSaved);
    if (url === '/api/characters/role-1/world-books') return [{ id: 'saved-book' }];
    if (url.startsWith('/api/character-assistant/sessions?')) {
      return clone(sessions.filter((session) => url.includes('unbound=true') ? !session.characterId : session.characterId === new URLSearchParams(url.split('?')[1]).get('characterId')));
    }
    if (url === '/api/character-assistant/sessions' && options.method === 'POST') {
      const session = { id: 'session-created', characterId: null, messages: [], ...body };
      sessions.push(session);
      return clone(session);
    }
    const session = sessions.find((item) => url.startsWith('/api/character-assistant/sessions/' + item.id));
    if (session && url.endsWith('/reset-draft-from-character')) {
      session.character = clone(currentSaved);
      session.state = { selectedWorldBookIds: ['saved-book'] };
      return { character: clone(currentSaved), session: clone(session) };
    }
    if (session) {
      if (options.method === 'PATCH') {
        if (body.character) session.character = body.character;
        if (body.characterId) session.characterId = body.characterId;
        session.state = body.state || { ...session.state, ...body.statePatch };
      }
      return clone(session);
    }
    return [];
  });
});

afterEach(async () => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  await flushPromises();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('server character editor drafts', () => {
  it('does not offer recovery when the server session already matches the saved card', async () => {
    currentSaved.authorAdvancedSettings = { showWorldBookMatches: false, highlightDialogue: false };
    sessions[0].character = clone(savedCharacter);
    sessions[0].character.authorAdvancedSettings = clone(currentSaved.authorAdvancedSettings);
    sessions[0].state = { selectedWorldBookIds: ['saved-book'] };
    const { editor } = mountEditor();
    await flushPromises();
    expect(editor.pendingCharacterDraft.value).toBeNull();
    expect(editor.characterDraftStatusText.value).toBe('');
    expect(editor.toPayload().authorAdvancedSettings.showWorldBookMatches).toBe(false);
    expect(editor.toPayload().authorAdvancedSettings.highlightDialogue).toBe(false);
  });

  it('loads the saved card first, offers server draft recovery and persists manual edits only on the server', async () => {
    const { editor, wrapper } = mountEditor();
    await flushPromises();
    expect(editor.form.name).toBe(savedCharacter.name);
    expect(editor.pendingCharacterDraft.value.payload.name).toBe('Assistant character');
    expect(editor.restoreCharacterDraft()).toBe(true);
    expect(editor.form.name).toBe('Assistant character');
    expect(editor.aiConversationHistory.value[0].content).toBe('Keep this conversation');
    editor.form.persona = 'Later manual edit';
    await nextTick();
    await vi.advanceTimersByTimeAsync(1200);
    expect(sessions[0].character.persona).toBe('Later manual edit');
    expect(localStorage.getItem(draftKey)).toBeNull();
    expect(sessionStorage.getItem('flai-character-assistant-active:owner:role-1')).toBe('session-1');
    wrapper.unmount();
    await flushPromises();
    const reloaded = mountEditor().editor;
    await flushPromises();
    expect(reloaded.pendingCharacterDraft.value.payload.persona).toBe('Later manual edit');
    reloaded.restoreCharacterDraft();
    expect(reloaded.form.persona).toBe('Later manual edit');
  });

  it.each([true, false])('restores an explicit server handoff and discards it durably (editing %s)', async (editing) => {
    sessions[0].characterId = editing ? 'role-1' : null;
    sessionStorage.setItem(handoffKey(editing), 'session-1');
    const { editor, wrapper } = mountEditor(editing);
    await flushPromises();
    expect(editor.form.name).toBe('Assistant character');
    expect(editor.aiSessionId.value).toBe('session-1');
    expect(editor.aiWorldBookChanges.value).toHaveLength(1);
    currentSaved = { ...currentSaved, name: 'Fresh database name' };
    expect(await editor.discardCharacterDraft()).toBe(true);
    expect(editor.form.name).toBe(editing ? 'Fresh database name' : '');
    expect(editor.aiWorldBookChanges.value).toEqual([]);
    expect(sessions[0].messages[0].content).toBe('Keep this conversation');
    expect(sessionStorage.getItem(handoffKey(editing))).toBeNull();
    wrapper.unmount();
    await flushPromises();
    const reloaded = mountEditor(editing).editor;
    await flushPromises();
    expect(reloaded.pendingCharacterDraft.value).toBeNull();
    expect(reloaded.form.name).toBe(editing ? 'Fresh database name' : '');
  });

  it('restores an unbound new-character server draft after reload without browser payload storage', async () => {
    sessions[0].characterId = null;
    sessionStorage.setItem('flai-character-assistant-active:owner:new', 'session-1');
    const { editor } = mountEditor(false);
    await flushPromises();

    expect(editor.form.name).toBe('Assistant character');
    expect(editor.pendingCharacterDraft.value).toBeNull();
    expect(editor.aiSessionId.value).toBe('session-1');
    expect(localStorage.length).toBe(0);
  });

  it('clears a stale handoff and falls back to the current server session for a new character', async () => {
    sessions[0].characterId = null;
    sessionStorage.setItem(handoffKey(false), 'missing-session');
    const original = apiRequest.getMockImplementation();
    apiRequest.mockImplementation(async (url, options) => {
      if (url === '/api/character-assistant/sessions/missing-session') throw Object.assign(new Error('Session unavailable'), { status: 404 });
      return original(url, options);
    });
    const { editor } = mountEditor(false);
    await flushPromises();
    expect(editor.form.name).toBe('Assistant character');
    expect(sessionStorage.getItem(handoffKey(false))).toBeNull();
  });

  it('creates a server session for a new manual draft without writing browser card contents', async () => {
    const { editor } = mountEditor(false);
    await flushPromises();
    editor.form.name = 'New draft';
    editor.form.persona = 'x'.repeat(250000);
    await nextTick();
    await vi.advanceTimersByTimeAsync(1200);
    expect(sessions.find((session) => session.id === 'session-created').character.persona).toHaveLength(250000);
    expect(editor.characterDraftStatus.value).toBe('saved');
    expect(localStorage.length).toBe(0);
    expect(Object.values(sessionStorage)).toEqual(['session-created']);
  });

  it('clears old card payload caches before opening an assistant and keeps preference values', async () => {
    localStorage.setItem(draftKey, JSON.stringify({ payload: { name: 'Obsolete private content' } }));
    localStorage.setItem('flai-character-ai-session:role-1', JSON.stringify({ checkpoint: 'Obsolete' }));
    localStorage.setItem('flai-assistant-preference', 'keep');
    const { editor } = mountEditor(true, { assistant: true });
    await flushPromises();
    expect(localStorage.getItem(draftKey)).toBeNull();
    expect(localStorage.getItem('flai-character-ai-session:role-1')).toBeNull();
    expect(localStorage.getItem('flai-assistant-preference')).toBe('keep');
    editor.selectAiSession(sessions[0]);
    editor.applyAssistantCharacter({ name: 'Current draft', persona: 'x'.repeat(250000) });
    editor.prepareAssistantEditorHandoff();
    expect(sessionStorage.getItem(handoffKey(true))).toBe('session-1');
    expect(Object.values(localStorage).some((value) => value.includes('Current draft'))).toBe(false);
  });

  it.each(['unavailable', 'wrong-character', 'invalid-character', 'running'])('keeps saved data and blocks edits from saving when a server draft is %s', async (failure) => {
    sessionStorage.setItem(handoffKey(true), 'session-1');
    const original = apiRequest.getMockImplementation();
    apiRequest.mockImplementation(async (url, options) => {
      if (url === '/api/character-assistant/sessions/session-1') {
        if (failure === 'unavailable') throw new Error('Session unavailable');
        return { ...clone(sessions[0]), ...(failure === 'wrong-character' ? { characterId: 'other-role' } : {}),
          ...(failure === 'invalid-character' ? { character: null } : {}),
          ...(failure === 'running' ? { state: { status: 'running' } } : {}) };
      }
      return original(url, options);
    });
    const { editor, emit } = mountEditor();
    await flushPromises();
    expect(editor.form.name).toBe(savedCharacter.name);
    expect(editor.loadError.value).not.toBe('');
    editor.form.name = 'Keep current input';
    await editor.submit();
    await editor.openAssistant();
    expect(emit).not.toHaveBeenCalled();
    expect(apiRequest.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
  });

  it.each(['success', 'failure', 'unmount'])('locks a new editor while its server handoff is pending: %s', async (outcome) => {
    sessions[0].characterId = null;
    sessionStorage.setItem(handoffKey(false), 'session-1');
    let finish;
    let fail;
    const original = apiRequest.getMockImplementation();
    apiRequest.mockImplementation(async (url, options) => url === '/api/character-assistant/sessions/session-1'
      ? new Promise((resolve, reject) => { finish = resolve; fail = reject; }) : original(url, options));
    const { editor, wrapper } = mountEditor(false);
    await flushPromises();
    expect(editor.loading.value).toBe(true);
    if (outcome === 'unmount') wrapper.unmount();
    if (outcome === 'failure') fail(new Error('Unavailable'));
    else finish(clone(sessions[0]));
    await flushPromises();
    expect(editor.form.name).toBe(outcome === 'success' ? 'Assistant character' : '');
    expect(editor.loading.value).toBe(outcome === 'unmount');
  });

  it('blocks a route change and assistant handoff after a failed draft save', async () => {
    sessions = [];
    const { editor, emit } = mountEditor();
    await flushPromises();
    editor.form.persona = 'Keep this input';
    await nextTick();
    const original = apiRequest.getMockImplementation();
    apiRequest.mockImplementation(async (url, options) => {
      if (url === '/api/character-assistant/sessions' && options?.method === 'POST') throw new Error('Unavailable');
      return original(url, options);
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const leave = onBeforeRouteLeave.mock.calls.at(-1)[0];
    expect(await leave()).toBe(false);
    await editor.openAssistant();
    expect(emit).not.toHaveBeenCalled();
    expect(editor.form.persona).toBe('Keep this input');
    expect(editor.characterDraftStatus.value).toBe('error');
    vi.restoreAllMocks();
  });

  it('uses user-scoped session IDs and asks the server for only the current character', async () => {
    sessionStorage.setItem('flai-character-assistant-active:other-user:role-1', 'other-session');
    mountEditor(true, { owner: 'owner' });
    await flushPromises();
    expect(apiRequest).toHaveBeenCalledWith('/api/character-assistant/sessions?characterId=role-1', { cache: 'no-store' });
    expect(apiRequest.mock.calls.some(([url]) => url.includes('/other-session'))).toBe(false);
  });
});
