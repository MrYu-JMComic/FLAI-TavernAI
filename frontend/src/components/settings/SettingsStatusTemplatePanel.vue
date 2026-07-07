<script setup>
import { Download, Save, Upload } from '@lucide/vue';

defineProps({
  actionBusyId: { type: String, default: '' },
  controlsBusy: { type: Boolean, default: false }
});

const emit = defineEmits(['export', 'import-file']);
</script>

<template>
  <section id="extension-section-status-templates" class="form-panel status-template-envelope-panel form-section-group">
    <div class="inline-heading">
      <div>
        <h2>状态栏模板</h2>
        <p>导出或导入状态栏模板库与会话状态栏模板快照，使用统一 envelope 格式。</p>
      </div>
      <Save :size="20" />
    </div>

    <div class="settings-data-export-actions">
      <button
        class="ghost-button"
        type="button"
        :disabled="controlsBusy"
        :aria-busy="actionBusyId === 'status-template-export'"
        @click="emit('export')"
      >
        <Download :size="17" />
        <span>{{ actionBusyId === 'status-template-export' ? '导出中...' : '导出' }}</span>
      </button>
      <label
        class="ghost-button file-import-button"
        :class="{ disabled: controlsBusy }"
        :aria-busy="actionBusyId === 'status-template-import'"
      >
        <Upload :size="17" />
        <span>{{ actionBusyId === 'status-template-import' ? '导入中...' : '导入' }}</span>
        <input type="file" accept=".json" :disabled="controlsBusy" @change="emit('import-file', $event)" />
      </label>
    </div>
  </section>
</template>
