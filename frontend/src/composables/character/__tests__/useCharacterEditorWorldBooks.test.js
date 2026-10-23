import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { useCharacterEditor } from '../useCharacterEditor.js';
import CharacterAiDraftPanel from '../../../components/character/CharacterAiDraftPanel.vue';
import WorldBookChanges from '../../../components/worldbook/WorldBookChanges.vue';
import { apiRequest, streamAssistantDraft } from '../../../api/core.js';
import { refreshProviderModels } from '../../../services/modelCatalog.js';
import { normalizeWorldBookEntryForCreate } from '../../../utils/worldBookDraft.js';
import { scanJsonBoundary } from '../../../../../backend/src/validations/schemas.js';

vi.mock('../../../api/core.js', () => ({ apiRequest: vi.fn(), streamAssistantDraft: vi.fn() }));
vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }));
vi.mock('../../../../../backend/src/config.js', () => ({ JSON_BODY_LIMIT_DEFAULT_BYTES: 12 * 1024 * 1024 }));

let wrapper;
beforeEach(() => {
  localStorage.clear();
  apiRequest.mockImplementation(async (url) => url === '/api/world-books' ? [{ id: 'book-a', name: '关联书 A' }, { id: 'book-b', name: '关联书 B' }] : []);
});
afterEach(() => { wrapper?.unmount(); wrapper = null; vi.resetAllMocks(); });

it('mounts the real editor with a restored assistant session and initializes current world book selections', async () => {
  const state = {
    version: 4, requirement: '继续上次世界书任务',
    worldBookWorkspace: { version: 1, targets: [{ ref: 'new:saved', bookId: null, profile: { name: '未应用草稿' }, entries: [] }] },
    worldBookChanges: [{ ref: 'new:saved', bookId: null, profile: { name: '未应用草稿' }, entries: [] }]
  };
  let editor;
  const Host = defineComponent({
    setup() {
      editor = useCharacterEditor({ props: reactive({ route: { name: 'characterNew', params: {} }, user: null, provider: null }), emit: vi.fn() });
      return () => h('output', editor.aiWorldBookSelectedIds.value.join(','));
    }
  });
  wrapper = mount(Host);
  await flushPromises();
  editor.selectAiSession({ id: 'server-session', state, messages: [] });
  await flushPromises();
  expect(editor.aiRequirement.value).toBe('继续上次世界书任务');
  expect(editor.aiWorldBookChanges.value).toHaveLength(1);
  editor.toggleWorldBook('book-a');
  editor.toggleWorldBook('book-b');
  await flushPromises();
  expect(editor.aiWorldBookSelectedIds.value).toEqual(['book-a', 'book-b']);
  expect(wrapper.text()).toBe('book-a,book-b');
});

it('keeps new-book and target adjustments available with selected books and groups existing/new results', async () => {
  wrapper = mount(CharacterAiDraftPanel, { props: {
    options: { worldBook: true },
    worldBooks: [{ id: 'book-a', name: '关联书 A', entryCount: 80 }],
    worldBookSelectedIds: ['book-a'], worldBookSourceLabel: '来自角色关联',
  } });
  const newBookButton = wrapper.findAll('button').find((button) => button.text() === '新建世界书');
  expect(newBookButton).toBeTruthy();
  await newBookButton.trigger('click');
  expect(wrapper.emitted('new-world-book')).toHaveLength(1);
  expect(wrapper.text()).toContain('来自角色关联');
  wrapper.unmount();
  wrapper = mount(WorldBookChanges, { props: {
    characterContext: true,
    changes: [
      { ref: 'existing:book-a', bookId: 'book-a', name: '关联书 A', profile: {}, upserts: [{ entryId: 'entry-65', patch: { content: '已更新' } }], removals: [] },
      { ref: 'new:b', bookId: null, profile: { name: '新书 B' }, entries: [{ name: '航线', content: '北方航线', triggerKeys: '航线' }] }
    ]
  } });
  expect(wrapper.text()).toContain('更新原书');
  expect(wrapper.text()).toContain('新书 B');
  expect(wrapper.text()).toContain('保存角色完成关联');
  const apply = wrapper.findAll('button').find((button) => button.text() === '应用 2 项变更');
  await apply.trigger('click');
  const selectedChanges = wrapper.emitted('apply')[0][0];
  expect(selectedChanges).toHaveLength(2);
  expect(selectedChanges[1].addToCharacter).toBe(true);
});

it('creates and selects a world book for an unsaved character without saving the character form', async () => {
  let editor;
  const Host = defineComponent({
    setup() {
      editor = useCharacterEditor({ props: reactive({ route: { name: 'characterNew', params: {} }, user: null, provider: null }), emit: vi.fn() });
      return () => h('output', editor.selectedWorldBookIds.value.join(','));
    }
  });
  wrapper = mount(Host);
  await flushPromises();
  expect(editor.aiWorldBookSelectedIds.value).toEqual([]);
  editor.form.name = '尚未保存的角色';
  editor.aiRequirement.value = '创建航海手册';
  const draft = { ref: 'new:guide', bookId: null, profile: { name: '航海手册' }, entries: [{ name: '航线', triggerKeys: '航线', content: '北方航线' }] };
  streamAssistantDraft.mockResolvedValue({ character: { worldBookWorkspace: { targets: [draft], activeRef: draft.ref }, worldBookChanges: [draft] }, summary: '新书草稿已准备' });
  apiRequest.mockImplementation(async (url) => url === '/api/world-books/apply-changes'
    ? { books: [{ ref: draft.ref, book: { id: 'created-guide', name: '航海手册', revision: 'saved-revision' } }] }
    : []);
  await editor.completeWithAi();
  await editor.applyAiWorldBookChanges();
  expect(editor.selectedWorldBookIds.value).toEqual(['created-guide']);
  expect(editor.worldBooks.value.some((book) => book.id === 'created-guide')).toBe(true);
  expect(apiRequest.mock.calls.filter(([url, options]) => url.startsWith('/api/characters') && ['POST', 'PATCH', 'PUT'].includes(options?.method))).toEqual([]);
  expect(editor.form.name).toBe('尚未保存的角色');
});

it.each(['characterAssistantNew', 'characterNew'])('saves assistant world book drafts and new links only when Save Character is used on %s', async (saveRoute) => {
  let editor;
  const props = reactive({ route: { name: 'characterAssistantNew', params: {} }, user: null, provider: null });
  wrapper = mount(defineComponent({
    setup() {
      editor = useCharacterEditor({ props, emit: vi.fn() });
      return () => h('div');
    }
  }));
  await flushPromises();
  editor.form.name = '草稿角色';
  editor.aiSessionId.value = 'assistant-session';
  editor.aiRequirement.value = '创建航海手册';
  const draft = { ref: 'new:guide', bookId: null, profile: { name: '航海手册' }, entries: [{ name: '航线', triggerKeys: '航线', content: '北方航线' }] };
  const largeTrace = { name: 'read_world_book', result: { content: 'x'.repeat(4_000_001) } };
  streamAssistantDraft.mockResolvedValueOnce({
    character: { name: '草稿角色', worldBookWorkspace: { targets: [draft], activeRef: draft.ref }, worldBookChanges: [draft] },
    summary: '新书草稿已准备',
    process: [{ round: 1, tools: [largeTrace] }], toolCalls: [largeTrace]
  });
  apiRequest.mockImplementation(async (url, options = {}) => {
    if (url === '/api/character-assistant/sessions/assistant-session' && !options.method) {
      return { id: 'assistant-session', characterId: null, character: editor.toPayload(), state: editor.exportAiSessionState() };
    }
    if (url === '/api/character-assistant/sessions/assistant-session' && options.method === 'PATCH' && options.body.length > 10_000) {
      throw new Error('Request JSON is too large');
    }
    if (url === '/api/character-assistant/sessions/assistant-session' && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      return { id: 'assistant-session', characterId: body.characterId || null, character: body.character || editor.toPayload(), state: { ...editor.exportAiSessionState(), ...body.statePatch } };
    }
    if (url === '/api/world-books/apply-changes') return { books: [{ ref: draft.ref, book: { id: 'created-guide', name: '航海手册', revision: 'saved-revision' } }] };
    if (url === '/api/characters' && options.method === 'POST') return { id: 'created-character', name: '草稿角色' };
    return [];
  });
  await editor.completeWithAi();
  await editor.applyAiWorldBookChanges();
  expect(apiRequest.mock.calls.filter(([url]) => url === '/api/world-books/apply-changes')).toEqual([]);
  expect(editor.selectedWorldBookIds.value).toEqual([]);

  props.route.name = saveRoute;
  await editor.submit();
  expect(apiRequest.mock.calls.filter(([url]) => url === '/api/world-books/apply-changes')).toHaveLength(1);
  expect(editor.selectedWorldBookIds.value).toEqual(['created-guide']);
  expect(apiRequest.mock.calls.some(([url, options]) => url === '/api/characters/created-character/world-books'
    && options.method === 'POST' && JSON.parse(options.body).worldBookId === 'created-guide')).toBe(true);
  expect(editor.aiWorldBookChanges.value).toEqual([]);
  const savedSessionStates = apiRequest.mock.calls.filter(([url, options]) => url === '/api/character-assistant/sessions/assistant-session' && options?.method === 'PATCH')
    .map(([, options]) => JSON.parse(options.body).statePatch);
  const applicationStates = savedSessionStates.filter((state) => Object.hasOwn(state, 'worldBookChanges'));
  expect(applicationStates[0].worldBookApplyRequest.requestId).toEqual(expect.any(String));
  expect(applicationStates[0].worldBookChanges).toHaveLength(1);
  expect(applicationStates[1].worldBookChanges).toEqual([]);
  expect(applicationStates[1].selectedWorldBookIds).toEqual(['created-guide']);
  expect(applicationStates[1].worldBookWorkspace.targets[0].bookId).toBe('created-guide');
  if (saveRoute === 'characterAssistantNew') {
    expect(editor.aiCheckpoint.value.character.worldBookChanges).toEqual([]);
    expect(editor.aiCheckpoint.value.character.worldBookWorkspace.targets[0].bookId).toBe('created-guide');
  }
  for (const state of savedSessionStates) {
    expect(state).not.toHaveProperty('process');
    expect(state).not.toHaveProperty('toolCalls');
    expect(state).not.toHaveProperty('reasoning');
    expect(state).not.toHaveProperty('checkpoint');
    expect(state).not.toHaveProperty('planContext');
  }
});

it('saves four generated books without reposting their checkpoint and plan copies beyond the request field limit', async () => {
  let editor;
  wrapper = mount(defineComponent({
    setup() {
      editor = useCharacterEditor({ props: reactive({ route: { name: 'characterAssistantNew', params: {} }, user: null, provider: null }), emit: vi.fn() });
      return () => h('div');
    }
  }));
  await flushPromises();
  editor.form.name = 'Four book character';
  const targets = Array.from({ length: 4 }, (_, bookIndex) => ({
    ref: `new:book-${bookIndex}`, bookId: null, baseRevision: null,
    profile: { name: `Book ${bookIndex}`, description: '', scanDepth: 4, lorebookContextPercent: 25 },
    linkedCharacterCount: 0, profilePatch: {}, upserts: [], removals: [],
    entries: Array.from({ length: 30 }, (_, entryIndex) => ({
      id: `entry-${bookIndex}-${entryIndex}`,
      ...normalizeWorldBookEntryForCreate({ name: `Entry ${entryIndex}`, triggerKeys: 'Lore', content: 'Generated lore' }, entryIndex)
    }))
  }));
  const workspace = { version: 1, activeRef: targets[0].ref, targets };
  const changes = targets.map((target) => ({ ...target, name: target.profile.name }));
  const characterDraft = { name: editor.form.name, worldBookWorkspace: workspace, worldBookChanges: changes };
  editor.selectAiSession({
    id: 'four-books', messages: [],
    state: {
      status: 'completed', worldBookWorkspace: workspace, worldBookChanges: changes,
      checkpoint: { character: characterDraft },
      planContext: { requirement: 'Create four books', character: { name: editor.form.name }, worldBookContext: { workspace } }
    }
  });
  expect(scanJsonBoundary({ state: editor.exportAiSessionState() })).toMatch(/字段过多/);
  apiRequest.mockImplementation(async (url, options = {}) => {
    if (options.body) {
      const error = scanJsonBoundary(JSON.parse(options.body));
      if (error) throw new Error(error);
    }
    if (url === '/api/world-books/apply-changes') return {
      books: targets.map((target, index) => ({ ref: target.ref, book: {
        id: `saved-book-${index}`, name: target.profile.name, revision: `revision-${index}`, entries: target.entries
      } }))
    };
    if (url === '/api/characters' && options.method === 'POST') return { id: 'saved-character', name: editor.form.name };
    return [];
  });

  await editor.submit();

  expect(apiRequest.mock.calls.filter(([url]) => url === '/api/world-books/apply-changes')).toHaveLength(1);
  const sessionRequests = apiRequest.mock.calls.filter(([url, options]) => url === '/api/character-assistant/sessions/four-books' && options?.method === 'PATCH')
    .map(([, options]) => JSON.parse(options.body));
  expect(sessionRequests).toHaveLength(3);
  expect(sessionRequests[0].statePatch.worldBookWorkspace.targets).toHaveLength(4);
  expect(sessionRequests[0].statePatch.worldBookChanges).toHaveLength(4);
  for (const payload of sessionRequests) {
    expect(scanJsonBoundary(payload)).toBe('');
    expect(payload.statePatch).not.toHaveProperty('checkpoint');
    expect(payload.statePatch).not.toHaveProperty('planContext');
  }
  expect(editor.aiCheckpoint.value.character.worldBookChanges).toEqual([]);
  expect(editor.aiCheckpoint.value.character.worldBookWorkspace.targets.map((target) => target.bookId)).toEqual([
    'saved-book-0', 'saved-book-1', 'saved-book-2', 'saved-book-3'
  ]);
  expect(editor.selectedWorldBookIds.value).toHaveLength(4);
});

it('aborts character saving when its assistant world book draft conflicts', async () => {
  let editor;
  wrapper = mount(defineComponent({
    setup() {
      editor = useCharacterEditor({ props: reactive({ route: { name: 'characterAssistantNew', params: {} }, user: null, provider: null }), emit: vi.fn() });
      return () => h('div');
    }
  }));
  await flushPromises();
  editor.form.name = '草稿角色';
  editor.aiSessionId.value = 'assistant-session';
  editor.aiRequirement.value = '修改关联书';
  const draft = { ref: 'existing:book-a', bookId: 'book-a', baseRevision: 'old-revision', profile: {}, upserts: [{ entryId: 'entry-a', patch: { content: '新设定' } }], removals: [] };
  streamAssistantDraft.mockResolvedValueOnce({ character: { name: '草稿角色', worldBookWorkspace: { targets: [draft], activeRef: draft.ref }, worldBookChanges: [draft] } });
  await editor.completeWithAi();
  apiRequest.mockImplementation(async (url) => {
    if (url === '/api/world-books/apply-changes') throw new Error('世界书已被修改');
    return [];
  });
  await editor.submit();
  expect(apiRequest.mock.calls.some(([url, options]) => url === '/api/characters' && options?.method === 'POST')).toBe(false);
  expect(editor.aiWorldBookChanges.value).toHaveLength(1);
  expect(editor.saving.value).toBe(false);
});

it('keeps accessory model choices on the global gateway after selecting another assistant gateway', async () => {
  const provider = { id: 'global', providerType: 'openai', gatewayName: 'Global', baseUrl: 'https://global.test/v1', model: 'global-model' };
  const assistantProvider = { id: 'assistant-only', providerType: 'anthropic', gatewayName: 'Assistant', baseUrl: 'https://assistant.test/v1', model: 'assistant-model' };
  apiRequest.mockImplementation(async (url, options = {}) => {
    if (url === '/api/providers') return { providers: [provider, assistantProvider] };
    if (url === '/api/providers/models') {
      const payload = JSON.parse(options.body);
      return { models: [payload.providerId === 'assistant-only' ? 'assistant-model' : 'global-model'] };
    }
    return [];
  });
  await refreshProviderModels(provider);
  let editor;
  wrapper = mount(defineComponent({
    setup() {
      editor = useCharacterEditor({ props: reactive({ route: { name: 'characterNew', params: {} }, user: { id: 'owner' }, provider }), emit: vi.fn() });
      return () => h('div');
    }
  }));
  await editor.loadAssistantProviderProfiles();
  editor.selectAssistantProviderProfile('assistant-only');
  await flushPromises();
  expect(editor.assistantModelOptions.value.map(option => option.id)).toContain('assistant-model');
  expect(editor.modelOverrideOptions().map(option => option.id)).toContain('global-model');
  expect(editor.modelOverrideOptions().map(option => option.id)).not.toContain('assistant-model');
});
