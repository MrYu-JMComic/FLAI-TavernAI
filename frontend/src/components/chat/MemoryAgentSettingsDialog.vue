<script setup>
import { computed, ref, watch } from 'vue';
import { RefreshCw, X } from '@lucide/vue';
import { fetchProviderModels, listProviderProfiles } from '../../api/providers.js';
import { buildModelSelectOptions } from '../../services/modelCatalog.js';

const props = defineProps({
  open: { type: Boolean, default: false },
  skill: { type: Object, default: () => ({}) },
  tools: { type: Array, default: () => [] },
  mainProvider: { type: Object, default: null },
  mainModelOptions: { type: Array, default: () => [] },
  saving: { type: Boolean, default: false }
});

const emit = defineEmits(['close', 'save']);

const enabled = ref('auto');
const mode = ref('follow');
const providerProfileId = ref('');
const modelOverride = ref('');
const toolState = ref({});
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
const toolItems = computed(() => props.tools.map((tool) => ({
  ...tool,
  checked: tool.required ? true : toolState.value[tool.name] !== false && (toolState.value[tool.name] === true || tool.enabledByDefault)
})));

watch(() => props.open, (isOpen) => {
  if (!isOpen) return;
  syncFromSkill();
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

function syncFromSkill() {
  const skill = props.skill || {};
  enabled.value = skill.enabled === true ? true : skill.enabled === false ? false : 'auto';
  providerProfileId.value = String(skill.providerProfileId || '');
  modelOverride.value = String(skill.modelOverride || '');
  mode.value = providerProfileId.value ? 'custom' : 'follow';
  const nextTools = {};
  const stored = skill.tools && typeof skill.tools === 'object' ? skill.tools : {};
  for (const tool of props.tools) {
    nextTools[tool.name] = Object.prototype.hasOwnProperty.call(stored, tool.name) ? stored[tool.name] === true : Boolean(tool.enabledByDefault);
  }
  toolState.value = nextTools;
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

function toggleTool(tool) {
  if (tool.required) return;
  toolState.value = { ...toolState.value, [tool.name]: !toolItems.value.find((item) => item.name === tool.name)?.checked };
}

function submit() {
  if (props.saving) return;
  const tools = {};
  for (const item of toolItems.value) tools[item.name] = item.required ? true : item.checked;
  emit('save', {
    enabled: enabled.value,
    providerProfileId: mode.value === 'custom' ? providerProfileId.value : '',
    modelOverride: modelOverride.value,
    tools
  });
}

function requestClose() {
  if (props.saving) return;
  emit('close');
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="memory-agent-backdrop" role="presentation" @click.self="requestClose">
      <div class="memory-agent-dialog" role="dialog" aria-modal="true" aria-labelledby="memory-agent-dialog-title">
        <header>
          <div>
            <h3 id="memory-agent-dialog-title">记忆 Agent 设置</h3>
            <p>每轮回复后整理长期记忆。模型可以跟随主聊天设置，也可以单独指定。</p>
          </div>
          <button class="memory-agent-icon-button" type="button" aria-label="关闭记忆 Agent 设置" :disabled="saving" @click="requestClose">
            <X :size="18" />
          </button>
        </header>

        <div class="agent-dialog-body">
        <section>
          <h4>运行方式</h4>
          <label class="memory-agent-field">
            <span>启用状态</span>
            <select v-model="enabled" :disabled="saving">
              <option value="auto">自动（有可用模型时用模型，否则用规则提取）</option>
              <option :value="true">开启（始终尝试调用模型）</option>
              <option :value="false">关闭（仅规则提取，不调用模型）</option>
            </select>
          </label>
        </section>

        <section>
          <h4>模型来源</h4>
          <div class="memory-agent-modes" role="radiogroup" aria-label="模型来源">
            <label class="memory-agent-mode" :class="{ active: mode === 'follow' }">
              <input type="radio" name="memory-agent-mode" value="follow" :checked="mode === 'follow'" :disabled="saving" @change="setMode('follow')" />
              <span>
                <strong>跟随主聊天设置</strong>
                <small>{{ mainProviderLabel }}</small>
              </span>
            </label>
            <label class="memory-agent-mode" :class="{ active: mode === 'custom' }">
              <input type="radio" name="memory-agent-mode" value="custom" :checked="mode === 'custom'" :disabled="saving" @change="setMode('custom')" />
              <span>
                <strong>单独指定供应商配置</strong>
                <small>使用设置页保存的另一套供应商与模型，例如更便宜的整理模型。</small>
              </span>
            </label>
          </div>
          <label v-if="mode === 'custom'" class="memory-agent-field">
            <span>供应商配置</span>
            <select v-model="providerProfileId" :disabled="saving || providersLoading">
              <option v-if="!providers.length" value="">{{ providersLoading ? '加载中...' : '没有可用的供应商配置' }}</option>
              <option v-for="provider in providers" :key="provider.id" :value="provider.id">
                {{ provider.gatewayName || provider.providerType }}{{ provider.selected ? '（主聊天当前使用）' : '' }} · {{ provider.model || '未设置模型' }}
              </option>
            </select>
            <small v-if="providersError" class="memory-agent-error">{{ providersError }}</small>
          </label>
          <label class="memory-agent-field">
            <span>模型{{ mode === 'custom' ? '' : '覆盖' }}</span>
            <div class="memory-agent-model-row">
              <select v-model="modelOverride" :disabled="saving">
                <option v-for="model in modelOptions" :key="model.id || 'default'" :value="model.id">{{ model.label || model.id }}</option>
              </select>
              <button
                v-if="mode === 'custom' && providerProfileId"
                class="memory-agent-icon-button"
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
              aria-label="手动输入记忆 Agent 模型"
              :disabled="saving"
            />
            <small v-if="modelsError" class="memory-agent-error">{{ modelsError }}</small>
          </label>
        </section>

        <section>
          <h4>可调用的工具</h4>
          <p class="memory-agent-hint">关闭的工具不会提供给模型。写入类工具都受来源与版本校验保护，置顶记忆始终由你维护。</p>
          <ul class="memory-agent-tools">
            <li v-for="tool in toolItems" :key="tool.name">
              <label class="memory-agent-tool" :class="{ required: tool.required }">
                <input type="checkbox" :checked="tool.checked" :disabled="saving || tool.required" @change="toggleTool(tool)" />
                <span>
                  <strong>{{ tool.label }}<em v-if="tool.effect === 'write'">写入</em><em v-else>只读</em></strong>
                  <small>{{ tool.description }}</small>
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
