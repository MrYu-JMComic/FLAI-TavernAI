import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import CharacterStatusBarPanel from '../character/CharacterStatusBarPanel.vue';
import { parseStatusBarRuntime, serializeStatusBarRuntime } from '../../../../shared/statusBarRuntime.js';

let wrapper;
afterEach(() => { wrapper?.unmount(); });

function mountEditor(canEdit = true) {
  const runtime = {
    framework: 'vue',
    html: '<section>{{ values.HP }}</section>',
    css: 'section { color: white; }',
    javascript: 'return {};'
  };
  const advancedSettings = reactive({
    statusBarPrompt: '受伤时降低 HP。',
    statusBarBlueprint: {
      name: '旅程状态',
      variables: [{ name: 'HP', type: 'meter', value: 80, max: 100 }],
      template: serializeStatusBarRuntime(runtime)
    }
  });
  wrapper = mount(CharacterStatusBarPanel, {
    props: {
      advancedSettings,
      canEdit,
      statusBarBlueprintTemplateStats: { variables: 1, meter: 1, text: 0, hasTemplate: true, lines: 3 },
      statusBlueprintEditorRows: []
    },
    attachTo: document.body
  });
  return { advancedSettings, runtime: parseStatusBarRuntime(advancedSettings.statusBarBlueprint.template) };
}

describe('independent character status bar sections', () => {
  it('edits the prompt and a code section independently and retains drafts across sections', async () => {
    const { advancedSettings, runtime } = mountEditor();
    const originalTemplate = advancedSettings.statusBarBlueprint.template;
    const originalVariables = JSON.stringify(advancedSettings.statusBarBlueprint.variables);
    const prompt = wrapper.get('[aria-label="状态栏提示词"]');
    expect(wrapper.get('#status-editor-section-prompt').isVisible()).toBe(true);
    expect(wrapper.get('#status-editor-section-custom').isVisible()).toBe(false);

    await prompt.setValue('受伤时降低 HP，每次最多减少 10。');
    expect(advancedSettings.statusBarBlueprint.template).toBe(originalTemplate);
    expect(JSON.stringify(advancedSettings.statusBarBlueprint.variables)).toBe(originalVariables);

    await wrapper.get('#status-editor-tab-custom').trigger('click');
    const codeEditor = wrapper.get('[aria-label="状态栏 CSS 代码"]');
    await codeEditor.setValue('section { color: gold; }');
    expect(parseStatusBarRuntime(advancedSettings.statusBarBlueprint.template)).toEqual({ ...runtime, css: 'section { color: gold; }' });
    expect(advancedSettings.statusBarPrompt).toBe('受伤时降低 HP，每次最多减少 10。');
    expect(JSON.stringify(advancedSettings.statusBarBlueprint.variables)).toBe(originalVariables);

    await wrapper.get('[aria-label="状态栏模板模式"]').setValue('custom');
    await wrapper.get('[aria-label="完全自定义状态栏模板"]').setValue('<b>{{HP}}</b>');
    await wrapper.get('#status-editor-tab-prompt').trigger('click');
    expect(wrapper.get('[aria-label="状态栏提示词"]').element).toBe(prompt.element);
    await wrapper.get('#status-editor-tab-custom').trigger('click');
    expect(wrapper.get('[aria-label="完全自定义状态栏模板"]').element.value).toBe('<b>{{HP}}</b>');
    await wrapper.get('[aria-label="状态栏模板模式"]').setValue('runtime');
    expect(parseStatusBarRuntime(advancedSettings.statusBarBlueprint.template)).toEqual({ ...runtime, css: 'section { color: gold; }' });
  });

  it('supports keyboard section navigation while keeping read-only controls disabled', async () => {
    const { advancedSettings } = mountEditor(false);
    const original = JSON.stringify(advancedSettings);
    const promptTab = wrapper.get('#status-editor-tab-prompt');
    promptTab.element.focus();
    await promptTab.trigger('keydown', { key: 'ArrowRight' });
    const customTab = wrapper.get('#status-editor-tab-custom');
    expect(customTab.attributes('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(customTab.element);
    expect(wrapper.get('[aria-label="状态栏 CSS 代码"]').element.disabled).toBe(true);
    expect(wrapper.get('[aria-label="状态栏模板模式"]').element.disabled).toBe(true);
    await customTab.trigger('keydown', { key: 'Home' });
    expect(promptTab.attributes('aria-selected')).toBe('true');
    expect(wrapper.get('[aria-label="状态栏提示词"]').element.disabled).toBe(true);
    expect(JSON.stringify(advancedSettings)).toBe(original);
  });
});
