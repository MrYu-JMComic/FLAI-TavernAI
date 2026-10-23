<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Check, ChevronDown, LoaderCircle, RefreshCw, Search, X } from '@lucide/vue';

const props = defineProps({
  model: { type: String, default: '' },
  modelOptions: { type: Array, default: () => [] },
  providerProfileId: { type: String, default: '' },
  providerProfiles: { type: Array, default: () => [] },
  touchDevice: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' }
});
const emit = defineEmits(['close', 'select-model', 'select-provider', 'refresh']);
const dialog = ref(null);
const searchInput = ref(null);
const closeButton = ref(null);
const search = ref('');
const viewportHeight = ref('100dvh');
const viewportCenter = ref('50%');
let previousFocus = null;
const filteredModels = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  return props.modelOptions.filter((model) => !keyword || `${model.label || ''} ${model.id || ''}`.toLowerCase().includes(keyword));
});

function updateViewport() {
  const viewport = window.visualViewport;
  const height = viewport?.height || window.innerHeight;
  viewportHeight.value = `${Math.round(height)}px`;
  viewportCenter.value = `${Math.round((viewport?.offsetTop || 0) + height / 2)}px`;
}

onMounted(() => {
  previousFocus = document.activeElement;
  updateViewport();
  window.addEventListener('resize', updateViewport);
  window.visualViewport?.addEventListener('resize', updateViewport);
  window.visualViewport?.addEventListener('scroll', updateViewport);
  dialog.value?.showModal();
  (props.touchDevice ? closeButton.value : searchInput.value)?.focus({ preventScroll: true });
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateViewport);
  window.visualViewport?.removeEventListener('resize', updateViewport);
  window.visualViewport?.removeEventListener('scroll', updateViewport);
  dialog.value?.close();
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
});
</script>

<template>
  <dialog ref="dialog" class="assistant-model-picker" :style="{ '--assistant-model-picker-viewport-height': viewportHeight, '--assistant-model-picker-center': viewportCenter }" aria-labelledby="assistant-model-picker-title" @cancel.prevent="emit('close')" @click="($event.target === dialog) && emit('close')">
    <div class="assistant-model-picker-shell">
      <header class="assistant-model-picker-heading">
        <div><h2 id="assistant-model-picker-title">选择助手模型</h2><p>切换网关，搜索可用模型</p></div>
        <button ref="closeButton" class="assistant-model-picker-close" type="button" aria-label="关闭模型选择" @click="emit('close')">
          <X :size="19" />
        </button>
      </header>
      <div class="assistant-model-picker-providers" aria-label="选择助手网关">
        <button class="assistant-provider-chip" :class="{ active: !providerProfileId }" type="button" :aria-pressed="!providerProfileId" @click="emit('select-provider', '')">跟随全局网关</button>
        <button v-for="profile in providerProfiles" :key="profile.id" class="assistant-provider-chip" :class="{ active: providerProfileId === profile.id }" type="button" :aria-pressed="providerProfileId === profile.id" :title="profile.gatewayName || profile.name || profile.providerType" @click="emit('select-provider', profile.id)">{{ profile.gatewayName || profile.name || profile.providerType || '已保存网关' }}</button>
        <ChevronDown v-if="providerProfiles.length > 2" :size="13" class="assistant-provider-overflow" aria-hidden="true" />
      </div>
      <div class="assistant-model-picker-tools">
        <label class="assistant-model-picker-search"><Search :size="17" /><input ref="searchInput" v-model="search" type="search" aria-label="搜索助手模型" placeholder="搜索模型名称" autocomplete="off" /></label>
        <button class="assistant-model-picker-refresh" type="button" aria-label="刷新助手模型" :disabled="loading" @click="emit('refresh')"><RefreshCw :size="17" :class="{ 'assistant-spinning': loading }" /></button>
      </div>
      <p v-if="error" class="assistant-model-picker-error" role="alert">{{ error }}<button type="button" :disabled="loading" @click="emit('refresh')">重试</button></p>
      <div class="assistant-model-picker-meta" aria-live="polite"><span v-if="loading"><LoaderCircle :size="13" class="assistant-spinning" />正在获取模型…</span><span v-else>{{ filteredModels.length }} 个选项</span><span>选择后立即生效</span></div>
      <div class="assistant-model-picker-list" aria-label="可用助手模型" :aria-busy="loading">
        <button v-for="option in filteredModels" :key="option.id || '__default'" class="assistant-model-picker-option" :class="{ active: model === option.id }" type="button" :aria-pressed="model === option.id" @click="emit('select-model', option.id)"><span><strong>{{ option.label || option.id }}</strong><small v-if="option.id && option.label && option.label !== option.id">{{ option.id }}</small></span>
          <Check v-if="model === option.id" :size="17" />
        </button>
        <p v-if="!filteredModels.length" class="assistant-model-picker-empty">{{ search.trim() ? '没有匹配的模型，试试其他关键词' : loading ? '正在加载模型列表…' : '此网关暂无模型，请尝试刷新' }}</p>
      </div>
    </div>
  </dialog>
</template>
