import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { reactive } from 'vue';
import StatusBarCodeEditor from '../StatusBarCodeEditor.vue';
import CharacterStatusBlueprintEditor from '../character/CharacterStatusBlueprintEditor.vue';
import StatusBarAgentSettingsDialog from '../chat/StatusBarAgentSettingsDialog.vue';
import { normalizeStatusBarBlueprintForPayload } from '../../composables/character/useCharacterStatusBlueprint.js';
import { hasNonDefaultAccessorySkills, normalizeAccessorySkillsForPayload } from '../../composables/character/useCharacterFormPayload.js';
import { createStatusBarRuntimeExample, parseStatusBarRuntime, serializeStatusBarRuntime } from '../../../../shared/statusBarRuntime.js';
import { STATUS_BAR_AGENT_TOOLS } from '../../../../shared/statusBarAgentTools.js';

vi.mock('../../api/providers.js', () => ({
  listProviderProfiles: vi.fn(async () => ({ providers: [{ id: 'profile-2', gatewayName: '独立供应商', model: 'default-agent' }] })),
  fetchProviderModels: vi.fn(async () => ({ models: [{ id: 'agent-model', label: 'Agent 模型' }] }))
}));

let wrapper;
afterEach(() => { wrapper?.unmount(); });

describe('status bar code and agent editing', () => {
  it('edits one code section while preserving the other sections and framework', async () => {
    const original = createStatusBarRuntimeExample('vue');
    wrapper = mount(StatusBarCodeEditor, { props: { modelValue: serializeStatusBarRuntime(original) }, global: { stubs: { StatusBar: true } } });
    await wrapper.get('[aria-label="状态栏 CSS 代码"]').setValue('body { color: gold; }');
    const next = parseStatusBarRuntime(wrapper.emitted('update:modelValue').at(-1)[0]);
    expect(next).toEqual({ ...original, css: 'body { color: gold; }' });
    await wrapper.setProps({ modelValue: serializeStatusBarRuntime(next) });
    await wrapper.get('select').setValue('html');
    expect(parseStatusBarRuntime(wrapper.emitted('update:modelValue').at(-1)[0])).toEqual({ ...next, framework: 'html' });
  });

  it('keeps role blueprint code when moving between display modes', async () => {
    const template = serializeStatusBarRuntime(createStatusBarRuntimeExample());
    const blueprint = reactive({ name: '面板', variables: [{ name: 'HP', value: 80, max: 100 }], template });
    wrapper = mount(CharacterStatusBlueprintEditor, { props: { blueprint, stats: { variables: 1 }, rows: [] }, global: { stubs: { StatusBarCodeEditor: true } } });
    await wrapper.get('select').setValue('custom');
    await wrapper.get('textarea').setValue('<p>{{HP}}</p>');
    await wrapper.get('select').setValue('builtin');
    expect(blueprint.template).toBe('');
    await wrapper.get('select').setValue('runtime');
    expect(blueprint.template).toBe(template);
    await wrapper.get('select').setValue('custom');
    expect(blueprint.template).toBe('<p>{{HP}}</p>');
  });

  it('keeps Vue bindings out of blueprint variable inference and preserves agent settings', () => {
    const template = serializeStatusBarRuntime({ framework: 'vue', html: '<b>{{ values.HP }}</b><i>{{ localCount }}</i>', javascript: 'return { localCount: Vue.ref(1) };' });
    const blueprint = normalizeStatusBarBlueprintForPayload({ template, variables: [{ name: 'HP', value: 80, max: 100 }] });
    expect(blueprint.variables).toEqual([{ name: 'HP', value: 80, max: 100, color: '#6c757d' }]);
    expect(blueprint.template).toBe(template);
    const skills = normalizeAccessorySkillsForPayload({ statusBarAgent: { provider_profile_id: 'profile-2', model_override: 'agent-model', thinking_level: 'max', tools: { update_status_bar_code: false } } });
    expect(skills.statusBarAgent).toMatchObject({ providerProfileId: 'profile-2', modelOverride: 'agent-model', thinkingLevel: 'max', tools: { update_status_bar_code: false } });
    expect(hasNonDefaultAccessorySkills({ statusBarAgent: { enabled: 'auto', thinkingLevel: 'off' } })).toBe(true);
  });

  it('saves independent provider, model, explicit thinking off and per-tool permissions', async () => {
    wrapper = mount(StatusBarAgentSettingsDialog, {
      props: { open: true, skill: { enabled: 'auto', providerProfileId: 'profile-2', modelOverride: 'agent-model', thinkingLevel: 'max', tools: { update_status_bar_code: false } } },
      global: { stubs: { teleport: true } }
    });
    await flushPromises();
    const selects = wrapper.findAll('select');
    await selects.at(-1).setValue('off');
    const tools = wrapper.findAll('.memory-agent-tools input');
    expect(tools).toHaveLength(STATUS_BAR_AGENT_TOOLS.length);
    expect(tools[STATUS_BAR_AGENT_TOOLS.findIndex((tool) => tool.name === 'update_status_bar_code')].element.checked).toBe(false);
    await tools[0].setValue(false);
    await wrapper.get('footer .primary').trigger('click');
    const payload = wrapper.emitted('save')[0][0];
    expect(payload).toMatchObject({ enabled: 'auto', providerProfileId: 'profile-2', modelOverride: 'agent-model', thinkingLevel: 'off' });
    expect(payload.tools.read_status_bar).toBe(false);
    expect(payload.tools.update_status_bar_code).toBe(false);
    expect(payload.tools.upsert_status_bar_variable).toBe(true);
  });
});
