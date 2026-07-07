<script setup>
import { Download, FileArchive, Stethoscope } from '@lucide/vue';

defineProps({
  busy: { type: Boolean, default: false },
  diagnosticsExporting: { type: Boolean, default: false },
  snapshotExporting: { type: Boolean, default: false }
});

const emit = defineEmits(['export-diagnostics', 'export-snapshot']);
</script>

<template>
  <section id="personal-section-data" class="form-panel settings-data-export-panel">
    <div class="inline-heading">
      <div>
        <h2>数据导出</h2>
      </div>
      <Download :size="20" />
    </div>

    <div class="settings-data-export-actions">
      <button
        class="ghost-button"
        type="button"
        :disabled="busy"
        :aria-busy="snapshotExporting"
        @click="emit('export-snapshot')"
      >
        <FileArchive :size="17" />
        <span>{{ snapshotExporting ? '导出中...' : '项目快照' }}</span>
      </button>
      <button
        class="ghost-button"
        type="button"
        :disabled="busy"
        :aria-busy="diagnosticsExporting"
        @click="emit('export-diagnostics')"
      >
        <Stethoscope :size="17" />
        <span>{{ diagnosticsExporting ? '导出中...' : '诊断包' }}</span>
      </button>
    </div>
  </section>
</template>
