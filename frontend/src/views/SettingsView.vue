<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { RefreshCw, Save, WalletCards } from '@lucide/vue';
import { fetchDeepSeekBalance, fetchProviderModels, getProviderSettings, saveProviderSettings } from '../api';

const emit = defineEmits(['provider-saved']);
const presets = {
  openai: {
    gatewayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    supportsReasoning: false,
    extraBody: '{}'
  },
  deepseek: {
    gatewayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    supportsReasoning: true,
    extraBody: '{}'
  },
  gemini: {
    gatewayName: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    supportsReasoning: true,
    extraBody: JSON.stringify(
      {
        extra_body: {
          google: {
            thinking_config: {
              include_thoughts: true
            }
          }
        }
      },
      null,
      2
    )
  },
  custom: {
    gatewayName: '自定义网关',
    baseUrl: '',
    model: '',
    supportsReasoning: false,
    extraBody: '{}'
  }
};

const form = reactive({
  providerType: 'deepseek',
  gatewayName: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  apiKey: '',
  apiKeySet: false,
  apiKeyHint: '',
  apiKeyNeedsReset: false,
  apiKeyError: '',
  clearApiKey: false,
  supportsReasoning: true,
  extraBody: '{}'
});
const loading = ref(false);
const saving = ref(false);
const modelLoading = ref(false);
const balanceLoading = ref(false);
const error = ref('');
const success = ref('');
const modelOptions = ref([]);
const balance = ref(null);

const canCheckBalance = computed(() => form.providerType === 'deepseek' && form.apiKeySet && !form.apiKeyNeedsReset);
const canFetchModels = computed(() => Boolean(form.baseUrl && (form.apiKey || form.apiKeySet)));

onMounted(loadSettings);

async function loadSettings() {
  loading.value = true;
  error.value = '';
  try {
    applySettings(await getProviderSettings());
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

function applyPreset() {
  const preset = presets[form.providerType];
  Object.assign(form, {
    gatewayName: preset.gatewayName,
    baseUrl: preset.baseUrl,
    model: preset.model,
    supportsReasoning: preset.supportsReasoning,
    extraBody: preset.extraBody
  });
  modelOptions.value = [];
}

async function loadModels() {
  modelLoading.value = true;
  error.value = '';
  success.value = '';
  try {
    const result = await fetchProviderModels({
      providerType: form.providerType,
      gatewayName: form.gatewayName,
      baseUrl: form.baseUrl,
      model: form.model,
      apiKey: form.apiKey,
      supportsReasoning: form.supportsReasoning,
      extraBody: form.extraBody
    });
    modelOptions.value = result.models || [];
    if (!modelOptions.value.length) {
      success.value = '官方接口没有返回可选模型，仍可手动填写模型名。';
    } else if (!modelOptions.value.some((model) => model.id === form.model)) {
      form.model = modelOptions.value[0].id;
      success.value = `已获取 ${modelOptions.value.length} 个模型，并自动选择第一个。`;
    } else {
      success.value = `已获取 ${modelOptions.value.length} 个模型。`;
    }
  } catch (err) {
    error.value = err.message;
  } finally {
    modelLoading.value = false;
  }
}

async function submit() {
  saving.value = true;
  error.value = '';
  success.value = '';
  try {
    const saved = await saveProviderSettings({
      providerType: form.providerType,
      gatewayName: form.gatewayName,
      baseUrl: form.baseUrl,
      model: form.model,
      apiKey: form.apiKey,
      clearApiKey: form.clearApiKey,
      supportsReasoning: form.supportsReasoning,
      extraBody: form.extraBody
    });
    applySettings(saved);
    success.value = '设置已保存';
    emit('provider-saved');
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function checkBalance() {
  balanceLoading.value = true;
  error.value = '';
  try {
    balance.value = await fetchDeepSeekBalance();
  } catch (err) {
    error.value = err.message;
  } finally {
    balanceLoading.value = false;
  }
}

function applySettings(settings) {
  Object.assign(form, {
    providerType: settings.providerType,
    gatewayName: settings.gatewayName,
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKey: '',
    apiKeySet: settings.apiKeySet,
    apiKeyHint: settings.apiKeyHint || '',
    apiKeyNeedsReset: Boolean(settings.apiKeyNeedsReset),
    apiKeyError: settings.apiKeyError || '',
    clearApiKey: false,
    supportsReasoning: settings.supportsReasoning,
    extraBody: JSON.stringify(settings.extraBody || {}, null, 2)
  });
}
</script>

<template>
  <section class="page-stack narrow-page">
    <div class="section-heading">
      <div>
        <p>用户设置</p>
        <h1>AI 供应商、SK 与网关</h1>
      </div>
    </div>

    <p v-if="error" class="error-text">{{ error }}</p>
    <p v-if="form.apiKeyNeedsReset" class="error-text">
      已保存的 API Key 无法解密。请重新粘贴 SK 并保存设置，之后再获取模型或查询余额。
    </p>
    <p v-if="success" class="success-text">{{ success }}</p>
    <p v-if="loading" class="muted-text">正在加载设置...</p>

    <form v-else class="form-panel" @submit.prevent="submit">
      <div class="form-grid two-col">
        <label class="field">
          <span>供应商</span>
          <select v-model="form.providerType" @change="applyPreset">
            <option value="deepseek">DeepSeek</option>
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini OpenAI-compatible</option>
            <option value="custom">自定义 OpenAI-compatible</option>
          </select>
        </label>
        <label class="field">
          <span>网关名称</span>
          <input v-model.trim="form.gatewayName" />
        </label>
        <label class="field">
          <span>Base URL</span>
          <input v-model.trim="form.baseUrl" placeholder="https://api.example.com/v1" required />
        </label>
        <div class="field model-field">
          <span>模型</span>
          <div class="model-picker">
            <select v-if="modelOptions.length" v-model="form.model" required>
              <option v-if="!modelOptions.some((model) => model.id === form.model)" :value="form.model">
                {{ form.model }}
              </option>
              <option v-for="model in modelOptions" :key="model.id" :value="model.id">
                {{ model.label || model.id }}
              </option>
            </select>
            <input v-else v-model.trim="form.model" placeholder="deepseek-v4-flash" required />
            <button class="ghost-button compact-button" type="button" :disabled="!canFetchModels || modelLoading" @click="loadModels">
              <RefreshCw :size="17" />
              <span>{{ modelLoading ? '获取中' : '获取模型' }}</span>
            </button>
          </div>
        </div>
      </div>

      <label class="field">
        <span>API Key / SK</span>
        <input
          v-model.trim="form.apiKey"
          autocomplete="off"
          :placeholder="form.apiKeyNeedsReset ? '当前密钥不可用，请重新粘贴 SK' : '留空则保留已保存密钥'"
          type="password"
        />
      </label>
      <label class="checkbox-line">
        <input v-model="form.clearApiKey" type="checkbox" />
        <span>清除已保存密钥 {{ form.apiKeyHint ? `（当前：${form.apiKeyHint}）` : '' }}</span>
      </label>
      <label class="field">
        <span>Extra Body JSON</span>
        <textarea v-model="form.extraBody" rows="8" spellcheck="false" />
      </label>

      <div class="form-actions">
        <button class="primary-button" type="submit" :disabled="saving">
          <Save :size="18" />
          <span>{{ saving ? '保存中...' : '保存设置' }}</span>
        </button>
        <button
          v-if="form.providerType === 'deepseek'"
          class="ghost-button"
          type="button"
          :disabled="!canCheckBalance || balanceLoading"
          @click="checkBalance"
        >
          <WalletCards :size="18" />
          <span>{{ balanceLoading ? '查询中...' : '查询余额' }}</span>
        </button>
      </div>
    </form>

    <section v-if="balance" class="balance-panel">
      <div class="inline-heading">
        <div>
          <h2>DeepSeek 余额</h2>
          <p>来自官方余额接口的原始账户信息。</p>
        </div>
        <RefreshCw :size="20" />
      </div>
      <pre>{{ JSON.stringify(balance, null, 2) }}</pre>
    </section>
  </section>
</template>
