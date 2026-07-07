<script setup>
import { Plus, Trash2 } from '@lucide/vue';
import MarkdownContent from '../MarkdownContent.vue';

defineProps({
  canEdit: { type: Boolean, default: false },
  enabledRenderPlugins: { type: Array, default: () => [] },
  previewText: { type: String, default: '' },
  renderPlugins: { type: Array, required: true }
});

const emit = defineEmits(['add-plugin', 'remove-plugin']);
</script>

<template>
  <section id="section-render-plugins" class="form-panel render-plugin-panel">
    <div class="inline-heading">
      <div>
        <h2>消息渲染插件</h2>
        <p>用正则把角色回复中的指定标题行渲染成默认收起的折叠消息。</p>
      </div>
      <button class="ghost-button" type="button" :disabled="!canEdit" @click="emit('add-plugin')">
        <Plus :size="17" />
        <span>插件</span>
      </button>
    </div>

    <div v-for="(plugin, index) in renderPlugins" :key="index" class="render-plugin-row">
      <label class="checkbox-line plugin-enabled">
        <input v-model="plugin.enabled" type="checkbox" :disabled="!canEdit" />
        <span>启用</span>
      </label>
      <input
        v-model="plugin.label"
        class="plugin-label"
        placeholder="插件名称"
        :disabled="!canEdit"
        :aria-label="`消息渲染插件 ${index + 1} 名称`"
      />
      <input
        v-model="plugin.pattern"
        class="plugin-pattern"
        placeholder="标题行正则，例如 ^【(.+档案.*)】$"
        :disabled="!canEdit"
        :aria-label="`消息渲染插件 ${index + 1} 标题行正则`"
      />
      <input
        v-model="plugin.titleTemplate"
        class="plugin-template"
        placeholder="标题模板，例如 $1"
        :disabled="!canEdit"
        :aria-label="`消息渲染插件 ${index + 1} 标题模板`"
      />
      <input
        v-model="plugin.flags"
        class="flags-input plugin-flags"
        placeholder="u"
        :disabled="!canEdit"
        :aria-label="`消息渲染插件 ${index + 1} 正则标志`"
      />
      <button
        v-if="canEdit"
        class="icon-button danger plugin-delete"
        type="button"
        title="删除插件"
        :aria-label="`删除消息渲染插件 ${index + 1}`"
        @click="emit('remove-plugin', index)"
      >
        <Trash2 :size="17" />
      </button>
    </div>

    <button v-if="canEdit && !renderPlugins.length" class="ghost-button add-plugin-empty" type="button" @click="emit('add-plugin')">
      <Plus :size="17" />
      <span>添加折叠插件</span>
    </button>

    <div class="render-plugin-preview">
      <label class="field">
        <span>角色内容预览</span>
        <textarea
          :value="previewText || '当前角色还没有可预览的背景、世界观、人设或开场白。'"
          rows="6"
          readonly
          aria-label="角色内容渲染预览文本"
        />
      </label>
      <div class="render-preview-card">
        <MarkdownContent
          v-if="previewText"
          :text="previewText"
          :render-plugins="enabledRenderPlugins"
        />
        <p v-else class="muted-text render-preview-empty">填写角色设定后，这里会直接预览真实角色内容的渲染效果。</p>
      </div>
    </div>
  </section>
</template>
