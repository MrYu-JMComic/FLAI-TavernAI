import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { useCharacterEditor } from '../useCharacterEditor.js';
import { apiRequest } from '../../../api/core.js';

vi.mock('../../../api/core.js', () => ({ apiRequest: vi.fn(), streamAssistantDraft: vi.fn() }));
vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }));

let wrapper;
let session;
const savedIds = ['book-1', 'book-2'];
const character = { id: 'role-1', name: 'Saved character', canEdit: true };
const notify = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  session = {
    id: 'session-1', characterId: character.id,
    character: { name: 'Generated character', persona: 'Generated story' },
    state: {}, messages: []
  };
  apiRequest.mockImplementation(async (url, options = {}) => {
    if (url === '/api/characters/role-1') return { ...character };
    if (url === '/api/characters/role-1/world-books') {
      return options.method ? {} : savedIds.map((id) => ({ id }));
    }
    if (url.startsWith('/api/character-assistant/sessions?')) return [session];
    if (url.startsWith('/api/character-assistant/sessions/')) return session;
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
  const emit = vi.fn();
  wrapper = mount(defineComponent({
    setup() {
      editor = useCharacterEditor({
        props: reactive({
          route: { name: routeName, params: routeName === 'characterAssistantNew' ? {} : { id: character.id } },
          user: { id: 'owner' }, provider: null
        }),
        emit
      });
      return () => h('div');
    }
  }), { global: { provide: { notify } } });
  await flushPromises();
  return { editor, emit };
}

function unlinkRequests() {
  return apiRequest.mock.calls.filter(([url, options]) => (
    url.startsWith('/api/characters/role-1/world-books/') && options?.method === 'DELETE'
  ));
}

function sessionPatch() {
  const call = apiRequest.mock.calls.find(([url, options]) => (
    url === '/api/character-assistant/sessions/session-1' && options?.method === 'PATCH'
  ));
  expect(call).toBeDefined();
  return JSON.parse(call[1].body);
}

describe('world book links when restoring assistant conversations', () => {
  it.each([{ selectedWorldBookIds: [] }, { selectedWorldBookIds: ['book-1'] }])(
    'keeps saved links when saving a legacy selection $selectedWorldBookIds', async ({ selectedWorldBookIds }) => {
      const { editor } = await mountEditor();
      editor.selectAiSession({ ...session, state: { selectedWorldBookIds } });
      await editor.submit();

      expect(notify.success).toHaveBeenCalledOnce();
      expect(unlinkRequests()).toEqual([]);
      expect(editor.selectedWorldBookIds.value).toEqual(savedIds);
    }
  );

  it('merges legacy session additions with links saved since that conversation', async () => {
    const { editor } = await mountEditor();
    editor.selectAiSession({ ...session, state: { selectedWorldBookIds: ['book-1', 'book-3'] } });
    await editor.submit();

    expect(editor.selectedWorldBookIds.value).toEqual(['book-1', 'book-2', 'book-3']);
    expect(unlinkRequests()).toEqual([]);
    expect(apiRequest).toHaveBeenCalledWith('/api/characters/role-1/world-books', {
      method: 'POST', body: JSON.stringify({ worldBookId: 'book-3' })
    });
  });

  it('keeps the current selection when a conversation has no stored selection', async () => {
    const { editor } = await mountEditor();
    editor.toggleWorldBook('book-2');
    editor.selectAiSession(session);
    expect(editor.selectedWorldBookIds.value).toEqual(['book-1']);
  });

  it('restores intentional removals captured against the same saved link set', async () => {
    const { editor } = await mountEditor();
    editor.selectAiSession({ ...session, state: {
      selectedWorldBookIds: [],
      worldBookLinkDraft: { version: 1, baselineIds: ['book-2', 'book-1'] }
    } });
    expect(editor.selectedWorldBookIds.value).toEqual([]);
    expect(editor.exportAiSessionState().worldBookLinkDraft).toEqual({ version: 1, baselineIds: savedIds });
    await editor.submit();

    expect(notify.success).toHaveBeenCalledOnce();
    expect(unlinkRequests().map(([url]) => url)).toEqual(savedIds.map((id) => `/api/characters/role-1/world-books/${id}`));
    expect(editor.exportAiSessionState().worldBookLinkDraft).toBeNull();
  });

  it('keeps a removal retryable when assistant session persistence fails before unlinking', async () => {
    const { editor } = await mountEditor();
    let failSessionPatch = true;
    const originalImplementation = apiRequest.getMockImplementation();
    apiRequest.mockImplementation(async (url, options = {}) => {
      if (failSessionPatch && url === '/api/character-assistant/sessions/session-1' && options.method === 'PATCH') {
        throw new Error('Session save failed');
      }
      return originalImplementation(url, options);
    });
    editor.selectAiSession({ ...session, state: {
      selectedWorldBookIds: [],
      worldBookLinkDraft: { version: 1, baselineIds: savedIds }
    } });

    await editor.submit();

    expect(notify.success).not.toHaveBeenCalled();
    expect(notify.warning).toHaveBeenCalledWith(expect.stringContaining('Session save failed'));
    expect(unlinkRequests()).toEqual([]);
    expect(sessionPatch().statePatch).toMatchObject({
      selectedWorldBookIds: [], worldBookLinkDraft: { version: 1, baselineIds: savedIds }
    });
    expect(editor.exportAiSessionState().worldBookLinkDraft).toEqual({ version: 1, baselineIds: savedIds });

    failSessionPatch = false;
    await editor.submit();

    expect(notify.success).toHaveBeenCalledOnce();
    expect(unlinkRequests().map(([url]) => url)).toEqual(savedIds.map((id) => `/api/characters/role-1/world-books/${id}`));
    expect(editor.exportAiSessionState().worldBookLinkDraft).toBeNull();
  });

  it('retains the removal marker and reports failure when a world book unlink fails', async () => {
    const { editor } = await mountEditor();
    let failUnlink = true;
    const linkedIds = new Set(savedIds);
    const originalImplementation = apiRequest.getMockImplementation();
    apiRequest.mockImplementation(async (url, options = {}) => {
      if (url === '/api/characters/role-1/world-books' && !options.method) {
        return [...linkedIds].map((id) => ({ id }));
      }
      if (failUnlink && url === '/api/characters/role-1/world-books/book-2' && options.method === 'DELETE') {
        throw new Error('World book unlink failed');
      }
      if (url.startsWith('/api/characters/role-1/world-books/') && options.method === 'DELETE') {
        linkedIds.delete(url.split('/').at(-1));
        return {};
      }
      return originalImplementation(url, options);
    });
    editor.selectAiSession({ ...session, state: {
      selectedWorldBookIds: [],
      worldBookLinkDraft: { version: 1, baselineIds: savedIds }
    } });

    await editor.submit();

    expect(notify.success).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith('World book unlink failed');
    expect([...linkedIds]).toEqual(['book-2']);
    expect(editor.exportAiSessionState().worldBookLinkDraft).toEqual({ version: 1, baselineIds: savedIds });

    failUnlink = false;
    await editor.submit();

    expect(notify.success).toHaveBeenCalledOnce();
    expect([...linkedIds]).toEqual([]);
    expect(editor.exportAiSessionState().worldBookLinkDraft).toBeNull();
  });

  it('replays pending removals after a partial unlink and editor reload', async () => {
    let linkedIds = new Set(savedIds);
    let failSecondUnlink = true;
    const originalImplementation = apiRequest.getMockImplementation();
    apiRequest.mockImplementation(async (url, options = {}) => {
      if (url === '/api/characters/role-1/world-books' && !options.method) {
        return [...linkedIds].map((id) => ({ id }));
      }
      if (url.startsWith('/api/characters/role-1/world-books/') && options.method === 'DELETE') {
        const id = url.split('/').at(-1);
        if (failSecondUnlink && id === 'book-2') throw new Error('World book unlink failed');
        linkedIds.delete(id);
        return {};
      }
      if (url === '/api/character-assistant/sessions/session-1' && options.method === 'PATCH') {
        const payload = JSON.parse(options.body);
        session = { ...session, character: payload.character, state: { ...session.state, ...payload.statePatch } };
        return session;
      }
      return originalImplementation(url, options);
    });

    let { editor } = await mountEditor();
    editor.selectAiSession({ ...session, state: {
      selectedWorldBookIds: [], worldBookLinkDraft: { version: 1, baselineIds: savedIds }
    } });
    await editor.submit();
    expect([...linkedIds]).toEqual(['book-2']);
    expect(editor.exportAiSessionState().worldBookLinkDraft).toEqual({ version: 1, baselineIds: savedIds });

    wrapper.unmount();
    wrapper = null;
    failSecondUnlink = false;
    ({ editor } = await mountEditor());
    editor.selectAiSession(session);
    expect(editor.selectedWorldBookIds.value).toEqual([]);

    await editor.submit();
    expect([...linkedIds]).toEqual([]);
    expect(editor.exportAiSessionState().worldBookLinkDraft).toBeNull();
  });

  it('replays the recorded link delta while retaining links added since its baseline', async () => {
    const { editor } = await mountEditor();
    editor.selectAiSession({ ...session, state: {
      selectedWorldBookIds: ['book-3'],
      worldBookLinkDraft: { version: 1, baselineIds: ['book-1'] }
    } });
    expect(editor.selectedWorldBookIds.value).toEqual(['book-2', 'book-3']);
  });

  it('preserves a current manual removal when selecting another conversation', async () => {
    const { editor } = await mountEditor();
    editor.toggleWorldBook('book-2');
    editor.selectAiSession({ ...session, state: {
      selectedWorldBookIds: ['book-1', 'book-2', 'book-3'],
      worldBookLinkDraft: { version: 1, baselineIds: savedIds }
    } });
    expect(editor.selectedWorldBookIds.value).toEqual(['book-1']);
    expect(editor.exportAiSessionState().worldBookLinkDraft).toEqual({ version: 1, baselineIds: savedIds });
  });

  it('allows an explicit historical restore to replace the current manual selection', async () => {
    const { editor } = await mountEditor();
    editor.toggleWorldBook('book-2');
    editor.selectAiSession({ ...session, state: { selectedWorldBookIds: ['book-3'] } }, { restoreVersion: true });
    expect(editor.selectedWorldBookIds.value).toEqual(['book-3']);
  });

  it('restores an unbound new character selection normally', async () => {
    const { editor } = await mountEditor('characterAssistantNew');
    editor.toggleWorldBook('temporary-book');
    editor.selectAiSession({ ...session, characterId: '', state: { selectedWorldBookIds: ['book-3'] } });
    expect(editor.selectedWorldBookIds.value).toEqual(['book-3']);
  });

  it('merges stale links during the editor handoff without posting oversized generated drafts', async () => {
    session.state = { selectedWorldBookIds: ['book-1', 'book-3'], reasoning: 'x'.repeat(4_000_001) };
    const { editor, emit } = await mountEditor('characterEdit');
    expect(editor.hasUnsavedChanges.value).toBe(false);
    await editor.openAssistant();

    const payload = sessionPatch();
    expect(payload.statePatch.selectedWorldBookIds).toEqual(['book-1', 'book-2', 'book-3']);
    expect(payload).toHaveProperty('characterPatch');
    expect(payload).not.toHaveProperty('character');
    expect(payload).not.toHaveProperty('state');
    expect(JSON.stringify(payload).length).toBeLessThan(1000);
    expect(session.character.persona).toBe('Generated story');
    expect(session.state.reasoning).toHaveLength(4_000_001);
    expect(emit).toHaveBeenCalledWith('navigate', 'characterAssistant', { id: character.id });
  });

  it('carries intentional manual removals and their baseline through the editor handoff', async () => {
    session.state.selectedWorldBookIds = savedIds;
    const { editor } = await mountEditor('characterEdit');
    for (const id of savedIds) editor.toggleWorldBook(id);
    await editor.openAssistant();

    expect(sessionPatch().statePatch).toMatchObject({
      selectedWorldBookIds: [], worldBookLinkDraft: { version: 1, baselineIds: savedIds }
    });
  });
});
