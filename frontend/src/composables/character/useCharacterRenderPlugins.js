import { computed } from 'vue';
import { defaultRenderPlugin } from './useCharacterFormPayload';

export function useCharacterRenderPlugins({ canEdit, form }) {
  const enabledRenderPlugins = computed(() => collectEnabledRenderPlugins(form.renderPlugins));
  const renderPluginPreviewText = computed(() => buildRenderPluginPreviewText(
    form.background,
    form.worldview,
    form.persona,
    form.openingMessage
  ));

  function addRenderPlugin(preset = false) {
    if (!canEdit.value) {
      return;
    }

    const plugin = defaultRenderPlugin();
    form.renderPlugins.push({
      ...plugin,
      label: preset ? '档案标题折叠' : `渲染插件 ${form.renderPlugins.length + 1}`,
      pattern: preset ? plugin.pattern : ''
    });
  }

  function removeRenderPlugin(index) {
    if (!canEdit.value) {
      return;
    }

    form.renderPlugins.splice(index, 1);
  }

  return {
    addRenderPlugin,
    enabledRenderPlugins,
    removeRenderPlugin,
    renderPluginPreviewText
  };
}

export function collectEnabledRenderPlugins(plugins = []) {
  const currentPlugins = Array.isArray(plugins) ? plugins : [];
  const enabledPlugins = [];
  for (const plugin of currentPlugins) {
    if (plugin?.enabled !== false && plugin?.pattern) {
      enabledPlugins.push(plugin);
    }
  }
  return enabledPlugins;
}

export function buildRenderPluginPreviewText() {
  let previewText = '';
  for (let index = 0; index < arguments.length; index += 1) {
    const value = String(arguments[index] || '').trim();
    if (!value) {
      continue;
    }
    previewText = previewText ? `${previewText}\n\n${value}` : value;
  }
  return previewText;
}
