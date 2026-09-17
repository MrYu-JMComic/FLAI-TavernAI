<script setup>
import { computed, ref, watch } from 'vue';
import { RefreshCw, X } from '@lucide/vue';
import { fetchProviderModels, listProviderProfiles } from '../../api/providers.js';
import { buildModelSelectOptions } from '../../services/modelCatalog.js';
import { resolveProviderModelCapabilities } from '../../../../shared/providerCapabilities.js';
import {
  THINKING_LEVELS,
  listThinkingPreferenceLevels,
  resolveThinkingPreferenceLevel,
} from '../../../../shared/providerThinking.js';

const THINKING_LEVEL_LABELS = Object.freeze({
  off: '关闭',
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大',
});

const props = defineProps({
  open: { type: Boolean, default: false },
  settings: { type: Object, default: () => ({}) },
  operations: { type: Array, default: () => [] },
  mainProvider: { type: Object, default: null },
  mainModelOptions: { type: Array, default: () => [] },
  mainThinkingLevel: { type: String, default: '' },
  saving: { type: Boolean, default: false }
});

const emit = defineEmits(['close', 'save']);

const mode = ref('follow');
const providerProfileId = ref('');
const modelOverride = ref('');
const thinkingLevel = ref('');
const autoSyncSwitches = ref({});
const organizeSwitches = ref({});
const providers = ref([]);
const providersLoading = ref(false);
const providersError = ref('');
const profileModels = ref([]);
const modelsLoading = ref(false);
const modelsError = ref('');
let profileLoadToken = 0;
let modelLoadToken = 0;

const selectedProfile = computed(() => providers.value.find((provider) => provider.id === providerProfileId.value) || null);
const mainProviderLabel = computed(() => {
  const provider = props.mainProvider || {};
  const name = provider.gatewayName || provider.providerType || '当前供应商';
  return provider.model ? `${name} · ${provider.model}` : name;
});
const modelOptions = computed(() => {
  const source = mode.value === 'custom' && providerProfileId.value ? profileModels.value : props.mainModelOptions;
  return buildModelSelectOptions(source, modelOverride.value, mode.value === 'custom' && selectedProfile.value
    ? `使用该配置的默认模型（${selectedProfile.value.model || '未设置'}）`
    : '使用当前聊天模型');
});
const agentProviderSettings = computed(() => {
  const provider = mode.value === 'custom' ? selectedProfile.value : props.mainProvider;
  return {
    ...(provider || {}),
    model: modelOverride.value || provider?.model || '',
  };
});
const thinkingControl = computed(() => resolveProviderModelCapabilities(agentProviderSettings.value).thinking || {});
const inheritedThinkingLevel = computed(() => {
  const control = thinkingControl.value;
  if (!control.supported) return '';
  const requested = normalizeThinkingLevelSetting(props.mainThinkingLevel);
  return resolveThinkingPreferenceLevel(requested || control.defaultLevel, control, control.defaultLevel);
});
const thinkingOptions = computed(() => {
  const control = thinkingControl.value;
  const levels = listThinkingPreferenceLevels(control);
  const selected = normalizeThinkingLevelSetting(thinkingLevel.value);
  if (selected && !levels.includes(selected)) levels.push(selected);
  return levels.map((value) => ({
    value,
    label: `${THINKING_LEVEL_LABELS[value] || value}${thinkingOptionSuffix(value, control)}`,
  }));
});
const followThinkingOptionLabel = computed(() => {
  if (!thinkingControl.value.supported) return '跟随主对话（当前模型不支持思考）';
  const label = THINKING_LEVEL_LABELS[inheritedThinkingLevel.value] || '供应商默认';
  return `跟随主对话（当前：${label}）`;
});
const thinkingHint = computed(() => {
  if (mode.value === 'custom' && !selectedProfile.value) return '选择供应商配置后会显示可用的思考强度。';
  if (!thinkingControl.value.supported) return '当前 NPC Agent 的供应商或模型不支持思考，运行时将自动关闭。';
  if (thinkingLevel.value) {
    const resolved = resolveThinkingPreferenceLevel(thinkingLevel.value, thinkingControl.value, thinkingControl.value.defaultLevel);
    const label = THINKING_LEVEL_LABELS[resolved] || resolved;
    return `NPC Agent 将单独使用${label}强度；当前模型不接受该档位时会自动映射到最接近的可用档位。`;
  }
  return '未单独设置时，每轮自动同步和手动 AI 整理都跟随当时的主对话思考强度。';
});
const autoSyncItems = computed(() => props.operations.filter((operation) => operation.autoSync).map((operation) => ({
  ...operation,
  checked: autoSyncSwitches.value[operation.name] !== false
})));
const organizeItems = computed(() => props.operations.map((operation) => ({
  ...operation,
  checked: organizeSwitches.value[operation.name] !== false
})));

watch(() => props.open, (isOpen) => {
  if (!isOpen) return;
  syncFromSettings();
  void loadProviders();
});

watch(providerProfileId, (nextId) => {
  if (!props.open) return;
  profileModels.value = [];
  modelsError.value = '';
  if (nextId && mode.value === 'custom') {
    void loadProfileModels(false);
  }
});

function syncFromSettings() {
  const settings = props.settings || {};
  providerProfileId.value = String(settings.providerProfileId || '');
  modelOverride.value = String(settings.modelOverride || '');
  thinkingLevel.value = normalizeThinkingLevelSetting(settings.thinkingLevel ?? settings.thinking_level);
  mode.value = providerProfileId.value ? 'custom' : 'follow';
  autoSyncSwitches.value = { ...(settings.autoSyncOperations || {}) };
  organizeSwitches.value = { ...(settings.organizeOperations || {}) };
}

async function loadProviders() {
  const token = ++profileLoadToken;
  providersLoading.value = true;
  providersError.value = '';
  try {
    const bundle = await listProviderProfiles();
    if (token !== profileLoadToken) return;
    providers.value = Array.isArray(bundle?.providers) ? bundle.providers : [];
    if (mode.value === 'custom' && providerProfileId.value) {
      void loadProfileModels(false);
    }
  } catch (error) {
    if (token !== profileLoadToken) return;
    providersError.value = error?.message || '无法加载供应商配置';
  } finally {
    if (token === profileLoadToken) providersLoading.value = false;
  }
}

async function loadProfileModels(forceRefresh) {
  const providerId = providerProfileId.value;
  if (!providerId) return;
  const token = ++modelLoadToken;
  modelsLoading.value = true;
  modelsError.value = '';
  try {
    const result = await fetchProviderModels({ providerId }, { forceRefresh });
    if (token !== modelLoadToken) return;
    profileModels.value = Array.isArray(result?.models) ? result.models : [];
  } catch (error) {
    if (token !== modelLoadToken) return;
    modelsError.value = error?.message || '无法获取模型列表';
  } finally {
    if (token === modelLoadToken) modelsLoading.value = false;
  }
}

function setMode(nextMode) {
  mode.value = nextMode;
  if (nextMode === 'follow') {
    providerProfileId.value = '';
  } else if (!providerProfileId.value) {
    const selected = providers.value.find((provider) => provider.selected) || providers.value[0];
    providerProfileId.value = selected?.id || '';
  }
}

function toggleAutoSync(name) {
  const current = autoSyncSwitches.value[name] !== false;
  autoSyncSwitches.value = { ...autoSyncSwitches.value, [name]: !current };
}

function toggleOrganize(name) {
  const current = organizeSwitches.value[name] !== false;
  organizeSwitches.value = { ...organizeSwitches.value, [name]: !current };
}

function compactSwitches(switches) {
  // Only disabled operations are stored; a missing key means allowed.
  const result = {};
  for (const [name, value] of Object.entries(switches)) {
    if (value === false) result[name] = false;
  }
  return result;
}

function submit() {
  if (props.saving) return;
  emit('save', {
    providerProfileId: mode.value === 'custom' ? providerProfileId.value : '',
    modelOverride: modelOverride.value,
    thinkingLevel: thinkingLevel.value,
    autoSyncOperations: compactSwitches(autoSyncSwitches.value),
    organizeOperations: compactSwitches(organizeSwitches.value)
  });
}

function requestClose() {
  if (props.saving) return;
  emit('close');
}

function normalizeThinkingLevelSetting(value) {
  const level = String(value ?? '').trim().toLowerCase();
  return THINKING_LEVELS.includes(level) ? level : '';
}

function thinkingOptionSuffix(level, control) {
  if ((control.levels || []).includes(level) || level === 'off') return '';
  return control.supported ? '（将自动适配）' : '（当前模型不支持）';
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="cast-agent-backdrop" role="presentation" @click.self="requestClose">
      <div class="cast-agent-dialog" role="dialog" aria-modal="true" aria-labelledby="cast-agent-dialog-title">
        <header>
          <div>
            <h3 id="cast-agent-dialog-title">NPC 管理 Agent 设置</h3>
            <p>自动同步和 AI 整理都由这个 Agent 提出结构化变更计划，服务端逐项校验后写入。</p>
          </div>
          <button class="cast-agent-icon-button" type="button" aria-label="关闭 NPC 管理 Agent 设置" :disabled="saving" @click="requestClose">
            <X :size="18" />
          </button>
        </header>

        <div class="agent-dialog-body">
        <section>
          <h4>模型来源</h4>
          <div class="cast-agent-modes" role="radiogroup" aria-label="模型来源">
            <label class="cast-agent-mode" :class="{ active: mode === 'follow' }">
              <input type="radio" name="cast-agent-mode" value="follow" :checked="mode === 'follow'" :disabled="saving" @change="setMode('follow')" />
              <span>
                <strong>跟随主聊天设置</strong>
                <small>{{ mainProviderLabel }}</small>
              </span>
            </label>
            <label class="cast-agent-mode" :class="{ active: mode === 'custom' }">
              <input type="radio" name="cast-agent-mode" value="custom" :checked="mode === 'custom'" :disabled="saving" @change="setMode('custom')" />
              <span>
                <strong>单独指定供应商配置</strong>
                <small>使用设置页保存的另一套供应商与模型，例如更便宜或更擅长 JSON 的模型。</small>
              </span>
            </label>
          </div>
          <label v-if="mode === 'custom'" class="cast-agent-field">
            <span>供应商配置</span>
            <select v-model="providerProfileId" :disabled="saving || providersLoading">
              <option v-if="!providers.length" value="">{{ providersLoading ? '加载中...' : '没有可用的供应商配置' }}</option>
              <option v-for="provider in providers" :key="provider.id" :value="provider.id">
                {{ provider.gatewayName || provider.providerType }}{{ provider.selected ? '（主聊天当前使用）' : '' }} · {{ provider.model || '未设置模型' }}
              </option>
            </select>
            <small v-if="providersError" class="cast-agent-error">{{ providersError }}</small>
          </label>
          <label class="cast-agent-field">
            <span>模型{{ mode === 'custom' ? '' : '覆盖' }}</span>
            <div class="cast-agent-model-row">
              <select v-model="modelOverride" :disabled="saving">
                <option v-for="model in modelOptions" :key="model.id || 'default'" :value="model.id">{{ model.label || model.id }}</option>
              </select>
              <button
                v-if="mode === 'custom' && providerProfileId"
                class="cast-agent-icon-button"
                type="button"
                title="刷新模型列表"
                aria-label="刷新模型列表"
                :disabled="saving || modelsLoading"
                :aria-busy="modelsLoading"
                @click="loadProfileModels(true)"
              >
                <RefreshCw :size="15" />
              </button>
            </div>
            <input
              v-model.trim="modelOverride"
              type="text"
              maxlength="100"
              placeholder="或手动输入模型 ID"
              aria-label="手动输入 NPC 管理 Agent 模型"
              :disabled="saving"
            />
            <small v-if="modelsError" class="cast-agent-error">{{ modelsError }}</small>
          </label>
          <label class="cast-agent-field">
            <span>思考强度</span>
            <select v-model="thinkingLevel" :disabled="saving" aria-describedby="cast-agent-thinking-hint">
              <option value="">{{ followThinkingOptionLabel }}</option>
              <option v-for="option in thinkingOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
            <small id="cast-agent-thinking-hint" class="cast-agent-hint">{{ thinkingHint }}</small>
          </label>
        </section>

        <section>
          <h4>自动同步可执行的操作</h4>
          <p class="cast-agent-hint">每轮回复后自动同步只能使用下面勾选的操作；未勾选的操作会在写入前被拒绝。</p>
          <ul class="cast-agent-operations">
            <li v-for="operation in autoSyncItems" :key="`auto-${operation.name}`">
              <label class="cast-agent-operation">
                <input type="checkbox" :checked="operation.checked" :disabled="saving" @change="toggleAutoSync(operation.name)" />
                <span>
                  <strong>{{ operation.label }}<em>{{ operation.name }}</em></strong>
                  <small>{{ operation.description }}</small>
                </span>
              </label>
            </li>
          </ul>
        </section>

        <section>
          <h4>AI 整理可执行的操作</h4>
          <p class="cast-agent-hint">单人物整理和全局整理使用下面的操作库。删除、隐藏类操作可以在这里关闭以保守整理。</p>
          <ul class="cast-agent-operations">
            <li v-for="operation in organizeItems" :key="`organize-${operation.name}`">
              <label class="cast-agent-operation">
                <input type="checkbox" :checked="operation.checked" :disabled="saving" @change="toggleOrganize(operation.name)" />
                <span>
                  <strong>{{ operation.label }}<em>{{ operation.name }}</em></strong>
                  <small>{{ operation.description }}</small>
                </span>
              </label>
            </li>
          </ul>
        </section>
        </div>

        <footer>
          <button type="button" :disabled="saving" @click="requestClose">取消</button>
          <button class="primary" type="button" :disabled="saving" :aria-busy="saving" @click="submit">
            {{ saving ? '保存中...' : '保存设置' }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
