<script setup>
import { computed } from 'vue';
import { CircleCheck, Plus, RefreshCw, Save, ShieldCheck, Trash2, WalletCards } from '@lucide/vue';

const props = defineProps({
  balanceLoading: { type: Boolean, default: false },
  canCheckBalance: { type: Boolean, default: false },
  canFetchModels: { type: Boolean, default: false },
  isRootAdmin: { type: Boolean, default: false },
  controlsBusy: { type: Boolean, default: false },
  form: { type: Object, required: true },
  modelLoading: { type: Boolean, default: false },
  modelOptions: { type: Array, default: () => [] },
  probeLoading: { type: Boolean, default: false },
  probeMessage: { type: String, default: '' },
  probeStatus: { type: String, default: 'idle' },
  providers: { type: Array, default: () => [] },
  providerCapability: { type: Object, default: null },
  providerCapabilityError: { type: String, default: '' },
  providerActionLoading: { type: Boolean, default: false },
  providerNetworkPolicy: { type: Object, default: () => ({}) },
  selectedProviderId: { type: String, default: '' },
  saving: { type: Boolean, default: false }
});

const emit = defineEmits([
  'apply-preset',
  'add-provider',
  'check-balance',
  'load-models',
  'probe-provider',
  'remove-provider',
  'select-provider',
  'submit',
  'update-field'
]);

const capabilityDefinitions = [
  { key: 'streaming', label: '流式' },
  { key: 'reasoning', label: '推理' },
  { key: 'tools', label: '工具' },
  { key: 'vision', label: '视觉' },
  { key: 'imageGeneration', label: '生图' },
  { key: 'usage', label: '用量' }
];
const providerCapabilityName = computed(() => (
  props.providerCapability?.gatewayName
  || props.form.gatewayName
  || '当前网关'
));
const activeProviderSummary = computed(() => {
  const provider = props.providers.find((item) => item?.id === props.selectedProviderId) || props.form;
  const gatewayName = String(provider?.gatewayName || '未命名供应商').trim() || '未命名供应商';
  const model = String(provider?.model || '').trim();
  return model ? `${gatewayName} · ${model}` : gatewayName;
});
const capabilityItems = computed(() => {
  const capabilities = props.providerCapability?.capabilities || {};
  return capabilityDefinitions.map((definition) => ({
    ...definition,
    enabled: Boolean(capabilities[definition.key])
  }));
});

function readInputValue(event) {
  const target = event?.target;
  return target && target.value !== undefined ? target.value : '';
}

function readInputChecked(event) {
  const target = event?.target;
  return Boolean(target?.checked);
}

function updateField(key, value) {
  emit('update-field', key, value);
}

function updateTrimmedField(key, event) {
  updateField(key, readInputValue(event).trim());
}

function providerOptionLabel(provider) {
  const gatewayName = String(provider?.gatewayName || '未命名供应商').trim() || '未命名供应商';
  const model = String(provider?.model || '').trim();
  return model ? `${gatewayName} · ${model}` : gatewayName;
}

function selectProvider(event) {
  const target = event?.target;
  emit('select-provider', readInputValue(event));
  queueMicrotask(() => {
    if (target) target.value = props.selectedProviderId;
  });
}
</script>

<template>
  <form id="personal-section-provider" class="form-panel provider-settings-panel" :aria-busy="controlsBusy" @submit.prevent="emit('submit')">
    <div class="inline-heading">
      <div>
        <h2>AI 供应商设置</h2>
        <p>{{ activeProviderSummary }}</p>
      </div>
    </div>
    <div class="provider-profile-toolbar">
      <label class="field provider-profile-picker">
        <span>配置档案</span>
        <select
          :value="selectedProviderId"
          :disabled="controlsBusy || providers.length < 2"
          @change="selectProvider"
        >
          <option v-for="provider in providers" :key="provider.id" :value="provider.id">
            {{ providerOptionLabel(provider) }}
          </option>
        </select>
      </label>
      <div class="provider-profile-actions">
        <span class="provider-active-indicator" aria-live="polite">
          <CircleCheck :size="17" />
          <span>{{ providerActionLoading ? '切换中' : '正在使用' }}</span>
        </span>
        <button
          class="icon-button"
          type="button"
          title="添加 AI 供应商"
          aria-label="添加配置档案"
          :disabled="controlsBusy"
          @click="emit('add-provider')"
        >
          <Plus :size="19" />
        </button>
        <button
          class="icon-button provider-delete-button"
          type="button"
          title="删除当前 AI 供应商"
          aria-label="删除配置档案"
          :disabled="controlsBusy || providers.length <= 1"
          @click="emit('remove-provider')"
        >
          <Trash2 :size="18" />
        </button>
      </div>
    </div>
    <div class="form-grid two-col">
      <label class="field">
        <span>供应商</span>
        <select
          :value="form.providerType"
          :disabled="controlsBusy"
          @change="updateField('providerType', readInputValue($event)); emit('apply-preset')"
        >
          <option value="deepseek">DeepSeek</option>
          <option value="openai">OpenAI</option>
          <option value="gemini">Gemini OpenAI-compatible</option>
          <option value="anthropic">Anthropic Claude</option>
          <option value="xai">xAI Grok</option>
          <option value="mistral">Mistral</option>
          <option value="qwen">Qwen 通义千问</option>
          <option value="glm">Z.AI GLM 智谱</option>
          <option value="kimi">Kimi Moonshot</option>
          <option value="custom">自定义 OpenAI-compatible</option>
        </select>
      </label>
      <label class="field">
        <span>网关名称</span>
        <input :value="form.gatewayName" :disabled="controlsBusy" @input="updateTrimmedField('gatewayName', $event)" />
      </label>
      <label class="field">
        <span>Base URL</span>
        <input :value="form.baseUrl" placeholder="https://api.example.com/v1" :disabled="controlsBusy" required @input="updateTrimmedField('baseUrl', $event)" />
      </label>
      <div class="field model-field">
        <span>模型</span>
        <div class="model-picker">
          <select :value="form.model" :disabled="controlsBusy" required aria-label="模型" @change="updateField('model', readInputValue($event))">
            <option v-if="!modelOptions.length" value="" disabled>
              请先获取模型列表
            </option>
            <option v-for="model in modelOptions" :key="model.id" :value="model.id">
              {{ model.label || model.id }}
            </option>
          </select>
          <button class="ghost-button compact-button" type="button" :disabled="controlsBusy || !canFetchModels" @click="emit('load-models')">
            <RefreshCw :size="17" />
            <span>{{ modelLoading ? '刷新中' : '刷新模型' }}</span>
          </button>
          <button class="ghost-button compact-button" type="button" :disabled="controlsBusy || !canFetchModels" :aria-busy="probeLoading" @click="emit('probe-provider')">
            <ShieldCheck :size="17" />
            <span>{{ probeLoading ? '检测中' : '检测连接' }}</span>
          </button>
        </div>
        <p v-if="probeMessage" class="provider-probe-message" :class="`probe-${probeStatus}`" role="status">
          {{ probeMessage }}
        </p>
      </div>
    </div>

    <div class="provider-capability-panel" :aria-label="`${providerCapabilityName} 能力`">
      <div class="provider-capability-header">
        <span>模型能力</span>
        <strong>{{ providerCapabilityName }}</strong>
      </div>
      <p v-if="providerCapabilityError" class="provider-capability-error" role="status">
        {{ providerCapabilityError }}
      </p>
      <div class="provider-capability-grid">
        <span
          v-for="item in capabilityItems"
          :key="item.key"
          class="provider-capability-chip"
          :class="{ enabled: item.enabled, disabled: !item.enabled }"
        >
          <span>{{ item.label }}</span>
          <strong>{{ item.enabled ? '可用' : '不可用' }}</strong>
        </span>
      </div>
    </div>

    <label class="field">
      <span>API Key / SK</span>
      <input
        :value="form.apiKey"
        autocomplete="off"
        :disabled="controlsBusy"
        :placeholder="form.apiKeyNeedsReset ? '当前密钥不可用，请重新粘贴 SK' : '留空则保留已保存密钥'"
        type="password"
        @input="updateTrimmedField('apiKey', $event)"
      />
    </label>
    <label class="checkbox-line">
      <input :checked="form.clearApiKey" type="checkbox" :disabled="controlsBusy" @change="updateField('clearApiKey', readInputChecked($event))" />
      <span>清除已保存密钥 {{ form.apiKeyHint ? `（当前：${form.apiKeyHint}）` : '' }}</span>
    </label>
    <label v-if="isRootAdmin" class="checkbox-line">
      <input
        :checked="form.allowPrivateNetwork"
        type="checkbox"
        :disabled="controlsBusy || !providerNetworkPolicy.enabled"
        @change="updateField('allowPrivateNetwork', readInputChecked($event))"
      />
      <span>允许本地或私网 Provider（仅 root）</span>
    </label>
    <p v-if="isRootAdmin" class="muted-text provider-private-network-hint">
      <template v-if="providerNetworkPolicy.enabled">
        部署已启用私网 Provider；仅 root 账户可以连接。
      </template>
      <template v-else>
        部署未启用；设置 {{ providerNetworkPolicy.settingName || 'ALLOW_PRIVATE_PROVIDER_NETWORK_DEV' }}=true 并重启后端。
      </template>
    </p>
    <details class="provider-advanced-settings">
      <summary>
        <span>高级模型参数</span>
      </summary>
      <div class="provider-advanced-body">
        <label class="checkbox-line">
          <input :checked="form.supportsReasoning" type="checkbox" :disabled="controlsBusy" @change="updateField('supportsReasoning', readInputChecked($event))" />
          <span>支持推理输出</span>
        </label>
        <label class="field">
          <span>Extra Body JSON</span>
          <textarea
            :value="form.extraBody"
            rows="5"
            spellcheck="false"
            :disabled="controlsBusy"
            @input="updateField('extraBody', readInputValue($event))"
          />
        </label>
      </div>
    </details>
    <div class="form-actions">
      <button class="primary-button" type="submit" :disabled="controlsBusy">
        <Save :size="18" />
        <span>{{ saving ? '保存中...' : '保存设置' }}</span>
      </button>
      <button
        v-if="form.providerType === 'deepseek'"
        class="ghost-button"
        type="button"
        :disabled="controlsBusy || !canCheckBalance || balanceLoading"
        @click="emit('check-balance')"
      >
        <WalletCards :size="18" />
        <span>{{ balanceLoading ? '查询中...' : '查询余额' }}</span>
      </button>
    </div>
  </form>
</template>
