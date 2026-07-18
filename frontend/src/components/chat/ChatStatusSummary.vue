<script setup>
import { computed } from 'vue';
import { Activity, ChevronDown, RefreshCw } from '@lucide/vue';

const props = defineProps({
  statusBar: { type: Object, default: null },
  templateConfig: { type: Object, default: () => ({}) },
  updateStatus: { type: String, default: 'not-updated' },
  expanded: { type: Boolean, default: false }
});

const emit = defineEmits(['update:expanded']);

const statusTitle = computed(() => props.statusBar?.name || '角色状态');
const summaryRows = computed(() => {
  const rows = [];
  const source = Array.isArray(props.statusBar?.variables) ? props.statusBar.variables : [];
  for (const item of source) {
    if (rows.length >= 3) break;
    const name = String(item?.name || '').trim();
    const value = normalizeSummaryValue(item?.value);
    if (name && value) rows.push({ name, value });
  }
  return rows;
});

const itemCount = computed(() => {
  const variableCount = Array.isArray(props.statusBar?.variables) ? props.statusBar.variables.length : 0;
  const characterCount = Array.isArray(props.templateConfig?.characters) ? props.templateConfig.characters.length : 0;
  return variableCount || characterCount;
});

const updateLabel = computed(() => {
  if (props.updateStatus === 'updating') return '正在同步';
  if (props.updateStatus === 'updated') return '本轮已同步';
  return '等待新回复';
});

function toggleExpanded() {
  emit('update:expanded', !props.expanded);
}

function normalizeSummaryValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return '';
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text || text.length > 48 || /[{}<>]/.test(text)) return '';
  return text;
}
</script>

<template>
  <section class="chat-status-disclosure" :class="{ 'is-expanded': expanded }">
    <button
      class="chat-status-summary"
      type="button"
      :aria-expanded="String(expanded)"
      aria-controls="chat-status-inline-details"
      :aria-label="expanded ? '收起完整角色状态' : '展开完整角色状态'"
      @click="toggleExpanded"
    >
      <span class="chat-status-summary-icon" aria-hidden="true">
        <Activity :size="18" />
      </span>
      <span class="chat-status-summary-copy">
        <span class="chat-status-summary-title">
          <strong>{{ statusTitle }}</strong>
          <small v-if="itemCount">{{ itemCount }} 项</small>
          <small :class="`is-${updateStatus}`">
            <RefreshCw v-if="updateStatus === 'updating'" :size="12" class="spinning" />
            {{ updateLabel }}
          </small>
        </span>
        <span v-if="summaryRows.length" class="chat-status-summary-values">
          <span v-for="row in summaryRows" :key="row.name">
            <em>{{ row.name }}</em>
            {{ row.value }}
          </span>
        </span>
        <span v-else class="chat-status-summary-empty">向下展开查看完整状态</span>
      </span>
      <ChevronDown class="chat-status-summary-chevron" :size="18" aria-hidden="true" />
    </button>

    <Transition name="chat-status-expand">
      <div v-if="expanded" id="chat-status-inline-details" class="chat-status-details" role="region" aria-label="完整角色状态">
        <slot name="details" />
      </div>
    </Transition>
  </section>
</template>
