import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { useCharacterEditor } from '../useCharacterEditor.js';
import { apiRequest } from '../../../api/core.js';

vi.mock('../../../api/core.js', () => ({ apiRequest: vi.fn(), streamAssistantDraft: vi.fn() }));
vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn() }));

let wrapper;
const character = { id: 'role-1', name: 'Current character', avatarUrl: '/uploads/avatar.png', canEdit: true };
const editorEmit = vi.fn();
let session;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  session = { id: 'session-1', characterId: 'role-1', character: { name: 'Assistant draft', persona: 'New story' }, state: {}, messages: [] };
  apiRequest.mockImplementation(async (url) => {
    if (url === '/api/characters/role-1') return { ...character };
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
  wrapper = mount(defineComponent({
    setup() {
      const params = routeName === 'characterAssistantNew' ? {} : { id: 'role-1' };
      editor = useCharacterEditor({ props: reactive({ route: { name: routeName, params }, user: { id: 'owner' }, provider: null }), emit: editorEmit });
      return () => h('div');
    }
  }));
  await flushPromises();
  return editor;
}

describe('avatar preservation when restoring assistant drafts', () => {
  it('keeps the current avatar when an older assistant draft omits it', async () => {
    const editor = await mountEditor();
    editor.applyAssistantCharacter(session.character);
    expect(editor.form.name).toBe('Assistant draft');
    expect(editor.form.persona).toBe('New story');
    expect(editor.form.avatarUrl).toBe(character.avatarUrl);
  });

  it.each(['', '/uploads/outdated-avatar.png'])('keeps the saved avatar when an older session contains an empty or stale avatar: %s', async (avatarUrl) => {
    const editor = await mountEditor();
    editor.applyAssistantCharacter({ ...session.character, avatarUrl });
    expect(editor.form.avatarUrl).toBe(character.avatarUrl);
    expect(editor.form.persona).toBe('New story');
  });

  it.each(['', '/uploads/new-avatar.png'])('restores an intentional unsaved manual avatar edit: %s', async (avatarUrl) => {
    const editor = await mountEditor();
    editor.applyAssistantCharacter({ ...session.character, avatarUrl }, {
      avatarDraft: { version: 1, baselineUrl: character.avatarUrl }
    });
    expect(editor.form.avatarUrl).toBe(avatarUrl);
    expect(editor.exportAiSessionState().avatarDraft).toEqual({ version: 1, baselineUrl: character.avatarUrl });
  });

  it('ignores manual intent captured against an obsolete saved avatar', async () => {
    const editor = await mountEditor();
    editor.applyAssistantCharacter({ ...session.character, avatarUrl: '' }, {
      avatarDraft: { version: 1, baselineUrl: '/uploads/outdated-avatar.png' }
    });
    expect(editor.form.avatarUrl).toBe(character.avatarUrl);
    expect(editor.exportAiSessionState().avatarDraft).toBeNull();
  });

  it('does not overwrite a current manual removal when selecting another conversation', async () => {
    const editor = await mountEditor();
    editor.clearAvatar();
    editor.applyAssistantCharacter({ ...session.character, avatarUrl: '/uploads/another-avatar.png' }, {
      avatarDraft: { version: 1, baselineUrl: character.avatarUrl }
    });
    expect(editor.form.avatarUrl).toBe('');
  });

  it.each(['', '/uploads/historical-avatar.png'])('restores the requested historical avatar over the current manual draft: %s', async (avatarUrl) => {
    const editor = await mountEditor();
    editor.form.avatarUrl = '/uploads/current-unsaved-avatar.png';
    editor.applyAssistantCharacter({ ...session.character, avatarUrl }, { restoreVersion: true });
    expect(editor.form.avatarUrl).toBe(avatarUrl);
    expect(editor.exportAiSessionState().avatarDraft).toEqual({ version: 1, baselineUrl: character.avatarUrl });
    expect(apiRequest.mock.calls.some(([, options]) => ['PATCH', 'POST', 'PUT'].includes(options?.method))).toBe(false);
  });

  it('restores the avatar from an unbound character draft', async () => {
    const editor = await mountEditor('characterAssistantNew');
    editor.applyAssistantCharacter({ ...session.character, avatarUrl: '/uploads/unsaved-avatar.png' });
    expect(editor.form.avatarUrl).toBe('/uploads/unsaved-avatar.png');
  });

  it('retains an uploaded avatar in the editor handoff to an older assistant session', async () => {
    const editor = await mountEditor('characterEdit');
    expect(editor.hasUnsavedChanges.value).toBe(false);
    await editor.openAssistant();
    const [, options] = apiRequest.mock.calls.find(([url, request]) => (
      url === '/api/character-assistant/sessions/session-1' && request?.method === 'PATCH'
    ));
    expect(JSON.parse(options.body).characterPatch).toEqual({ avatarUrl: character.avatarUrl });
    expect(JSON.parse(options.body)).not.toHaveProperty('character');
  });

  it('passes a manual removal through the editor handoff instead of restoring the saved avatar', async () => {
    const editor = await mountEditor('characterEdit');
    editor.clearAvatar();
    await editor.openAssistant();
    const [, options] = apiRequest.mock.calls.find(([url, request]) => (
      url === '/api/character-assistant/sessions/session-1' && request?.method === 'PATCH'
    ));
    expect(JSON.parse(options.body).character.avatarUrl).toBe('');
    expect(JSON.parse(options.body).statePatch.avatarDraft).toEqual({ version: 1, baselineUrl: character.avatarUrl });
  });

  it('replaces the stale avatar and manual intent of an old session when reopening it from the editor', async () => {
    session.character.avatarUrl = '';
    session.state.avatarDraft = { version: 1, baselineUrl: character.avatarUrl };
    const editor = await mountEditor('characterEdit');
    await editor.openAssistant();
    const [, options] = apiRequest.mock.calls.find(([url, request]) => (
      url === '/api/character-assistant/sessions/session-1' && request?.method === 'PATCH'
    ));
    expect(JSON.parse(options.body).characterPatch.avatarUrl).toBe(character.avatarUrl);
    expect(JSON.parse(options.body).statePatch.avatarDraft).toBeNull();
  });

  it('opens an existing assistant with oversized generated JSON without posting it back', async () => {
    const generatedWorkspace = {
      targets: [{
        ref: 'new:large-book',
        entries: Array.from({ length: 1500 }, (_, index) => ({
          id: `entry-${index}`, title: `Entry ${index}`, content: 'Generated lore',
          keywords: [`keyword-${index}`], enabled: true, position: index, priority: 0
        }))
      }]
    };
    session.character.worldBookWorkspace = generatedWorkspace;
    session.state = {
      checkpoint: { character: session.character },
      worldBookWorkspace: generatedWorkspace,
      reasoning: 'x'.repeat(4_000_001),
      selectedWorldBookIds: ['assistant-selected-book']
    };
    const originalRequest = apiRequest.getMockImplementation();
    apiRequest.mockImplementation(async (url, options = {}) => {
      if (url === '/api/character-assistant/sessions/session-1' && options.method === 'PATCH') {
        if (options.body.length > 10_000) throw new Error('Request JSON is too large');
        return session;
      }
      return originalRequest(url, options);
    });
    const editor = await mountEditor('characterEdit');
    await editor.openAssistant();

    expect(editorEmit).toHaveBeenCalledWith('navigate', 'characterAssistant', { id: 'role-1' });
    const [, options] = apiRequest.mock.calls.find(([url, request]) => (
      url === '/api/character-assistant/sessions/session-1' && request?.method === 'PATCH'
    ));
    const payload = JSON.parse(options.body);
    expect(options.body.length).toBeLessThan(1000);
    expect(payload).not.toHaveProperty('state');
    expect(payload).not.toHaveProperty('character');
    expect(payload.statePatch.selectedWorldBookIds).toEqual(['assistant-selected-book']);
    expect(session.state.reasoning).toHaveLength(4_000_001);
    expect(session.character.worldBookWorkspace.targets[0].entries).toHaveLength(1500);
  });

  it('uses the canonical saved avatar URL in the editor and session after uploading', async () => {
    const editor = await mountEditor();
    editor.aiSessionId.value = 'session-1';
    editor.form.avatarUrl = 'data:image/png;base64,aW1hZ2U=';
    const canonicalUrl = '/api/assets/saved-avatar';
    apiRequest.mockImplementation(async (url, options = {}) => {
      if (url === '/api/characters/role-1' && options.method === 'PATCH') return { ...character, avatarUrl: canonicalUrl };
      if (url.startsWith('/api/character-assistant/sessions/')) return session;
      return [];
    });
    await editor.submit();
    expect(editor.form.avatarUrl).toBe(canonicalUrl);
    expect(editor.exportAiSessionState().avatarDraft).toBeNull();
    const [, options] = apiRequest.mock.calls.find(([url, request]) => (
      url === '/api/character-assistant/sessions/session-1' && request?.method === 'PATCH'
    ));
    expect(JSON.parse(options.body).character.avatarUrl).toBe(canonicalUrl);
    expect(JSON.parse(options.body).statePatch.avatarDraft).toBeNull();
    await editor.submit();
    const requests = apiRequest.mock.calls.filter(([url, request]) => url === '/api/characters/role-1' && request?.method === 'PATCH');
    expect(JSON.parse(requests.at(-1)[1].body).avatarUrl).toBe(canonicalUrl);
  });
});
