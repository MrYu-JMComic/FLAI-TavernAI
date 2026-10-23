import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, reactive, ref } from 'vue';
import { useCharacterAiGeneration } from '../useCharacterAiGeneration.js';
import { streamCharacterDraft } from '../../../api/characters.js';
import { createAsset } from '../../../api/assets.js';

vi.mock('../../../api/characters.js', () => ({ streamCharacterDraft: vi.fn() }));
vi.mock('../../../api/worldBooks.js', () => ({ applyWorldBookChanges: vi.fn(), fetchWorldBook: vi.fn() }));
vi.mock('../../../api/mods.js', () => ({ createMod: vi.fn() }));
vi.mock('../../../api/assets.js', () => ({ createAsset: vi.fn() }));

let scope;
beforeEach(() => { localStorage.clear(); });
afterEach(() => { scope?.stop(); vi.resetAllMocks(); vi.restoreAllMocks(); });

function fixture({ useCurrent = true, planMode = false } = {}) {
  scope = effectScope();
  const characterId = ref('character-a');
  const assistantProviderProfileId = ref('');
  const assistantModel = ref('');
  const form = reactive({
    name: '手动角色', avatarUrl: '/uploads/avatar.png', gender: '女', age: '25',
    background: '手动背景', worldview: '手动世界观', persona: '手动人设', openingMessage: '手动开场白',
    visibility: 'public', selectedTags: ['原有标签'], tagsText: '原有标签', worldBookId: 'legacy-book',
    regexRules: [{ label: '保留规则', pattern: '原文', replacement: '替换' }],
    renderPlugins: [{ label: '保留插件', pattern: '标题', type: 'fold' }],
    authorAdvancedSettings: {
      customCss: '.card { color: red; }', customCssEnabled: true, customCssRiskAccepted: true,
      customJs: 'setStatus("心情", "开心");', customJsEnabled: true, customJsRiskAccepted: true,
      statusBarBlueprint: { variables: [{ name: '心情', type: 'text', value: '开心' }], template: '{{心情}}' },
      accessorySkills: { statusBarAgent: { enabled: 'auto', modelOverride: 'manual-model' } }
    },
    canEdit: true, canUse: true, isOwner: true
  });
  const options = reactive({ profile: true, tags: true, persona: true, background: true, advancedSettings: true, worldBook: true });
  const applyAdvancedSettingsDraft = vi.fn((value) => { form.authorAdvancedSettings = value; });
  const api = scope.run(() => useCharacterAiGeneration({
    canEdit: ref(true), saving: ref(false), form, aiOptions: options,
    aiUseCurrentDraft: ref(useCurrent), assistantPlanMode: ref(planMode),
    assistantProviderProfileId, assistantModel,
    getSessionId: () => characterId.value, getSelectedWorldBookIds: () => ['book-a'],
    isConversationMode: () => true,
    buildPayload: () => ({ ...JSON.parse(JSON.stringify(form)), tags: [...form.selectedTags] }),
    applyAdvancedSettingsDraft,
    notify: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }
  }));
  api.selectAiSession({ id: 'session-a', messages: [], state: {} });
  api.aiRequirement.value = '先讨论角色动机，不要修改';
  return { api, form, options, characterId, applyAdvancedSettingsDraft, assistantProviderProfileId, assistantModel };
}

describe('character assistant conversation runtime', () => {
  const draftImage = (name = '参考.png') => ({
    id: name, type: 'image', name, alt: name, mimeType: 'image/png', size: 3,
    dataUrl: 'data:image/png;base64,YWJj'
  });

  it('clears submitted text while awaiting the reply and keeps it in the request and conversation', async () => {
    const { api } = fixture();
    const requirement = api.aiRequirement.value;
    let finish;
    streamCharacterDraft.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));

    const running = api.completeWithAi();

    expect(api.aiLoading.value).toBe(true);
    expect(api.aiFinalContent.value).toBe('');
    expect(api.aiRequirement.value).toBe('');
    expect(streamCharacterDraft.mock.calls[0][0].requirement).toBe(requirement);
    finish({ changed: false, character: {}, assistantMessage: '任务汇报：已收到。', summary: '已收到。' });
    await running;
    expect(api.aiFinalContent.value).toBe('任务汇报：已收到。');
    expect(api.aiRequirement.value).toBe('');
    expect(api.exportAiSessionState().requirement).toBe('');
    expect(api.aiConversationHistory.value.at(-2)).toEqual({ role: 'user', content: requirement });
  });

  it('restores the exact submitted text after a failed send and clears it on retry', async () => {
    const { api } = fixture();
    const requirement = '  保留背景\n只讨论角色动机  ';
    api.aiRequirement.value = requirement;
    streamCharacterDraft.mockRejectedValueOnce(new Error('模型暂不可用'));
    await api.completeWithAi();
    expect(api.aiRequirement.value).toBe(requirement);
    expect(api.aiStatus.value).toBe('failed');
    streamCharacterDraft.mockResolvedValueOnce({ changed: false, character: {}, summary: '重试成功。' });
    await api.retryCharacterAi();
    expect(streamCharacterDraft.mock.calls[1][0].requirement).toBe(requirement.trim());
    expect(api.aiRequirement.value).toBe('');
  });

  it.each(['completed', 'review'])('keeps an unsent repeated message when reopening a %s session', (status) => {
    const { api } = fixture();
    const requirement = '原始任务';
    const saved = {
      id: 'session-a', state: { status, requirement, planContext: { character: { name: '角色' } } },
      messages: [{ role: 'user', content: requirement }, { role: 'assistant', content: '已响应' }]
    };
    api.selectAiSession(saved);
    expect(api.aiRequirement.value).toBe(requirement);
    expect(api.exportAiSessionState().planContext.requirement).toBe(requirement);
    api.selectAiSession({ ...saved, state: { ...saved.state, requirement: '尚未发送的新问题' } });
    expect(api.aiRequirement.value).toBe('尚未发送的新问题');
  });

  it('keeps the original legacy plan task separate from an unsent follow-up', async () => {
    const { api } = fixture({ planMode: true });
    api.selectAiSession({
      id: 'session-a', state: {
        status: 'review', requirement: '尚未发送的新问题', planPhase: 'review',
        plan: { steps: [{ section: 'persona', intent: '完善人设' }] },
        planContext: { character: { name: '角色' }, worldBookContext: {} }
      }, messages: [{ role: 'user', content: '原始任务' }]
    });
    expect(api.aiRequirement.value).toBe('尚未发送的新问题');
    expect(api.exportAiSessionState().planContext.requirement).toBe('原始任务');
    api.aiRequirement.value = '';
    streamCharacterDraft.mockResolvedValueOnce({ changed: false, character: {}, summary: '完成' });
    await api.executeApprovedPlan();
    expect(streamCharacterDraft.mock.calls[0][0].requirement).toBe('原始任务');
  });

  it('uploads an image-only turn as an asset and never serializes its bytes into session state', async () => {
    const { api } = fixture({ useCurrent: false });
    api.aiRequirement.value = '';
    api.aiAttachments.value = [draftImage()];
    const exported = JSON.stringify(api.exportAiSessionState());
    expect(exported).not.toContain('base64');
    createAsset.mockResolvedValue({ url: '/api/assets/reference-image', mimeType: 'image/png', byteSize: 3 });
    streamCharacterDraft.mockResolvedValue({ changed: false, character: {}, summary: '已看图。' });

    await api.completeWithAi();

    expect(createAsset).toHaveBeenCalledWith(expect.objectContaining({
      dataUrl: draftImage().dataUrl, ownerType: 'character-assistant-session', ownerId: 'session-a', kind: 'chat-image'
    }), { signal: expect.any(AbortSignal) });
    expect(streamCharacterDraft.mock.calls[0][0]).toMatchObject({
      requirement: '', attachments: [{ type: 'image', url: '/api/assets/reference-image', name: '参考.png' }]
    });
    expect(JSON.stringify(streamCharacterDraft.mock.calls[0][0])).not.toContain('base64');
    expect(api.aiAttachments.value).toEqual([]);
    expect(api.aiStatus.value).toBe('completed');
  });

  it('retains uploaded URLs and unreadied images when one upload fails, then retries only the unfinished image', async () => {
    const { api } = fixture();
    api.aiAttachments.value = [draftImage('第一.png'), draftImage('第二.png')];
    createAsset.mockResolvedValueOnce({ url: '/api/assets/first' }).mockRejectedValueOnce(new Error('上传失败'));
    await api.completeWithAi();

    expect(api.aiStatus.value).toBe('failed');
    expect(api.aiRequirement.value).toBe('先讨论角色动机，不要修改');
    expect(api.aiAttachments.value[0]).toMatchObject({ url: '/api/assets/first' });
    expect(api.aiAttachments.value[0]).not.toHaveProperty('dataUrl');
    expect(api.aiAttachments.value[1]).toHaveProperty('dataUrl');
    expect(streamCharacterDraft).not.toHaveBeenCalled();

    createAsset.mockResolvedValueOnce({ url: '/api/assets/second' });
    streamCharacterDraft.mockResolvedValueOnce({ changed: false, character: {}, summary: '收到两张。' });
    await api.retryCharacterAi();
    expect(createAsset).toHaveBeenCalledTimes(3);
    expect(streamCharacterDraft.mock.calls[0][0].attachments.map((image) => image.url)).toEqual(['/api/assets/first', '/api/assets/second']);
    expect(api.aiAttachments.value).toEqual([]);
  });

  it('keeps an uploaded image available when generation fails and stops image upload with the same controller', async () => {
    const { api } = fixture();
    api.aiAttachments.value = [draftImage()];
    createAsset.mockResolvedValueOnce({ url: '/api/assets/reference-image' });
    streamCharacterDraft.mockRejectedValueOnce(new Error('模型暂不可用'));
    await api.completeWithAi();
    expect(api.aiAttachments.value[0].url).toBe('/api/assets/reference-image');

    api.aiAttachments.value = [draftImage('新图.png')];
    createAsset.mockImplementationOnce((_payload, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('已停止', 'AbortError')), { once: true });
    }));
    const running = api.completeWithAi();
    api.stopCharacterAi();
    await running;
    expect(api.aiStatus.value).toBe('paused');
    expect(api.aiRequirement.value).toBe('先讨论角色动机，不要修改');
    expect(api.aiAttachments.value[0].name).toBe('新图.png');
    expect(streamCharacterDraft).toHaveBeenCalledTimes(1);
  });

  it('does not apply a late image upload from a different session', async () => {
    const { api } = fixture();
    let finish;
    api.aiAttachments.value = [draftImage()];
    createAsset.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const running = api.completeWithAi();
    api.selectAiSession({ id: 'session-b', state: {}, messages: [] });
    api.aiAttachments.value = [draftImage('B.png')];
    finish({ url: '/api/assets/old-image' });
    await running;
    expect(api.aiAttachments.value).toEqual([draftImage('B.png')]);
    expect(streamCharacterDraft).not.toHaveBeenCalled();
  });

  it('does not resend the planning images while executing an approved plan', async () => {
    const { api } = fixture({ planMode: true });
    const requirement = api.aiRequirement.value;
    api.aiAttachments.value = [draftImage()];
    createAsset.mockResolvedValueOnce({ url: '/api/assets/planning-image' });
    streamCharacterDraft.mockResolvedValueOnce({ phase: 'plan', plan: { steps: [{ section: 'persona', intent: '参考图片完善人设' }] } });
    await api.completeWithAi();
    expect(api.aiStatus.value).toBe('review');
    expect(api.aiRequirement.value).toBe('');
    const saved = api.exportAiSessionState();
    expect(saved.planContext.requirement).toBe(requirement);
    api.selectAiSession({ id: 'session-a', state: saved, messages: [{ role: 'user', content: requirement }] });
    expect(api.aiAttachments.value).toEqual([]);
    streamCharacterDraft.mockResolvedValueOnce({ changed: false, character: {}, summary: '计划已完成。' });
    await api.executeApprovedPlan();
    expect(createAsset).toHaveBeenCalledOnce();
    expect(streamCharacterDraft.mock.calls[1][0]).not.toHaveProperty('attachments');
    expect(streamCharacterDraft.mock.calls[1][0].plan.approved).toBe(true);
    expect(streamCharacterDraft.mock.calls[1][0].requirement).toBe(requirement);
    expect(api.aiRequirement.value).toBe('');
  });

  it('replans the original task with an empty composer after planning succeeds', async () => {
    const { api } = fixture({ planMode: true });
    const requirement = api.aiRequirement.value;
    const result = { phase: 'plan', plan: { steps: [{ section: 'persona', intent: '完善人设' }] } };
    streamCharacterDraft.mockResolvedValue(result);
    await api.completeWithAi();
    expect(api.aiRequirement.value).toBe('');
    await api.replanCharacterAi();
    expect(streamCharacterDraft.mock.calls[1][0].requirement).toBe(requirement);
    expect(api.aiRequirement.value).toBe('');
  });

  it('uses server history for long image conversations instead of sending or saving another copy', async () => {
    const { api } = fixture();
    const messages = Array.from({ length: 201 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user', content: index ? `消息 ${index}` : '',
      ...(index === 0 ? { attachments: [{ type: 'image', url: '/api/assets/history-image', name: '旧图.png' }] } : {})
    }));
    api.selectAiSession({ id: 'long-session', state: {}, messages });
    expect(api.aiConversationHistory.value[0].attachments[0].url).toBe('/api/assets/history-image');
    api.aiRequirement.value = '继续';
    streamCharacterDraft.mockResolvedValueOnce({ changed: false, character: {}, summary: '继续讨论。' });
    await api.completeWithAi();
    expect(streamCharacterDraft.mock.calls[0][0]).not.toHaveProperty('history');
    expect(api.exportAiSessionState().conversationHistory).toEqual([]);
  });

  it('routes the selected gateway and model and restores each session selection', async () => {
    const { api, assistantProviderProfileId, assistantModel } = fixture();
    assistantProviderProfileId.value = 'gateway-a';
    assistantModel.value = 'model-a';
    streamCharacterDraft.mockResolvedValueOnce({ changed: false, character: {}, summary: '已讨论。' });
    await api.completeWithAi();
    expect(streamCharacterDraft.mock.calls[0][0]).toMatchObject({ providerProfileId: 'gateway-a', modelOverride: 'model-a' });
    const saved = api.exportAiSessionState();
    api.selectAiSession({ id: 'session-b', messages: [], state: { providerProfileId: 'gateway-b', modelOverride: 'model-b' } });
    expect(assistantProviderProfileId.value).toBe('gateway-b');
    expect(assistantModel.value).toBe('model-b');
    api.selectAiSession({ id: 'session-a', messages: [], state: saved });
    expect(assistantProviderProfileId.value).toBe('gateway-a');
    expect(assistantModel.value).toBe('model-a');
  });

  it.each([true, false])('keeps the exact manual form when a conversation makes no edits (current draft %s)', async (useCurrent) => {
    const { api, form, applyAdvancedSettingsDraft } = fixture({ useCurrent });
    const before = JSON.parse(JSON.stringify(form));
    streamCharacterDraft.mockResolvedValueOnce({
      changed: false, assistantMessage: '可以先讨论她的动机。', summary: '可以先讨论她的动机。',
      character: {
        name: '', avatarUrl: '', visibility: 'private', persona: '', tags: [], regexRules: [], renderPlugins: [],
        authorAdvancedSettings: { customCss: '', customCssEnabled: false }
      },
      toolCalls: [], process: []
    });

    await api.completeWithAi();

    expect(streamCharacterDraft.mock.calls[0][0]).toMatchObject({ assistantSessionId: 'session-a', conversationMode: true });
    expect(streamCharacterDraft.mock.calls[0][0].character).toMatchObject({
      avatarUrl: before.avatarUrl, worldBookId: before.worldBookId, tags: before.selectedTags,
      authorAdvancedSettings: before.authorAdvancedSettings
    });
    expect(streamCharacterDraft.mock.calls[0][0].options.excludeCharacterContext).toBe(!useCurrent);
    expect(form).toEqual(before);
    expect(applyAdvancedSettingsDraft).not.toHaveBeenCalled();
    expect(api.aiStatus.value).toBe('completed');
    expect(api.aiConversationHistory.value.at(-1).content).toBe('可以先讨论她的动机。');
  });

  it.each([{ tags: ['旅人', '雾港'] }, { tags: [] }])('updates both tag representations after an actual tool edit: $tags', async ({ tags }) => {
    const { api, form } = fixture();
    streamCharacterDraft.mockResolvedValueOnce({
      changed: true, character: { tags }, summary: '标签已更新。',
      toolCalls: [{ name: 'update_character_profile', arguments: { tags }, result: { ok: true } }]
    });

    await api.completeWithAi();

    expect(form.selectedTags).toEqual(tags);
    expect(form.tagsText).toBe(tags.join(', '));
    expect(form.selectedTags).not.toBe(tags);
    expect(form.avatarUrl).toBe('/uploads/avatar.png');
    expect(form.worldBookId).toBe('legacy-book');
  });

  it('retains the manual avatar in checkpoints when AI story results omit the unsupported avatar field', async () => {
    const { api, form } = fixture();
    const character = { name: '手动角色', persona: 'AI 完善后的动机' };
    streamCharacterDraft.mockImplementationOnce(async (_request, handlers) => {
      handlers.checkpoint({ character, completedSections: ['persona'] });
      expect(api.aiCheckpoint.value.character.avatarUrl).toBe(form.avatarUrl);
      return { changed: true, character, summary: '动机已完善。' };
    });

    await api.completeWithAi();

    expect(api.aiStatus.value).toBe('completed');
    expect(form.persona).toBe(character.persona);
    expect(form.avatarUrl).toBe('/uploads/avatar.png');
    expect(api.exportAiSessionState().checkpoint.character.avatarUrl).toBe(form.avatarUrl);
    expect(character).not.toHaveProperty('avatarUrl');
  });

  it.each(['/uploads/replacement.png', ''])('uses the current manual avatar when resuming a legacy checkpoint: %s', async (avatarUrl) => {
    const { api, form } = fixture({ useCurrent: false });
    api.selectAiSession({
      id: 'session-a', messages: [], state: {
        status: 'paused', checkpoint: { character: { name: '阶段角色', persona: '已完成的阶段动机' } }
      }
    });
    api.aiRequirement.value = '继续完善';
    form.avatarUrl = avatarUrl;
    streamCharacterDraft.mockResolvedValueOnce({ changed: true, character: { persona: '续写后的动机' }, summary: '已继续完善。' });

    await api.resumeCharacterAi();

    expect(streamCharacterDraft.mock.calls[0][0].character).toMatchObject({
      name: '阶段角色', persona: '已完成的阶段动机', avatarUrl
    });
    expect(form.avatarUrl).toBe(avatarUrl);
    expect(api.aiCheckpoint.value.character.avatarUrl).toBe(avatarUrl);
  });

  it.each(['', '/uploads/stale-ai-avatar.png'])('keeps a manual avatar change while AI checkpoints and results contain an unsupported avatar: %s', async (aiAvatarUrl) => {
    const { api, form } = fixture();
    let finish;
    let handlers;
    streamCharacterDraft.mockImplementationOnce((_request, streamHandlers) => {
      handlers = streamHandlers;
      return new Promise((resolve) => { finish = resolve; });
    });
    const running = api.completeWithAi();
    form.avatarUrl = '/uploads/replacement.png';
    const character = { persona: 'AI 完善后的动机', avatarUrl: aiAvatarUrl };
    handlers.checkpoint({ character });

    expect(api.aiCheckpoint.value.character.avatarUrl).toBe('/uploads/replacement.png');
    finish({ changed: true, character, summary: '已完善。' });
    await running;

    expect(form.avatarUrl).toBe('/uploads/replacement.png');
    expect(form.persona).toBe(character.persona);
    form.avatarUrl = '';
    api.saveAiCheckpoint();
    expect(form.avatarUrl).toBe('');
  });

  it('restores the selected server session and clears the previous conversation state', () => {
    const { api, options } = fixture();
    const contextA = { strategy: 'stable-prefix-v1', estimatedTokens: 120, cache: { reported: false } };
    const checkpointA = { character: { name: '阶段角色' }, updatedAt: '2026-10-18T01:00:00.000Z' };
    const sessionA = {
      id: 'session-a',
      state: {
        requirement: '继续之前的任务', options: { profile: true, tags: false }, status: 'running',
        checkpoint: checkpointA, reasoning: '安全进度', process: [{ round: 1, content: '', tools: [] }],
        toolCalls: [{ name: 'update_character_story', result: { ok: true } }], warnings: ['待复核'],
        modSuggestions: [{ name: '建议', content: '内容' }], worldBookTargetOverride: ['session-a-only-book'],
        worldBookChanges: [{ ref: 'new:a', entries: [] }], context: contextA,
        plan: { steps: [{ id: 'step-a', section: 'persona', intent: '完善动机' }] }, planPhase: 'review',
        conversationHistory: [{ role: 'assistant', content: '过期的本地历史' }]
      },
      messages: [{ role: 'user', content: 'A 的问题' }, { role: 'assistant', content: 'A 的回复' }]
    };

    api.selectAiSession(sessionA);
    expect(api.aiSessionId.value).toBe('session-a');
    expect(api.aiRequirement.value).toBe('继续之前的任务');
    expect(api.aiStatus.value).toBe('paused');
    expect(api.aiCheckpoint.value).toEqual(checkpointA);
    expect(api.aiContext.value).toEqual(contextA);
    expect(api.aiConversationHistory.value).toEqual(sessionA.messages);
    expect(api.aiWorldBookSelectedIds.value).toEqual(['session-a-only-book']);
    expect(options.tags).toBe(false);
    expect(api.aiPlan.value.steps[0].id).toBe('step-a');

    const contextB = { strategy: 'stable-prefix-v1', estimatedTokens: 42, cache: { reported: true, cachedTokens: 0 } };
    api.selectAiSession({
      id: 'session-b', state: { requirement: 'B 的新要求', options: { profile: false, tags: true }, status: 'completed' },
      messages: [{ role: 'user', content: 'B 的问题' }, { role: 'assistant', content: 'B 的回复', context: contextB }]
    });
    expect(api.aiSessionId.value).toBe('session-b');
    expect(api.aiRequirement.value).toBe('B 的新要求');
    expect(api.aiStatus.value).toBe('completed');
    expect(api.aiContext.value).toEqual(contextB);
    expect(api.aiConversationHistory.value).toEqual([{ role: 'user', content: 'B 的问题' }, { role: 'assistant', content: 'B 的回复' }]);
    expect(api.aiCheckpoint.value).toBeNull();
    expect(api.aiProcess.value).toEqual([]);
    expect(api.aiToolCalls.value).toEqual([]);
    expect(api.aiWarnings.value).toEqual([]);
    expect(api.aiReasoning.value).toBe('');
    expect(api.aiModSuggestions.value).toEqual([]);
    expect(api.aiWorldBookChanges.value).toEqual([]);
    expect(api.aiWorldBookSelectedIds.value).toEqual(['book-a']);
    expect(api.aiPlan.value).toBeNull();
    expect(options).toMatchObject({ profile: false, tags: true });

    api.selectAiSession(sessionA);
    expect(api.aiCheckpoint.value).toEqual(checkpointA);
    expect(api.aiContext.value).toEqual(contextA);
    expect(api.aiConversationHistory.value).toEqual(sessionA.messages);
  });

  it('respects an explicitly cleared context while preserving conversation messages after a saved-card reset', () => {
    const { api } = fixture();
    api.selectAiSession({
      id: 'reset-session',
      state: { context: null, checkpoint: null, plan: null, status: 'idle' },
      messages: [{ role: 'assistant', content: 'Previous reply', context: { character: { name: 'stale draft' } } }]
    });
    expect(api.aiContext.value).toBeNull();
    expect(api.aiCheckpoint.value).toBeNull();
    expect(api.aiPlan.value).toBeNull();
    expect(api.aiConversationHistory.value).toEqual([{ role: 'assistant', content: 'Previous reply' }]);
  });

  it('uses server sessions without reading or writing legacy localStorage during selection and conversation', async () => {
    const legacyKey = 'flai-character-ai-session:character-a';
    const legacyValue = JSON.stringify({ version: 4, requirement: '旧页面遗留任务', status: 'failed' });
    localStorage.setItem(legacyKey, legacyValue);
    const read = vi.spyOn(Storage.prototype, 'getItem');
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const remove = vi.spyOn(Storage.prototype, 'removeItem');
    const { api, characterId } = fixture();
    api.setAiOptionValue('profile', false);
    streamCharacterDraft.mockResolvedValueOnce({ changed: false, character: {}, summary: '只讨论，不修改。' });

    await api.completeWithAi();
    api.selectAiSession({ id: 'session-b', messages: [], state: { requirement: '新的服务端要求' } });
    characterId.value = 'character-b';
    await nextTick();

    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    read.mockRestore();
    expect(localStorage.getItem(legacyKey)).toBe(legacyValue);
  });
});
