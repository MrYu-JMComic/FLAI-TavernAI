import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { useCharacterEditor } from '../useCharacterEditor.js';
import { apiRequest } from '../../../api/core.js';

vi.mock('../../../api/core.js', () => ({ apiRequest: vi.fn(), streamAssistantDraft: vi.fn() }));
vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }));

let wrapper;
const notify = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
const savedCharacter = { id: 'role-1', name: 'Test character', avatarUrl: '/uploads/avatar.png', canEdit: true };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  let manualSession = null;
  apiRequest.mockImplementation(async (url, options = {}) => {
    if (url === '/api/character-assistant/sessions' && options.method === 'POST') {
      manualSession = { id: 'session-1', characterId: null, ...JSON.parse(options.body || '{}') };
      return manualSession;
    }
    if (url.startsWith('/api/character-assistant/sessions/')) {
      const body = JSON.parse(options.body || '{}');
      manualSession = { id: 'session-1', characterId: 'role-1', character: {}, state: {}, ...manualSession, ...body };
      return manualSession;
    }
    if (url === '/api/characters' && options.method === 'POST') return { ...savedCharacter };
    if (url === '/api/characters/role-1') return { ...savedCharacter };
    return [];
  });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.resetAllMocks();
});

async function mountEditor(routeName = 'characterAssistant') {
  let editor;
  const editing = ['characterEdit', 'characterAssistant'].includes(routeName);
  const props = reactive({ route: { name: routeName, params: editing ? { id: 'role-1' } : {} }, user: { id: 'owner' }, provider: null });
  const emit = vi.fn();
  wrapper = mount(defineComponent({
    setup() {
      editor = useCharacterEditor({ props, emit });
      return () => h('button', { disabled: editor.saving.value, onClick: editor.submit }, editor.saving.value ? 'Saving' : 'Save');
    }
  }), { global: { provide: { notify } } });
  await flushPromises();
  if (!editing) editor.form.name = savedCharacter.name;
  return { editor, emit, props };
}

describe('character save completion', () => {
  it.each(['characterAssistant', 'characterAssistantNew', 'characterEdit', 'characterNew'])(
    'releases the save button after success on %s and allows another save', async (routeName) => {
      const { editor, emit } = await mountEditor(routeName);
      if (routeName.startsWith('characterAssistant')) editor.aiSessionId.value = 'session-1';

      await wrapper.get('button').trigger('click');
      await flushPromises();

      expect(notify.success).toHaveBeenCalledOnce();
      expect(emit).toHaveBeenCalledWith('navigate', routeName.startsWith('characterAssistant') ? 'characterAssistant' : 'characterEdit', { id: 'role-1' });
      expect(editor.saving.value).toBe(false);
      expect(wrapper.get('button').element.disabled).toBe(false);
      expect(wrapper.text()).toBe('Save');

      editor.form.persona = 'Another edit after saving';
      await wrapper.get('button').trigger('click');
      await flushPromises();
      expect(notify.success).toHaveBeenCalledTimes(2);
      expect(editor.saving.value).toBe(false);
    }
  );

  it('blocks duplicate saves until the character request completes', async () => {
    const { editor } = await mountEditor();
    let finish;
    apiRequest.mockImplementation(async (url, options = {}) => {
      if (url === '/api/characters/role-1' && options.method === 'PATCH') {
        return new Promise((resolve) => { finish = () => resolve(savedCharacter); });
      }
      return [];
    });

    const saving = editor.submit();
    await editor.submit();
    await flushPromises();
    expect(wrapper.get('button').element.disabled).toBe(true);
    expect(apiRequest.mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(1);
    finish();
    await saving;
    await flushPromises();
    expect(wrapper.get('button').element.disabled).toBe(false);
  });

  it('releases the save button after a failed request without navigating', async () => {
    const { editor, emit } = await mountEditor();
    apiRequest.mockRejectedValueOnce(new Error('Save unavailable'));
    await editor.submit();
    await flushPromises();

    expect(notify.error).toHaveBeenCalledWith('Save unavailable');
    expect(editor.saving.value).toBe(false);
    expect(emit).not.toHaveBeenCalled();
    expect(wrapper.get('button').element.disabled).toBe(false);
  });

  it('keeps a partially saved new character retryable when assistant binding fails', async () => {
    const { editor, emit } = await mountEditor('characterAssistantNew');
    editor.aiSessionId.value = 'session-1';
    apiRequest.mockImplementation(async (url, options = {}) => {
      if (url.startsWith('/api/character-assistant/sessions/')) throw new Error('Binding unavailable');
      if (url.startsWith('/api/characters')) return { ...savedCharacter };
      return [];
    });

    await editor.submit();
    await flushPromises();
    expect(notify.warning).toHaveBeenCalledWith(expect.stringContaining('Binding unavailable'));
    expect(notify.success).not.toHaveBeenCalled();
    expect(editor.saving.value).toBe(false);
    expect(emit).not.toHaveBeenCalled();

    await editor.submit();
    expect(apiRequest.mock.calls.filter(([url, options]) => url === '/api/characters' && options?.method === 'POST')).toHaveLength(1);
    expect(apiRequest.mock.calls.filter(([url, options]) => url === '/api/characters/role-1' && options?.method === 'PATCH')).toHaveLength(1);
    expect(editor.saving.value).toBe(false);
  });

  it.each(['characterAssistant', 'characterEdit'])('saves and binds a character without reposting oversized session state on %s', async (routeName) => {
    const { editor, emit } = await mountEditor(routeName);
    const state = {
      status: 'completed',
      process: [{ round: 1, tools: [{ name: 'read_world_book', result: { content: 'x'.repeat(4_000_001) } }] }]
    };
    editor.selectAiSession({ id: 'session-1', state, messages: [] });
    apiRequest.mockImplementation(async (url, options = {}) => {
      if (url === '/api/character-assistant/sessions/session-1') {
        if (options.method === 'PATCH') {
          if (options.body.length > 10_000) throw new Error('Request JSON is too large');
          return { id: 'session-1', state };
        }
        return { id: 'session-1', state };
      }
      if (url === '/api/characters/role-1') return { ...savedCharacter };
      return [];
    });

    await editor.submit();

    expect(notify.success).toHaveBeenCalledOnce();
    expect(notify.warning).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('navigate', routeName, { id: 'role-1' });
    const [, options] = apiRequest.mock.calls.find(([url, request]) => (
      url === '/api/character-assistant/sessions/session-1' && request?.method === 'PATCH'
    ));
    expect(JSON.parse(options.body)).not.toHaveProperty('state');
    expect(JSON.parse(options.body).statePatch).toEqual({
      avatarDraft: null, selectedWorldBookIds: [], worldBookLinkDraft: null
    });
    expect(state.process[0].tools[0].result.content).toHaveLength(4_000_001);
    expect(editor.saving.value).toBe(false);
  });

  it('ignores a save response after the edited character has changed', async () => {
    const { editor, emit, props } = await mountEditor();
    let finish;
    apiRequest.mockImplementation(async (url, options = {}) => {
      if (url === '/api/characters/role-1' && options.method === 'PATCH') {
        return new Promise((resolve) => { finish = () => resolve(savedCharacter); });
      }
      return [];
    });

    const saving = editor.submit();
    props.route.params.id = 'role-2';
    finish();
    await saving;
    expect(notify.success).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(editor.saving.value).toBe(false);
  });
});

function savedStatusCharacter(overrides = {}) {
  return {
    ...savedCharacter,
    persona: 'Saved persona',
    authorAdvancedSettings: {
      statusBarBlueprint: {
        name: 'Saved status',
        template: '<p>Saved HP {{HP}}</p>',
        variables: [{ name: 'HP', type: 'number', value: 5 }]
      }
    },
    ...overrides
  };
}

function mockSavedStatusCharacter(character, worldBookIds = []) {
  const fallback = apiRequest.getMockImplementation();
  apiRequest.mockImplementation(async (url, options = {}) => {
    if (url === '/api/characters/role-1' && !options.method) return character;
    if (url === '/api/characters/role-1/world-books' && !options.method) {
      return worldBookIds.map((id) => ({ id }));
    }
    return fallback(url, options);
  });
}

describe('saved character snapshot isolation', () => {
  it('initializes an independent saved snapshot from the database card', async () => {
    const databaseCharacter = savedStatusCharacter();
    mockSavedStatusCharacter(databaseCharacter);
    const { editor } = await mountEditor();

    expect(editor.savedCharacter.value).toEqual(databaseCharacter);
    expect(editor.savedCharacter.value).not.toBe(databaseCharacter);
    expect(editor.savedCharacter.value.authorAdvancedSettings.statusBarBlueprint).toMatchObject({
      name: 'Saved status', template: '<p>Saved HP {{HP}}</p>',
      variables: [{ name: 'HP', type: 'number', value: 5 }]
    });
    databaseCharacter.authorAdvancedSettings.statusBarBlueprint.variables[0].value = 99;
    expect(editor.savedCharacter.value.authorAdvancedSettings.statusBarBlueprint.variables[0].value).toBe(5);
  });

  it('previews the current draft while retaining an independent saved snapshot', async () => {
    mockSavedStatusCharacter(savedStatusCharacter());
    const { editor } = await mountEditor();
    const before = JSON.stringify(editor.savedCharacter.value);
    editor.applyAssistantCharacter(savedStatusCharacter({
      name: 'Assistant draft', persona: 'Draft persona',
      authorAdvancedSettings: { statusBarBlueprint: {
        name: 'Draft status', template: '<p>Draft HP {{HP}}</p>',
        variables: [{ name: 'HP', type: 'number', value: 20 }]
      } }
    }));
    editor.form.authorAdvancedSettings.statusBarBlueprint.variables[0].value = 42;
    editor.form.persona = 'Local change';
    await flushPromises();

    expect(editor.statusBarBlueprintPreview.value.template).toContain('Draft HP');
    expect(editor.statusBarBlueprintPreview.value.variables[0].value).toBe(42);
    expect(JSON.stringify(editor.savedCharacter.value)).toBe(before);
    expect(editor.savedCharacter.value.authorAdvancedSettings.statusBarBlueprint.template).toBe('<p>Saved HP {{HP}}</p>');
    expect(editor.savedCharacter.value.authorAdvancedSettings.statusBarBlueprint.variables[0].value).toBe(5);
  });

  it('accepts a synced card without replacing the current draft, conversation or selected world books', async () => {
    mockSavedStatusCharacter(savedStatusCharacter(), ['saved-book']);
    const { editor } = await mountEditor();
    editor.selectAiSession({
      id: 'current-session', state: { requirement: 'Continue current draft', reasoning: 'Current reasoning' },
      messages: [{ role: 'user', content: 'Current conversation' }]
    });
    editor.applyAssistantCharacter(savedStatusCharacter({ name: 'Current draft', persona: 'Unsaved persona' }));
    editor.toggleWorldBook('draft-book');
    const draftBefore = editor.toPayload();
    const selectedBefore = [...editor.selectedWorldBookIds.value];
    const conversationBefore = JSON.stringify(editor.aiConversationHistory.value);
    const stateBefore = editor.exportAiSessionState();
    const synced = savedStatusCharacter({
      name: 'Historical saved card',
      avatarUrl: '/uploads/historical.png',
      authorAdvancedSettings: { statusBarBlueprint: {
        name: 'Synced status', template: JSON.stringify({ variant: 'terminal', density: 'compact', layout: 'list' }),
        variables: [{ name: 'HP', type: 'number', value: 10 }]
      } }
    });

    expect(editor.acceptSyncedCharacter(synced)).toBe(true);
    await flushPromises();

    expect(editor.savedCharacter.value.name).toBe('Historical saved card');
    expect(editor.savedCharacter.value.authorAdvancedSettings.statusBarBlueprint.template).toBe(synced.authorAdvancedSettings.statusBarBlueprint.template);
    expect(editor.toPayload()).toEqual(draftBefore);
    expect(editor.selectedWorldBookIds.value).toEqual(selectedBefore);
    expect(editor.aiSessionId.value).toBe('current-session');
    expect(editor.aiRequirement.value).toBe('Continue current draft');
    expect(editor.aiReasoning.value).toBe('Current reasoning');
    expect(JSON.stringify(editor.aiConversationHistory.value)).toBe(conversationBefore);
    expect(editor.exportAiSessionState()).toEqual(stateBefore);
    synced.authorAdvancedSettings.statusBarBlueprint.variables[0].value = 100;
    expect(editor.savedCharacter.value.authorAdvancedSettings.statusBarBlueprint.variables[0].value).toBe(10);
  });

  it('rejects a saved card belonging to another editing route', async () => {
    mockSavedStatusCharacter(savedStatusCharacter(), ['saved-book']);
    const { editor } = await mountEditor();
    editor.toggleWorldBook('draft-book');
    const before = JSON.stringify(editor.savedCharacter.value);

    expect(editor.acceptSyncedCharacter(savedStatusCharacter({ id: 'role-other' }))).toBe(false);

    expect(JSON.stringify(editor.savedCharacter.value)).toBe(before);
    expect(editor.exportAiSessionState().worldBookLinkDraft).toEqual({ version: 1, baselineIds: ['saved-book'] });
  });

  it('refreshes the saved snapshot from the canonical save response', async () => {
    mockSavedStatusCharacter(savedStatusCharacter());
    const { editor } = await mountEditor();
    editor.form.authorAdvancedSettings.statusBarBlueprint.template = '<p>Unsaved HP {{HP}}</p>';
    const canonical = savedStatusCharacter({ name: 'Canonical server name' });
    apiRequest.mockImplementation(async (url, options = {}) => {
      if (url === '/api/characters/role-1' && options.method === 'PATCH') return canonical;
      return [];
    });

    await editor.submit();

    expect(notify.success).toHaveBeenCalledOnce();
    expect(editor.savedCharacter.value.name).toBe('Canonical server name');
    expect(editor.savedCharacter.value.authorAdvancedSettings.statusBarBlueprint.template).toBe('<p>Saved HP {{HP}}</p>');
    expect(editor.form.authorAdvancedSettings.statusBarBlueprint.template).toBe('<p>Unsaved HP {{HP}}</p>');
    canonical.authorAdvancedSettings.statusBarBlueprint.template = '<p>Later mutation</p>';
    expect(editor.savedCharacter.value.authorAdvancedSettings.statusBarBlueprint.template).toBe('<p>Saved HP {{HP}}</p>');
  });

  it('retains the previous saved snapshot when saving the current draft fails', async () => {
    mockSavedStatusCharacter(savedStatusCharacter());
    const { editor } = await mountEditor();
    editor.form.authorAdvancedSettings.statusBarBlueprint.template = '<p>Unsaved status</p>';
    const before = JSON.stringify(editor.savedCharacter.value);
    apiRequest.mockRejectedValueOnce(new Error('Save unavailable'));

    await editor.submit();

    expect(notify.error).toHaveBeenCalledWith('Save unavailable');
    expect(JSON.stringify(editor.savedCharacter.value)).toBe(before);
    expect(editor.savedCharacter.value.authorAdvancedSettings.statusBarBlueprint.template).toBe('<p>Saved HP {{HP}}</p>');
    expect(editor.form.authorAdvancedSettings.statusBarBlueprint.template).toBe('<p>Unsaved status</p>');
  });

  it('keeps a new assistant draft without a saved snapshot until its first save', async () => {
    const { editor } = await mountEditor('characterAssistantNew');
    editor.applyAssistantCharacter(savedStatusCharacter());
    expect(editor.savedCharacter.value).toBeNull();
    expect(editor.statusBarBlueprintPreview.value.template).toBe('<p>Saved HP {{HP}}</p>');

    await editor.submit();

    expect(editor.savedCharacter.value.id).toBe('role-1');
    expect(notify.success).toHaveBeenCalledOnce();
  });

});

describe('replacing the assistant draft from a saved character', () => {
  it('fully replaces fields and runtime, resets saved link intent and saves the authoritative payload', async () => {
    mockSavedStatusCharacter(savedStatusCharacter(), ['old-book']);
    const { editor } = await mountEditor();
    const legacyCacheKey = 'flai-character-form-draft:edit:role-1';
    localStorage.setItem(legacyCacheKey, 'independent draft');
    editor.applyAssistantCharacter(savedStatusCharacter({
      name: 'Old assistant draft', avatarUrl: '/uploads/old-draft.png', background: 'Old background',
      renderPlugins: [{ label: 'Old plugin' }], regexRules: [{ pattern: 'old' }],
      authorAdvancedSettings: { customCss: '.old { color: red; }', customJs: 'old()', statusBarPrompt: 'Old prompt',
        statusBarBlueprint: { name: 'Old status', template: '<p>{{Old}}</p>', variables: [{ name: 'Old', value: 'old' }] } }
    }), { restoreVersion: true });
    editor.selectAiSession({ id: 'session-1', characterId: 'role-1', messages: [], state: {
      version: 4, requirement: 'Old task', reasoning: 'Old reasoning', status: 'paused',
      checkpoint: { character: { name: 'Old checkpoint' } }, checkpointUpdatedAt: 'old',
      plan: { title: 'Old plan', steps: [{ id: 'old-step', title: 'Old step' }] }, planPhase: 'paused',
      worldBookWorkspace: { entries: ['old'] }, worldBookChanges: [{ ref: 'old' }],
      worldBookTargetOverride: ['old-book'], selectedWorldBookIds: ['old-book', 'draft-book'],
      avatarDraft: { version: 1, baselineUrl: savedCharacter.avatarUrl },
      worldBookLinkDraft: { version: 1, baselineIds: ['old-book'] },
      toolCalls: [{ name: 'old_tool' }], process: [{ round: 1, content: 'old process' }], warnings: ['Old warning']
    } });
    editor.advancedAiRequirement.value = 'Old advanced task';
    const authoritative = savedStatusCharacter({
      name: 'Database card', avatarUrl: '/uploads/database.png', background: '', persona: 'Database persona',
      renderPlugins: [], regexRules: [], tags: ['database-tag'], characterTags: [{ name: 'database-tag' }],
      authorAdvancedSettings: { customCss: '', customJs: '', statusBarPrompt: '',
        statusBarBlueprint: { name: 'Database status', template: '<p>DB {{HP}}</p>', variables: [{ name: 'HP', type: 'number', value: 97 }] } }
    });
    const resetSession = { id: 'session-1', characterId: 'role-1', character: authoritative,
      state: { version: 4, status: 'idle', selectedWorldBookIds: ['database-book'], modelOverride: 'preferred-model' },
      messages: [{ role: 'user', content: 'Conversation stays' }] };

    expect(editor.replaceAssistantDraftFromSavedCharacter(authoritative, resetSession)).toBe(true);
    await flushPromises();

    expect(editor.form.name).toBe('Database card');
    expect(editor.form.avatarUrl).toBe('/uploads/database.png');
    expect(editor.form.background).toBe('');
    expect(editor.form.renderPlugins).toEqual([]);
    expect(editor.form.regexRules).toEqual([]);
    expect(editor.form.selectedTags).toEqual(['database-tag']);
    expect(editor.statusBarBlueprintPreview.value.template).toBe('<p>DB {{HP}}</p>');
    expect(editor.statusBarBlueprintPreview.value.variables).toEqual([{ name: 'HP', type: 'number', value: 97 }]);
    expect(editor.form.authorAdvancedSettings.customCss).toBe('');
    expect(editor.selectedWorldBookIds.value).toEqual(['database-book']);
    expect(editor.aiCheckpoint.value).toBeNull();
    expect(editor.aiHasCheckpoint.value).toBe(false);
    expect(editor.aiPlan.value?.steps || []).toEqual([]);
    expect(editor.aiWorldBookChanges.value).toEqual([]);
    expect(editor.aiProcess.value).toEqual([]);
    expect(editor.aiToolCalls.value).toEqual([]);
    expect(editor.aiReasoning.value).toBe('');
    expect(editor.aiRequirement.value).toBe('');
    expect(editor.advancedAiRequirement.value).toBe('');
    expect(editor.assistantModel.value).toBe('preferred-model');
    expect(editor.aiConversationHistory.value).toEqual([{ role: 'user', content: 'Conversation stays' }]);
    expect(editor.exportAiSessionState()).toMatchObject({ avatarDraft: null, worldBookLinkDraft: null, worldBookWorkspace: null, planContext: null });
    expect(editor.hasUnsavedChanges.value).toBe(false);
    expect(editor.pendingCharacterDraft.value).toBeNull();
    expect(localStorage.getItem(legacyCacheKey)).toBe('independent draft');
    authoritative.authorAdvancedSettings.statusBarBlueprint.variables[0].value = 1;
    expect(editor.statusBarBlueprintPreview.value.variables[0].value).toBe(97);
    expect(editor.savedCharacter.value.authorAdvancedSettings.statusBarBlueprint.variables[0].value).toBe(97);
    const expectedPayload = editor.toPayload();

    await editor.submit();

    const [, savedOptions] = apiRequest.mock.calls.find(([url, options]) => url === '/api/characters/role-1' && options?.method === 'PATCH');
    expect(JSON.parse(savedOptions.body)).toEqual(expectedPayload);
    expect(savedOptions.body).not.toContain('Old');
  });

  it.each(['wrong-character', 'wrong-session', 'unmount'])('rejects a replacement after %s without changing the draft', async (change) => {
    const { editor } = await mountEditor();
    editor.selectAiSession({ id: 'session-1', characterId: 'role-1', state: {}, messages: [] });
    editor.form.persona = 'Current draft';
    const before = editor.toPayload();
    const authoritative = savedStatusCharacter({ id: change === 'wrong-character' ? 'role-other' : 'role-1' });
    const session = { id: change === 'wrong-session' ? 'session-other' : 'session-1', characterId: authoritative.id,
      state: { selectedWorldBookIds: [] }, messages: [], character: authoritative };
    if (change === 'unmount') wrapper.unmount();

    expect(editor.replaceAssistantDraftFromSavedCharacter(authoritative, session)).toBe(false);
    expect(editor.toPayload()).toEqual(before);
  });
});
