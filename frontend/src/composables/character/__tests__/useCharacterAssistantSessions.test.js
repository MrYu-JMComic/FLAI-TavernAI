import { defineComponent, h, nextTick, onBeforeUnmount, reactive } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCharacterAssistantSessions } from '../useCharacterAssistantSessions.js';
import { normalizeWorldBookEntryForCreate } from '../../../utils/worldBookDraft.js';
import { scanJsonBoundary } from '../../../../../backend/src/validations/schemas.js';

vi.mock('../../../../../backend/src/config.js', () => ({ JSON_BODY_LIMIT_DEFAULT_BYTES: 12 * 1024 * 1024 }));

const api = vi.hoisted(() => ({
  createCharacterAssistantSession: vi.fn(),
  deleteCharacterAssistantSession: vi.fn(),
  fetchCharacterAssistantSession: vi.fn(),
  fetchCharacterAssistantSessions: vi.fn(),
  fetchCharacterAssistantVersions: vi.fn(),
  resetCharacterAssistantDraftFromSavedCharacter: vi.fn(),
  restoreCharacterAssistantVersion: vi.fn(),
  updateCharacterAssistantSession: vi.fn()
}));
vi.mock('../../../api/characterAssistant.js', () => api);

const wrappers = [];
function session(id, extra = {}) {
  return { id, title: id, characterId: null, character: { name: id }, messages: [], state: {}, updatedAt: '2026-10-18T10:00:00Z', ...extra };
}

function setupEditor(overrides = {}, { beforeUnmount } = {}) {
  const editor = reactive({
    editingCharacterId: '', canEdit: true, loading: false, loadError: '',
    aiLoading: false, aiRequirement: '', aiAttachments: [], aiStatus: 'idle', aiSessionId: '',
    assistantProviderProfileId: '', assistantModel: '',
    selectedWorldBookIds: [], form: { name: 'current draft' },
    toPayload() { return { ...this.form }; },
    exportAiSessionState() { return { requirement: this.aiRequirement, status: this.aiStatus }; },
    applyAssistantCharacter(character) { Object.assign(this.form, character); },
    selectAiSession(value) { this.aiSessionId = value.id; this.aiRequirement = value.state.requirement || ''; this.aiAttachments = []; },
    replaceAssistantDraftFromSavedCharacter(character, value) {
      this.form = { ...character };
      this.selectAiSession(value);
      return true;
    },
    completeWithAi: vi.fn(),
    ...overrides
  });
  let workspace;
  const wrapper = mount(defineComponent({
    setup() {
      if (beforeUnmount) onBeforeUnmount(() => beforeUnmount(editor));
      workspace = reactive(useCharacterAssistantSessions({ editor, user: { id: 'user-1' } }));
      return () => h('div');
    }
  }));
  wrappers.push(wrapper);
  return { editor, get workspace() { return workspace; } };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  api.fetchCharacterAssistantSessions.mockResolvedValue([]);
  api.createCharacterAssistantSession.mockImplementation(async (payload) => session('new-session', payload));
  api.fetchCharacterAssistantSession.mockImplementation(async (id) => session(id));
  api.updateCharacterAssistantSession.mockImplementation(async (id, payload) => session(id, payload));
  api.deleteCharacterAssistantSession.mockResolvedValue({ ok: true });
  api.fetchCharacterAssistantVersions.mockResolvedValue([]);
});

afterEach(async () => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  await flushPromises();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('character assistant sessions', () => {
  const image = { id: 'draft-image', type: 'image', name: '参考.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,YWJj' };

  it.each(['completed', 'review'])('does not refill sent text from a stale %s session snapshot', async (status) => {
    const { editor, workspace } = setupEditor();
    await flushPromises();
    editor.aiRequirement = '完善角色动机';
    api.fetchCharacterAssistantSession.mockResolvedValueOnce(session('new-session', {
      messages: [{ id: 'sent-message', role: 'user', content: editor.aiRequirement }],
      state: { status, requirement: editor.aiRequirement }
    }));
    await workspace.run(() => { editor.aiStatus = status; editor.aiRequirement = ''; });
    expect(editor.aiRequirement).toBe('');
    expect(workspace.activeSession.messages[0].content).toBe('完善角色动机');
    await workspace.persist();
    expect(api.updateCharacterAssistantSession).toHaveBeenLastCalledWith('new-session', expect.objectContaining({
      statePatch: expect.objectContaining({ requirement: '' })
    }));
  });

  it('loads server history and persists current edits before restoring a version into the draft', async () => {
    const { editor, workspace } = setupEditor();
    await flushPromises();
    const versions = [{ id: 'before-ai', title: '修改前', createdAt: '2026-10-19T10:00:00Z' }];
    api.fetchCharacterAssistantVersions.mockResolvedValueOnce(versions);
    await workspace.loadVersions();
    expect(workspace.versions).toEqual(versions);
    editor.form.name = 'manual edit after AI';
    api.restoreCharacterAssistantVersion.mockResolvedValueOnce(session('new-session', {
      character: { name: 'original draft' }, draftVersionCount: 3, state: { status: 'idle' },
      messages: [{ id: 'discussion', role: 'assistant', content: 'Preserved reply' }]
    }));

    expect(await workspace.restoreVersion('before-ai')).toBe(true);

    expect(api.updateCharacterAssistantSession).toHaveBeenCalledWith('new-session', expect.objectContaining({ character: { name: 'manual edit after AI' } }));
    expect(api.updateCharacterAssistantSession.mock.invocationCallOrder.at(-1)).toBeLessThan(api.restoreCharacterAssistantVersion.mock.invocationCallOrder[0]);
    expect(api.restoreCharacterAssistantVersion).toHaveBeenCalledWith('new-session', 'before-ai');
    expect(editor.form.name).toBe('original draft');
    expect(workspace.activeSession.messages[0].content).toBe('Preserved reply');
    expect(workspace.saveStatus).toContain('保存角色后生效');
    expect(workspace.busy).toBe(false);
  });

  it('drains queued writes before replacing the actual draft, and uses the replacement for the next AI request', async () => {
    vi.useFakeTimers();
    const original = session('bound-session', { characterId: 'card-a', character: { name: 'older draft', statusBar: 'draft status' } });
    api.fetchCharacterAssistantSessions.mockResolvedValueOnce([original]);
    api.fetchCharacterAssistantSession.mockResolvedValueOnce(original);
    const { editor, workspace } = setupEditor({ editingCharacterId: 'card-a' });
    await flushPromises();
    let finishSave;
    api.updateCharacterAssistantSession.mockImplementationOnce((id, payload) => new Promise((resolve) => {
      finishSave = () => resolve(session(id, { ...payload, characterId: 'card-a' }));
    }));
    editor.form.name = 'queued draft';
    const saving = workspace.persist();
    await flushPromises();
    editor.form.name = 'latest unsaved draft';
    const character = { id: 'card-a', name: 'database card', statusBar: 'database status' };
    const replacement = session('bound-session', { characterId: 'card-a', character, state: { context: null, status: 'idle' } });
    api.resetCharacterAssistantDraftFromSavedCharacter.mockResolvedValueOnce({ session: replacement, character });
    const resetting = workspace.resetDraftFromSavedCharacter();
    await workspace.persist({ force: true });
    await flushPromises();
    expect(api.resetCharacterAssistantDraftFromSavedCharacter).not.toHaveBeenCalled();
    finishSave();
    await saving;
    expect(await resetting).toBe(true);
    expect(api.updateCharacterAssistantSession.mock.calls[1][1].character.name).toBe('latest unsaved draft');
    expect(api.updateCharacterAssistantSession.mock.invocationCallOrder[1]).toBeLessThan(api.resetCharacterAssistantDraftFromSavedCharacter.mock.invocationCallOrder[0]);
    expect(editor.form.statusBar).toBe('database status');
    await nextTick();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.updateCharacterAssistantSession).toHaveBeenCalledTimes(2);
    editor.aiRequirement = 'next task';
    api.fetchCharacterAssistantSession.mockResolvedValueOnce(replacement);
    const action = vi.fn(() => { expect(editor.toPayload()).toEqual(character); editor.aiStatus = 'completed'; });
    await workspace.run(action);
    expect(action).toHaveBeenCalledOnce();
    expect(api.updateCharacterAssistantSession.mock.calls.at(-1)[1].character.statusBar).toBe('database status');
  });

  it('keeps the current draft after a reset failure and lets the same operation retry', async () => {
    const original = session('bound-session', { characterId: 'card-a', character: { name: 'draft' } });
    api.fetchCharacterAssistantSessions.mockResolvedValueOnce([original]);
    api.fetchCharacterAssistantSession.mockResolvedValueOnce(original);
    const { editor, workspace } = setupEditor({ editingCharacterId: 'card-a' });
    await flushPromises();
    api.resetCharacterAssistantDraftFromSavedCharacter.mockRejectedValueOnce(new Error('数据库暂不可用'));
    expect(await workspace.resetDraftFromSavedCharacter()).toBe(false);
    expect(workspace.resetDraftError).toBe('数据库暂不可用');
    expect(editor.form.name).toBe('draft');
    expect(workspace.busy).toBe(false);
    const character = { id: 'card-a', name: 'saved' };
    api.resetCharacterAssistantDraftFromSavedCharacter.mockResolvedValueOnce({ character, session: { ...original, character } });
    expect(await workspace.resetDraftFromSavedCharacter()).toBe(true);
    expect(workspace.resetDraftError).toBe('');
  });

  it('rejects a reset response for another character without applying it', async () => {
    const original = session('bound-session', { characterId: 'card-a', character: { name: 'draft' } });
    api.fetchCharacterAssistantSessions.mockResolvedValueOnce([original]);
    api.fetchCharacterAssistantSession.mockResolvedValueOnce(original);
    const { editor, workspace } = setupEditor({ editingCharacterId: 'card-a' });
    await flushPromises();
    api.resetCharacterAssistantDraftFromSavedCharacter.mockResolvedValueOnce({ character: { id: 'card-b' }, session: original });
    expect(await workspace.resetDraftFromSavedCharacter()).toBe(false);
    expect(editor.form.name).toBe('draft');
    expect(workspace.resetDraftError).toContain('不匹配');
  });

  it('does not reset unbound or running sessions', async () => {
    const { workspace } = setupEditor();
    await flushPromises();
    expect(await workspace.resetDraftFromSavedCharacter()).toBe(false);
    workspace.running = true;
    expect(await workspace.resetDraftFromSavedCharacter()).toBe(false);
    expect(api.resetCharacterAssistantDraftFromSavedCharacter).not.toHaveBeenCalled();
  });

  it('keeps the current draft and exposes a version restore error', async () => {
    const { editor, workspace } = setupEditor();
    await flushPromises();
    api.restoreCharacterAssistantVersion.mockRejectedValueOnce(new Error('历史版本不存在'));
    expect(await workspace.restoreVersion('missing')).toBe(false);
    expect(editor.form.name).toBe('current draft');
    expect(workspace.versionsError).toBe('历史版本不存在');
    expect(workspace.busy).toBe(false);
  });

  it('drains an older autosave before restoring even when the local draft matches the previous baseline', async () => {
    const { editor, workspace } = setupEditor();
    await flushPromises();
    let finishSave;
    api.updateCharacterAssistantSession.mockImplementationOnce((id, payload) => new Promise((resolve) => {
      finishSave = () => resolve(session(id, payload));
    }));
    editor.form.name = 'older autosave';
    const pendingSave = workspace.persist();
    await flushPromises();
    editor.form.name = 'current draft';
    api.restoreCharacterAssistantVersion.mockResolvedValueOnce(session('new-session', { character: { name: 'historical draft' } }));
    const restoring = workspace.restoreVersion('before-ai');
    await flushPromises();
    expect(api.restoreCharacterAssistantVersion).not.toHaveBeenCalled();

    finishSave();
    await pendingSave;
    expect(await restoring).toBe(true);

    expect(api.updateCharacterAssistantSession).toHaveBeenCalledTimes(2);
    expect(api.updateCharacterAssistantSession.mock.calls[1][1].character.name).toBe('current draft');
    expect(api.updateCharacterAssistantSession.mock.invocationCallOrder[1]).toBeLessThan(api.restoreCharacterAssistantVersion.mock.invocationCallOrder[0]);
    expect(editor.form.name).toBe('historical draft');
  });

  it('prevents restoring history while a turn runs and clears history when switching sessions', async () => {
    const { workspace } = setupEditor();
    await flushPromises();
    workspace.running = true;
    expect(await workspace.restoreVersion('before-ai')).toBe(false);
    expect(api.restoreCharacterAssistantVersion).not.toHaveBeenCalled();
    workspace.running = false;
    workspace.versions = [{ id: 'first-history' }];
    await workspace.newSession();
    expect(workspace.versions).toEqual([]);
  });

  it('starts history loading for the new session while discarding an older request', async () => {
    const { workspace } = setupEditor();
    await flushPromises();
    let resolveFirst;
    let resolveSecond;
    api.fetchCharacterAssistantVersions
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    const firstLoad = workspace.loadVersions();
    expect(workspace.versionsLoading).toBe(true);
    api.fetchCharacterAssistantSession.mockResolvedValueOnce(session('second-session'));
    await workspace.selectSession('second-session');
    expect(workspace.versionsLoading).toBe(false);

    const secondLoad = workspace.loadVersions();
    expect(api.fetchCharacterAssistantVersions).toHaveBeenNthCalledWith(1, 'new-session');
    expect(api.fetchCharacterAssistantVersions).toHaveBeenNthCalledWith(2, 'second-session');
    resolveFirst([{ id: 'stale-version' }]);
    await firstLoad;
    expect(workspace.versions).toEqual([]);
    expect(workspace.versionsLoading).toBe(true);

    resolveSecond([{ id: 'second-version' }]);
    await secondLoad;
    expect(workspace.versions).toEqual([{ id: 'second-version' }]);
    expect(workspace.versionsLoading).toBe(false);
  });

  it('holds autosave during explicit save and resumes with the committed world book draft', async () => {
    vi.useFakeTimers();
    const { editor, workspace } = setupEditor({ saving: false });
    await flushPromises();
    editor.saving = true;
    editor.form.name = 'save in progress';
    await nextTick();
    await vi.advanceTimersByTimeAsync(700);
    await workspace.persist({ force: true });
    expect(api.updateCharacterAssistantSession).not.toHaveBeenCalled();
    editor.form.name = 'committed draft';
    editor.saving = false;
    await nextTick();
    await vi.advanceTimersByTimeAsync(700);
    expect(api.updateCharacterAssistantSession).toHaveBeenCalledWith('new-session', expect.objectContaining({ character: { name: 'committed draft' } }));
  });

  it('shows pending images through generation and clears them after a successful server refresh', async () => {
    const { editor, workspace } = setupEditor();
    await flushPromises();
    editor.aiAttachments = [{ ...image }];
    editor.aiRequirement = '';
    let finish;
    const running = workspace.run(() => new Promise((resolve) => { finish = () => { editor.aiStatus = 'completed'; editor.aiAttachments = []; resolve(); }; }));
    await flushPromises();
    expect(workspace.pendingMessage).toBe('');
    expect(workspace.pendingAttachments).toEqual([image]);
    api.fetchCharacterAssistantSession.mockResolvedValueOnce(session('new-session', {
      messages: [{ id: 'user-image', role: 'user', content: '', attachments: [{ type: 'image', url: '/api/assets/saved-image', name: '参考.png' }] }],
      state: { status: 'completed' }
    }));
    finish();
    await running;
    expect(workspace.activeSession.messages[0].attachments[0].url).toBe('/api/assets/saved-image');
    expect(workspace.pendingAttachments).toEqual([]);
    expect(editor.aiAttachments).toEqual([]);
  });

  it('keeps images and text for retry after the pre-request save fails', async () => {
    const { editor, workspace } = setupEditor();
    await flushPromises();
    editor.aiAttachments = [{ ...image }];
    editor.aiRequirement = '参考这张图';
    api.updateCharacterAssistantSession.mockRejectedValueOnce(new Error('保存失败'));
    const action = vi.fn();
    await workspace.run(action);
    expect(action).not.toHaveBeenCalled();
    expect(editor.aiAttachments).toEqual([image]);
    expect(editor.aiRequirement).toBe('参考这张图');
    expect(workspace.pendingAttachments).toEqual([]);
  });

  it('retains the visible failure when upload or connection fails before the server starts a turn', async () => {
    const { editor, workspace } = setupEditor();
    await flushPromises();
    editor.aiAttachments = [{ ...image }];
    editor.aiRequirement = '看一下参考图';
    await workspace.run(() => {
      editor.aiStatus = 'failed';
      editor.aiLastError = '图片上传暂不可用';
      editor.aiStatusMessage = '生成失败，可按原任务重试';
    });
    expect(editor.aiStatus).toBe('failed');
    expect(editor.aiLastError).toBe('图片上传暂不可用');
    expect(editor.aiStatusMessage).toBe('生成失败，可按原任务重试');
    expect(editor.aiAttachments).toEqual([image]);
  });

  it.each(['failed', 'paused'])('keeps an approved plan retryable after a pre-turn interruption: %s', async (status) => {
    const plan = { steps: [{ id: 'persona', section: 'persona', intent: 'Rewrite persona' }] };
    const { editor, workspace } = setupEditor({
      aiPlan: null, aiPlanPhase: 'idle',
      exportAiSessionState() {
        return { requirement: this.aiRequirement, status: this.aiStatus, plan: this.aiPlan, planPhase: this.aiPlanPhase };
      },
      selectAiSession(value) {
        this.aiSessionId = value.id;
        this.aiRequirement = value.state.requirement || '';
        this.aiAttachments = [];
        this.aiStatus = value.state.status || 'idle';
        this.aiPlan = value.state.plan || null;
        this.aiPlanPhase = value.state.planPhase || 'idle';
      }
    });
    await flushPromises();
    editor.aiRequirement = 'Execute this approved plan';
    editor.aiPlan = plan;
    editor.aiPlanPhase = 'review';
    editor.aiStatus = 'review';
    api.fetchCharacterAssistantSession.mockResolvedValueOnce(session('new-session', {
      state: { status: 'review', plan, planPhase: 'review' }
    }));

    await workspace.run(() => {
      editor.aiStatus = status;
      editor.aiPlanPhase = status;
      editor.aiLastError = status === 'failed' ? 'Connection failed before request' : '';
    });

    expect(editor.aiStatus).toBe(status);
    expect(editor.aiPlanPhase).toBe(status);
    expect(editor.aiPlan).toEqual(plan);
    expect(editor.aiRequirement).toBe('Execute this approved plan');
    expect(workspace.running).toBe(false);
    expect(editor.exportAiSessionState().planPhase).toBe(status);
  });

  it('restores failed attachments with this turn asset URLs, keeping older history images separate', async () => {
    const oldMessage = { id: 'old-image', role: 'user', content: '', attachments: [{ type: 'image', url: '/api/assets/old-image' }] };
    api.fetchCharacterAssistantSessions.mockResolvedValue([session('first', { messages: [oldMessage] })]);
    api.fetchCharacterAssistantSession.mockResolvedValueOnce(session('first', { messages: [oldMessage] }));
    const { editor, workspace } = setupEditor();
    await flushPromises();
    editor.aiAttachments = [{ ...image }];
    editor.aiRequirement = '参考新图片';
    const newMessage = { id: 'new-image', role: 'user', content: '参考新图片', attachments: [{ type: 'image', url: '/api/assets/new-image', name: '参考.png' }] };
    api.fetchCharacterAssistantSession.mockResolvedValueOnce(session('first', { messages: [oldMessage, newMessage], state: { status: 'failed' } }));
    await workspace.run(() => { editor.aiStatus = 'failed'; });
    expect(editor.aiAttachments).toEqual([{ id: 'draft-image', type: 'image', name: '参考.png', mimeType: 'image/png', url: '/api/assets/new-image' }]);
    expect(editor.aiRequirement).toBe('参考新图片');

    api.fetchCharacterAssistantSession.mockResolvedValueOnce(session('first', { messages: [oldMessage, newMessage], state: { status: 'failed' } }));
    editor.aiAttachments = [{ ...image }];
    await workspace.run(() => { editor.aiStatus = 'failed'; });
    expect(editor.aiAttachments).toEqual([image]);
  });

  it('clears unsubmitted image drafts when selecting or creating another session', async () => {
    const { editor, workspace } = setupEditor();
    await flushPromises();
    editor.aiAttachments = [{ ...image }];
    await workspace.selectSession('other-session');
    expect(editor.aiAttachments).toEqual([]);
    editor.aiAttachments = [{ ...image }];
    await workspace.newSession();
    expect(editor.aiAttachments).toEqual([]);
  });

  it('creates an unbound session from the current draft and remembers it per user', async () => {
    const { editor, workspace } = setupEditor();
    await flushPromises();
    expect(api.fetchCharacterAssistantSessions).toHaveBeenCalledWith('');
    expect(api.createCharacterAssistantSession).toHaveBeenCalledWith(expect.objectContaining({
      characterId: undefined, character: { name: 'current draft' },
      state: expect.objectContaining({ selectedWorldBookIds: [] })
    }));
    expect(editor.aiSessionId).toBe('new-session');
    expect(workspace.activeSession.id).toBe('new-session');
    expect(sessionStorage.getItem('flai-character-assistant-active:user-1:new')).toBe('new-session');
  });

  it('restores the remembered conversation for this character', async () => {
    sessionStorage.setItem('flai-character-assistant-active:user-1:role-1', 'older-session');
    api.fetchCharacterAssistantSessions.mockResolvedValue([session('latest-session'), session('older-session')]);
    const { editor, workspace } = setupEditor({ editingCharacterId: 'role-1' });
    await flushPromises();
    expect(api.fetchCharacterAssistantSessions).toHaveBeenCalledWith('role-1');
    expect(api.fetchCharacterAssistantSession).toHaveBeenCalledWith('older-session');
    expect(workspace.activeSession.id).toBe('older-session');
    expect(editor.form.name).toBe('older-session');
  });

  it('saves the outgoing draft before switching conversations', async () => {
    api.fetchCharacterAssistantSessions.mockResolvedValue([session('first'), session('second')]);
    const { editor, workspace } = setupEditor();
    await flushPromises();
    editor.form.name = 'unsaved refinement';
    await nextTick();
    await workspace.selectSession('second');
    expect(api.updateCharacterAssistantSession).toHaveBeenCalledWith('first', expect.objectContaining({ character: { name: 'unsaved refinement' } }));
    expect(workspace.activeSession.id).toBe('second');
    expect(editor.form.name).toBe('second');
    expect(api.updateCharacterAssistantSession.mock.invocationCallOrder[0]).toBeLessThan(api.fetchCharacterAssistantSession.mock.invocationCallOrder.at(-1));
  });

  it('saves inherited gateway and model on a new session before its first turn', async () => {
    const { editor, workspace } = setupEditor({
      assistantProviderProfileId: 'gateway-a', assistantModel: 'model-a',
      exportAiSessionState() {
        return { requirement: this.aiRequirement, status: this.aiStatus, process: [{ content: 'previous turn' }] };
      }
    });
    await flushPromises();
    editor.aiRequirement = 'old requirement';
    await workspace.newSession();
    expect(api.createCharacterAssistantSession).toHaveBeenLastCalledWith(expect.objectContaining({
      state: { providerProfileId: 'gateway-a', modelOverride: 'model-a', selectedWorldBookIds: [] }
    }));
  });

  it('carries pending world book link intent into a new conversation', async () => {
    const worldBookLinkDraft = { version: 1, baselineIds: ['book-1'] };
    const { workspace } = setupEditor({
      selectedWorldBookIds: ['book-2'],
      exportAiSessionState() { return { worldBookLinkDraft }; }
    });
    await flushPromises();

    await workspace.newSession();

    expect(api.createCharacterAssistantSession).toHaveBeenLastCalledWith(expect.objectContaining({
      state: {
        providerProfileId: '', modelOverride: '', selectedWorldBookIds: ['book-2'], worldBookLinkDraft
      }
    }));
  });

  it('locks generation and autosave when switching to a session still running on the server', async () => {
    api.fetchCharacterAssistantSessions.mockResolvedValue([session('first'), session('second')]);
    const { editor, workspace } = setupEditor();
    await flushPromises();
    api.fetchCharacterAssistantSession.mockResolvedValue(session('second', { state: { status: 'running' } }));
    await workspace.selectSession('second');
    expect(workspace.settling).toBe(true);
    editor.aiRequirement = 'do not start another request';
    const action = vi.fn();
    await workspace.run(action);
    await workspace.persist({ force: true });
    expect(action).not.toHaveBeenCalled();
    expect(api.updateCharacterAssistantSession).not.toHaveBeenCalledWith('second', expect.anything());
  });

  it('fetches server messages after an interrupted run and never patches messages', async () => {
    const { editor, workspace } = setupEditor();
    await flushPromises();
    const history = [{ id: 'message-1', role: 'assistant', content: '已保留阶段结果', status: 'cancelled' }];
    api.fetchCharacterAssistantSession.mockResolvedValue(session('new-session', {
      messages: history, character: { name: 'latest server checkpoint' }, state: { status: 'paused' }
    }));
    editor.aiRequirement = '完善背景';
    const action = vi.fn().mockRejectedValue(new Error('interrupted'));
    await workspace.run(action);
    expect(action).toHaveBeenCalledOnce();
    expect(workspace.activeSession.messages).toEqual(history);
    expect(editor.form.name).toBe('latest server checkpoint');
    expect(api.updateCharacterAssistantSession).toHaveBeenCalledTimes(1);
    expect(workspace.running).toBe(false);
    expect(workspace.pendingMessage).toBe('');
    expect(workspace.error).toBe('interrupted');
    for (const [, payload] of api.updateCharacterAssistantSession.mock.calls) expect(payload).not.toHaveProperty('messages');
  });

  it('does not start a second run or switch sessions while a request is pending', async () => {
    const { editor, workspace } = setupEditor();
    await flushPromises();
    editor.aiRequirement = '讨论设定';
    let finish;
    const action = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const first = workspace.run(action);
    await flushPromises();
    await workspace.run(action);
    await workspace.selectSession('other-session');
    expect(action).toHaveBeenCalledOnce();
    expect(api.fetchCharacterAssistantSession).not.toHaveBeenCalledWith('other-session');
    finish();
    await first;
  });

  it('keeps unsaved edits when the required pre-request save fails', async () => {
    const { editor, workspace } = setupEditor();
    await flushPromises();
    editor.form.name = 'unsaved character changes';
    editor.aiRequirement = '完善人设';
    api.updateCharacterAssistantSession.mockRejectedValueOnce(new Error('network unavailable'));
    const action = vi.fn();
    await workspace.run(action);
    expect(action).not.toHaveBeenCalled();
    expect(api.fetchCharacterAssistantSession).not.toHaveBeenCalled();
    expect(editor.form.name).toBe('unsaved character changes');
    expect(workspace.error).toBe('network unavailable');
    expect(workspace.running).toBe(false);
  });

  it('does not save a stale draft when editor cancellation clears aiLoading before session disposal', async () => {
    const { editor, workspace } = setupEditor({}, { beforeUnmount: (value) => { value.aiLoading = false; } });
    await flushPromises();
    editor.aiRequirement = '继续维护角色';
    let finish;
    const request = workspace.run(() => {
      editor.aiLoading = true;
      return new Promise((resolve) => { finish = resolve; });
    });
    await flushPromises();
    expect(api.updateCharacterAssistantSession).toHaveBeenCalledTimes(1);
    editor.form.name = 'stale pre-checkpoint form';
    wrappers.pop().unmount();
    await flushPromises();
    expect(editor.aiLoading).toBe(false);
    expect(api.updateCharacterAssistantSession).toHaveBeenCalledTimes(1);
    finish();
    await request;
    expect(api.updateCharacterAssistantSession).toHaveBeenCalledTimes(1);
  });

  it('autosaves changes made to the plan outside a generation request', async () => {
    vi.useFakeTimers();
    const { editor } = setupEditor();
    await flushPromises();
    editor.aiRequirement = '修改计划：保留背景';
    await nextTick();
    await vi.advanceTimersByTimeAsync(650);
    expect(api.updateCharacterAssistantSession).toHaveBeenCalledWith('new-session', expect.objectContaining({
      statePatch: expect.objectContaining({ requirement: '修改计划：保留背景' })
    }));
  });

  it.each([
    ['content', { text: 'x'.repeat(4_000_001) }],
    ['fields', Object.fromEntries(Array.from({ length: 10_001 }, (_, index) => [`field${index}`, index]))]
  ])('reopens a session with excessive %s and sends only changed state before saving, running, and switching', async (_kind, result) => {
    let stored = session('large-session', {
      state: {
        requirement: '', status: 'completed',
        checkpoint: { result }, toolCalls: [{ result }], process: [{ result }],
        worldBookChanges: [{ id: 'worldbook-draft', entries: [{ content: 'retained lore' }] }]
      }
    });
    api.fetchCharacterAssistantSessions.mockResolvedValue([stored, session('other-session')]);
    api.fetchCharacterAssistantSession.mockImplementation(async (id) => id === stored.id ? stored : session(id));
    api.updateCharacterAssistantSession.mockImplementation(async (id, payload) => {
      expect(payload).not.toHaveProperty('state');
      expect(JSON.stringify(payload).length).toBeLessThan(1000);
      stored = { ...stored, character: payload.character, state: { ...stored.state, ...payload.statePatch } };
      return stored;
    });
    const { editor, workspace } = setupEditor({
      runtime: {},
      exportAiSessionState() { return { ...this.runtime, requirement: this.aiRequirement, status: this.aiStatus }; },
      selectAiSession(value) {
        this.aiSessionId = value.id;
        this.aiRequirement = value.state.requirement || '';
        this.aiStatus = value.state.status || 'idle';
        // The restored client state contains defaults absent from the server.
        this.runtime = {
          ...value.state,
          checkpoint: value.state.checkpoint ? { ...value.state.checkpoint, version: 1 } : null,
          worldBookChanges: (value.state.worldBookChanges || []).map((change) => ({ ...change, addToCharacter: true }))
        };
      }
    });
    await flushPromises();
    expect(workspace.activeSession.id).toBe('large-session');
    expect(workspace.error).toBe('');

    await workspace.persist({ force: true });
    expect(api.updateCharacterAssistantSession).toHaveBeenLastCalledWith('large-session', {
      character: { name: 'large-session' }, statePatch: {}
    });
    editor.aiRequirement = '继续完善';
    const action = vi.fn(() => {
      editor.aiStatus = 'completed';
      stored = { ...stored, state: { ...stored.state, status: 'completed' } };
    });
    await workspace.run(action);
    expect(action).toHaveBeenCalledOnce();
    expect(api.updateCharacterAssistantSession.mock.calls[1][1].statePatch).toEqual({ requirement: '继续完善' });
    await workspace.persist();
    expect(api.updateCharacterAssistantSession).toHaveBeenLastCalledWith('large-session', {
      character: { name: 'large-session' }, statePatch: { requirement: '' }
    });
    editor.form.name = 'manually refined draft';
    await workspace.selectSession('other-session');
    expect(api.updateCharacterAssistantSession).toHaveBeenLastCalledWith('large-session', {
      character: { name: 'manually refined draft' }, statePatch: {}
    });
    expect(stored.state.checkpoint.result).toEqual(result);
    expect(stored.state.toolCalls[0].result).toEqual(result);
    expect(stored.state.process[0].result).toEqual(result);
    expect(workspace.activeSession.id).toBe('other-session');
    expect(workspace.error).toBe('');
  });

  it('persists edited world books and explicit plan and checkpoint clears', async () => {
    const state = {
      plan: { steps: [{ id: 'persona' }] }, checkpoint: { character: { name: 'before' } },
      worldBookChanges: [{ id: 'draft', entries: [{ content: 'before' }] }]
    };
    api.fetchCharacterAssistantSessions.mockResolvedValue([session('first', { state })]);
    api.fetchCharacterAssistantSession.mockResolvedValueOnce(session('first', { state }));
    const { editor, workspace } = setupEditor({
      runtime: {},
      exportAiSessionState() { return this.runtime; },
      selectAiSession(value) { this.aiSessionId = value.id; this.runtime = value.state; }
    });
    await flushPromises();
    editor.runtime.worldBookChanges[0].entries[0].content = 'manually edited lore';
    editor.runtime.plan = null;
    editor.runtime.checkpoint = null;
    editor.selectedWorldBookIds = ['linked-book'];

    await workspace.persist();

    expect(api.updateCharacterAssistantSession).toHaveBeenLastCalledWith('first', {
      character: { name: 'first' },
      statePatch: {
        plan: null, checkpoint: null,
        worldBookChanges: [{ id: 'draft', entries: [{ content: 'manually edited lore' }] }],
        selectedWorldBookIds: ['linked-book']
      }
    });
    editor.runtime.worldBookChanges = [];
    editor.selectedWorldBookIds = [];
    await workspace.persist();
    expect(api.updateCharacterAssistantSession.mock.calls[1][1].statePatch).toEqual({
      worldBookChanges: [], selectedWorldBookIds: []
    });
  });

  it('autosaves four world books without repeating their checkpoint and plan context copies', async () => {
    const targets = Array.from({ length: 4 }, (_, bookIndex) => ({
      ref: `new:book-${bookIndex}`, profile: { name: `World ${bookIndex}` },
      entries: Array.from({ length: 30 }, (_, entryIndex) => ({
        id: `entry-${bookIndex}-${entryIndex}`,
        ...normalizeWorldBookEntryForCreate({ name: `Entry ${entryIndex}`, triggerKeys: 'Lore', content: 'Original lore' }, entryIndex)
      }))
    }));
    const worldBookWorkspace = { version: 1, targets };
    const state = {
      worldBookWorkspace, worldBookChanges: targets,
      checkpoint: { character: { name: 'Retained checkpoint', worldBookWorkspace, worldBookChanges: targets }, summary: 'Retained summary' },
      planContext: { requirement: 'Retained task', character: { name: 'Original draft' }, worldBookContext: { workspace: worldBookWorkspace } }
    };
    let stored = session('first', { state });
    api.fetchCharacterAssistantSessions.mockResolvedValue([stored]);
    api.fetchCharacterAssistantSession.mockResolvedValueOnce(stored);
    api.updateCharacterAssistantSession.mockImplementation(async (_id, payload) => {
      const next = { ...stored.state, ...payload.statePatch };
      next.checkpoint = {
        ...next.checkpoint,
        character: { ...next.checkpoint.character, worldBookWorkspace: next.worldBookWorkspace, worldBookChanges: next.worldBookChanges }
      };
      next.planContext = { ...next.planContext, worldBookContext: { ...next.planContext.worldBookContext, workspace: next.worldBookWorkspace } };
      stored = { ...stored, state: next };
      return stored;
    });
    const { editor, workspace } = setupEditor({
      runtime: {},
      exportAiSessionState() { return this.runtime; },
      selectAiSession(value) { this.aiSessionId = value.id; this.runtime = value.state; }
    });
    await flushPromises();
    editor.runtime.worldBookWorkspace.targets[0].entries[0].content = 'Manually refined lore';
    expect(scanJsonBoundary({ state: editor.exportAiSessionState() })).toMatch(/字段过多/);

    await workspace.persist();

    const payload = api.updateCharacterAssistantSession.mock.calls[0][1];
    expect(scanJsonBoundary(payload)).toBe('');
    expect(Object.keys(payload.statePatch)).toEqual(['worldBookWorkspace', 'worldBookChanges']);
    expect(stored.state.checkpoint.character.worldBookWorkspace.targets[0].entries[0].content).toBe('Manually refined lore');
    expect(stored.state.checkpoint.character.worldBookChanges[0].entries[0].content).toBe('Manually refined lore');
    expect(stored.state.planContext.worldBookContext.workspace.targets[0].entries[0].content).toBe('Manually refined lore');
    expect(stored.state.checkpoint.character.name).toBe('Retained checkpoint');
    expect(stored.state.planContext.requirement).toBe('Retained task');
  });

  it('retains checkpoint and plan context edits beyond their synchronized world book copies', async () => {
    const worldBookWorkspace = { version: 1, targets: [] };
    const state = {
      worldBookWorkspace,
      checkpoint: { character: { name: 'Original', worldBookWorkspace } },
      planContext: { requirement: 'Original task', worldBookContext: { workspace: worldBookWorkspace } }
    };
    api.fetchCharacterAssistantSessions.mockResolvedValue([session('first', { state })]);
    api.fetchCharacterAssistantSession.mockResolvedValueOnce(session('first', { state }));
    const { editor, workspace } = setupEditor({
      runtime: {},
      exportAiSessionState() { return this.runtime; },
      selectAiSession(value) { this.aiSessionId = value.id; this.runtime = value.state; }
    });
    await flushPromises();
    editor.runtime.worldBookWorkspace.targets.push({ ref: 'new:book', entries: [] });
    editor.runtime.checkpoint.character.name = 'Edited checkpoint';
    editor.runtime.planContext.requirement = 'Edited task';
    await workspace.persist();
    const { statePatch } = api.updateCharacterAssistantSession.mock.calls[0][1];
    expect(statePatch.checkpoint.character.name).toBe('Edited checkpoint');
    expect(statePatch.planContext.requirement).toBe('Edited task');
  });

  it.each([false, true])('saves a queued requirement clear against the completed write when unmounted: %s', async (unmount) => {
    const { editor, workspace } = setupEditor();
    await flushPromises();
    let finishSave;
    api.updateCharacterAssistantSession.mockImplementationOnce((id, payload) => new Promise((resolve) => {
      finishSave = () => resolve(session(id, payload));
    }));
    editor.aiRequirement = 'older queued requirement';
    const pendingSave = workspace.persist();
    await flushPromises();
    editor.aiRequirement = '';
    let clearing;
    if (unmount) wrappers.pop().unmount();
    else clearing = workspace.persist();
    await flushPromises();
    expect(api.updateCharacterAssistantSession).toHaveBeenCalledTimes(1);

    finishSave();
    await pendingSave;
    if (clearing) await clearing;
    await flushPromises();

    expect(api.updateCharacterAssistantSession).toHaveBeenCalledTimes(2);
    expect(api.updateCharacterAssistantSession.mock.calls[0][1].statePatch).toEqual({ requirement: 'older queued requirement' });
    expect(api.updateCharacterAssistantSession.mock.calls[1][1].statePatch).toEqual({ requirement: '' });
  });

  it('deleting the last session starts a clean conversation while retaining the draft', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { editor, workspace } = setupEditor();
    await flushPromises();
    editor.form.name = 'keep this character';
    api.createCharacterAssistantSession.mockResolvedValueOnce(session('replacement'));
    await workspace.removeSession('new-session');
    expect(api.deleteCharacterAssistantSession).toHaveBeenCalledWith('new-session');
    expect(api.createCharacterAssistantSession).toHaveBeenLastCalledWith(expect.objectContaining({
      character: { name: 'keep this character' },
      state: { providerProfileId: '', modelOverride: '', selectedWorldBookIds: [] }
    }));
    expect(workspace.activeSession.id).toBe('replacement');
    expect(editor.form.name).toBe('keep this character');
  });
});
