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
  areProviderModelListsEqual,
  buildModelSelectOptions,
  readCachedProviderModels,
  refreshProviderModels
} from '../services/modelCatalog';
import { samePlainValue } from '../utils/plainValues';
import { isLocalOrPrivateBaseUrl } from '../../../shared/privateNetwork.js';

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
const providerControlsBusy = computed(() => saving.value || modelLoading.value);
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
  () => [
    form.providerType,
    form.gatewayName,
    form.baseUrl,
    Boolean(form.apiKey || form.apiKeySet),
    form.supportsReasoning,
    form.extraBody
  ],
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
  if (!isPersonalPage.value || providerControlsBusy.value || !canFetchModels.value) {
    return;
  }
  const requestToken = ++modelLoadToken;
  const request = buildProviderModelRequest();
  modelLoading.value = true;
  try {
    const nextOptions = await refreshProviderModels(request, { forceRefresh: true });
    if (!isCurrentModelLoadResult(requestToken, request)) return;
    applyModelOptions(nextOptions);
    if (!nextOptions.length) {
      notify.info('网关没有返回可选模型，请确认 /models 接口可用。');
    } else if (!hasProviderModelOption(nextOptions, form.model)) {
      form.model = nextOptions[0].id;
      notify.success(`已刷新 ${nextOptions.length} 个模型，并自动选择第一个。`);
    } else {
      notify.success(`已刷新 ${nextOptions.length} 个模型。`);
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
  if (!isPersonalPage.value || providerControlsBusy.value) {
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
  if (!isPersonalPage.value || profileSaving.value) {
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
  if (!isPersonalPage.value || providerControlsBusy.value || balanceLoading.value || !canCheckBalance.value) {
    return;
  }
  const requestToken = ++balanceLoadToken;
  balanceLoading.value = true;
  try {
    const nextBalance = await fetchDeepSeekBalance();
    if (!isCurrentBalanceLoadResult(requestToken)) return;
    setBalanceIfChanged(nextBalance);
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
  setProfileStatsIfChanged(result.stats);
  setOwnedCharactersIfChanged(result.ownedCharacters);
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
  applyModelOptions(readCachedProviderModels(form));
}

function applyModelOptions(nextOptions) {
  if (areProviderModelListsEqual(modelOptions.value, nextOptions)) {
    return false;
  }
  modelOptions.value = nextOptions;
  return true;
}

function hasProviderModelOption(options, modelId) {
  const id = String(modelId || '').trim();
  if (!id) {
    return false;
  }
  for (const model of Array.isArray(options) ? options : []) {
    if (model?.id === id) {
      return true;
    }
  }
  return false;
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

function sameListItems(currentList, nextList) {
  if (!Array.isArray(currentList) || !Array.isArray(nextList) || currentList.length !== nextList.length) {
    return false;
  }
  for (let index = 0; index < currentList.length; index += 1) {
    if (!samePlainValue(currentList[index], nextList[index])) {
      return false;
    }
  }
  return true;
}

function setPlainValueIfChanged(valueRef, nextValue) {
  if (samePlainValue(valueRef.value, nextValue)) {
    return false;
  }
  valueRef.value = nextValue;
  return true;
}

function setBalanceIfChanged(nextBalance) {
  return setPlainValueIfChanged(balance, nextBalance);
}

function setProfileStatsIfChanged(nextStats) {
  return setPlainValueIfChanged(profileStats, nextStats || profileStats.value);
}

function setListIfChanged(listRef, nextList) {
  const normalizedNextList = Array.isArray(nextList) ? nextList : [];
  if (sameListItems(listRef.value, normalizedNextList)) {
    return false;
  }
  listRef.value = normalizedNextList;
  return true;
}

function getListItemById(listRef, itemId) {
  const targetId = String(itemId || '');
  if (!targetId) {
    return null;
  }
  const currentList = Array.isArray(listRef.value) ? listRef.value : [];
  for (const item of currentList) {
    if (item?.id === targetId) {
      return item;
    }
  }
  return null;
}

function prependListItemByIdWithLimit(listRef, nextItem, limit) {
  const nextId = String(nextItem?.id || '');
  const normalizedLimit = Math.max(0, Number(limit) || 0);
  if (!nextId || normalizedLimit <= 0) {
    return false;
  }
  const currentList = Array.isArray(listRef.value) ? listRef.value : [];
  const nextList = [nextItem];
  for (const item of currentList) {
    if (item?.id === nextId) continue;
    if (nextList.length >= normalizedLimit) break;
    nextList.push(item);
  }
  return setListIfChanged(listRef, nextList);
}

function removeListItemByIdIfPresent(listRef, itemId) {
  const targetId = String(itemId || '');
  if (!targetId) {
    return false;
  }
  const currentList = Array.isArray(listRef.value) ? listRef.value : [];
  const nextList = [];
  let changed = false;
  for (const item of currentList) {
    if (item?.id === targetId) {
      changed = true;
    } else {
      nextList.push(item);
    }
  }
  if (changed) {
    setListIfChanged(listRef, nextList);
  }
  return changed;
}

function updateListItemByIdIfChanged(listRef, itemId, nextItem) {
  const targetId = String(itemId || '');
  if (!targetId) {
    return false;
  }
  const currentList = Array.isArray(listRef.value) ? listRef.value : [];
  const nextList = [];
  let changed = false;
  for (const item of currentList) {
    if (item?.id === targetId) {
      if (!samePlainValue(item, nextItem)) {
        changed = true;
        nextList.push(nextItem);
      } else {
        nextList.push(item);
      }
    } else {
      nextList.push(item);
    }
  }
  if (changed) {
    setListIfChanged(listRef, nextList);
  }
  return changed;
}

function moveListItemToTargetIndexById(listRef, itemId, targetItemId) {
  const sourceId = String(itemId || '');
  const targetId = String(targetItemId || '');
  if (!sourceId || !targetId || sourceId === targetId) {
    return null;
  }
  const currentList = Array.isArray(listRef.value) ? listRef.value : [];
  let fromIndex = -1;
  let targetIndex = -1;
  for (let index = 0; index < currentList.length; index += 1) {
    const id = currentList[index]?.id;
    if (id === sourceId) {
      fromIndex = index;
    } else if (id === targetId) {
      targetIndex = index;
    }
  }
  if (fromIndex === -1 || targetIndex === -1) {
    return null;
  }
  const nextList = currentList.slice();
  const [moved] = nextList.splice(fromIndex, 1);
  nextList.splice(targetIndex, 0, moved);
  const ids = [];
  for (const item of nextList) {
    ids.push(item.id);
  }
  setListIfChanged(listRef, nextList);
  return { previousList: currentList, nextList, ids };
}

function setOwnedCharactersIfChanged(nextCharacters) {
  return setListIfChanged(ownedCharacters, nextCharacters);
}

function setModCharacterOptionsIfChanged(characters) {
  const nextOptions = [];
  if (Array.isArray(characters)) {
    for (const character of characters) {
      if (character?.canUse !== false) {
        nextOptions.push(character);
      }
    }
  }
  return setListIfChanged(modCharacterOptions, nextOptions);
}

function canUseNoAuthProvider() {
  return form.providerType === 'custom' && isLocalOrPrivateBaseUrl(form.baseUrl);
}

const tagList = ref([]);
const newTagName = ref('');
const TAG_LOAD_LIMIT_DEFAULT = 80;
const TAG_LOAD_LIMIT_MAX = 500;
const TAG_LOAD_LIMIT_STORAGE_KEY = 'flai-tag-load-limit';
const tagLoadLimit = ref(readStoredTagLoadLimit());
const tagLoading = ref(false);
const tagLoadError = ref('');
const tagActionBusyId = ref('');
const normalizedTagLoadLimit = computed(() => normalizeTagLoadLimit(tagLoadLimit.value));
const tagActionBusy = computed(() => Boolean(tagActionBusyId.value));
const tagControlsBusy = computed(() => tagLoading.value || tagActionBusy.value);
let tagLoadToken = 0;
let tagMutationToken = 0;

onMounted(loadTags);

async function loadTags() {
  if (!isExtensionsPage.value || tagControlsBusy.value) {
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
    setListIfChanged(tagList, nextTags);
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
  tagActionBusyId.value = '';
  resetTagMutationScope();
}

function tagDeleteActionId(id) {
  return `tag-delete:${id}`;
}

function isTagDeleteBusy(id) {
  return tagActionBusyId.value === tagDeleteActionId(id);
}

function beginTagMutation(actionId) {
  resetTagAsyncScope();
  tagActionBusyId.value = actionId;
  return tagMutationToken;
}

function finishTagMutation(mutationToken) {
  if (mutationToken === tagMutationToken) {
    tagActionBusyId.value = '';
  }
}

function isCurrentTagMutation(mutationToken) {
  return mutationToken === tagMutationToken && isExtensionsPage.value;
}

function getCurrentTag(id) {
  return getListItemById(tagList, id);
}

function updateTagLoadLimit() {
  if (tagControlsBusy.value) return;
  resetTagAsyncScope();
  tagLoadLimit.value = normalizedTagLoadLimit.value;
  saveStoredTagLoadLimit(tagLoadLimit.value);
  loadTags();
}

async function addTag() {
  const name = newTagName.value.trim();
  if (!name || tagControlsBusy.value) return;
  const mutationToken = beginTagMutation('tag-add');
  try {
    const tag = await createTag({ name });
    if (!isCurrentTagMutation(mutationToken)) return;
    prependListItemByIdWithLimit(tagList, tag, normalizedTagLoadLimit.value);
    newTagName.value = '';
    notify.success(`标签「${tag.name}」已创建`);
  } catch (err) {
    if (!isCurrentTagMutation(mutationToken)) return;
    notify.error(err.message);
  } finally {
    finishTagMutation(mutationToken);
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
  if (tagControlsBusy.value) return;
  const currentTag = getCurrentTag(id);
  if (!currentTag) return;
  name = currentTag.name || name;
  if (!window.confirm(`确定删除标签「${name}」吗？关联的角色卡将失去此标签。`)) return;
  const mutationToken = beginTagMutation(tagDeleteActionId(currentTag.id));
  try {
    await deleteTag(currentTag.id);
    if (!isCurrentTagMutation(mutationToken)) return;
    removeListItemByIdIfPresent(tagList, currentTag.id);
    notify.success(`标签「${name}」已删除`);
  } catch (err) {
    if (!isCurrentTagMutation(mutationToken)) return;
    if (/标签不存在/.test(err.message || '')) {
      removeListItemByIdIfPresent(tagList, currentTag.id);
      notify.info(`标签「${name}」已从列表移除`);
      return;
    }
    notify.error(err.message);
  } finally {
    finishTagMutation(mutationToken);
  }
}

// ── Preset Management ──
const presetList = ref([]);
const presetLoading = ref(false);
const presetLoadError = ref('');
const presetActionBusyId = ref('');
const presetActionBusy = computed(() => Boolean(presetActionBusyId.value));
const presetControlsBusy = computed(() => presetLoading.value || presetActionBusy.value);
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
  if (!isExtensionsPage.value || presetControlsBusy.value) {
    return;
  }
  const requestToken = ++presetLoadToken;
  presetLoading.value = true;
  presetLoadError.value = '';
  try {
    const nextPresets = await fetchPresets();
    if (!isCurrentPresetLoad(requestToken)) return;
    setListIfChanged(presetList, nextPresets);
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
  presetActionBusyId.value = '';
  resetPresetMutationScope();
}

function presetDefaultActionId(id) {
  return `preset-default:${id}`;
}

function presetDeleteActionId(id) {
  return `preset-delete:${id}`;
}

function isPresetDefaultBusy(id) {
  return presetActionBusyId.value === presetDefaultActionId(id);
}

function isPresetDeleteBusy(id) {
  return presetActionBusyId.value === presetDeleteActionId(id);
}

function beginPresetMutation(actionId) {
  resetPresetAsyncScope();
  presetActionBusyId.value = actionId;
  return presetMutationToken;
}

function finishPresetMutation(mutationToken) {
  if (mutationToken === presetMutationToken) {
    presetActionBusyId.value = '';
  }
}

function isCurrentPresetMutation(mutationToken) {
  return mutationToken === presetMutationToken && isExtensionsPage.value;
}

function getCurrentPreset(id) {
  return getListItemById(presetList, id);
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
  if (presetControlsBusy.value) return;
  resetPresetMutationScope();
  presetEditing.value = null;
  resetPresetForm();
  showPresetEditor.value = true;
}

function startEditPreset(preset) {
  if (presetControlsBusy.value) return;
  const currentPreset = getCurrentPreset(preset?.id);
  if (!currentPreset) return;
  resetPresetMutationScope();
  presetEditing.value = currentPreset.id;
  Object.assign(presetForm, {
    name: currentPreset.name,
    systemPrompt: currentPreset.systemPrompt,
    temperature: currentPreset.temperature,
    maxTokens: currentPreset.maxTokens,
    topP: currentPreset.topP,
    frequencyPenalty: currentPreset.frequencyPenalty,
    presencePenalty: currentPreset.presencePenalty
  });
  showPresetEditor.value = true;
}

function cancelPresetEdit() {
  if (presetActionBusy.value) return;
  resetPresetMutationScope();
  showPresetEditor.value = false;
  presetEditing.value = null;
  resetPresetForm();
}

async function savePreset() {
  if (presetControlsBusy.value) return;
  const editingId = presetEditing.value;
  const editingPreset = editingId ? getCurrentPreset(editingId) : null;
  if (editingId && !editingPreset) {
    showPresetEditor.value = false;
    presetEditing.value = null;
    resetPresetForm();
    return;
  }
  const mutationToken = beginPresetMutation('preset-save');
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
      await updatePreset(editingPreset.id, payload);
      if (!isCurrentPresetMutation(mutationToken)) return;
      notify.success('预设已更新');
    } else {
      await createPreset(payload);
      if (!isCurrentPresetMutation(mutationToken)) return;
      notify.success('预设已创建');
    }
    showPresetEditor.value = false;
    presetEditing.value = null;
    resetPresetForm();
    finishPresetMutation(mutationToken);
    await loadPresets();
  } catch (err) {
    if (!isCurrentPresetMutation(mutationToken)) return;
    notify.error(err.message);
  } finally {
    finishPresetMutation(mutationToken);
  }
}

async function removePreset(id, name) {
  if (presetControlsBusy.value) return;
  const currentPreset = getCurrentPreset(id);
  if (!currentPreset) return;
  name = currentPreset.name || name;
  if (!window.confirm(`确定删除预设「${name}」吗？`)) return;
  const mutationToken = beginPresetMutation(presetDeleteActionId(currentPreset.id));
  try {
    await deletePreset(currentPreset.id);
    if (!isCurrentPresetMutation(mutationToken)) return;
    removeListItemByIdIfPresent(presetList, currentPreset.id);
    if (presetEditing.value === currentPreset.id) {
      showPresetEditor.value = false;
      presetEditing.value = null;
      resetPresetForm();
    }
    notify.success(`预设「${name}」已删除`);
  } catch (err) {
    if (!isCurrentPresetMutation(mutationToken)) return;
    notify.error(err.message);
  } finally {
    finishPresetMutation(mutationToken);
  }
}

async function makeDefaultPreset(id) {
  if (presetControlsBusy.value) return;
  const currentPreset = getCurrentPreset(id);
  if (!currentPreset) return;
  const mutationToken = beginPresetMutation(presetDefaultActionId(currentPreset.id));
  try {
    await setDefaultPreset(currentPreset.id);
    if (!isCurrentPresetMutation(mutationToken)) return;
    finishPresetMutation(mutationToken);
    await loadPresets();
    if (!isCurrentPresetMutation(mutationToken)) return;
    notify.success('已设为默认预设');
  } catch (err) {
    if (!isCurrentPresetMutation(mutationToken)) return;
    notify.error(err.message);
  } finally {
    finishPresetMutation(mutationToken);
  }
}

function exportPresets() {
  if (presetControlsBusy.value) return;
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

async function importPresets(mutationToken = beginPresetMutation('preset-import')) {
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
    finishPresetMutation(mutationToken);
    await loadPresets();
    if (!isCurrentPresetMutation(mutationToken)) return;
    notify.success(`已导入 ${imported} 个预设`);
  } catch (err) {
    if (!isCurrentPresetMutation(mutationToken)) return;
    notify.error('导入失败：JSON 格式不正确');
  } finally {
    finishPresetMutation(mutationToken);
  }
}

function handlePresetImportFile(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (input) {
    input.value = '';
  }
  if (!file || presetControlsBusy.value) return;
  const reader = new FileReader();
  const mutationToken = beginPresetMutation('preset-import');
  reader.onload = async () => {
    if (!isCurrentPresetMutation(mutationToken)) return;
    presetImportText.value = String(reader.result || '');
    await importPresets(mutationToken);
  };
  reader.onerror = () => {
    if (!isCurrentPresetMutation(mutationToken)) return;
    notify.error('导入失败：文件读取失败');
    finishPresetMutation(mutationToken);
  };
  reader.readAsText(file);
}

// ── Mod Management ──
const modList = ref([]);
const modLoading = ref(false);
const modLoadError = ref('');
const modActionBusyId = ref('');
const modActionBusy = computed(() => Boolean(modActionBusyId.value));
const modControlsBusy = computed(() => modLoading.value || modActionBusy.value);
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
  if (!isExtensionsPage.value || modControlsBusy.value) {
    return;
  }
  const requestToken = ++modLoadToken;
  modLoading.value = true;
  modLoadError.value = '';
  try {
    const nextMods = await fetchMods();
    if (!isCurrentModLoad(requestToken)) return;
    setListIfChanged(modList, nextMods);
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
  if (!isExtensionsPage.value || modCharactersLoading.value || modActionBusy.value) {
    return;
  }
  const requestToken = ++modCharactersLoadToken;
  modCharactersLoading.value = true;
  modCharactersLoadError.value = '';
  try {
    const characters = await fetchCharacters({ sort: 'name' });
    if (!isCurrentModCharacterLoad(requestToken)) return;
    setModCharacterOptionsIfChanged(characters);
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
  modActionBusyId.value = '';
  resetModMutationScope();
}

function resetModCharacterLoadScope() {
  modCharactersLoadToken += 1;
  modCharactersLoading.value = false;
}

function modToggleActionId(id) {
  return `mod-toggle:${id}`;
}

function modDeleteActionId(id) {
  return `mod-delete:${id}`;
}

function isModToggleBusy(id) {
  return modActionBusyId.value === modToggleActionId(id);
}

function isModDeleteBusy(id) {
  return modActionBusyId.value === modDeleteActionId(id);
}

function beginModMutation(actionId) {
  resetModAsyncScope();
  modActionBusyId.value = actionId;
  return modMutationToken;
}

function finishModMutation(mutationToken) {
  if (mutationToken === modMutationToken) {
    modActionBusyId.value = '';
  }
}

function isCurrentModMutation(mutationToken) {
  return mutationToken === modMutationToken && isExtensionsPage.value;
}

function getCurrentMod(id) {
  return getListItemById(modList, id);
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
  if (modControlsBusy.value) return;
  resetModAsyncScope();
  modEditing.value = null;
  resetModForm();
  showModEditor.value = true;
}

function startEditMod(mod) {
  if (modControlsBusy.value) return;
  const currentMod = getCurrentMod(mod?.id);
  if (!currentMod) return;
  resetModAsyncScope();
  modEditing.value = currentMod.id;
  Object.assign(modForm, {
    name: currentMod.name,
    description: currentMod.description,
    type: currentMod.type,
    content: currentMod.content,
    enabled: currentMod.enabled,
    scope: normalizeModScope(currentMod.scope, currentMod.characterIds),
    characterIds: normalizeModCharacterIds(currentMod.characterIds)
  });
  showModEditor.value = true;
}

function cancelModEdit() {
  if (modActionBusy.value) return;
  resetModAsyncScope();
  closeModEditor();
}

async function saveMod() {
  if (modControlsBusy.value) return;
  const editingId = modEditing.value;
  if (editingId && !getCurrentMod(editingId)) {
    closeModEditor();
    return;
  }
  const scope = normalizeModScope(modForm.scope, modForm.characterIds);
  const characterIds = scope === 'characters' ? normalizeModCharacterIds(modForm.characterIds) : [];
  if (scope === 'characters' && !characterIds.length) {
    notify.warning('请至少绑定一个角色');
    return;
  }
  const mutationToken = beginModMutation('mod-save');
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
      finishModMutation(mutationToken);
      await loadMods();
      if (!isCurrentModMutation(mutationToken)) return;
      notify.success('Mod 已更新');
    } else {
      await createMod(payload);
      if (!isCurrentModMutation(mutationToken)) return;
      closeModEditor();
      finishModMutation(mutationToken);
      await loadMods();
      if (!isCurrentModMutation(mutationToken)) return;
      notify.success('Mod 已创建');
    }
  } catch (err) {
    if (!isCurrentModMutation(mutationToken)) return;
    notify.error(err.message);
  } finally {
    finishModMutation(mutationToken);
  }
}

async function removeMod(id, name) {
  if (modControlsBusy.value) return;
  const currentMod = getCurrentMod(id);
  if (!currentMod) return;
  name = currentMod.name || name;
  if (!window.confirm(`确定删除 Mod「${name}」吗？`)) return;
  const mutationToken = beginModMutation(modDeleteActionId(currentMod.id));
  try {
    await deleteMod(currentMod.id);
    if (!isCurrentModMutation(mutationToken)) return;
    removeListItemByIdIfPresent(modList, currentMod.id);
    if (modEditing.value === currentMod.id) {
      closeModEditor();
    }
    notify.success(`Mod「${name}」已删除`);
  } catch (err) {
    if (!isCurrentModMutation(mutationToken)) return;
    notify.error(err.message);
  } finally {
    finishModMutation(mutationToken);
  }
}

async function toggleMod(mod) {
  if (modControlsBusy.value) return;
  const currentMod = getCurrentMod(mod?.id);
  if (!currentMod) return;
  const mutationToken = beginModMutation(modToggleActionId(currentMod.id));
  const nextEnabled = !currentMod.enabled;
  try {
    const updated = await updateMod(currentMod.id, { enabled: nextEnabled });
    if (!isCurrentModMutation(mutationToken)) return;
    if (!getCurrentMod(currentMod.id)) return;
    const nextMod = updated && typeof updated === 'object' ? updated : { ...currentMod, enabled: nextEnabled };
    updateListItemByIdIfChanged(modList, currentMod.id, nextMod);
    notify.success(nextEnabled ? `Mod「${nextMod.name}」已启用` : `Mod「${nextMod.name}」已禁用`);
  } catch (err) {
    if (!isCurrentModMutation(mutationToken)) return;
    notify.error(err.message);
  } finally {
    finishModMutation(mutationToken);
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
  if (modActionBusy.value) return;
  modForm.characterIds = modCharacterOptions.value.map((character) => character.id);
}

function clearModCharacters() {
  if (modActionBusy.value) return;
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
  if (modControlsBusy.value) {
    event?.preventDefault?.();
    return;
  }
  const currentMod = getCurrentMod(mod?.id);
  if (!currentMod) {
    event?.preventDefault?.();
    return;
  }
  draggingMod.value = currentMod.id;
  const dataTransfer = event?.dataTransfer;
  if (dataTransfer) {
    dataTransfer.effectAllowed = 'move';
  }
}

function onModDragOver(event, mod) {
  if (modControlsBusy.value) return;
  const currentMod = getCurrentMod(mod?.id);
  if (!currentMod) return;
  event?.preventDefault?.();
  if (dragOverMod.value !== currentMod.id) {
    dragOverMod.value = currentMod.id;
  }
}

function onModDragEnd() {
  draggingMod.value = null;
  dragOverMod.value = null;
}

async function onModDrop(event, targetMod) {
  event?.preventDefault?.();
  if (modControlsBusy.value) return;
  const draggedId = draggingMod.value;
  const currentDraggedMod = getCurrentMod(draggedId);
  const currentTargetMod = getCurrentMod(targetMod?.id);
  if (!currentDraggedMod || !currentTargetMod || currentDraggedMod.id === currentTargetMod.id) {
    dragOverMod.value = null;
    return;
  }

  const moveResult = moveListItemToTargetIndexById(modList, currentDraggedMod.id, currentTargetMod.id);
  if (!moveResult) {
    dragOverMod.value = null;
    return;
  }

  const mutationToken = beginModMutation('mod-reorder');
  dragOverMod.value = null;

  try {
    await reorderMods(moveResult.ids);
    if (!isCurrentModMutation(mutationToken)) return;
  } catch (err) {
    if (!isCurrentModMutation(mutationToken)) return;
    setListIfChanged(modList, moveResult.previousList);
    notify.error(err.message);
    finishModMutation(mutationToken);
    await loadMods();
  } finally {
    finishModMutation(mutationToken);
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
const regexActionBusyId = ref('');
const regexActionBusy = computed(() => Boolean(regexActionBusyId.value));
const regexControlsBusy = computed(() => regexLoading.value || regexActionBusy.value);
const regexGroupFilter = ref('');
const regexGroupOptions = ref([]);
const regexImportText = ref('');
const showRegexImport = ref(false);
const draggingRegexRuleId = ref('');
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
  if (!isExtensionsPage.value || regexControlsBusy.value) {
    return;
  }
  const groupFilter = regexGroupFilter.value;
  const requestToken = ++regexLoadToken;
  regexLoading.value = true;
  regexLoadError.value = '';
  try {
    const nextRules = await fetchRegexRules(groupFilter);
    if (!isCurrentRegexLoad(requestToken, groupFilter)) return;
    setListIfChanged(regexRules, nextRules);
    setRegexGroupOptionsFromRules(nextRules, groupFilter);
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
  regexActionBusyId.value = '';
  resetRegexMutationScope();
}

function resetRegexMutationScope() {
  regexMutationToken += 1;
  draggingRegexRuleId.value = '';
}

function regexToggleActionId(id) {
  return `regex-toggle:${id}`;
}

function isRegexToggleBusy(id) {
  return regexActionBusyId.value === regexToggleActionId(id);
}

function beginRegexMutation(actionId) {
  resetRegexAsyncScope();
  regexActionBusyId.value = actionId;
  return regexMutationToken;
}

function finishRegexMutation(mutationToken) {
  if (mutationToken === regexMutationToken) {
    regexActionBusyId.value = '';
  }
}

function isCurrentRegexMutation(mutationToken, groupFilter) {
  return mutationToken === regexMutationToken
    && isExtensionsPage.value
    && regexGroupFilter.value === groupFilter;
}

function getCurrentRegexRule(ruleId) {
  return getListItemById(regexRules, ruleId);
}

function handleRegexGroupFilterChange() {
  if (regexControlsBusy.value) return;
  resetRegexMutationScope();
  loadRegexRules();
}

async function handleToggleRegexRule(ruleId) {
  if (regexControlsBusy.value) return;
  const currentRule = getCurrentRegexRule(ruleId);
  if (!currentRule) return;
  const groupFilter = regexGroupFilter.value;
  const mutationToken = beginRegexMutation(regexToggleActionId(currentRule.id));
  try {
    await toggleRegexRule(currentRule.id);
    if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
    finishRegexMutation(mutationToken);
    await loadRegexRules();
    if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
    notify.success('规则状态已切换');
  } catch (err) {
    if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
    notify.error(err.message);
  } finally {
    finishRegexMutation(mutationToken);
  }
}

function onRegexDragStart(event, ruleId) {
  if (regexControlsBusy.value) {
    event?.preventDefault?.();
    return;
  }
  const currentRule = getCurrentRegexRule(ruleId);
  if (!currentRule) {
    event?.preventDefault?.();
    return;
  }
  draggingRegexRuleId.value = currentRule.id;
}

function onRegexDragOver(event, ruleId) {
  if (regexControlsBusy.value) return;
  if (!getCurrentRegexRule(ruleId)) return;
  event?.preventDefault?.();
}

async function onRegexDrop(targetRuleId) {
  if (regexControlsBusy.value) return;
  const currentDraggedRule = getCurrentRegexRule(draggingRegexRuleId.value);
  const currentTargetRule = getCurrentRegexRule(targetRuleId);
  if (!currentDraggedRule || !currentTargetRule || currentDraggedRule.id === currentTargetRule.id) {
    draggingRegexRuleId.value = '';
    return;
  }
  const groupFilter = regexGroupFilter.value;
  const moveResult = moveListItemToTargetIndexById(regexRules, currentDraggedRule.id, currentTargetRule.id);
  if (!moveResult) {
    draggingRegexRuleId.value = '';
    return;
  }
  draggingRegexRuleId.value = '';
  const mutationToken = beginRegexMutation('regex-reorder');
  try {
    await reorderRegexRules(moveResult.ids, groupFilter);
    if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
    notify.success('排序已保存');
  } catch (err) {
    if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
    setListIfChanged(regexRules, moveResult.previousList);
    notify.error(err.message);
    finishRegexMutation(mutationToken);
    await loadRegexRules();
  } finally {
    finishRegexMutation(mutationToken);
  }
}

const regexGroups = computed(() => regexGroupOptions.value);

function setRegexGroupOptionsFromRules(rules, selectedGroup = '') {
  const nextGroups = [];
  const replacingAllGroups = !selectedGroup;
  if (!replacingAllGroups) {
    appendKnownRegexGroups(nextGroups, regexGroupOptions.value);
    appendRegexGroupIfMissing(nextGroups, selectedGroup);
  }
  appendKnownRegexGroups(nextGroups, normalizeRegexGroupNamesFromRules(rules));
  nextGroups.sort();
  return setListIfChanged(regexGroupOptions, nextGroups);
}

function normalizeRegexGroupNamesFromRules(rules) {
  const groups = [];
  for (const rule of Array.isArray(rules) ? rules : []) {
    appendRegexGroupIfMissing(groups, normalizeRegexGroupName(rule?.groupName));
  }
  return groups;
}

function appendKnownRegexGroups(targetGroups, sourceGroups) {
  for (const group of Array.isArray(sourceGroups) ? sourceGroups : []) {
    appendRegexGroupIfMissing(targetGroups, normalizeRegexGroupName(group));
  }
}

function appendRegexGroupIfMissing(groups, groupName) {
  const normalizedName = normalizeRegexGroupName(groupName);
  if (!normalizedName) {
    return false;
  }
  for (const group of groups) {
    if (group === normalizedName) {
      return false;
    }
  }
  groups.push(normalizedName);
  return true;
}

function normalizeRegexGroupName(groupName) {
  return String(groupName || '').trim() || '全局';
}

function exportRegexRules() {
  if (regexControlsBusy.value) return;
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

async function importRegexRules(mutationToken = beginRegexMutation('regex-import'), groupFilter = regexGroupFilter.value) {
  try {
    const parsed = JSON.parse(regexImportText.value);
    const result = await importRegexRuleSet(Array.isArray(parsed) ? { rules: parsed } : parsed);
    if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
    const imported = result.imported || 0;
    regexImportText.value = '';
    showRegexImport.value = false;
    finishRegexMutation(mutationToken);
    await loadRegexRules();
    if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
    if (result.skipped?.length) {
      notify.warning(`已跳过 ${result.skipped.length} 条无效或无权限规则`);
    }
    notify.success(`已导入 ${imported} 条规则`);
  } catch (err) {
    if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
    notify.error('导入失败：JSON 格式不正确');
  } finally {
    finishRegexMutation(mutationToken);
  }
}

function handleRegexImportFile(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (input) {
    input.value = '';
  }
  if (!file || regexControlsBusy.value) return;
  const reader = new FileReader();
  const groupFilter = regexGroupFilter.value;
  const mutationToken = beginRegexMutation('regex-import');
  reader.onload = () => {
    if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
    regexImportText.value = String(reader.result || '');
    importRegexRules(mutationToken, groupFilter);
  };
  reader.onerror = () => {
    if (!isCurrentRegexMutation(mutationToken, groupFilter)) return;
    notify.error('导入失败：文件读取失败');
    finishRegexMutation(mutationToken);
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

        <form class="profile-form" :aria-busy="profileSaving" @submit.prevent="submitProfile">
          <label class="field">
            <span>账户名</span>
            <strong class="readonly-value">{{ profile.accountName }}</strong>
          </label>
          <label class="field">
            <span>对话用户名</span>
            <input
              v-model.trim="profile.displayName"
              maxlength="8"
              :disabled="profileSaving"
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

    <form v-if="isPersonalPage && !loading && !loadError" class="form-panel" :aria-busy="providerControlsBusy" @submit.prevent="submit">
      <div class="inline-heading">
        <div>
          <h2>AI 供应商设置</h2>
          <p>配置 SK、网关和模型列表。</p>
        </div>
      </div>
      <div class="form-grid two-col">
        <label class="field">
          <span>供应商</span>
          <select v-model="form.providerType" :disabled="providerControlsBusy" @change="applyPreset">
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
          <input v-model.trim="form.gatewayName" :disabled="providerControlsBusy" />
        </label>
        <label class="field">
          <span>Base URL</span>
          <input v-model.trim="form.baseUrl" placeholder="https://api.example.com/v1" :disabled="providerControlsBusy" required />
        </label>
        <div class="field model-field">
          <span>模型</span>
          <div class="model-picker">
            <select v-model="form.model" :disabled="providerControlsBusy" required aria-label="模型">
              <option v-if="!settingsModelOptions.length" value="" disabled>
                请先获取模型列表
              </option>
              <option v-for="model in settingsModelOptions" :key="model.id" :value="model.id">
                {{ model.label || model.id }}
              </option>
            </select>
            <button class="ghost-button compact-button" type="button" :disabled="providerControlsBusy || !canFetchModels" @click="loadModels">
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
          :disabled="providerControlsBusy"
          :placeholder="form.apiKeyNeedsReset ? '当前密钥不可用，请重新粘贴 SK' : '留空则保留已保存密钥'"
          type="password"
        />
      </label>
      <label class="checkbox-line">
        <input v-model="form.clearApiKey" type="checkbox" :disabled="providerControlsBusy" />
        <span>清除已保存密钥 {{ form.apiKeyHint ? `（当前：${form.apiKeyHint}）` : '' }}</span>
      </label>
      <div class="form-actions">
        <button class="primary-button" type="submit" :disabled="providerControlsBusy">
          <Save :size="18" />
          <span>{{ saving ? '保存中...' : '保存设置' }}</span>
        </button>
        <button
          v-if="form.providerType === 'deepseek'"
          class="ghost-button"
          type="button"
          :disabled="providerControlsBusy || !canCheckBalance || balanceLoading"
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
        <input v-model="newTagName" placeholder="新标签名称" maxlength="30" aria-label="新标签名称" :disabled="tagControlsBusy" @keyup.enter="addTag" />
        <button class="ghost-button" type="button" :disabled="tagControlsBusy || !newTagName.trim()" :aria-busy="tagActionBusyId === 'tag-add'" @click="addTag">
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
            :disabled="tagControlsBusy"
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
        <button class="ghost-button compact-button" type="button" :disabled="tagControlsBusy" @click="loadTags">
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
            :disabled="tagControlsBusy"
            :aria-busy="isTagDeleteBusy(tag.id)"
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
        <button class="ghost-button" type="button" :disabled="presetControlsBusy" @click="startNewPreset">
          <Plus :size="17" />
          <span>新建预设</span>
        </button>
        <button class="ghost-button" type="button" @click="exportPresets" :disabled="presetControlsBusy || !presetList.length">
          <Download :size="17" />
          <span>导出</span>
        </button>
        <label class="ghost-button file-import-button" :class="{ disabled: presetControlsBusy }">
          <Upload :size="17" />
          <span>导入</span>
          <input type="file" accept=".json" :disabled="presetControlsBusy" @change="handlePresetImportFile" />
        </label>
      </div>
      <p v-if="presetLoading" class="muted-text" aria-live="polite">正在加载预设...</p>
      <div v-if="presetLoadError" class="section-load-status error-state" role="alert">
        <span>{{ presetLoadError }}</span>
        <button class="ghost-button compact-button" type="button" :disabled="presetControlsBusy" @click="loadPresets">
          <RefreshCw :size="17" />
          <span>{{ presetLoading ? '重试中...' : '重试' }}</span>
        </button>
      </div>

      <!-- Preset Editor -->
      <form v-if="showPresetEditor" class="preset-editor" :aria-busy="presetActionBusy" @submit.prevent="savePreset">
        <h3>{{ presetEditing ? '编辑预设' : '新建预设' }}</h3>
        <label class="field">
          <span>预设名称</span>
          <input v-model.trim="presetForm.name" placeholder="如：创意写作、精确回答" maxlength="80" :disabled="presetActionBusy" required />
        </label>
        <label class="field">
          <span>系统提示词</span>
          <textarea v-model="presetForm.systemPrompt" rows="4" placeholder="可选，会作为额外的 system 消息发送给模型" :disabled="presetActionBusy" />
        </label>
        <div class="form-grid two-col">
          <label class="field">
            <span>Temperature ({{ presetForm.temperature }})</span>
            <input v-model.number="presetForm.temperature" type="range" min="0" max="2" step="0.1" :disabled="presetActionBusy" />
          </label>
          <label class="field">
            <span>Max Tokens</span>
            <input v-model.number="presetForm.maxTokens" type="number" min="1" max="128000" step="1" :disabled="presetActionBusy" />
          </label>
          <label class="field">
            <span>Top P ({{ presetForm.topP }})</span>
            <input v-model.number="presetForm.topP" type="range" min="0" max="1" step="0.05" :disabled="presetActionBusy" />
          </label>
          <label class="field">
            <span>Frequency Penalty ({{ presetForm.frequencyPenalty }})</span>
            <input v-model.number="presetForm.frequencyPenalty" type="range" min="-2" max="2" step="0.1" :disabled="presetActionBusy" />
          </label>
          <label class="field">
            <span>Presence Penalty ({{ presetForm.presencePenalty }})</span>
            <input v-model.number="presetForm.presencePenalty" type="range" min="-2" max="2" step="0.1" :disabled="presetActionBusy" />
          </label>
        </div>
        <div class="form-actions">
          <button class="primary-button" type="submit" :disabled="presetActionBusy" :aria-busy="presetActionBusyId === 'preset-save'">
            <Save :size="18" />
            <span>{{ presetActionBusyId === 'preset-save' ? '保存中...' : presetEditing ? '保存修改' : '创建预设' }}</span>
          </button>
          <button class="ghost-button" type="button" :disabled="presetActionBusy" @click="cancelPresetEdit">
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
            <button class="icon-button" type="button" title="编辑" :aria-label="`编辑预设：${preset.name}`" :disabled="presetControlsBusy" @click="startEditPreset(preset)">
              <Sliders :size="16" />
            </button>
            <button
              v-if="!preset.isDefault"
              class="icon-button"
              type="button"
              title="设为默认"
              :aria-label="`设为默认预设：${preset.name}`"
              :disabled="presetControlsBusy"
              :aria-busy="isPresetDefaultBusy(preset.id)"
              @click="makeDefaultPreset(preset.id)"
            >
              <Save :size="16" />
            </button>
            <button
              class="icon-button danger"
              type="button"
              title="删除"
              :aria-label="`删除预设：${preset.name}`"
              :disabled="presetControlsBusy"
              :aria-busy="isPresetDeleteBusy(preset.id)"
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
        <button class="ghost-button" type="button" :disabled="modControlsBusy" @click="startNewMod">
          <Plus :size="17" />
          <span>新建 Mod</span>
        </button>
      </div>
      <p v-if="modLoading" class="muted-text" aria-live="polite">正在加载 Mod...</p>
      <div v-if="modLoadError" class="section-load-status error-state" role="alert">
        <span>{{ modLoadError }}</span>
        <button class="ghost-button compact-button" type="button" :disabled="modControlsBusy" @click="loadMods">
          <RefreshCw :size="17" />
          <span>{{ modLoading ? '重试中...' : '重试' }}</span>
        </button>
      </div>

      <!-- Mod Editor -->
      <Teleport to="body">
        <div v-if="showModEditor" class="mod-editor-overlay" @click.self="cancelModEdit">
          <form class="preset-editor mod-editor-modal" role="dialog" aria-modal="true" :aria-busy="modActionBusy" @submit.prevent="saveMod" @keydown.esc.prevent="cancelModEdit">
            <div class="mod-editor-header">
              <div>
                <span>Mod</span>
                <h3>{{ modEditing ? '编辑 Mod' : '新建 Mod' }}</h3>
              </div>
              <button class="icon-button" type="button" title="关闭" aria-label="关闭 Mod 编辑器" :disabled="modActionBusy" @click="cancelModEdit">
                <X :size="17" />
              </button>
            </div>
            <div class="mod-editor-body">
              <div class="form-grid two-col">
                <label class="field">
                  <span>Mod 名称</span>
                  <input v-model.trim="modForm.name" placeholder="如：文风增强、世界观注入" maxlength="80" :disabled="modActionBusy" required />
                </label>
                <label class="field">
                  <span>类型</span>
                  <select v-model="modForm.type" :disabled="modActionBusy">
                    <option value="prompt_inject">提示词注入</option>
                    <option value="style_enhance">文风增强</option>
                    <option value="custom">自定义</option>
                  </select>
                </label>
              </div>
              <label class="field">
                <span>描述</span>
                <input v-model.trim="modForm.description" placeholder="可选，简要描述此 Mod 的作用" maxlength="200" :disabled="modActionBusy" />
              </label>
              <label class="field">
                <span>内容</span>
                <textarea v-model="modForm.content" rows="8" placeholder="输入要注入的提示词或文风要求..." :disabled="modActionBusy" required />
              </label>
              <div class="field mod-scope-field">
                <span>加载范围</span>
                <div class="mod-scope-grid" role="radiogroup" aria-label="Mod 加载范围">
                  <label class="mod-scope-option" :class="{ active: modForm.scope === 'global' }">
                    <input v-model="modForm.scope" type="radio" value="global" aria-describedby="mod-scope-global-desc" :disabled="modActionBusy" />
                    <span class="mod-scope-text">
                      <strong>全局加载</strong>
                      <small id="mod-scope-global-desc">所有聊天都会注入，适合通用规则。</small>
                    </span>
                  </label>
                  <label class="mod-scope-option" :class="{ active: modForm.scope === 'all_characters' }">
                    <input v-model="modForm.scope" type="radio" value="all_characters" aria-describedby="mod-scope-all-desc" :disabled="modActionBusy" />
                    <span class="mod-scope-text">
                      <strong>全角色加载</strong>
                      <small id="mod-scope-all-desc">所有角色卡聊天生效，不影响无角色场景。</small>
                    </span>
                  </label>
                  <label class="mod-scope-option" :class="{ active: modForm.scope === 'characters' }">
                    <input v-model="modForm.scope" type="radio" value="characters" aria-describedby="mod-scope-characters-desc" :disabled="modActionBusy" />
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
                    <button class="ghost-button compact-button" type="button" :disabled="modActionBusy || !modCharacterOptions.length" @click="selectAllModCharacters">
                      全选
                    </button>
                    <button class="ghost-button compact-button" type="button" :disabled="modActionBusy || !modForm.characterIds.length" @click="clearModCharacters">
                      清空
                    </button>
                  </div>
                </div>
                <p v-if="modCharactersLoading" class="muted-text" aria-live="polite">正在加载角色...</p>
                <div v-if="modCharactersLoadError" class="section-load-status error-state" role="alert">
                  <span>{{ modCharactersLoadError }}</span>
                  <button class="ghost-button compact-button" type="button" :disabled="modCharactersLoading || modActionBusy" @click="loadModCharacterOptions">
                    <RefreshCw :size="17" />
                    <span>{{ modCharactersLoading ? '重试中...' : '重试' }}</span>
                  </button>
                </div>
                <div v-if="modCharacterOptions.length" class="mod-character-list">
                  <label v-for="character in modCharacterOptions" :key="character.id" class="mod-character-option">
                    <input v-model="modForm.characterIds" type="checkbox" :value="character.id" :disabled="modActionBusy" />
                    <span>{{ character.name }}</span>
                    <small>{{ visibilityText(character.visibility) }}</small>
                  </label>
                </div>
                <p v-else-if="!modCharactersLoading && !modCharactersLoadError" class="muted-text">暂无可绑定角色</p>
              </div>
              <label class="checkbox-line">
                <input v-model="modForm.enabled" type="checkbox" :disabled="modActionBusy" />
                <span>启用此 Mod</span>
              </label>
            </div>
            <div class="form-actions mod-editor-actions">
              <button class="ghost-button" type="button" :disabled="modActionBusy" @click="cancelModEdit">
                取消
              </button>
              <button class="primary-button" type="submit" :disabled="modActionBusy" :aria-busy="modActionBusyId === 'mod-save'">
                <Save :size="18" />
                <span>{{ modActionBusyId === 'mod-save' ? '保存中...' : modEditing ? '保存修改' : '创建 Mod' }}</span>
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
          :draggable="!modControlsBusy"
          :aria-busy="isModToggleBusy(mod.id) || isModDeleteBusy(mod.id) || modActionBusyId === 'mod-reorder'"
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
              :disabled="modControlsBusy"
              :aria-busy="isModToggleBusy(mod.id)"
              @click="toggleMod(mod)"
            >
              <Power :size="16" />
            </button>
            <button class="icon-button" type="button" title="编辑" :aria-label="`编辑 Mod：${mod.name}`" :disabled="modControlsBusy" @click="startEditMod(mod)">
              <Sliders :size="16" />
            </button>
            <button class="icon-button danger" type="button" title="删除" :aria-label="`删除 Mod：${mod.name}`" :disabled="modControlsBusy" :aria-busy="isModDeleteBusy(mod.id)" @click="removeMod(mod.id, mod.name)">
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
        <select v-model="regexGroupFilter" aria-label="正则规则分组筛选" :disabled="regexControlsBusy" @change="handleRegexGroupFilterChange">
          <option value="">全部分组</option>
          <option v-for="g in regexGroups" :key="g" :value="g">{{ g }}</option>
        </select>
        <button class="ghost-button" type="button" @click="exportRegexRules" :disabled="regexControlsBusy || !regexRules.length">
          <Download :size="17" />
          <span>导出</span>
        </button>
        <label class="ghost-button file-import-button" :class="{ disabled: regexControlsBusy }" :aria-busy="regexActionBusyId === 'regex-import'">
          <Upload :size="17" />
          <span>导入</span>
          <input type="file" accept=".json" :disabled="regexControlsBusy" @change="handleRegexImportFile" />
        </label>
      </div>
      <p v-if="regexLoading" class="muted-text" aria-live="polite">正在加载正则规则...</p>
      <div v-if="regexLoadError" class="section-load-status error-state" role="alert">
        <span>{{ regexLoadError }}</span>
        <button class="ghost-button compact-button" type="button" :disabled="regexControlsBusy" @click="loadRegexRules">
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
          :draggable="!regexControlsBusy"
          :aria-busy="isRegexToggleBusy(rule.id) || regexActionBusyId === 'regex-reorder'"
          @dragstart="onRegexDragStart($event, rule.id)"
          @dragover="onRegexDragOver($event, rule.id)"
          @drop="onRegexDrop(rule.id)"
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
            :disabled="regexControlsBusy"
            :aria-busy="isRegexToggleBusy(rule.id)"
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
