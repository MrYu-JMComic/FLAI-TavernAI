<script setup>
import { X } from '@lucide/vue';
import StatusBar from '../StatusBar.vue';

defineProps({
  statusBar: { type: Object, default: null },
  templateConfig: { type: Object, required: true }
});

const emit = defineEmits(['close']);
</script>

<template>
  <div class="status-preview-overlay" @click.self="emit('close')">
    <section
      class="status-preview-dialog form-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="status-preview-title"
      tabindex="-1"
      @keydown.esc.prevent="emit('close')"
    >
      <div class="status-preview-header">
        <div>
          <h2 id="status-preview-title">实际效果预览</h2>
          <p>保存后，新会话会按此状态栏效果显示。</p>
        </div>
        <button
          class="icon-button status-preview-close"
          type="button"
          aria-label="关闭效果预览"
          @click="emit('close')"
        >
          <X :size="18" />
        </button>
      </div>
      <div class="status-preview-body">
        <StatusBar
          v-if="statusBar"
          :status-bar="statusBar"
          :template-config="templateConfig"
        />
        <p v-else class="muted-text status-blueprint-empty">添加变量或模板后显示预览。</p>
      </div>
    </section>
  </div>
</template>
