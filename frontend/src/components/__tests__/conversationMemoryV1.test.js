import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import MemoryAgentSettingsDialog from '../chat/MemoryAgentSettingsDialog.vue';
import ConversationMemoryReview from '../chat/ConversationMemoryReview.vue';
import ChatProcessingStatus from '../chat/ChatProcessingStatus.vue';
import ChatContextInspector from '../chat/ChatContextInspector.vue';
import { hasNonDefaultAccessorySkills, normalizeAccessorySkillsForPayload } from '../../composables/character/useCharacterFormPayload.js';
import { normalizeMemoryEmbedding, normalizeMemoryPolicy, portableMemoryDefaults } from '../../../../shared/memoryPolicy.js';

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock('../../api/core.js', () => ({ apiRequest, streamSSE: vi.fn() }));
vi.mock('../../api/providers.js', () => ({
  listProviderProfiles: vi.fn(async () => ({ providers: [{ id: 'embedding-profile', gatewayName: '向量服务', model: 'chat' }] })),
  fetchProviderModels: vi.fn(async () => ({ models: [] }))
}));

let wrapper;
afterEach(() => { wrapper?.unmount(); wrapper = null; apiRequest.mockReset(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('conversation memory V1 user contracts', () => {
  it('preserves independent embedding and temporal policy through author form normalization', () => {
    const skills = normalizeAccessorySkillsForPayload({ memoryAgent: {
      thinking_level: 'off',
      memoryPolicy: { isolation: 'actor', actorId: 'actor-1', coreWaitMs: 9000, summaryEnabled: false, syncMode: 'blocking', shortTermTurns: 12, autoConsolidate: false, statusLink: true },
      embedding: { enabled: true, providerProfileId: 'embedding-profile', dimensions: 512, quotaUsdPerCny: 0.14 }
    } });
    expect(skills.memoryAgent.memoryPolicy).toMatchObject({ isolation: 'actor', actorId: 'actor-1', coreWaitMs: 9000, summaryEnabled: false });
    expect(skills.memoryAgent.thinkingLevel).toBe('off');
    expect(hasNonDefaultAccessorySkills({ memoryAgent: { thinkingLevel: 'off' } })).toBe(true);
    expect(skills.memoryAgent.memoryPolicy).toMatchObject({ syncMode: 'blocking', shortTermTurns: 12, autoConsolidate: false, statusLink: true });
    expect(skills.memoryAgent.embedding).toMatchObject({ providerProfileId: 'embedding-profile', enabled: true, dimensions: 512, quotaUsdPerCny: 0.14 });
    expect(portableMemoryDefaults(skills.memoryAgent)).toMatchObject({ thinkingLevel: 'off', memoryPolicy: { actorId: '' }, embedding: { providerProfileId: '', enabled: false, quotaUsdPerCny: 0 } });
  });

  it('requires an explicit actor and separate embedding binding before saving', async () => {
    wrapper = mount(MemoryAgentSettingsDialog, {
      props: { open: false, skill: { memoryPolicy: { isolation: 'actor' }, embedding: { enabled: true } } },
      global: { stubs: { teleport: true } }
    });
    await wrapper.setProps({ open: true });
    await flushPromises();
    await wrapper.get('footer .primary').trigger('click');
    expect(wrapper.get('[role="alert"]').text()).toContain('角色 ID');
    expect(wrapper.emitted('save')).toBeUndefined();
    await wrapper.get('input[placeholder="从角色认知视图复制角色 ID"]').setValue('actor-1');
    await wrapper.get('footer .primary').trigger('click');
    expect(wrapper.get('[role="alert"]').text()).toContain('独立供应商');
    const providerSelect = wrapper.findAll('select').find((select) => select.findAll('option').some((option) => option.text() === '请选择保存的供应商'));
    await providerSelect.setValue('embedding-profile');
    await wrapper.get('footer .primary').trigger('click');
    expect(wrapper.emitted('save')[0][0]).toMatchObject({ memoryPolicy: { isolation: 'actor', actorId: 'actor-1' }, embedding: { enabled: true, providerProfileId: 'embedding-profile' } });
  });

  it('sends revision-guarded review operations through the sole memory API', async () => {
    apiRequest.mockImplementation(async (path) => {
      if (path.endsWith('/memories/conflicts')) return { candidates: [] };
      if (path.endsWith('/memory-state')) return { coreReady: true, entities: [], events: [], watermarks: { core: 3, summary: 2, index: 1 } };
      if (path.endsWith('/memories')) return { memories: [{ id: 'fact-1', revision: 4, content: '阿青把钥匙交给小雪', enabled: false, lifecycle: 'candidate' }] };
      return { ok: true };
    });
    wrapper = mount(ConversationMemoryReview, { props: { conversationId: 'story-1' } });
    await flushPromises();
    await wrapper.findAll('button').find(button => button.text() === '全部记忆').trigger('click');
    expect(wrapper.text()).toContain('待审核');
    await wrapper.findAll('button').find((button) => button.text() === '确认').trigger('click');
    await flushPromises();
    expect(apiRequest).toHaveBeenCalledWith('/api/conversations/story-1/memories/fact-1/confirm', expect.objectContaining({ body: JSON.stringify({ revision: 4 }) }));
  });

  it('keeps derived failures independent and never signals a core refresh for derived completion', async () => {
    vi.useFakeTimers();
    const base = { coreReady: true, stateStatus: 'ready', job: { id: 'core-1', status: 'succeeded' }, stages: { core: { id: 'core-1', status: 'succeeded' }, index: { id: 'index-1', status: 'running' } } };
    apiRequest.mockResolvedValueOnce(base).mockResolvedValue({ ...base, stages: { ...base.stages, index: { id: 'index-1', status: 'failed' } } });
    wrapper = mount(ChatProcessingStatus, { props: { conversationId: 'story-1', showProgress: true } });
    await flushPromises();
    expect(wrapper.text()).toContain('可继续对话');
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    expect(wrapper.text()).toContain('重试索引');
    expect(wrapper.emitted('settled')).toBeUndefined();
  });

  it('preserves revision and role visibility when editing a manual memory', async () => {
    apiRequest.mockImplementation(async (path) => {
      if (path.endsWith('/memories/conflicts')) return { candidates: [] };
      if (path.endsWith('/memory-state')) return { revision: 8, entities: [{ id: 'actor-1', name: '小雪', kind: 'actor' }], events: [{ id: 'event-1', memoryId: 'fact-1', content: '灯塔仍在燃烧。', visibility: 'restricted', truthStatus: 'disputed', actorIds: ['actor-1'] }], knowledge: [{ id: 'knowledge-1', actorId: 'actor-1', eventId: 'event-1', epistemicState: 'false_belief', belief_content: '小雪相信灯塔已经熄灭。' }] };
      if (path.endsWith('/memories')) return { memories: [{ id: 'fact-1', revision: 4, memoryType: 'fact', content: '小雪相信灯塔已经熄灭。', confidence: 1, enabled: true }] };
      return { ok: true };
    });
    wrapper = mount(ConversationMemoryReview, { props: { conversationId: 'story-1' } });
    await flushPromises();
    await wrapper.findAll('button').find(button => button.text() === '全部记忆').trigger('click');
    await wrapper.findAll('button').find((button) => button.text() === '角色认知').trigger('click');
    expect(wrapper.get('.structured-list').text()).toContain('错误信念');
    expect(wrapper.get('.structured-list').text()).toContain('小雪相信灯塔已经熄灭。');
    expect(wrapper.get('.structured-list').text()).not.toContain('灯塔仍在燃烧。');
    await wrapper.findAll('button').find((button) => button.text() === '记忆审阅').trigger('click');
    await wrapper.get('[aria-label="编辑记忆"]').trigger('click');
    const dialog = wrapper.get('[role="dialog"][aria-label="记忆编辑"]');
    expect(dialog.get('select[multiple]').element.selectedOptions[0].value).toBe('actor-1');
    await dialog.trigger('submit');
    await flushPromises();
    const call = apiRequest.mock.calls.find(([path]) => path.endsWith('/memories/fact-1'));
    expect(JSON.parse(call[1].body)).toMatchObject({ revision: 4, visibility: 'restricted', truthStatus: 'disputed', actorIds: ['actor-1'] });
  });

  it.each(['available', 'unavailable'])('retains correction identity on retry and renews it after edits (randomUUID %s)', async availability => {
    if (availability === 'unavailable') vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    let submission = 0;
    apiRequest.mockImplementation(async (path) => {
      if (path.endsWith('/memories/conflicts')) return { candidates: [] };
      if (path.endsWith('/memory-state')) return { revision: 8, entities: [], events: [] };
      if (path.endsWith('/memories')) return { memories: [] };
      if (path.endsWith('/memory-state/packet') && ++submission <= 2) throw new Error('记忆版本冲突，请刷新');
      return { ok: true };
    });
    wrapper = mount(ConversationMemoryReview, { props: { conversationId: 'story-1' } });
    await flushPromises();
    await wrapper.findAll('button').find(button => button.text() === '全部记忆').trigger('click');
    await wrapper.findAll('button').find((button) => button.text() === '结构化修订').trigger('click');
    const dialog = wrapper.get('[role="dialog"][aria-label="结构化记忆修订"]');
    await dialog.get('textarea').setValue('{invalid');
    await dialog.trigger('submit');
    expect(dialog.get('[role="alert"]').text()).toContain('JSON 格式无效');
    const packetText = JSON.stringify({ version: 1, sources: [], events: [], claims: [], knowledge: [], threads: [], entities: [] });
    await dialog.get('textarea').setValue(packetText);
    await dialog.trigger('submit');
    await flushPromises();
    expect(dialog.get('textarea').element.value).toBe(packetText);
    expect(dialog.get('[role="alert"]').text()).toContain('记忆版本冲突');
    await dialog.trigger('submit');
    await flushPromises();
    const editedText = JSON.stringify({ ...JSON.parse(packetText), events: [{ localId: 'event-edited', content: '小雪拾起黄铜钥匙。' }] });
    await dialog.get('textarea').setValue(editedText);
    await dialog.trigger('submit');
    await flushPromises();
    const calls = apiRequest.mock.calls.filter(([path]) => path.endsWith('/memory-state/packet')).map(([, request]) => JSON.parse(request.body));
    expect(calls).toHaveLength(3);
    expect(calls[0].expectedRevision).toBe(8);
    expect(calls[0].packet.idempotencyKey).toBeTruthy();
    expect(calls[1].packet.idempotencyKey).toBe(calls[0].packet.idempotencyKey);
    expect(calls[2].packet.idempotencyKey).not.toBe(calls[0].packet.idempotencyKey);
    expect(calls[2].expectedRevision).toBe(8);
    expect(wrapper.find('[aria-label="结构化记忆修订"]').exists()).toBe(false);
  });

  it('shows the actual compiled memory evidence without starting a separate retrieval', async () => {
    apiRequest.mockImplementation(async (path) => path.endsWith('/context/preview') ? {
      contextBundle: { source: { coreOrder: 8 }, actorId: 'actor-1', memory: { entries: [] } },
      retrieval: { evidence: [{ id: 'memory-1', eventId: 'event-1', content: '小雪持有黄铜钥匙。', reasons: ['entity_graph', 'vector'], sourceHash: 'source-hash-1', epistemicState: 'experienced' }] }
    } : { nodes: [] });
    wrapper = mount(ChatContextInspector, { props: { open: true, conversationId: 'story-1' }, global: { stubs: { teleport: true } } });
    await flushPromises();
    expect(wrapper.text()).toContain('核心水位 8');
    expect(wrapper.text()).toContain('小雪持有黄铜钥匙。');
    expect(wrapper.text()).toContain('entity_graph、vector');
    expect(apiRequest).toHaveBeenCalledTimes(2);
    expect(wrapper.get('#chat-context-inspector-title').text()).toBe('Prompt Pipeline V2');
    await wrapper.get('#context-tab-memory').trigger('click');
    expect(wrapper.get('#chat-context-inspector-title').text()).toBe('记忆工作台');
    expect(wrapper.get('.chat-context-inspector-kicker').text()).toBe('角色档案与剧情记录');
    await wrapper.get('#context-tab-preview').trigger('click');
    expect(wrapper.get('#chat-context-inspector-title').text()).toBe('Prompt Pipeline V2');
  });

  it('does not share mutable defaults between policies or embeddings', () => {
    const first = normalizeMemoryPolicy();
    first.actorId = 'private-actor';
    expect(normalizeMemoryPolicy().actorId).toBe('');
    const binding = normalizeMemoryEmbedding({ enabled: true });
    expect(binding.providerProfileId).toBe('');
  });

  it('relays current-conversation recovery to chat while refreshing records and preview without a page reload', async () => {
    let processing = { conversationId: 'story-1', stateStatus: 'needs_rebuild', coreReady: false, job: null };
    const recovered = { id: 'recovered', revision: 1, memoryType: 'event', content: '恢复后已同步的剧情', enabled: true };
    apiRequest.mockImplementation(async path => {
      if (path.endsWith('/processing')) return processing;
      if (path.endsWith('/memories/conflicts')) return { candidates: [] };
      if (path.endsWith('/memories')) return { memories: processing.coreReady ? [recovered] : [] };
      if (path.endsWith('/memory-state/actors')) return { actors: [] };
      if (path.endsWith('/memory-state')) return { revision: 2, coreReady: processing.coreReady, entities: [], events: [], watermarks: {} };
      return { messages: [], nodes: [] };
    });
    wrapper = mount(ChatContextInspector, { props: { open: true, conversationId: 'story-1', initialView: 'memory' }, global: { stubs: { teleport: true } } });
    await flushPromises();
    const status = wrapper.findComponent(ChatProcessingStatus);
    processing = { ...processing, stateStatus: 'ready', coreReady: true };
    status.vm.$emit('settled', processing);
    await flushPromises();
    expect(wrapper.emitted('processing-settled')).toEqual([[processing]]);
    expect(wrapper.emitted('memory-updated')).toBeUndefined();
    expect(apiRequest.mock.calls.filter(([path]) => path.endsWith('/context/preview'))).toHaveLength(2);
    await wrapper.findComponent(ConversationMemoryReview).findAll('button').find(button => button.text() === '全部记忆').trigger('click');
    expect(wrapper.text()).toContain(recovered.content);
    const callCount = apiRequest.mock.calls.length;
    status.vm.$emit('settled', { ...processing, conversationId: 'old-story' });
    await flushPromises();
    expect(wrapper.emitted('processing-settled')).toHaveLength(1);
    expect(apiRequest).toHaveBeenCalledTimes(callCount);
  });
});
