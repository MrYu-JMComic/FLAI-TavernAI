import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import ConversationActorDossier from '../chat/ConversationActorDossier.vue';
import MemoryAgentSettingsDialog from '../chat/MemoryAgentSettingsDialog.vue';
import ChatProcessingStatus from '../chat/ChatProcessingStatus.vue';
import { fetchConversationActorDossier } from '../../api/memories.js';
import { useChatAccessory } from '../../composables/chat/useChatAccessory.js';

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock('../../api/core.js', () => ({ apiRequest, streamSSE: vi.fn() }));
vi.mock('../../api/providers.js', () => ({ listProviderProfiles: vi.fn(async () => ({ providers: [] })), fetchProviderModels: vi.fn(async () => ({ models: [] })) }));
let wrapper;
afterEach(() => { wrapper?.unmount(); wrapper = null; apiRequest.mockReset(); vi.clearAllTimers(); vi.useRealTimers(); });
const actors = [
  { id: 'card-actor', name: '阿青', origin: 'card', counts: { memories: 1 } },
  { id: 'story-actor', name: '小雪', aliases: ['雪儿'], origin: 'story', counts: { memories: 1, events: 1, relations: 1, items: 1 } }
];
const detail = actor => ({ actor, memories: [{ id: 'm', content: `${actor.name}保留的承诺`, truthStatus: 'established' }], events: [{ id: 'e', content: `${actor.name}在港口接过钥匙`, evidenceRefs: [{ messageId: 'msg', quote: '把钥匙交给你' }] }], relations: [{ id: 'r', subjectName: actor.name, predicate: '信任', objectName: '灯塔守卫', truthStatus: 'unverified' }], items: [{ id: 'i', name: '黄铜钥匙', quantity: null, status: 'established', authoritative: false }] });
const button = text => wrapper.findAll('button').find(item => item.text().startsWith(text));

describe('character memory workspace', () => {
  it('shows story actors and four author dossier categories without changing knowledge scope', async () => {
    apiRequest.mockImplementation(async path => path.endsWith('/actors') ? { actors } : detail(actors.find(actor => path.endsWith(actor.id))));
    wrapper = mount(ConversationActorDossier, { props: { conversationId: 'story' } });
    await flushPromises();
    await wrapper.findAll('.actor-list button')[1].trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('小雪保留的承诺');
    expect(wrapper.text()).toContain('在剧情中相识 · 雪儿');
    await button('事件').trigger('click');
    expect(wrapper.text()).toContain('小雪在港口接过钥匙');
    await button('关系').trigger('click');
    expect(wrapper.text()).toContain('信任 灯塔守卫');
    await button('物品').trigger('click');
    expect(wrapper.text()).toContain('黄铜钥匙');
    expect(wrapper.text()).toContain('数量未明确');
    expect(apiRequest.mock.calls.some(([path]) => path.includes('actorId=') || path.includes('viewerActorId='))).toBe(false);
  });

  it('searches names and aliases through the list API and shows empty results', async () => {
    vi.useFakeTimers();
    apiRequest.mockImplementation(async path => path.endsWith('/actors') ? { actors } : path.includes('?query=') ? { actors: [] } : detail(actors[0]));
    wrapper = mount(ConversationActorDossier, { props: { conversationId: 'story' } });
    await flushPromises();
    await wrapper.get('input[type="search"]').setValue('未登场');
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(apiRequest).toHaveBeenCalledWith('/api/conversations/story/memory-state/actors?query=%E6%9C%AA%E7%99%BB%E5%9C%BA');
    expect(wrapper.text()).toContain('没有匹配的角色');
    expect(wrapper.find('.dossier-records').exists()).toBe(false);
  });

  it('rejects late details after switching conversations and retains a retryable detail error', async () => {
    let resolveOld;
    let detailAttempts = 0;
    apiRequest.mockImplementation(async path => {
      if (path.endsWith('/actors')) return { actors: [actors[1]] };
      if (path.includes('/old/')) return new Promise(resolve => { resolveOld = resolve; });
      if (++detailAttempts === 1) throw new Error('档案加载暂时失败');
      return detail(actors[1]);
    });
    wrapper = mount(ConversationActorDossier, { props: { conversationId: 'old' } });
    await flushPromises();
    await wrapper.setProps({ conversationId: 'new' });
    await flushPromises();
    resolveOld(detail({ ...actors[0], name: '过期角色' }));
    await flushPromises();
    expect(wrapper.text()).not.toContain('过期角色');
    expect(wrapper.get('[role="alert"]').text()).toContain('档案加载暂时失败');
    await wrapper.get('[role="alert"] button').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('小雪保留的承诺');
  });

  it('uses independent, encoded target and strict viewer API parameters', async () => {
    apiRequest.mockResolvedValue({});
    await fetchConversationActorDossier('story/one', 'target/two', { viewerActorId: 'viewer three' });
    expect(apiRequest).toHaveBeenCalledWith('/api/conversations/story%2Fone/memory-state/actors/target%2Ftwo?viewerActorId=viewer+three');
  });

  it('appends paginated records and requires refresh if the canonical revision changed', async () => {
    let changed = false;
    apiRequest.mockImplementation(async path => {
      if (path.endsWith('/actors')) return { actors: [actors[1]] };
      if (path.includes('offset=200')) return { ...detail(actors[1]), revision: changed ? 9 : 8, memories: [{ id: 'm2', content: '更早的故事' }], pagination: { offset: 200, limit: 200, hasMore: true } };
      if (path.includes('offset=400')) return { ...detail(actors[1]), revision: 9, pagination: { offset: 400, limit: 200, hasMore: false } };
      return { ...detail(actors[1]), revision: 8, pagination: { offset: 0, limit: 200, hasMore: true } };
    });
    wrapper = mount(ConversationActorDossier, { props: { conversationId: 'story' } });
    await flushPromises();
    await button('加载更多记录').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('小雪保留的承诺');
    expect(wrapper.text()).toContain('更早的故事');
    changed = true;
    await button('加载更多记录').trigger('click'); await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('角色档案已更新');
    expect(wrapper.text()).toContain('更早的故事');
  });

  it('saves and reloads the four workflow settings through the shared policy', async () => {
    wrapper = mount(MemoryAgentSettingsDialog, { props: { open: true, canRestoreInheritance: true }, global: { stubs: { teleport: true } } });
    await flushPromises();
    const select = wrapper.findAll('select').find(item => item.find('option[value="background"]').exists());
    expect(select.element.value).toBe('background');
    await select.setValue('blocking');
    const turns = wrapper.findAll('input[type="number"]').find(item => item.attributes('max') === '32');
    await turns.setValue('16');
    const consolidate = wrapper.findAll('label').find(item => item.text().startsWith('AI 整理时自动合并压缩')).get('input');
    const link = wrapper.findAll('label').find(item => item.text().startsWith('记忆与状态栏联动')).get('input');
    let thinking = wrapper.findAll('label').find(item => item.text().startsWith('思考等级')).get('select');
    expect(thinking.findAll('option').map(option => option.element.value)).toEqual(['', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(thinking.element.value).toBe('');
    await thinking.setValue('off');
    await consolidate.setValue(false); await link.setValue(true);
    await wrapper.get('footer .primary').trigger('click');
    const saved = wrapper.emitted('save')[0][0];
    expect(saved.memoryPolicy).toMatchObject({ syncMode: 'blocking', shortTermTurns: 16, autoConsolidate: false, statusLink: true });
    expect(saved.tools.merge_memories).toBe(false);
    expect(saved.thinkingLevel).toBe('off');
    expect(wrapper.findAll('.memory-agent-tools label').some(label => label.text().includes('合并重复记忆'))).toBe(false);
    await wrapper.setProps({ open: false, skill: saved }); await wrapper.setProps({ open: true });
    thinking = wrapper.findAll('label').find(item => item.text().startsWith('思考等级')).get('select');
    expect(select.element.value).toBe('blocking');
    expect(link.element.checked).toBe(true);
    expect(thinking.element.value).toBe('off');
    await thinking.setValue('');
    await wrapper.get('footer .primary').trigger('click');
    expect(wrapper.emitted('save').at(-1)[0].thinkingLevel).toBe('');
    await button('恢复角色默认').trigger('click');
    expect(wrapper.emitted('restore-inheritance')).toHaveLength(1);
  });

  it('retains inherited memory thinking and saves a thinking-only override without copying policy defaults', async () => {
    const accessory = useChatAccessory({ conversation: ref({ id: 'story' }), setActiveConversationIfChanged: vi.fn(), showActionNotice: vi.fn(), showError: vi.fn() });
    expect(accessory.accessorySkills.memoryAgent.thinkingLevel).toBe('');
    accessory.syncAccessorySkills({ memoryAgent: { thinkingLevel: 'high' } });
    expect(accessory.accessorySkills.memoryAgent.thinkingLevel).toBe('high');
    accessory.updateAccessorySkill('memoryAgent', { thinkingLevel: 'off' });
    apiRequest.mockImplementation(async path => path.endsWith('/accessory-skills') ? { skills: { memoryAgent: { thinkingLevel: 'off' } } } : { accounts: [] });
    try {
      expect(await accessory.saveAccessorySkillChanges()).toBe(true);
      const saved = apiRequest.mock.calls.find(([path]) => path.endsWith('/accessory-skills'));
      expect(JSON.parse(saved[1].body)).toEqual({ accessorySkills: { memoryAgent: { thinkingLevel: 'off' } }, restoreInheritance: [] });
      expect(accessory.accessorySkills.memoryAgent.thinkingLevel).toBe('off');
    } finally { accessory.cleanupAccessory(); }
  });

  it('keeps normal core and derived work silent while polling and emitting core completion', async () => {
    vi.useFakeTimers();
    const state = { conversationId: 'story', stateStatus: 'pending', coreReady: false, stages: { core: [{ id: 'core', status: 'running', progress: 40 }], index: [{ id: 'index', status: 'running' }], summary: [] } };
    apiRequest.mockResolvedValueOnce(state).mockResolvedValue({ ...state, stateStatus: 'ready', coreReady: true, stages: { ...state.stages, core: [{ id: 'core', status: 'succeeded' }] } });
    wrapper = mount(ChatProcessingStatus, { props: { conversationId: 'story' } });
    await flushPromises();
    expect(wrapper.find('section').exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(1000); await flushPromises();
    expect(wrapper.find('section').exists()).toBe(false);
    expect(wrapper.emitted('settled')).toHaveLength(1);
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it('shows a brief failure entry and opens detailed recovery without repeating its full error in chat', async () => {
    apiRequest.mockResolvedValue({ coreReady: false, stateStatus: 'needs_review', stages: { core: [{ id: 'failed', status: 'failed', error: { message: '具体供应商失败详情' } }] } });
    wrapper = mount(ChatProcessingStatus, { props: { conversationId: 'story' } });
    await flushPromises();
    expect(wrapper.text()).toContain('部分剧情记忆待恢复');
    expect(wrapper.text()).not.toContain('具体供应商失败详情');
    await button('查看记忆').trigger('click');
    expect(wrapper.emitted('open-memory')).toHaveLength(1);
  });
});
