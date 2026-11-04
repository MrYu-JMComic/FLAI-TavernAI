<script setup>
import { computed, ref, watch } from 'vue';
import { RefreshCw, X } from '@lucide/vue';
import { MEMORY_AGENT_TOOLS } from '../../../../shared/memoryAgentTools.js';
import { EMBEDDING_DIMENSIONS, normalizeMemoryEmbedding, normalizeMemoryPolicy } from '../../../../shared/memoryPolicy.js';
import { THINKING_LEVELS } from '../../../../shared/providerThinking.js';
import { fetchProviderModels, listProviderProfiles } from '../../api/providers.js';
import { buildModelSelectOptions } from '../../services/modelCatalog.js';

const props = defineProps({
  open: { type: Boolean, default: false },
  skill: { type: Object, default: () => ({}) },
  tools: { type: Array, default: () => MEMORY_AGENT_TOOLS },
  mainProvider: { type: Object, default: null },
  mainModelOptions: { type: Array, default: () => [] },
  saving: { type: Boolean, default: false },
  canRestoreInheritance: { type: Boolean, default: false }
});

const emit = defineEmits(['close', 'save', 'restore-inheritance']);

const enabled = ref('auto');
const mode = ref('follow');
const providerProfileId = ref('');
const modelOverride = ref('');
const thinkingLevel = ref('');
const thinkingOptions = THINKING_LEVELS.map((value) => ({ value, label: ({ off: '关闭', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高' })[value] }));
const toolState = ref({});
const memoryPolicy = ref(normalizeMemoryPolicy());
const embedding = ref(normalizeMemoryEmbedding());
const formError = ref('');
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
const toolItems = computed(() => props.tools.filter(tool => tool.name !== 'merge_memories').map((tool) => ({
  ...tool,
  checked: tool.required ? true : toolState.value[tool.name] !== false && (toolState.value[tool.name] === true || tool.enabledByDefault)
})));

watch(() => props.open, (isOpen) => {
  if (!isOpen) return;
  syncFromSkill();
  void loadProviders();
}, { immediate: true });

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
  const level = String(skill.thinkingLevel || skill.thinking_level || '').trim().toLowerCase();
  thinkingLevel.value = THINKING_LEVELS.includes(level) ? level : '';
  mode.value = providerProfileId.value ? 'custom' : 'follow';
  const nextTools = {};
  const stored = skill.tools && typeof skill.tools === 'object' ? skill.tools : {};
  for (const tool of props.tools) {
    nextTools[tool.name] = Object.prototype.hasOwnProperty.call(stored, tool.name) ? stored[tool.name] === true : Boolean(tool.enabledByDefault);
  }
  toolState.value = nextTools;
  memoryPolicy.value = normalizeMemoryPolicy(skill.memoryPolicy);
  embedding.value = normalizeMemoryEmbedding(skill.embedding);
  formError.value = '';
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
  formError.value = '';
  if (memoryPolicy.value.isolation === 'actor' && !memoryPolicy.value.actorId.trim()) {
    formError.value = '严格角色视角需要填写当前会话中已建立的角色 ID。';
    return;
  }
  if (embedding.value.enabled && !embedding.value.providerProfileId) {
    formError.value = '请为向量检索选择独立供应商配置。';
    return;
  }
  const tools = {};
  for (const item of toolItems.value) tools[item.name] = item.required ? true : item.checked;
  // Consolidation is the single product control for the automatic merge capability.
  if (props.tools.some(tool => tool.name === 'merge_memories')) tools.merge_memories = memoryPolicy.value.autoConsolidate;
  emit('save', {
    enabled: enabled.value,
    providerProfileId: mode.value === 'custom' ? providerProfileId.value : '',
    modelOverride: modelOverride.value,
    thinkingLevel: thinkingLevel.value,
    tools,
    memoryPolicy: normalizeMemoryPolicy(memoryPolicy.value),
    embedding: normalizeMemoryEmbedding(embedding.value)
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
              <option value="auto">自动（无可用模型时使用原文连续性）</option>
              <option :value="true">开启（配置失效时先修复再生成）</option>
              <option :value="false">关闭（不提取结构化记忆）</option>
            </select>
          </label>
        </section>

        <section>
          <h4>连续性与角色视角</h4>
          <label class="memory-agent-field"><span>记忆模式</span><select v-model="memoryPolicy.mode" :disabled="saving"><option value="structured">结构化记忆</option><option value="raw">原文连续性（不执行记忆提取）</option></select></label>
          <label class="memory-agent-field"><span>同步方式</span><select v-model="memoryPolicy.syncMode" :disabled="saving"><option value="background">后台同步（可继续对话）</option><option value="blocking">下一轮等待核心记忆</option></select><small>后台同步期间保留尚未整理的近期原文；严格单角色视角仍需等待知情记录完成。</small></label>
          <label class="memory-agent-field"><span>短期连续性轮数</span><input v-model.number="memoryPolicy.shortTermTurns" type="number" min="1" max="32" step="1" :disabled="saving"><small>后台尚未完成的完整轮次最多保留 1～32 轮；达到容量时需先完成同步，不会丢弃剧情。</small></label>
          <label class="memory-agent-tool"><input v-model="memoryPolicy.autoConsolidate" type="checkbox" :disabled="saving"><span>AI 整理时自动合并压缩<small>合并兼容的重复记忆，保留来源和历史；置顶记忆由你维护。</small></span></label>
          <label class="memory-agent-tool"><input v-model="memoryPolicy.statusLink" type="checkbox" :disabled="saving"><span>记忆与状态栏联动<small>与已启用的状态栏 Agent 共享本轮证据和已验证提取结果，不会自动开启状态栏 Agent。</small></span></label>
          <label class="memory-agent-field"><span>角色视角</span><select v-model="memoryPolicy.isolation" :disabled="saving"><option value="cast">多角色叙述（软隔离）</option><option value="actor">严格单角色视角</option></select></label>
          <label v-if="memoryPolicy.isolation === 'actor'" class="memory-agent-field"><span>会话角色 ID</span><input v-model.trim="memoryPolicy.actorId" maxlength="160" :disabled="saving" placeholder="从角色认知视图复制角色 ID"><small>只有该角色有权获知的来源会进入生成上下文。</small></label>
          <label class="memory-agent-field"><span>等待核心记忆上限（毫秒）</span><input v-model.number="memoryPolicy.coreWaitMs" type="number" min="1000" max="60000" step="1000" :disabled="saving"><small>摘要和索引在后台处理，不阻挡下一轮。超时后保留输入和附件。</small></label>
          <label class="memory-agent-field"><span>未知模型窗口时的保守总预算（Token）</span><input v-model.number="memoryPolicy.unknownContextTokens" type="number" min="4096" max="262144" step="1024" :disabled="saving"></label>
          <label class="memory-agent-tool"><input v-model="memoryPolicy.summaryEnabled" type="checkbox" :disabled="saving"><span>自动生成分层摘要</span></label>
        </section>

        <section>
          <h4>向量检索</h4>
          <label class="memory-agent-tool"><input v-model="embedding.enabled" type="checkbox" :disabled="saving"><span>启用云端向量检索</span></label>
          <p class="memory-agent-hint">开启后会将选中的剧情文本发送给你配置的向量供应商。向量用于找回相关证据；关闭或服务失败时仍可使用文本与关系检索。</p>
          <template v-if="embedding.enabled">
            <label class="memory-agent-field"><span>向量供应商（独立于整理模型）</span><select v-model="embedding.providerProfileId" :disabled="saving || providersLoading"><option value="">请选择保存的供应商</option><option v-for="provider in providers" :key="provider.id" :value="provider.id">{{ provider.gatewayName || provider.providerType }}</option></select></label>
            <label class="memory-agent-field"><span>向量模型</span><input v-model.trim="embedding.model" maxlength="160" :disabled="saving"></label>
            <label class="memory-agent-field"><span>向量维度</span><select v-model.number="embedding.dimensions" :disabled="saving"><option v-for="dimension in EMBEDDING_DIMENSIONS" :key="dimension" :value="dimension">{{ dimension }}</option></select><small>模型、维度或处理模板改变后建立新索引，完成后切换。</small></label>
            <label class="memory-agent-field"><span>配额换算：1 元人民币折合美元</span><input v-model.number="embedding.quotaUsdPerCny" type="number" min="0" max="100" step="0.001" :disabled="saving"><small>实际费用按人民币记录。已有美元金额配额生效时需填写明确换算率；0 表示未配置。</small></label>
          </template>
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
          <label class="memory-agent-field">
            <span>思考等级</span>
            <select v-model="thinkingLevel" :disabled="saving">
              <option value="">跟随供应商配置</option>
              <option v-for="option in thinkingOptions" :key="option.value" :value="option.value">{{ option.label }}（{{ option.value }}）</option>
            </select>
            <small>按所选模型支持的等级生效；选择关闭会明确关闭思考。</small>
          </label>
        </section>

        <section>
          <h4>可调用的工具</h4>
          <p class="memory-agent-hint">关闭的工具不会提供给模型。修改工具先暂存提案，完整轮次通过来源与版本校验后统一提交；置顶记忆始终由你维护。</p>
          <ul class="memory-agent-tools">
            <li v-for="tool in toolItems" :key="tool.name">
              <label class="memory-agent-tool" :class="{ required: tool.required }">
                <input type="checkbox" :checked="tool.checked" :disabled="saving || tool.required" @change="toggleTool(tool)" />
                <span>
                  <strong>{{ tool.label }}<em v-if="tool.effect === 'write'">暂存提案</em><em v-else>只读</em></strong>
                  <small>{{ tool.description }}</small>
                </span>
              </label>
            </li>
          </ul>
        </section>
        </div>

        <footer>
          <p v-if="formError" class="memory-agent-error" role="alert">{{ formError }}</p>
          <button v-if="canRestoreInheritance" type="button" :disabled="saving" @click="emit('restore-inheritance')">恢复角色默认</button>
          <button type="button" :disabled="saving" @click="requestClose">取消</button>
          <button class="primary" type="button" :disabled="saving" :aria-busy="saving" @click="submit">
            {{ saving ? '保存中...' : '保存设置' }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
