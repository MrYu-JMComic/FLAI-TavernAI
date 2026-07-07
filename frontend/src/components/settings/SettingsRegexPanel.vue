<script setup>
import { Download, GripVertical, Power, RefreshCw, Regex, Upload } from '@lucide/vue';

const props = defineProps({
  actionBusyId: { type: String, default: '' },
  controlsBusy: { type: Boolean, default: false },
  groupFilter: { type: String, default: '' },
  groups: { type: Array, default: () => [] },
  loadError: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  regexRules: { type: Array, default: () => [] }
});

const emit = defineEmits([
  'drag-over',
  'drag-start',
  'drop',
  'export',
  'group-filter-change',
  'import-file',
  'load',
  'toggle',
  'update-group-filter'
]);

function readInputValue(event) {
  const target = event?.target;
  return target && target.value !== undefined ? target.value : '';
}

function regexToggleActionId(id) {
  return `regex-toggle:${id}`;
}

function isRegexToggleBusy(id) {
  return props.actionBusyId === regexToggleActionId(id);
}

function regexScopeLabel(scope) {
  if (scope === 'input') return '输入';
  if (scope === 'output') return '输出';
  return '双向';
}
</script>

<template>
  <section id="extension-section-regex" class="form-panel regex-rules-panel form-section-group">
    <div class="inline-heading">
      <div>
        <h2>正则规则管理</h2>
        <p>管理所有角色的正则替换规则，支持分组、排序和启用/禁用。</p>
      </div>
      <Regex :size="20" />
    </div>
    <div class="regex-actions-row">
      <select
        :value="groupFilter"
        aria-label="正则规则分组筛选"
        :disabled="controlsBusy"
        @change="emit('update-group-filter', readInputValue($event)); emit('group-filter-change')"
      >
        <option value="">全部分组</option>
        <option v-for="group in groups" :key="group" :value="group">{{ group }}</option>
      </select>
      <button class="ghost-button" type="button" :disabled="controlsBusy || !regexRules.length" @click="emit('export')">
        <Download :size="17" />
        <span>导出</span>
      </button>
      <label class="ghost-button file-import-button" :class="{ disabled: controlsBusy }" :aria-busy="actionBusyId === 'regex-import'">
        <Upload :size="17" />
        <span>导入</span>
        <input type="file" accept=".json" :disabled="controlsBusy" @change="emit('import-file', $event)" />
      </label>
    </div>
    <p v-if="loading" class="muted-text" aria-live="polite">正在加载正则规则...</p>
    <div v-if="loadError" class="section-load-status error-state" role="alert">
      <span>{{ loadError }}</span>
      <button class="ghost-button compact-button" type="button" :disabled="controlsBusy" @click="emit('load')">
        <RefreshCw :size="17" />
        <span>{{ loading ? '重试中...' : '重试' }}</span>
      </button>
    </div>
    <div v-if="regexRules.length" class="regex-rule-list">
      <div
        v-for="rule in regexRules"
        :key="rule.id"
        class="regex-rule-card"
        :class="{ disabled: !rule.enabled }"
        :draggable="!controlsBusy"
        :aria-busy="isRegexToggleBusy(rule.id) || actionBusyId === 'regex-reorder'"
        @dragstart="emit('drag-start', $event, rule.id)"
        @dragover="emit('drag-over', $event, rule.id)"
        @drop="emit('drop', rule.id)"
      >
        <div class="regex-rule-grip">
          <GripVertical :size="16" />
        </div>
        <div class="regex-rule-info">
          <strong>{{ rule.label }}</strong>
          <small class="regex-rule-pattern">{{ rule.pattern }}</small>
          <small v-if="rule.replacement" class="regex-rule-replacement">→ {{ rule.replacement }}</small>
          <div class="regex-rule-meta">
            <span class="regex-group-badge">{{ rule.groupName || '全局' }}</span>
            <span class="regex-scope-badge">{{ regexScopeLabel(rule.scope) }}</span>
            <span class="regex-priority-badge">优先级 {{ rule.priority }}</span>
          </div>
        </div>
        <button
          class="icon-button"
          :class="{ active: rule.enabled }"
          type="button"
          :title="rule.enabled ? '点击禁用' : '点击启用'"
          :aria-label="rule.enabled ? `禁用正则规则：${rule.label}` : `启用正则规则：${rule.label}`"
          :disabled="controlsBusy"
          :aria-busy="isRegexToggleBusy(rule.id)"
          @click="emit('toggle', rule.id)"
        >
          <Power :size="16" />
        </button>
      </div>
    </div>
    <p v-else-if="!loading && !loadError" class="muted-text">还没有正则规则。在角色编辑页创建规则后会在这里显示。</p>
  </section>
</template>
