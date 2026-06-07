<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { Bot, Download, Heart, MessageSquareText, Plus, RefreshCw, Save, ShieldCheck, Sliders, Tag, Trash2, Upload, WalletCards, Puzzle, GripVertical, Power, Regex, X } from '@lucide/vue';
import {
  fetchCharacters,
  createTag,
  deleteTag,
  fetchDeepSeekBalance,
  fetchTags,
  getProviderSettings,
  getUserProfile,
  saveProviderSettings,
  saveUserAvatar,
  saveUserProfile,
  fetchPresets,
  createPreset,
  updatePreset,
  deletePreset,
  setDefaultPreset,
  fetchMods,
  createMod,
  updateMod,
  deleteMod,
  reorderMods,
  fetchRegexRules,
  importRegexRuleSet,
  toggleRegexRule,
  reorderRegexRules
} from '../api';
import { useNotify } from '../composables/useNotify';
import {
  buildModelSelectOptions,
  readCachedProviderModels,
  refreshProviderModels
} from '../services/modelCatalog';

const props = defineProps({
  route: {
    type: Object,
    default: () => ({ name: 'settings' })
  },
  user: {
    type: Object,
    default: null
  }
});
const emit = defineEmits(['provider-saved', 'profile-saved']);
const notify = useNotify();
const isExtensionsPage = computed(() => props.route?.name === 'extensions');
const isPersonalPage = computed(() => !isExtensionsPage.value);

// Extension section navigation
const extensionSections = [
  { id: 'tags', label: '标签管理', icon: 'Tag' },
  { id: 'presets', label: '对话预设', icon: 'Sliders' },
  { id: 'mods', label: 'Mod 管理', icon: 'Puzzle' },
  { id: 'regex', label: '正则规则', icon: 'Regex' }
];
const activeExtensionSection = ref('tags');
const extensionNavRef = ref(null);

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
  anthropic: {
    gatewayName: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-6',
    supportsReasoning: true,
    extraBody: '{}'
  },
  xai: {
    gatewayName: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-4.1',
    supportsReasoning: true,
    extraBody: '{}'
  },
  mistral: {
    gatewayName: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-medium-3-5',
    supportsReasoning: true,
    extraBody: '{}'
  },
  qwen: {
    gatewayName: 'Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3-plus',
    supportsReasoning: true,
    extraBody: '{}'
  },
  glm: {
    gatewayName: 'Z.AI GLM',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    model: 'glm-5.1',
    supportsReasoning: true,
    extraBody: '{}'
  },
  kimi: {
    gatewayName: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2.5',
    supportsReasoning: true,
    extraBody: '{}'
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
const loadError = ref('');
const saving = ref(false);
const profileSaving = ref(false);
const avatarSaving = ref(false);
const modelLoading = ref(false);
const balanceLoading = ref(false);
const modelOptions = ref([]);
const balance = ref(null);
const settingsModelOptions = computed(() => buildModelSelectOptions(modelOptions.value, form.model));
let settingsLoadToken = 0;
let modelLoadToken = 0;
let providerSaveToken = 0;
let avatarSaveToken = 0;
let profileSaveToken = 0;
let balanceLoadToken = 0;
const profile = reactive({
  avatarUrl: props.user?.avatarUrl || '',
  accountName: props.user?.accountName || props.user?.username || '',
  displayName: props.user?.displayName || '',
  permissionLabel: props.user?.permissionLabel || '用户组',
  permissionGroup: props.user?.permissionGroup || 'user',
  isRootAdmin: Boolean(props.user?.isRootAdmin)
});
const profileStats = ref({
  ownedAiCount: 0,
  publicAiCount: 0,
  privateAiCount: 0,
  likeCount: 0,
  totalUseCount: 0,
  userCount: 0
});
const ownedCharacters = ref([]);

const canCheckBalance = computed(() => form.providerType === 'deepseek' && form.apiKeySet && !form.apiKeyNeedsReset);
const canFetchModels = computed(() => Boolean(
  form.baseUrl && (form.apiKey || form.apiKeySet || canUseNoAuthProvider())
));

watch(
  () => [form.providerType, form.gatewayName, form.baseUrl, form.supportsReasoning, form.extraBody],
  ([providerType], [previousProviderType] = []) => {
    syncCachedModelOptions();
    if (previousProviderType !== undefined && providerType !== previousProviderType) {
      resetBalanceLoadScope();
      balance.value = null;
    }
  }
);

watch(
  () => props.user,
  (value) => {
    if (!value) {
      return;
    }
    applyProfileUser(value);
  }
);

onMounted(loadSettings);
onBeforeUnmount(resetSettingsAsyncScopes);

async function loadSettings() {
  if (!isPersonalPage.value || loading.value) {
    return;
  }
  const requestToken = ++settingsLoadToken;
  loading.value = true;
  loadError.value = '';
  try {
    const [settings, userProfile] = await Promise.all([
      getProviderSettings(),
      getUserProfile()
    ]);
    if (!isCurrentSettingsLoad(requestToken)) return;
    applySettings(settings);
    applyProfile(userProfile);
  } catch (err) {
    if (!isCurrentSettingsLoad(requestToken)) return;
    const message = err?.message || '加载个人设置失败';
    loadError.value = message;
    notify.error(message);
  } finally {
    if (isCurrentSettingsLoad(requestToken)) {
      loading.value = false;
    }
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
  syncCachedModelOptions();
}

async function loadModels() {
  if (!isPersonalPage.value || modelLoading.value || !canFetchModels.value) {
    return;
  }
  const requestToken = ++modelLoadToken;
  const request = buildProviderModelRequest();
  modelLoading.value = true;
  try {
    const nextOptions = await refreshProviderModels(request, { forceRefresh: true });
    if (!isCurrentModelLoadResult(requestToken, request)) return;
    modelOptions.value = nextOptions;
    if (!modelOptions.value.length) {
      notify.info('网关没有返回可选模型，请确认 /models 接口可用。');
    } else if (!modelOptions.value.some((model) => model.id === form.model)) {
      form.model = modelOptions.value[0].id;
      notify.success(`已刷新 ${modelOptions.value.length} 个模型，并自动选择第一个。`);
    } else {
      notify.success(`已刷新 ${modelOptions.value.length} 个模型。`);
    }
  } catch (err) {
    if (!isCurrentModelLoadResult(requestToken, request)) return;
    notify.error(err.message);
  } finally {
    if (isCurrentModelLoadToken(requestToken)) {
      modelLoading.value = false;
    }
  }
}

async function submit() {
  if (!isPersonalPage.value) {
    return;
  }
  const mutationToken = ++providerSaveToken;
  const payload = buildProviderSettingsPayload();
  saving.value = true;
  try {
    const saved = await saveProviderSettings(payload);
    if (!isCurrentProviderSaveResult(mutationToken, payload)) return;
    applySettings(saved);
    notify.success('设置已保存');
    emit('provider-saved');
  } catch (err) {
    if (!isCurrentProviderSaveResult(mutationToken, payload)) return;
    notify.error(err.message);
  } finally {
    if (isCurrentProviderSaveToken(mutationToken)) {
      saving.value = false;
    }
  }
}

async function handleUserAvatar(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (input) {
    input.value = '';
  }
  if (!file || !isPersonalPage.value || avatarSaving.value) {
    return;
  }

  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    notify.warning('头像仅支持 PNG、JPG 或 WebP');
    return;
  }

  if (file.size > 2 * 1024 * 1024) {
    notify.warning('头像不能超过 2MB');
    return;
  }

  avatarSaving.value = true;
  const mutationToken = ++avatarSaveToken;
  try {
    const avatarDataUrl = await readAsDataUrl(file);
    if (!isCurrentAvatarSave(mutationToken)) return;
    const result = await saveUserAvatar({ avatarDataUrl });
    if (!isCurrentAvatarSave(mutationToken)) return;
    profile.avatarUrl = result.user?.avatarUrl || '';
    notify.success('头像已保存');
    emit('profile-saved', result.user);
  } catch (err) {
    if (!isCurrentAvatarSave(mutationToken)) return;
    notify.error(err.message);
  } finally {
    if (isCurrentAvatarSave(mutationToken)) {
      avatarSaving.value = false;
    }
  }
}

async function submitProfile() {
  if (!isPersonalPage.value) {
    return;
  }
  const mutationToken = ++profileSaveToken;
  const displayName = profile.displayName;
  profileSaving.value = true;
  try {
    const result = await saveUserProfile({
      displayName
    });
    if (!isCurrentProfileSaveResult(mutationToken, displayName)) return;
    applyProfile(result);
    notify.success('个人资料已保存');
    emit('profile-saved', result.user);
  } catch (err) {
    if (!isCurrentProfileSaveResult(mutationToken, displayName)) return;
    notify.error(err.message);
  } finally {
    if (isCurrentProfileSaveToken(mutationToken)) {
      profileSaving.value = false;
    }
  }
}

async function checkBalance() {
  if (!isPersonalPage.value || balanceLoading.value || !canCheckBalance.value) {
    return;
  }
  const requestToken = ++balanceLoadToken;
  balanceLoading.value = true;
  try {
    const nextBalance = await fetchDeepSeekBalance();
    if (!isCurrentBalanceLoadResult(requestToken)) return;
    balance.value = nextBalance;
  } catch (err) {
    if (!isCurrentBalanceLoadResult(requestToken)) return;
    notify.error(err.message);
  } finally {
    if (isCurrentBalanceLoadToken(requestToken)) {
      balanceLoading.value = false;
    }
  }
}

function isCurrentSettingsLoad(requestToken) {
  return requestToken === settingsLoadToken && isPersonalPage.value;
}

function buildProviderModelRequest() {
  return {
    providerType: form.providerType,
    gatewayName: form.gatewayName,
    baseUrl: form.baseUrl,
    model: form.model,
    apiKey: form.apiKey,
    apiKeySet: form.apiKeySet,
    supportsReasoning: form.supportsReasoning,
    extraBody: form.extraBody
  };
}

function hasSameProviderModelRequest(request) {
  return form.providerType === request.providerType
    && form.gatewayName === request.gatewayName
    && form.baseUrl === request.baseUrl
    && form.model === request.model
    && form.apiKey === request.apiKey
    && form.apiKeySet === request.apiKeySet
    && form.supportsReasoning === request.supportsReasoning
    && form.extraBody === request.extraBody;
}

function isCurrentModelLoadToken(requestToken) {
  return requestToken === modelLoadToken && isPersonalPage.value;
}

function isCurrentModelLoadResult(requestToken, request) {
  return isCurrentModelLoadToken(requestToken) && hasSameProviderModelRequest(request);
}

function buildProviderSettingsPayload() {
  return {
    providerType: form.providerType,
    gatewayName: form.gatewayName,
    baseUrl: form.baseUrl,
    model: form.model,
    apiKey: form.apiKey,
    clearApiKey: form.clearApiKey,
    supportsReasoning: form.supportsReasoning,
    extraBody: form.extraBody
  };
}

function hasSameProviderSettingsPayload(payload) {
  return form.providerType === payload.providerType
    && form.gatewayName === payload.gatewayName
    && form.baseUrl === payload.baseUrl
    && form.model === payload.model
    && form.apiKey === payload.apiKey
    && form.clearApiKey === payload.clearApiKey
    && form.supportsReasoning === payload.supportsReasoning
    && form.extraBody === payload.extraBody;
}

function isCurrentProviderSaveToken(mutationToken) {
  return mutationToken === providerSaveToken && isPersonalPage.value;
}

function isCurrentProviderSaveResult(mutationToken, payload) {
  return isCurrentProviderSaveToken(mutationToken) && hasSameProviderSettingsPayload(payload);
}

function isCurrentAvatarSave(mutationToken) {
  return mutationToken === avatarSaveToken && isPersonalPage.value;
}

function isCurrentProfileSaveToken(mutationToken) {
  return mutationToken === profileSaveToken && isPersonalPage.value;
}

function isCurrentProfileSaveResult(mutationToken, displayName) {
  return isCurrentProfileSaveToken(mutationToken) && profile.displayName === displayName;
}

function isCurrentBalanceLoadToken(requestToken) {
  return requestToken === balanceLoadToken && isPersonalPage.value;
}

function isCurrentBalanceLoadResult(requestToken) {
  return isCurrentBalanceLoadToken(requestToken) && canCheckBalance.value;
}

function resetBalanceLoadScope() {
  balanceLoadToken += 1;
  balanceLoading.value = false;
}

function resetPersonalAsyncScope() {
  settingsLoadToken += 1;
  modelLoadToken += 1;
  providerSaveToken += 1;
  avatarSaveToken += 1;
  profileSaveToken += 1;
  resetBalanceLoadScope();
  loading.value = false;
  saving.value = false;
  avatarSaving.value = false;
  profileSaving.value = false;
  modelLoading.value = false;
}

function resetSettingsAsyncScopes() {
  resetPersonalAsyncScope();
  resetExtensionAsyncScopes();
}

function applyProfile(result = {}) {
  applyProfileUser(result.user || {});
  profileStats.value = result.stats || profileStats.value;
  ownedCharacters.value = result.ownedCharacters || [];
}

function applyProfileUser(user = {}) {
  profile.avatarUrl = user.avatarUrl || profile.avatarUrl || '';
  profile.accountName = user.accountName || user.username || profile.accountName || '';
  profile.displayName = user.displayName || '';
  profile.permissionLabel = user.permissionLabel || '用户组';
  profile.permissionGroup = user.permissionGroup || 'user';
  profile.isRootAdmin = Boolean(user.isRootAdmin);
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
  syncCachedModelOptions();
}

function syncCachedModelOptions() {
  modelOptions.value = readCachedProviderModels(form);
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('头像读取失败'));
    reader.readAsDataURL(file);
  });
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function visibilityText(value) {
  return value === 'public' ? '公开' : '私有';
}

// ── Tag Management ──
function loadFailureMessage(error, fallback) {
  return error?.message || fallback;
}

function canUseNoAuthProvider() {
  return form.providerType === 'custom' && isLocalOrPrivateBaseUrl(form.baseUrl);
}

function isLocalOrPrivateBaseUrl(value) {
  try {
    const { hostname } = new URL(String(value || ''));
    const host = hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
    if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(host) || host.startsWith('127.')) {
      return true;
    }
    const parts = host.split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return false;
    }
    return (
      parts[0] === 10 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 198 && parts[1] === 18)
    );
  } catch {
    return false;
  }
}

const tagList = ref([]);
const newTagName = ref('');
const TAG_LOAD_LIMIT_DEFAULT = 80;
const TAG_LOAD_LIMIT_MAX = 500;
const TAG_LOAD_LIMIT_STORAGE_KEY = 'flai-tag-load-limit';
const tagLoadLimit = ref(readStoredTagLoadLimit());
const tagLoading = ref(false);
const tagLoadError = ref('');
const normalizedTagLoadLimit = computed(() => normalizeTagLoadLimit(tagLoadLimit.value));
let tagLoadToken = 0;
let tagMutationToken = 0;

onMounted(loadTags);

async function loadTags() {
  if (!isExtensionsPage.value || tagLoading.value) {
    return;
  }
  const requestToken = ++tagLoadToken;
  const limit = normalizedTagLoadLimit.value;
  tagLoadLimit.value = limit;
  saveStoredTagLoadLimit(limit);
  tagLoading.value = true;
  tagLoadError.value = '';
  try {
    const nextTags = await fetchTags({ limit });
    if (!isCurrentTagLoad(requestToken)) return;
    tagList.value = nextTags;
  } catch (err) {
    if (!isCurrentTagLoad(requestToken)) return;
    tagLoadError.value = loadFailureMessage(err, '标签加载失败');
  } finally {
    if (isCurrentTagLoad(requestToken)) {
      tagLoading.value = false;
    }
  }
}

function isCurrentTagLoad(requestToken) {
  return requestToken === tagLoadToken && isExtensionsPage.value;
}

function resetTagMutationScope() {
  tagMutationToken += 1;
}

function resetTagAsyncScope() {
  tagLoadToken += 1;
  tagLoading.value = false;
  resetTagMutationScope();
}

function beginTagMutation() {
  resetTagAsyncScope();
  return tagMutationToken;
}

function isCurrentTagMutation(mutationToken) {
  return mutationToken === tagMutationToken && isExtensionsPage.value;
}

function updateTagLoadLimit() {
  resetTagAsyncScope();
  tagLoadLimit.value = normalizedTagLoadLimit.value;
  saveStoredTagLoadLimit(tagLoadLimit.value);
  loadTags();
}

async function addTag() {
  const name = newTagName.value.trim();
  if (!name) return;
  const mutationToken = beginTagMutation();
  try {
    const tag = await createTag({ name });
    if (!isCurrentTagMutation(mutationToken)) return;
    tagList.value = [tag, ...tagList.value.filter((item) => item.id !== tag.id)].slice(0, normalizedTagLoadLimit.value);
    newTagName.value = '';
    notify.success(`标签「${tag.name}」已创建`);
  } catch (err) {
    if (!isCurrentTagMutation(mutationToken)) return;
    notify.error(err.message);
  }
}

function normalizeTagLoadLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit < 1) {
    return TAG_LOAD_LIMIT_DEFAULT;
  }
  return Math.min(Math.floor(limit), TAG_LOAD_LIMIT_MAX);
}

function readStoredTagLoadLimit() {
  if (typeof localStorage === 'undefined') {
    return TAG_LOAD_LIMIT_DEFAULT;
  }
  return normalizeTagLoadLimit(localStorage.getItem(TAG_LOAD_LIMIT_STORAGE_KEY));
}

function saveStoredTagLoadLimit(limit) {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(TAG_LOAD_LIMIT_STORAGE_KEY, String(limit));
}

async function removeTag(id, name) {
  if (!window.confirm(`确定删除标签「${name}」吗？关联的角色卡将失去此标签。`)) return;
  const mutationToken = beginTagMutation();
  try {
    await deleteTag(id);
    if (!isCurrentTagMutation(mutationToken)) return;
    tagList.value = tagList.value.filter((t) => t.id !== id);
    notify.success(`标签「${name}」已删除`);
  } catch (err) {
    if (!isCurrentTagMutation(mutationToken)) return;
    if (/标签不存在/.test(err.message || '')) {
      tagList.value = tagList.value.filter((t) => t.id !== id);
      notify.info(`标签「${name}」已从列表移除`);
      return;
    }
    notify.error(err.message);
  }
}

// ── Preset Management ──
const presetList = ref([]);
const presetLoading = ref(false);
const presetLoadError = ref('');
let presetLoadToken = 0;
let presetMutationToken = 0;
const presetEditing = ref(null);
const presetForm = reactive({
  name: '',
  systemPrompt: '',
  temperature: 1.0,
  maxTokens: 4096,
  topP: 1.0,
  frequencyPenalty: 0,
  presencePenalty: 0
});
const showPresetEditor = ref(false);
const presetImportText = ref('');

onMounted(loadPresets);

async function loadPresets() {
  if (!isExtensionsPage.value || presetLoading.value) {
    return;
  }
  const requestToken = ++presetLoadToken;
  presetLoading.value = true;
  presetLoadError.value = '';
  try {
    const nextPresets = await fetchPresets();
    if (!isCurrentPresetLoad(requestToken)) return;
    presetList.value = nextPresets;
  } catch (err) {
    if (!isCurrentPresetLoad(requestToken)) return;
    presetLoadError.value = loadFailureMessage(err, '预设加载失败');
  } finally {
    if (isCurrentPresetLoad(requestToken)) {
      presetLoading.value = false;
    }
  }
}

function isCurrentPresetLoad(requestToken) {
  return requestToken === presetLoadToken && isExtensionsPage.value;
}

function resetPresetMutationScope() {
  presetMutationToken += 1;
}

function resetPresetAsyncScope() {
  presetLoadToken += 1;
  presetLoading.value = false;
  resetPresetMutationScope();
}

function beginPresetMutation() {
  resetPresetAsyncScope();
  return presetMutationToken;
}

function isCurrentPresetMutation(mutationToken) {
  return mutationToken === presetMutationToken && isExtensionsPage.value;
}

function resetPresetForm() {
  Object.assign(presetForm, {
    name: '',
    systemPrompt: '',
    temperature: 1.0,
    maxTokens: 4096,
    topP: 1.0,
    frequencyPenalty: 0,
    presencePenalty: 0
  });
}

function startNewPreset() {
  resetPresetMutationScope();
  presetEditing.value = null;
  resetPresetForm();
  showPresetEditor.value = true;
}

function startEditPreset(preset) {
  resetPresetMutationScope();
  presetEditing.value = preset.id;
  Object.assign(presetForm, {
    name: preset.name,
    systemPrompt: preset.systemPrompt,
    temperature: preset.temperature,
    maxTokens: preset.maxTokens,
    topP: preset.topP,
    frequencyPenalty: preset.frequencyPenalty,
    presencePenalty: preset.presencePenalty
  });
  showPresetEditor.value = true;
}

function cancelPresetEdit() {
  resetPresetMutationScope();
  showPresetEditor.value = false;
  presetEditing.value = null;
  resetPresetForm();
}

async function savePreset() {
  const editingId = presetEditing.value;
  const mutationToken = beginPresetMutation();
  const payload = {
    name: presetForm.name,
    systemPrompt: presetForm.systemPrompt,
    temperature: Number(presetForm.temperature),
    maxTokens: Math.round(Number(presetForm.maxTokens)),
    topP: Number(presetForm.topP),
    frequencyPenalty: Number(presetForm.frequencyPenalty),
    presencePenalty: Number(presetForm.presencePenalty)
  };
  try {
    if (editingId) {
      await updatePreset(editingId, payload);
      if (!isCurrentPresetMutation(mutationToken)) return;
      notify.success('预设已更新');
    } else {
      await createPreset(payload);
      if (!isCurrentPresetMutation(mutationToken)) return;
      notify.success('预设已创建');
    }
    cancelPresetEdit();
    await loadPresets();
  } catch (err) {
    if (!isCurrentPresetMutation(mutationToken)) return;
    notify.error(err.message);
  }
}

async function removePreset(id, name) {
  if (!window.confirm(`确定删除预设「${name}」吗？`)) return;
  const mutationToken = beginPresetMutation();
  try {
    await deletePreset(id);
    if (!isCurrentPresetMutation(mutationToken)) return;
    presetList.value = presetList.value.filter((p) => p.id !== id);
    if (presetEditing.value === id) {
      cancelPresetEdit();
    }
    notify.success(`预设「${name}」已删除`);
  } catch (err) {
    if (!isCurrentPresetMutation(mutationToken)) return;
    notify.error(err.message);
  }
}

async function makeDefaultPreset(id) {
  const mutationToken = beginPresetMutation();
  try {
    await setDefaultPreset(id);
    if (!isCurrentPresetMutation(mutationToken)) return;
    await loadPresets();
    if (!isCurrentPresetMutation(mutationToken)) return;
    notify.success('已设为默认预设');
  } catch (err) {
    if (!isCurrentPresetMutation(mutationToken)) return;
    notify.error(err.message);
  }
}

function exportPresets() {
  const data = JSON.stringify(presetList.value, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `flai-presets-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  notify.success('预设已导出');
}

async function importPresets(mutationToken = beginPresetMutation()) {
  try {
    const parsed = JSON.parse(presetImportText.value);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    let imported = 0;
    for (const item of items) {
      if (!item.name) continue;
      await createPreset({
        name: item.name,
        systemPrompt: item.systemPrompt || '',
        temperature: item.temperature,
        maxTokens: item.maxTokens,
        topP: item.topP,
        frequencyPenalty: item.frequencyPenalty,
        presencePenalty: item.presencePenalty
      });
      if (!isCurrentPresetMutation(mutationToken)) return;
      imported++;
    }
    if (!isCurrentPresetMutation(mutationToken)) return;
    presetImportText.value = '';
    await loadPresets();
    if (!isCurrentPresetMutation(mutationToken)) return;
    notify.success(`已导入 ${imported} 个预设`);
  } catch (err) {
    if (!isCurrentPresetMutation(mutationToken)) return;
    notify.error('导入失败：JSON 格式不正确');
  }
}

function handlePresetImportFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  const mutationToken = beginPresetMutation();
  reader.onload = async () => {
    if (!isCurrentPresetMutation(mutationToken)) return;
    presetImportText.value = String(reader.result || '');
    await importPresets(mutationToken);
  };
  reader.onerror = () => {
    if (!isCurrentPresetMutation(mutationToken)) return;
    notify.error('导入失败：文件读取失败');
  };
  reader.readAsText(file);
}

// ── Mod Management ──
const modList = ref([]);
const modLoading = ref(false);
const modLoadError = ref('');
let modLoadToken = 0;
let modMutationToken = 0;
const modCharacterOptions = ref([]);
const modCharactersLoading = ref(false);
const modCharactersLoadError = ref('');
let modCharactersLoadToken = 0;
const showModEditor = ref(false);
const modEditing = ref(null);
const modForm = reactive({
  name: '',
  description: '',
  type: 'prompt_inject',
  content: '',
  enabled: true,
  scope: 'global',
  characterIds: []
});
const draggingMod = ref(null);
const dragOverMod = ref(null);

onMounted(loadMods);
onMounted(loadModCharacterOptions);

async function loadMods() {
  if (!isExtensionsPage.value || modLoading.value) {
    return;
  }
  const requestToken = ++modLoadToken;
  modLoading.value = true;
  modLoadError.value = '';
  try {
    const nextMods = await fetchMods();
    if (!isCurrentModLoad(requestToken)) return;
    modList.value = nextMods;
  } catch (err) {
    if (!isCurrentModLoad(requestToken)) return;
    modLoadError.value = loadFailureMessage(err, 'Mod 加载失败');
  } finally {
    if (isCurrentModLoad(requestToken)) {
      modLoading.value = false;
    }
  }
}

function isCurrentModLoad(requestToken) {
  return requestToken === modLoadToken && isExtensionsPage.value;
}

async function loadModCharacterOptions() {
  if (!isExtensionsPage.value || modCharactersLoading.value) {
    return;
  }
  const requestToken = ++modCharactersLoadToken;
  modCharactersLoading.value = true;
  modCharactersLoadError.value = '';
  try {
    const characters = await fetchCharacters({ sort: 'name' });
    if (!isCurrentModCharacterLoad(requestToken)) return;
    modCharacterOptions.value = Array.isArray(characters)
      ? characters.filter((character) => character?.canUse !== false)
      : [];
  } catch (err) {
    if (!isCurrentModCharacterLoad(requestToken)) return;
    modCharactersLoadError.value = loadFailureMessage(err, '角色加载失败');
  } finally {
    if (isCurrentModCharacterLoad(requestToken)) {
      modCharactersLoading.value = false;
    }
  }
}

function isCurrentModCharacterLoad(requestToken) {
  return requestToken === modCharactersLoadToken && isExtensionsPage.value;
}

function resetModMutationScope() {
  modMutationToken += 1;
  draggingMod.value = null;
  dragOverMod.value = null;
}

function resetModAsyncScope() {
  modLoadToken += 1;
  modLoading.value = false;
  resetModMutationScope();
}

function resetModCharacterLoadScope() {
  modCharactersLoadToken += 1;
  modCharactersLoading.value = false;
}

function beginModMutation() {
  resetModAsyncScope();
  return modMutationToken;
}

function isCurrentModMutation(mutationToken) {
  return mutationToken === modMutationToken && isExtensionsPage.value;
}

function resetModForm() {
  Object.assign(modForm, {
    name: '',
    description: '',
    type: 'prompt_inject',
    content: '',
    enabled: true,
    scope: 'global',
    characterIds: []
  });
}

function closeModEditor() {
  showModEditor.value = false;
  modEditing.value = null;
  resetModForm();
}

function startNewMod() {
  resetModAsyncScope();
  modEditing.value = null;
  resetModForm();
  showModEditor.value = true;
}

function startEditMod(mod) {
  resetModAsyncScope();
  modEditing.value = mod.id;
  Object.assign(modForm, {
    name: mod.name,
    description: mod.description,
    type: mod.type,
    content: mod.content,
    enabled: mod.enabled,
    scope: normalizeModScope(mod.scope, mod.characterIds),
    characterIds: normalizeModCharacterIds(mod.characterIds)
  });
  showModEditor.value = true;
}

function cancelModEdit() {
  resetModAsyncScope();
  closeModEditor();
}

async function saveMod() {
  const editingId = modEditing.value;
  const scope = normalizeModScope(modForm.scope, modForm.characterIds);
  const characterIds = scope === 'characters' ? normalizeModCharacterIds(modForm.characterIds) : [];
  if (scope === 'characters' && !characterIds.length) {
    notify.warning('请至少绑定一个角色');
    return;
  }
  const mutationToken = beginModMutation();
  const payload = {
    name: modForm.name,
    description: modForm.description,
    type: modForm.type,
    content: modForm.content,
    enabled: modForm.enabled,
    scope,
    characterIds
  };
  try {
    if (editingId) {
      await updateMod(editingId, payload);
      if (!isCurrentModMutation(mutationToken)) return;
      closeModEditor();
      await loadMods();
      if (!isCurrentModMutation(mutationToken)) return;
      notify.success('Mod 已更新');
    } else {
      await createMod(payload);
      if (!isCurrentModMutation(mutationToken)) return;
      closeModEditor();
      await loadMods();
      if (!isCurrentModMutation(mutationToken)) return;
      notify.success('Mod 已创建');
    }
  } catch (err) {
    if (!isCurrentModMutation(mutationToken)) return;
    notify.error(err.message);
  }
}

async function removeMod(id, name) {
  if (!window.confirm(`确定删除 Mod「${name}」吗？`)) return;
  const mutationToken = beginModMutation();
  try {
    await deleteMod(id);
    if (!isCurrentModMutation(mutationToken)) return;
    modList.value = modList.value.filter((m) => m.id !== id);
    if (modEditing.value === id) {
      closeModEditor();
    }
    notify.success(`Mod「${name}」已删除`);
  } catch (err) {
    if (!isCurrentModMutation(mutationToken)) return;
    notify.error(err.message);
  }
}

async function toggleMod(mod) {
  const mutationToken = beginModMutation();
  const nextEnabled = !mod.enabled;
  try {
    await updateMod(mod.id, { enabled: nextEnabled });
    if (!isCurrentModMutation(mutationToken)) return;
    const currentMod = modList.value.find((item) => item.id === mod.id);
    if (!currentMod) return;
    currentMod.enabled = nextEnabled;
    notify.success(nextEnabled ? `Mod「${mod.name}」已启用` : `Mod「${mod.name}」已禁用`);
  } catch (err) {
    if (!isCurrentModMutation(mutationToken)) return;
    notify.error(err.message);
  }
}

function normalizeModScope(scope, characterIds = []) {
  const value = String(scope || '').trim();
  if (['global', 'all_characters', 'characters'].includes(value)) {
    return value;
  }
  return normalizeModCharacterIds(characterIds).length ? 'characters' : 'global';
}

function normalizeModCharacterIds(ids = []) {
  const seen = new Set();
  const normalized = [];
  for (const rawId of Array.isArray(ids) ? ids : []) {
    const id = String(rawId || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

function selectAllModCharacters() {
  modForm.characterIds = modCharacterOptions.value.map((character) => character.id);
}

function clearModCharacters() {
  modForm.characterIds = [];
}

function modScopeLabel(mod) {
  const scope = normalizeModScope(mod.scope, mod.characterIds);
  if (scope === 'all_characters') {
    return '全角色加载';
  }
  if (scope === 'characters') {
    const count = normalizeModCharacterIds(mod.characterIds).length;
    return count ? `绑定 ${count} 个角色` : '未绑定角色';
  }
  return '全局加载';
}

function onModDragStart(event, mod) {
  draggingMod.value = mod.id;
  event.dataTransfer.effectAllowed = 'move';
}

function onModDragOver(event, mod) {
  event.preventDefault();
  dragOverMod.value = mod.id;
}

function onModDragEnd() {
  draggingMod.value = null;
  dragOverMod.value = null;
}

async function onModDrop(event, targetMod) {
  event.preventDefault();
  const draggedId = draggingMod.value;
  if (!draggedId || draggedId === targetMod.id) {
    dragOverMod.value = null;
    return;
  }

  const mutationToken = beginModMutation();
  const previousList = [...modList.value];
  const fromIndex = modList.value.findIndex((m) => m.id === draggedId);
  const toIndex = modList.value.findIndex((m) => m.id === targetMod.id);
  if (fromIndex === -1 || toIndex === -1) return;

  const newList = [...modList.value];
  const [moved] = newList.splice(fromIndex, 1);
  newList.splice(toIndex, 0, moved);
  modList.value = newList;
  dragOverMod.value = null;

  try {
    await reorderMods(newList.map((m) => m.id));
    if (!isCurrentModMutation(mutationToken)) return;
  } catch (err) {
    if (!isCurrentModMutation(mutationToken)) return;
    modList.value = previousList;
    notify.error(err.message);
    await loadMods();
  }
}

function modTypeLabel(type) {
  return {
    prompt_inject: '提示词注入',
    style_enhance: '文风增强',
    custom: '自定义'
  }[type] || type;
}

function modTypeColor(type) {
  return {
    prompt_inject: '#4f8cff',
    style_enhance: '#a855f7',
    custom: '#10b981'
  }[type] || '#888';
}

// ── Regex Rules Management ──
const regexRules = ref([]);
const regexLoading = ref(false);
const regexLoadError = ref('');
const regexGroupFilter = ref('');
const regexImportText = ref('');
const showRegexImport = ref(false);
const dragIndex = ref(-1);
let regexLoadToken = 0;
let regexMutationToken = 0;

onMounted(loadRegexRules);

watch(isExtensionsPage, handleExtensionsPageChange);

function handleExtensionsPageChange(value) {
  resetSettingsAsyncScopes();
  if (!value) {
    loadSettings();
    return;
  }
  loadTags();
  loadPresets();
  loadMods();
  loadModCharacterOptions();
  loadRegexRules();
}

function resetExtensionAsyncScopes() {
  resetTagAsyncScope();
  resetPresetAsyncScope();
  resetModAsyncScope();
  resetModCharacterLoadScope();
  resetRegexAsyncScope();
}

async function loadRegexRules() {
  if (!isExtensionsPage.value || regexLoading.value) {
    return;
  }
  const groupFilter = regexGroupFilter.value;
  const requestToken = ++regexLoadToken;
  regexLoading.value = true;
  regexLoadError.value = '';
  try {
    const nextRules = await fetchRegexRules(groupFilter);
    if (!isCurrentRegexLoad(requestToken, groupFilter)) return;
    regexRules.value = nextRules;
  } catch (err) {
    if (!isCurrentRegexLoad(requestToken, groupFilter)) return;
    regexLoadError.value = loadFailureMessage(err, '正则规则加载失败');
  } finally {
    if (isCurrentRegexLoad(requestToken, groupFilter)) {
      regexLoading.value = false;
    }
  }
}

function isCurrentRegexLoad(requestToken, groupFilter) {
  return requestToken === regexLoadToken
    && isExtensionsPage.value
    && regexGroupFilter.value === groupFilter;
}

function resetRegexAsyncScope() {
  regexLoadToken += 1;
  regexLoading.value = false;
  resetRegexMutationScope();
}

function resetRegexMutationScope() {
  regexMutationToken += 1;
  dragIndex.value = -1;
}

function isCurrentRegexMutation(mutationToken, groupFilter) {
  return mutationToken === regexMutationToken
    && isExtensionsPage.value
    && regexGroupFilter.value === groupFilter;
}

function handleRegexGroupFilterChange() {
  resetRegexMutationScope();
  loadRegexRules();
}

async function handleToggleRegexRule(ruleId) {
  const groupFilter = regexGroupFilter.value;
  const mutationToken = regexMutationToken;
  try {
    await toggleRegexRule(ruleId);
    if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
    await loadRegexRules();
    if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
    notify.success('规则状态已切换');
  } catch (err) {
    if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
    notify.error(err.message);
  }
}

function onRegexDragStart(index) {
  dragIndex.value = index;
}

function onRegexDragOver(event) {
  event.preventDefault();
}

async function onRegexDrop(dropIndex) {
  if (dragIndex.value < 0 || dragIndex.value === dropIndex) return;
  const groupFilter = regexGroupFilter.value;
  const mutationToken = regexMutationToken;
  const items = [...regexRules.value];
  const [moved] = items.splice(dragIndex.value, 1);
  items.splice(dropIndex, 0, moved);
  regexRules.value = items;
  dragIndex.value = -1;
  try {
    await reorderRegexRules(items.map((r) => r.id), groupFilter);
    if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
    notify.success('排序已保存');
  } catch (err) {
    if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
    notify.error(err.message);
    await loadRegexRules();
  }
}

const regexGroups = computed(() => {
  const groups = new Set();
  regexRules.value.forEach((r) => groups.add(r.groupName || '全局'));
  return [...groups].sort();
});

function exportRegexRules() {
  const data = JSON.stringify(regexRules.value, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `flai-regex-rules-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  notify.success('正则规则已导出');
}

async function importRegexRules(mutationToken = regexMutationToken, groupFilter = regexGroupFilter.value) {
  try {
    const parsed = JSON.parse(regexImportText.value);
    const result = await importRegexRuleSet(Array.isArray(parsed) ? { rules: parsed } : parsed);
    if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
    const imported = result.imported || 0;
    regexImportText.value = '';
    showRegexImport.value = false;
    await loadRegexRules();
    if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
    if (result.skipped?.length) {
      notify.warning(`已跳过 ${result.skipped.length} 条无效或无权限规则`);
    }
    notify.success(`已导入 ${imported} 条规则`);
  } catch (err) {
    if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
    notify.error('导入失败：JSON 格式不正确');
  }
}

function handleRegexImportFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  const groupFilter = regexGroupFilter.value;
  const mutationToken = ++regexMutationToken;
  reader.onload = () => {
    if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
    regexImportText.value = String(reader.result || '');
    importRegexRules(mutationToken, groupFilter);
  };
  reader.onerror = () => {
    if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
    notify.error('导入失败：文件读取失败');
  };
  reader.readAsText(file);
}

function setActiveExtensionSection(sectionId) {
  if (!extensionSections.some((section) => section.id === sectionId)) {
    return;
  }
  activeExtensionSection.value = sectionId;
}

function scrollActiveExtensionTab(sectionId) {
  const nav = extensionNavRef.value;
  const tab = nav?.querySelector(`[data-section-id="${sectionId}"]`);
  if (!tab) {
    return;
  }
  tab.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
}

function scrollToSection(sectionId) {
  setActiveExtensionSection(sectionId);
  scrollActiveExtensionTab(sectionId);
  const el = document.getElementById(`extension-section-${sectionId}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
</script>

<template>
  <section class="page-stack" :class="isExtensionsPage ? 'extensions-page' : 'narrow-page'">
    <div class="section-heading">
      <div>
        <p>{{ isExtensionsPage ? '扩展管理' : '个人中心' }}</p>
        <h1>{{ isExtensionsPage ? '标签、预设、Mod 与正则' : '账户、权限与 AI 资产' }}</h1>
      </div>
    </div>

    <!-- Extension Section Navigation -->
    <nav v-if="isExtensionsPage" ref="extensionNavRef" class="form-section-nav extension-section-nav">
      <button
        v-for="section in extensionSections"
        :key="section.id"
        class="form-section-tab"
        :class="{ active: activeExtensionSection === section.id }"
        :data-section-id="section.id"
        type="button"
        @click="scrollToSection(section.id)"
      >
        {{ section.label }}
      </button>
    </nav>

    <p v-if="isPersonalPage && !loading && !loadError && form.apiKeyNeedsReset" class="error-text">
      已保存的 API Key 无法解密。请重新粘贴 SK 并保存设置，之后再获取模型或查询余额。
    </p>
    <p v-if="isPersonalPage && loading" class="muted-text" aria-live="polite">正在加载设置...</p>

    <section v-if="isPersonalPage && loadError" class="form-panel empty-state error-state" role="alert">
      <h2>设置加载失败</h2>
      <p>{{ loadError }}</p>
      <button class="ghost-button" type="button" :disabled="loading" @click="loadSettings">
        <RefreshCw :size="17" />
        <span>{{ loading ? '重试中...' : '重试' }}</span>
      </button>
    </section>

    <section v-if="isPersonalPage && !loading && !loadError" class="form-panel profile-panel">
      <div class="inline-heading">
        <div>
          <h2>个人资料</h2>
        </div>
      </div>

      <div class="profile-layout">
        <div class="avatar-editor compact-avatar-editor">
          <div class="large-avatar">
            <img v-if="profile.avatarUrl" :src="profile.avatarUrl" :alt="profile.accountName || '用户头像'" />
            <span v-else>{{ (profile.displayName || profile.accountName || 'U').slice(0, 1) }}</span>
          </div>
          <label class="file-button" :class="{ disabled: avatarSaving }">
            <Upload :size="18" />
            <span>{{ avatarSaving ? '保存中...' : '上传头像' }}</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              :disabled="avatarSaving"
              @change="handleUserAvatar"
            />
          </label>
        </div>

        <form class="profile-form" @submit.prevent="submitProfile">
          <label class="field">
            <span>账户名</span>
            <strong class="readonly-value">{{ profile.accountName }}</strong>
          </label>
          <label class="field">
            <span>对话用户名</span>
            <input
              v-model.trim="profile.displayName"
              maxlength="8"
              placeholder="可选，最多 8 个字符"
            />
          </label>
          <div class="profile-meta-row">
            <span class="permission-chip strong">
              <ShieldCheck :size="16" />
              {{ profile.permissionLabel }}
            </span>
            <small>支持真管理员、管理员组、用户组、游客组。</small>
          </div>
          <div class="form-actions">
            <button class="primary-button" type="submit" :disabled="profileSaving">
              <Save :size="18" />
              <span>{{ profileSaving ? '保存中...' : '保存个人资料' }}</span>
            </button>
          </div>
        </form>
      </div>

      <div class="profile-stats-grid">
        <div class="profile-stat-card">
          <Bot :size="18" />
          <span>拥有 AI</span>
          <strong>{{ formatNumber(profileStats.ownedAiCount) }}</strong>
        </div>
        <div class="profile-stat-card">
          <Heart :size="18" />
          <span>获得点赞</span>
          <strong>{{ formatNumber(profileStats.likeCount) }}</strong>
        </div>
        <div class="profile-stat-card">
          <MessageSquareText :size="18" />
          <span>使用次数</span>
          <strong>{{ formatNumber(profileStats.totalUseCount) }}</strong>
        </div>
      </div>

      <div class="owned-ai-list">
        <div class="inline-heading">
          <div>
            <h2>我的 AI</h2>
            <p>公开 {{ formatNumber(profileStats.publicAiCount) }} · 私有 {{ formatNumber(profileStats.privateAiCount) }}</p>
          </div>
        </div>
        <div v-if="ownedCharacters.length" class="owned-ai-rows">
          <div v-for="character in ownedCharacters" :key="character.id" class="owned-ai-row">
            <div class="character-avatar small">
              <img v-if="character.avatarUrl" :src="character.avatarUrl" :alt="character.name" />
              <span v-else>{{ character.name.slice(0, 1) }}</span>
            </div>
            <div>
              <strong>{{ character.name }}</strong>
              <small>{{ visibilityText(character.visibility) }} · 使用 {{ formatNumber(character.useCount) }} · 点赞 {{ formatNumber(character.likeCount) }}</small>
            </div>
          </div>
        </div>
        <p v-else class="muted-text">还没有拥有的 AI。</p>
      </div>
    </section>

    <form v-if="isPersonalPage && !loading && !loadError" class="form-panel" @submit.prevent="submit">
      <div class="inline-heading">
        <div>
          <h2>AI 供应商设置</h2>
          <p>配置 SK、网关和模型列表。</p>
        </div>
      </div>
      <div class="form-grid two-col">
        <label class="field">
          <span>供应商</span>
          <select v-model="form.providerType" @change="applyPreset">
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
          <input v-model.trim="form.gatewayName" />
        </label>
        <label class="field">
          <span>Base URL</span>
          <input v-model.trim="form.baseUrl" placeholder="https://api.example.com/v1" required />
        </label>
        <div class="field model-field">
          <span>模型</span>
          <div class="model-picker">
            <select v-model="form.model" required aria-label="模型">
              <option v-if="!settingsModelOptions.length" value="" disabled>
                请先获取模型列表
              </option>
              <option v-for="model in settingsModelOptions" :key="model.id" :value="model.id">
                {{ model.label || model.id }}
              </option>
            </select>
            <button class="ghost-button compact-button" type="button" :disabled="!canFetchModels || modelLoading" @click="loadModels">
              <RefreshCw :size="17" />
              <span>{{ modelLoading ? '刷新中' : '刷新模型' }}</span>
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

    <!-- Tags Section -->
    <section v-if="isExtensionsPage" id="extension-section-tags" class="form-panel tag-management-panel form-section-group">
      <div class="inline-heading">
        <div>
          <h2>标签管理</h2>
          <p>创建和管理角色卡标签，支持按标签筛选。</p>
        </div>
        <Tag :size="20" />
      </div>
      <div class="tag-toolbar-row">
        <div class="tag-add-row">
        <input v-model="newTagName" placeholder="新标签名称" maxlength="30" aria-label="新标签名称" @keyup.enter="addTag" />
        <button class="ghost-button" type="button" :disabled="!newTagName.trim()" @click="addTag">
          <Plus :size="17" />
          <span>添加</span>
        </button>
        </div>
        <label class="tag-load-limit-field">
          <span>最多加载</span>
          <input
            v-model.number="tagLoadLimit"
            type="number"
            min="1"
            max="500"
            step="1"
            aria-label="标签最多加载数量"
            @change="updateTagLoadLimit"
            @keyup.enter="updateTagLoadLimit"
          />
        </label>
      </div>
      <p v-if="tagList.length" class="tag-load-summary" aria-live="polite">
        当前显示 {{ tagList.length }} / {{ normalizedTagLoadLimit }} 个标签
      </p>
      <p v-if="tagLoading" class="muted-text" aria-live="polite">正在加载标签...</p>
      <div v-if="tagLoadError" class="section-load-status error-state" role="alert">
        <span>{{ tagLoadError }}</span>
        <button class="ghost-button compact-button" type="button" :disabled="tagLoading" @click="loadTags">
          <RefreshCw :size="17" />
          <span>{{ tagLoading ? '重试中...' : '重试' }}</span>
        </button>
      </div>
      <div v-if="tagList.length" class="tag-manage-cloud">
        <div v-for="tag in tagList" :key="tag.id" class="tag-manage-bubble">
          <span class="tag-badge" :style="tag.color ? { '--tag-color': tag.color } : {}">{{ tag.name }}</span>
          <span class="tag-usage">{{ tag.usageCount || 0 }} 个角色</span>
          <button
            class="icon-button danger"
            type="button"
            title="删除标签"
            :aria-label="`删除标签：${tag.name}`"
            @click="removeTag(tag.id, tag.name)"
          >
            <Trash2 :size="16" />
          </button>
        </div>
      </div>
      <p v-else-if="!tagLoading && !tagLoadError" class="muted-text">还没有标签，在角色卡编辑页或这里创建。</p>
    </section>

    <!-- Presets Section -->
    <section v-if="isExtensionsPage" id="extension-section-presets" class="form-panel preset-management-panel form-section-group">
      <div class="inline-heading">
        <div>
          <h2>对话预设</h2>
          <p>管理对话参数预设，可设置系统提示词和生成参数。选择预设后在聊天时自动生效。</p>
        </div>
        <Sliders :size="20" />
      </div>
      <div class="preset-actions-row">
        <button class="ghost-button" type="button" @click="startNewPreset">
          <Plus :size="17" />
          <span>新建预设</span>
        </button>
        <button class="ghost-button" type="button" @click="exportPresets" :disabled="!presetList.length">
          <Download :size="17" />
          <span>导出</span>
        </button>
        <label class="ghost-button file-import-button">
          <Upload :size="17" />
          <span>导入</span>
          <input type="file" accept=".json" @change="handlePresetImportFile" />
        </label>
      </div>
      <p v-if="presetLoading" class="muted-text" aria-live="polite">正在加载预设...</p>
      <div v-if="presetLoadError" class="section-load-status error-state" role="alert">
        <span>{{ presetLoadError }}</span>
        <button class="ghost-button compact-button" type="button" :disabled="presetLoading" @click="loadPresets">
          <RefreshCw :size="17" />
          <span>{{ presetLoading ? '重试中...' : '重试' }}</span>
        </button>
      </div>

      <!-- Preset Editor -->
      <form v-if="showPresetEditor" class="preset-editor" @submit.prevent="savePreset">
        <h3>{{ presetEditing ? '编辑预设' : '新建预设' }}</h3>
        <label class="field">
          <span>预设名称</span>
          <input v-model.trim="presetForm.name" placeholder="如：创意写作、精确回答" maxlength="80" required />
        </label>
        <label class="field">
          <span>系统提示词</span>
          <textarea v-model="presetForm.systemPrompt" rows="4" placeholder="可选，会作为额外的 system 消息发送给模型" />
        </label>
        <div class="form-grid two-col">
          <label class="field">
            <span>Temperature ({{ presetForm.temperature }})</span>
            <input v-model.number="presetForm.temperature" type="range" min="0" max="2" step="0.1" />
          </label>
          <label class="field">
            <span>Max Tokens</span>
            <input v-model.number="presetForm.maxTokens" type="number" min="1" max="128000" step="1" />
          </label>
          <label class="field">
            <span>Top P ({{ presetForm.topP }})</span>
            <input v-model.number="presetForm.topP" type="range" min="0" max="1" step="0.05" />
          </label>
          <label class="field">
            <span>Frequency Penalty ({{ presetForm.frequencyPenalty }})</span>
            <input v-model.number="presetForm.frequencyPenalty" type="range" min="-2" max="2" step="0.1" />
          </label>
          <label class="field">
            <span>Presence Penalty ({{ presetForm.presencePenalty }})</span>
            <input v-model.number="presetForm.presencePenalty" type="range" min="-2" max="2" step="0.1" />
          </label>
        </div>
        <div class="form-actions">
          <button class="primary-button" type="submit">
            <Save :size="18" />
            <span>{{ presetEditing ? '保存修改' : '创建预设' }}</span>
          </button>
          <button class="ghost-button" type="button" @click="cancelPresetEdit">
            取消
          </button>
        </div>
      </form>

      <!-- Preset List -->
      <div v-if="presetList.length" class="preset-card-list">
        <div v-for="preset in presetList" :key="preset.id" class="preset-card" :class="{ 'is-default': preset.isDefault }">
          <div class="preset-card-header">
            <strong>{{ preset.name }}</strong>
            <span v-if="preset.isDefault" class="default-badge">默认</span>
          </div>
          <div class="preset-card-params">
            <small>T={{ preset.temperature }} · max={{ preset.maxTokens }} · topP={{ preset.topP }}</small>
          </div>
          <p v-if="preset.systemPrompt" class="preset-card-prompt">{{ preset.systemPrompt.slice(0, 100) }}{{ preset.systemPrompt.length > 100 ? '...' : '' }}</p>
          <div class="preset-card-actions">
            <button class="icon-button" type="button" title="编辑" :aria-label="`编辑预设：${preset.name}`" @click="startEditPreset(preset)">
              <Sliders :size="16" />
            </button>
            <button
              v-if="!preset.isDefault"
              class="icon-button"
              type="button"
              title="设为默认"
              :aria-label="`设为默认预设：${preset.name}`"
              @click="makeDefaultPreset(preset.id)"
            >
              <Save :size="16" />
            </button>
            <button
              class="icon-button danger"
              type="button"
              title="删除"
              :aria-label="`删除预设：${preset.name}`"
              @click="removePreset(preset.id, preset.name)"
            >
              <Trash2 :size="16" />
            </button>
          </div>
        </div>
      </div>
      <p v-else-if="!presetLoading && !presetLoadError" class="muted-text">还没有预设，点击「新建预设」创建第一个。</p>
    </section>

    <!-- Mods Section -->
    <section v-if="isExtensionsPage" id="extension-section-mods" class="form-panel mod-management-panel form-section-group">
      <div class="inline-heading">
        <div>
          <h2>Mod 管理</h2>
          <p>管理聊天 Mod，可注入提示词、增强文风或自定义指令。启用的 Mod 会在聊天时自动生效。</p>
        </div>
        <Puzzle :size="20" />
      </div>
      <div class="preset-actions-row">
        <button class="ghost-button" type="button" @click="startNewMod">
          <Plus :size="17" />
          <span>新建 Mod</span>
        </button>
      </div>
      <p v-if="modLoading" class="muted-text" aria-live="polite">正在加载 Mod...</p>
      <div v-if="modLoadError" class="section-load-status error-state" role="alert">
        <span>{{ modLoadError }}</span>
        <button class="ghost-button compact-button" type="button" :disabled="modLoading" @click="loadMods">
          <RefreshCw :size="17" />
          <span>{{ modLoading ? '重试中...' : '重试' }}</span>
        </button>
      </div>

      <!-- Mod Editor -->
      <Teleport to="body">
        <div v-if="showModEditor" class="mod-editor-overlay" @click.self="cancelModEdit">
          <form class="preset-editor mod-editor-modal" role="dialog" aria-modal="true" @submit.prevent="saveMod" @keydown.esc.prevent="cancelModEdit">
            <div class="mod-editor-header">
              <div>
                <span>Mod</span>
                <h3>{{ modEditing ? '编辑 Mod' : '新建 Mod' }}</h3>
              </div>
              <button class="icon-button" type="button" title="关闭" aria-label="关闭 Mod 编辑器" @click="cancelModEdit">
                <X :size="17" />
              </button>
            </div>
            <div class="mod-editor-body">
              <div class="form-grid two-col">
                <label class="field">
                  <span>Mod 名称</span>
                  <input v-model.trim="modForm.name" placeholder="如：文风增强、世界观注入" maxlength="80" required />
                </label>
                <label class="field">
                  <span>类型</span>
                  <select v-model="modForm.type">
                    <option value="prompt_inject">提示词注入</option>
                    <option value="style_enhance">文风增强</option>
                    <option value="custom">自定义</option>
                  </select>
                </label>
              </div>
              <label class="field">
                <span>描述</span>
                <input v-model.trim="modForm.description" placeholder="可选，简要描述此 Mod 的作用" maxlength="200" />
              </label>
              <label class="field">
                <span>内容</span>
                <textarea v-model="modForm.content" rows="8" placeholder="输入要注入的提示词或文风要求..." required />
              </label>
              <div class="field mod-scope-field">
                <span>加载范围</span>
                <div class="mod-scope-grid" role="radiogroup" aria-label="Mod 加载范围">
                  <label class="mod-scope-option" :class="{ active: modForm.scope === 'global' }">
                    <input v-model="modForm.scope" type="radio" value="global" aria-describedby="mod-scope-global-desc" />
                    <span class="mod-scope-text">
                      <strong>全局加载</strong>
                      <small id="mod-scope-global-desc">所有聊天都会注入，适合通用规则。</small>
                    </span>
                  </label>
                  <label class="mod-scope-option" :class="{ active: modForm.scope === 'all_characters' }">
                    <input v-model="modForm.scope" type="radio" value="all_characters" aria-describedby="mod-scope-all-desc" />
                    <span class="mod-scope-text">
                      <strong>全角色加载</strong>
                      <small id="mod-scope-all-desc">所有角色卡聊天生效，不影响无角色场景。</small>
                    </span>
                  </label>
                  <label class="mod-scope-option" :class="{ active: modForm.scope === 'characters' }">
                    <input v-model="modForm.scope" type="radio" value="characters" aria-describedby="mod-scope-characters-desc" />
                    <span class="mod-scope-text">
                      <strong>指定角色</strong>
                      <small id="mod-scope-characters-desc">只对下方绑定的角色生效。</small>
                    </span>
                  </label>
                </div>
              </div>
              <div v-if="modForm.scope === 'characters'" class="mod-character-picker">
                <div class="mod-character-tools">
                  <span>绑定角色 · {{ modForm.characterIds.length }}</span>
                  <div class="mod-character-actions">
                    <button class="ghost-button compact-button" type="button" :disabled="!modCharacterOptions.length" @click="selectAllModCharacters">
                      全选
                    </button>
                    <button class="ghost-button compact-button" type="button" :disabled="!modForm.characterIds.length" @click="clearModCharacters">
                      清空
                    </button>
                  </div>
                </div>
                <p v-if="modCharactersLoading" class="muted-text" aria-live="polite">正在加载角色...</p>
                <div v-if="modCharactersLoadError" class="section-load-status error-state" role="alert">
                  <span>{{ modCharactersLoadError }}</span>
                  <button class="ghost-button compact-button" type="button" :disabled="modCharactersLoading" @click="loadModCharacterOptions">
                    <RefreshCw :size="17" />
                    <span>{{ modCharactersLoading ? '重试中...' : '重试' }}</span>
                  </button>
                </div>
                <div v-if="modCharacterOptions.length" class="mod-character-list">
                  <label v-for="character in modCharacterOptions" :key="character.id" class="mod-character-option">
                    <input v-model="modForm.characterIds" type="checkbox" :value="character.id" />
                    <span>{{ character.name }}</span>
                    <small>{{ visibilityText(character.visibility) }}</small>
                  </label>
                </div>
                <p v-else-if="!modCharactersLoading && !modCharactersLoadError" class="muted-text">暂无可绑定角色</p>
              </div>
              <label class="checkbox-line">
                <input v-model="modForm.enabled" type="checkbox" />
                <span>启用此 Mod</span>
              </label>
            </div>
            <div class="form-actions mod-editor-actions">
              <button class="ghost-button" type="button" @click="cancelModEdit">
                取消
              </button>
              <button class="primary-button" type="submit">
                <Save :size="18" />
                <span>{{ modEditing ? '保存修改' : '创建 Mod' }}</span>
              </button>
            </div>
          </form>
        </div>
      </Teleport>

      <!-- Mod List -->
      <div v-if="modList.length" class="mod-card-list">
        <div
          v-for="mod in modList"
          :key="mod.id"
          class="mod-card"
          :class="{
            'is-disabled': !mod.enabled,
            'is-dragging': draggingMod === mod.id,
            'is-drag-over': dragOverMod === mod.id
          }"
          draggable="true"
          @dragstart="onModDragStart($event, mod)"
          @dragover="onModDragOver($event, mod)"
          @dragend="onModDragEnd"
          @drop="onModDrop($event, mod)"
        >
          <div class="mod-card-grip">
            <GripVertical :size="16" />
          </div>
          <div class="mod-card-body">
            <div class="mod-card-header">
              <strong>{{ mod.name }}</strong>
              <span class="mod-type-badge" :style="{ backgroundColor: modTypeColor(mod.type) }">
                {{ modTypeLabel(mod.type) }}
              </span>
              <span class="mod-scope-badge">{{ modScopeLabel(mod) }}</span>
              <span v-if="!mod.enabled" class="mod-disabled-badge">已禁用</span>
            </div>
            <p v-if="mod.description" class="mod-card-desc">{{ mod.description }}</p>
            <p class="mod-card-preview">{{ mod.content.slice(0, 120) }}{{ mod.content.length > 120 ? '...' : '' }}</p>
          </div>
          <div class="mod-card-actions">
            <button
              class="icon-button"
              :class="{ active: mod.enabled }"
              type="button"
              :title="mod.enabled ? '禁用' : '启用'"
              :aria-label="mod.enabled ? `禁用 Mod：${mod.name}` : `启用 Mod：${mod.name}`"
              @click="toggleMod(mod)"
            >
              <Power :size="16" />
            </button>
            <button class="icon-button" type="button" title="编辑" :aria-label="`编辑 Mod：${mod.name}`" @click="startEditMod(mod)">
              <Sliders :size="16" />
            </button>
            <button class="icon-button danger" type="button" title="删除" :aria-label="`删除 Mod：${mod.name}`" @click="removeMod(mod.id, mod.name)">
              <Trash2 :size="16" />
            </button>
          </div>
        </div>
      </div>
      <p v-else-if="!modLoading && !modLoadError" class="muted-text">还没有 Mod，点击「新建 Mod」创建第一个。拖拽卡片可调整顺序。</p>
    </section>

    <!-- Regex Rules Section -->
    <section v-if="isExtensionsPage" id="extension-section-regex" class="form-panel regex-rules-panel form-section-group">
      <div class="inline-heading">
        <div>
          <h2>正则规则管理</h2>
          <p>管理所有角色的正则替换规则，支持分组、排序和启用/禁用。</p>
        </div>
        <Regex :size="20" />
      </div>
      <div class="regex-actions-row">
        <select v-model="regexGroupFilter" aria-label="正则规则分组筛选" @change="handleRegexGroupFilterChange">
          <option value="">全部分组</option>
          <option v-for="g in regexGroups" :key="g" :value="g">{{ g }}</option>
        </select>
        <button class="ghost-button" type="button" @click="exportRegexRules" :disabled="!regexRules.length">
          <Download :size="17" />
          <span>导出</span>
        </button>
        <label class="ghost-button file-import-button">
          <Upload :size="17" />
          <span>导入</span>
          <input type="file" accept=".json" @change="handleRegexImportFile" />
        </label>
      </div>
      <p v-if="regexLoading" class="muted-text" aria-live="polite">正在加载正则规则...</p>
      <div v-if="regexLoadError" class="section-load-status error-state" role="alert">
        <span>{{ regexLoadError }}</span>
        <button class="ghost-button compact-button" type="button" :disabled="regexLoading" @click="loadRegexRules">
          <RefreshCw :size="17" />
          <span>{{ regexLoading ? '重试中...' : '重试' }}</span>
        </button>
      </div>
      <div v-if="regexRules.length" class="regex-rule-list">
        <div
          v-for="(rule, index) in regexRules"
          :key="rule.id"
          class="regex-rule-card"
          :class="{ disabled: !rule.enabled }"
          draggable="true"
          @dragstart="onRegexDragStart(index)"
          @dragover="onRegexDragOver"
          @drop="onRegexDrop(index)"
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
              <span class="regex-scope-badge">{{ rule.scope === 'input' ? '输入' : rule.scope === 'output' ? '输出' : '双向' }}</span>
              <span class="regex-priority-badge">优先级 {{ rule.priority }}</span>
            </div>
          </div>
          <button
            class="icon-button"
            :class="{ active: rule.enabled }"
            type="button"
            :title="rule.enabled ? '点击禁用' : '点击启用'"
            :aria-label="rule.enabled ? `禁用正则规则：${rule.label}` : `启用正则规则：${rule.label}`"
            @click="handleToggleRegexRule(rule.id)"
          >
            <Power :size="16" />
          </button>
        </div>
      </div>
      <p v-else-if="!regexLoading && !regexLoadError" class="muted-text">还没有正则规则。在角色编辑页创建规则后会在这里显示。</p>
    </section>

    <section v-if="isPersonalPage && canCheckBalance && balance" class="balance-panel">
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
