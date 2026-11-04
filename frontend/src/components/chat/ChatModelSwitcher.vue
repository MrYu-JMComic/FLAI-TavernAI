<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Check, LoaderCircle, RefreshCw, Search, X } from '@lucide/vue';
import { inferProviderModelTask } from '../../../../shared/providerCapabilities.js';

const props = defineProps({
  open: { type: Boolean, default: false },
  provider: { type: Object, default: null },
  models: { type: Array, default: () => [] },
  providerProfiles: { type: Array, default: () => [] },
  selectedProviderId: { type: String, default: '' },
  profilesLoading: { type: Boolean, default: false },
  profilesError: { type: String, default: '' },
  switchingProvider: { type: Boolean, default: false },
  touchDevice: { type: Boolean, default: false },
  refreshing: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  error: { type: String, default: '' }
});

const emit = defineEmits(['close', 'refresh', 'refresh-providers', 'restore-focus', 'save', 'select-provider']);

const search = ref('');
const draftModel = ref('');
const dialog = ref(null);
const searchInput = ref(null);
const closeButton = ref(null);
const viewportHeight = ref('100dvh');
const viewportCenter = ref('50%');
let previousFocus = null;

const currentModel = computed(() => String(props.provider?.model || '').trim());
const providerContextKey = computed(() => {
  const provider = props.provider || {};
  return [
    provider.providerType || '',
    provider.gatewayName || '',
    provider.baseUrl || '',
    Boolean(provider.apiKey || provider.apiKeySet),
    Boolean(provider.supportsReasoning),
    provider.extraBody ?? '{}'
  ].join('\n');
});
const gatewayLabel = computed(() => {
  return String(props.provider?.gatewayName || props.provider?.providerType || '当前网关').trim();
});
const modelSelectionLocked = computed(() => props.saving || props.switchingProvider);
const canRefresh = computed(() => Boolean(props.provider?.baseUrl) && !props.refreshing && !modelSelectionLocked.value);
const modelOptions = computed(() => {
  const byId = new Map();
  const current = currentModel.value;
  if (current && inferProviderModelTask(current) === 'chat') {
    byId.set(current, {
      id: current,
      label: current,
      ownedBy: '',
      current: true
    });
  }
  for (const item of Array.isArray(props.models) ? props.models : []) {
    const id = String(item?.id || item?.name || item?.model || item || '').trim();
    if (!id || inferProviderModelTask(id, item?.task) !== 'chat') continue;
    byId.set(id, {
      id,
      label: String(item?.label || item?.displayName || item?.name || id).trim() || id,
      ownedBy: String(item?.ownedBy || item?.owned_by || item?.publisher || '').trim(),
      current: id === current
    });
  }
  return collectModelOptionValues(byId);
});
const filteredModels = computed(() => filterModelOptions(modelOptions.value, search.value));
const canSave = computed(() => {
  return Boolean(draftModel.value) &&
    draftModel.value !== currentModel.value &&
    hasModelOption(modelOptions.value, draftModel.value) &&
    !modelSelectionLocked.value;
});

function updateViewport() {
  const viewport = window.visualViewport;
  const height = viewport?.height || window.innerHeight;
  viewportHeight.value = `${Math.round(height)}px`;
  viewportCenter.value = `${Math.round((viewport?.offsetTop || 0) + height / 2)}px`;
}

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

watch(modelOptions, (options) => {
  if (!props.open) return;
  syncDraftModelWithOptions(options);
});

onMounted(() => {
  updateViewport();
  window.addEventListener('resize', updateViewport);
  window.visualViewport?.addEventListener('resize', updateViewport);
  window.visualViewport?.addEventListener('scroll', updateViewport);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateViewport);
  window.visualViewport?.removeEventListener('resize', updateViewport);
  window.visualViewport?.removeEventListener('scroll', updateViewport);
  if (dialog.value?.open) dialog.value.close();
  restoreFocus();
});

watch(() => props.open, (open) => {
  if (!open) {
    if (dialog.value?.open) dialog.value.close();
    restoreFocus();
    return;
  }
  previousFocus = document.activeElement;
  updateViewport();
  nextTick(() => {
    if (!props.open || !dialog.value) return;
    if (!dialog.value.open) dialog.value.showModal();
    (isTouchSizedViewport() ? closeButton.value : searchInput.value)?.focus({ preventScroll: true });
  });
}, { immediate: true });

function isTouchSizedViewport() {
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(max-width: 760px)').matches;
  }
  return props.touchDevice || window.innerWidth <= 760;
}

function restoreFocus() {
  const target = previousFocus;
  previousFocus = null;
  if (target?.isConnected) {
    target.focus({ preventScroll: true });
  } else {
    emit('restore-focus');
  }
}

function chooseModel(modelId) {
  if (modelSelectionLocked.value) return;
  if (!hasModelOption(modelOptions.value, modelId)) return;
  draftModel.value = modelId;
}

function filterModelOptions(options, rawKeyword) {
  const currentOptions = Array.isArray(options) ? options : [];
  const keyword = String(rawKeyword || '').trim().toLowerCase();
  if (!keyword) {
    return currentOptions;
  }
  const matches = [];
  for (const model of currentOptions) {
    if (`${model?.id || ''} ${model?.label || ''} ${model?.ownedBy || ''}`.toLowerCase().includes(keyword)) {
      matches.push(model);
    }
  }
  return matches;
}

function collectModelOptionValues(byId) {
  const options = [];
  for (const option of byId.values()) {
    options.push(option);
  }
  return options;
}

function hasModelOption(options, modelId) {
  const id = String(modelId || '').trim();
  if (!id) {
    return false;
  }
  const currentOptions = Array.isArray(options) ? options : [];
  for (const model of currentOptions) {
    if (model?.id === id) {
      return true;
    }
  }
  return false;
}

function syncDraftModelWithOptions(options = modelOptions.value) {
  const current = currentModel.value;
  if (!draftModel.value) {
    draftModel.value = current;
    return;
  }
  if (hasModelOption(options, draftModel.value)) {
    return;
  }
  draftModel.value = current;
}

function saveDraft() {
  if (!canSave.value) return;
  emit('save', draftModel.value);
}

function closeSwitcher() {
  if (modelSelectionLocked.value) return;
  emit('close');
}
</script>

<template>
  <Teleport to="body">
    <dialog v-if="open" ref="dialog" class="chat-model-switcher" :style="{ '--chat-model-switcher-viewport-height': viewportHeight, '--chat-model-switcher-center': viewportCenter }" aria-labelledby="chat-model-switcher-title" @cancel.prevent="closeSwitcher" @click="($event.target === dialog) && closeSwitcher()">
      <div class="chat-model-switcher-shell">
        <header class="chat-model-switcher-head">
          <div>
            <span>{{ gatewayLabel }}</span>
            <h2 id="chat-model-switcher-title">切换聊天模型</h2>
            <p>切换网关，搜索可用模型</p>
          </div>
          <button ref="closeButton" class="chat-model-switcher-close" type="button" aria-label="关闭模型切换器" title="关闭" :disabled="modelSelectionLocked" :aria-busy="modelSelectionLocked" @click="closeSwitcher">
            <X :size="18" />
          </button>
        </header>

        <div class="chat-model-switcher-providers" aria-label="选择聊天网关" :aria-busy="profilesLoading || switchingProvider">
          <button
            v-for="profile in providerProfiles"
            :key="profile.id"
            class="chat-model-provider-chip"
            :class="{ active: selectedProviderId === profile.id }"
            type="button"
            :aria-pressed="selectedProviderId === profile.id"
            :title="profile.gatewayName || profile.name || profile.providerType"
            :disabled="profilesLoading || modelSelectionLocked || selectedProviderId === profile.id"
            @click="emit('select-provider', profile.id)"
          >{{ profile.gatewayName || profile.name || profile.providerType || '已保存网关' }}</button>
          <span v-if="profilesLoading" class="chat-model-provider-status" role="status">正在加载网关…</span>
          <span v-else-if="!providerProfiles.length && !profilesError" class="chat-model-provider-status">暂无可用网关</span>
          <button v-if="profilesError" class="chat-model-provider-retry" type="button" :disabled="profilesLoading || modelSelectionLocked" @click="emit('refresh-providers')">重试加载网关</button>
        </div>
        <p v-if="profilesError" class="chat-model-switcher-error" role="alert">{{ profilesError }}</p>

        <div class="chat-model-switcher-tools">
          <label class="chat-model-search" :class="{ 'is-disabled': modelSelectionLocked }">
            <Search :size="17" />
            <input ref="searchInput" v-model.trim="search" type="search" placeholder="搜索模型名称" aria-label="搜索当前网关模型" :disabled="modelSelectionLocked" autocomplete="off" />
          </label>
          <button class="chat-model-switcher-refresh" type="button" aria-label="刷新模型列表" title="刷新模型列表" :disabled="!canRefresh" :aria-busy="refreshing" @click="emit('refresh')">
            <RefreshCw :size="17" :class="{ spinning: refreshing }" />
          </button>
        </div>

        <p v-if="error" class="chat-model-switcher-error" role="alert">{{ error }}<button type="button" :disabled="!canRefresh" @click="emit('refresh')">重试</button></p>
        <div class="chat-model-switcher-meta" aria-live="polite"><span v-if="switchingProvider"><LoaderCircle :size="13" class="spinning" />正在切换网关…</span><span v-else-if="refreshing"><LoaderCircle :size="13" class="spinning" />正在获取模型…</span><span v-else>{{ filteredModels.length }} 个选项</span><span>选择后确认生效</span></div>

        <div v-if="filteredModels.length" class="chat-model-list">
          <button
            v-for="model in filteredModels"
            :key="model.id"
            class="chat-model-option"
            :class="{ active: draftModel === model.id, current: currentModel === model.id }"
            type="button"
            :disabled="modelSelectionLocked"
            :aria-pressed="draftModel === model.id"
            :aria-busy="saving && draftModel === model.id"
            @click="chooseModel(model.id)"
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
          <p>{{ search.trim() ? '没有匹配的模型，试试其他关键词' : switchingProvider || refreshing ? '正在加载模型列表…' : modelOptions.length ? '当前网关暂无匹配模型' : '当前网关暂无模型列表' }}</p>
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
      </div>
    </dialog>
  </Teleport>
</template>
