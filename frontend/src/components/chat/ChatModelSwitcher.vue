<script setup>
import { computed, ref, watch } from 'vue';
import { Check, RefreshCw, Search, X } from '@lucide/vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  provider: { type: Object, default: null },
  models: { type: Array, default: () => [] },
  refreshing: { type: Boolean, default: false },
  saving: { type: Boolean, default: false }
});

const emit = defineEmits(['close', 'refresh', 'save']);

const search = ref('');
const draftModel = ref('');

const currentModel = computed(() => String(props.provider?.model || '').trim());
const providerContextKey = computed(() => {
  const provider = props.provider || {};
  return [
    provider.providerType || '',
    provider.gatewayName || '',
    provider.baseUrl || '',
    Boolean(provider.supportsReasoning),
    provider.extraBody ?? '{}'
  ].join('\n');
});
const gatewayLabel = computed(() => {
  return String(props.provider?.gatewayName || props.provider?.providerType || '当前网关').trim();
});
const modelSelectionLocked = computed(() => props.saving);
const canRefresh = computed(() => Boolean(props.provider?.baseUrl) && !props.refreshing && !modelSelectionLocked.value);
const modelOptions = computed(() => {
  const byId = new Map();
  const current = currentModel.value;
  if (current) {
    byId.set(current, {
      id: current,
      label: current,
      ownedBy: '',
      current: true
    });
  }
  for (const item of Array.isArray(props.models) ? props.models : []) {
    const id = String(item?.id || item?.name || item?.model || item || '').trim();
    if (!id) continue;
    byId.set(id, {
      id,
      label: String(item?.label || item?.displayName || item?.name || id).trim() || id,
      ownedBy: String(item?.ownedBy || item?.owned_by || item?.publisher || '').trim(),
      current: id === current
    });
  }
  return [...byId.values()];
});
const filteredModels = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  if (!keyword) return modelOptions.value;
  return modelOptions.value.filter((model) => {
    return `${model.id} ${model.label} ${model.ownedBy}`.toLowerCase().includes(keyword);
  });
});
const canSave = computed(() => {
  return Boolean(draftModel.value) &&
    draftModel.value !== currentModel.value &&
    !props.saving;
});

watch(
  () => [props.open, providerContextKey.value],
  ([open]) => {
    if (!open) return;
    search.value = '';
    draftModel.value = currentModel.value;
  },
  { immediate: true }
);

watch(currentModel, (value, previousValue) => {
  if (props.open && (!draftModel.value || draftModel.value === previousValue)) {
    draftModel.value = value;
  }
});

function chooseModel(modelId) {
  if (modelSelectionLocked.value) return;
  draftModel.value = modelId;
}

function saveDraft() {
  if (!canSave.value) return;
  emit('save', draftModel.value);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="chat-model-switcher-overlay" @click.self="emit('close')">
      <section class="chat-model-switcher" role="dialog" aria-modal="true" aria-label="切换模型" :aria-busy="saving || refreshing">
        <header class="chat-model-switcher-head">
          <div>
            <span>{{ gatewayLabel }}</span>
            <h2>切换模型</h2>
          </div>
          <button class="deep-icon-button" type="button" aria-label="关闭模型切换器" title="关闭" @click="emit('close')">
            <X :size="18" />
          </button>
        </header>

        <div class="chat-model-switcher-tools">
          <label class="chat-model-search" :class="{ 'is-disabled': modelSelectionLocked }">
            <Search :size="17" />
            <input v-model.trim="search" type="search" placeholder="搜索当前网关模型" :disabled="modelSelectionLocked" />
          </label>
          <button class="ghost-button compact-button" type="button" :disabled="!canRefresh" :aria-busy="refreshing" @click="emit('refresh')">
            <RefreshCw :size="17" :class="{ spinning: refreshing }" />
            <span>{{ refreshing ? '刷新中' : '刷新' }}</span>
          </button>
        </div>

        <div v-if="filteredModels.length" class="chat-model-list">
          <button
            v-for="model in filteredModels"
            :key="model.id"
            class="chat-model-option"
            :class="{ active: draftModel === model.id, current: currentModel === model.id }"
            type="button"
            :disabled="modelSelectionLocked"
            :aria-busy="saving && draftModel === model.id"
            @click="chooseModel(model.id)"
            @dblclick="saveDraft"
          >
            <span class="chat-model-option-main">
              <strong>{{ model.label || model.id }}</strong>
              <small v-if="(model.label || model.id) !== model.id">{{ model.id }}</small>
              <small v-else-if="model.ownedBy">{{ model.ownedBy }}</small>
            </span>
            <span v-if="currentModel === model.id" class="chat-model-current">当前</span>
            <Check v-if="draftModel === model.id" :size="17" />
          </button>
        </div>

        <div v-else class="chat-model-empty">
          <p>{{ modelOptions.length ? '没有匹配的模型' : '当前网关暂无模型列表' }}</p>
          <button class="ghost-button compact-button" type="button" :disabled="!canRefresh" :aria-busy="refreshing" @click="emit('refresh')">
            <RefreshCw :size="17" />
            <span>刷新模型</span>
          </button>
        </div>

        <footer class="chat-model-switcher-footer">
          <p>当前：<strong>{{ currentModel || '未配置' }}</strong></p>
          <button class="chat-model-save" type="button" :disabled="!canSave" :aria-busy="saving" @click="saveDraft">
            <Check :size="17" />
            <span>{{ saving ? '切换中' : '切换模型' }}</span>
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
