<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { Bot, Download, Heart, MessageSquareText, Plus, RefreshCw, Save, ShieldCheck, Sliders, Tag, Trash2, Upload, WalletCards, Puzzle, GripVertical, Power, Regex } from '@lucide/vue';
import {
  createTag,
  deleteTag,
  fetchDeepSeekBalance,
  fetchProviderModels,
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
const profileSaving = ref(false);
const avatarSaving = ref(false);
const modelLoading = ref(false);
const balanceLoading = ref(false);
const modelOptions = ref([]);
const balance = ref(null);
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
const canFetchModels = computed(() => Boolean(form.baseUrl && (form.apiKey || form.apiKeySet)));

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

async function loadSettings() {
  if (!isPersonalPage.value) {
    return;
  }
  loading.value = true;
  try {
    const [settings, userProfile] = await Promise.all([
      getProviderSettings(),
      getUserProfile()
    ]);
    applySettings(settings);
    applyProfile(userProfile);
  } catch (err) {
    notify.error(err.message);
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
      notify.info('官方接口没有返回可选模型，仍可手动填写模型名。');
    } else if (!modelOptions.value.some((model) => model.id === form.model)) {
      form.model = modelOptions.value[0].id;
      notify.success(`已获取 ${modelOptions.value.length} 个模型，并自动选择第一个。`);
    } else {
      notify.success(`已获取 ${modelOptions.value.length} 个模型。`);
    }
  } catch (err) {
    notify.error(err.message);
  } finally {
    modelLoading.value = false;
  }
}

async function submit() {
  saving.value = true;
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
    notify.success('设置已保存');
    emit('provider-saved');
  } catch (err) {
    notify.error(err.message);
  } finally {
    saving.value = false;
  }
}

async function handleUserAvatar(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) {
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
  try {
    const result = await saveUserAvatar({ avatarDataUrl: await readAsDataUrl(file) });
    profile.avatarUrl = result.user?.avatarUrl || '';
    notify.success('头像已保存');
    emit('profile-saved', result.user);
  } catch (err) {
    notify.error(err.message);
  } finally {
    avatarSaving.value = false;
  }
}

async function submitProfile() {
  profileSaving.value = true;
  try {
    const result = await saveUserProfile({
      displayName: profile.displayName
    });
    applyProfile(result);
    notify.success('个人资料已保存');
    emit('profile-saved', result.user);
  } catch (err) {
    notify.error(err.message);
  } finally {
    profileSaving.value = false;
  }
}

async function checkBalance() {
  balanceLoading.value = true;
  try {
    balance.value = await fetchDeepSeekBalance();
  } catch (err) {
    notify.error(err.message);
  } finally {
    balanceLoading.value = false;
  }
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
const tagList = ref([]);
const newTagName = ref('');
const tagLoading = ref(false);

onMounted(loadTags);

async function loadTags() {
  if (!isExtensionsPage.value) {
    return;
  }
  try {
    tagList.value = await fetchTags();
  } catch {
    // ignore
  }
}

async function addTag() {
  const name = newTagName.value.trim();
  if (!name) return;
  try {
    const tag = await createTag({ name });
    tagList.value = [...tagList.value, tag];
    newTagName.value = '';
    notify.success(`标签「${tag.name}」已创建`);
  } catch (err) {
    notify.error(err.message);
  }
}

async function removeTag(id, name) {
  if (!window.confirm(`确定删除标签「${name}」吗？关联的角色卡将失去此标签。`)) return;
  try {
    await deleteTag(id);
    tagList.value = tagList.value.filter((t) => t.id !== id);
    notify.success(`标签「${name}」已删除`);
  } catch (err) {
    notify.error(err.message);
  }
}

// ── Preset Management ──
const presetList = ref([]);
const presetLoading = ref(false);
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
const presetImportText = ref('');
const showPresetImport = ref(false);

onMounted(loadPresets);

async function loadPresets() {
  if (!isExtensionsPage.value) {
    return;
  }
  presetLoading.value = true;
  try {
    presetList.value = await fetchPresets();
  } catch {
    // ignore
  } finally {
    presetLoading.value = false;
  }
}

function startNewPreset() {
  presetEditing.value = null;
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

function startEditPreset(preset) {
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
}

async function savePreset() {
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
    if (presetEditing.value) {
      await updatePreset(presetEditing.value, payload);
      notify.success('预设已更新');
    } else {
      await createPreset(payload);
      notify.success('预设已创建');
    }
    presetEditing.value = null;
    await loadPresets();
  } catch (err) {
    notify.error(err.message);
  }
}

async function removePreset(id, name) {
  if (!window.confirm(`确定删除预设「${name}」吗？`)) return;
  try {
    await deletePreset(id);
    presetList.value = presetList.value.filter((p) => p.id !== id);
    if (presetEditing.value === id) {
      presetEditing.value = null;
    }
    notify.success(`预设「${name}」已删除`);
  } catch (err) {
    notify.error(err.message);
  }
}

async function makeDefaultPreset(id) {
  try {
    await setDefaultPreset(id);
    await loadPresets();
    notify.success('已设为默认预设');
  } catch (err) {
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

async function importPresets() {
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
      imported++;
    }
    presetImportText.value = '';
    showPresetImport.value = false;
    await loadPresets();
    notify.success(`已导入 ${imported} 个预设`);
  } catch (err) {
    notify.error('导入失败：JSON 格式不正确');
  }
}

function handlePresetImportFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    presetImportText.value = String(reader.result || '');
  };
  reader.readAsText(file);
}

// ── Mod Management ──
const modList = ref([]);
const modLoading = ref(false);
const modEditing = ref(null);
const modForm = reactive({
  name: '',
  description: '',
  type: 'prompt_inject',
  content: '',
  enabled: true
});
const draggingMod = ref(null);
const dragOverMod = ref(null);

onMounted(loadMods);

async function loadMods() {
  if (!isExtensionsPage.value) {
    return;
  }
  modLoading.value = true;
  try {
    modList.value = await fetchMods();
  } catch {
    // ignore
  } finally {
    modLoading.value = false;
  }
}

function startNewMod() {
  modEditing.value = null;
  Object.assign(modForm, {
    name: '',
    description: '',
    type: 'prompt_inject',
    content: '',
    enabled: true
  });
}

function startEditMod(mod) {
  modEditing.value = mod.id;
  Object.assign(modForm, {
    name: mod.name,
    description: mod.description,
    type: mod.type,
    content: mod.content,
    enabled: mod.enabled
  });
}

async function saveMod() {
  const payload = {
    name: modForm.name,
    description: modForm.description,
    type: modForm.type,
    content: modForm.content,
    enabled: modForm.enabled
  };
  try {
    if (modEditing.value) {
      await updateMod(modEditing.value, payload);
      notify.success('Mod 已更新');
    } else {
      await createMod(payload);
      notify.success('Mod 已创建');
    }
    modEditing.value = null;
    await loadMods();
  } catch (err) {
    notify.error(err.message);
  }
}

async function removeMod(id, name) {
  if (!window.confirm(`确定删除 Mod「${name}」吗？`)) return;
  try {
    await deleteMod(id);
    modList.value = modList.value.filter((m) => m.id !== id);
    if (modEditing.value === id) {
      modEditing.value = null;
    }
    notify.success(`Mod「${name}」已删除`);
  } catch (err) {
    notify.error(err.message);
  }
}

async function toggleMod(mod) {
  try {
    await updateMod(mod.id, { enabled: !mod.enabled });
    mod.enabled = !mod.enabled;
    notify.success(mod.enabled ? `Mod「${mod.name}」已启用` : `Mod「${mod.name}」已禁用`);
  } catch (err) {
    notify.error(err.message);
  }
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
  if (!draggingMod.value || draggingMod.value === targetMod.id) {
    dragOverMod.value = null;
    return;
  }

  const fromIndex = modList.value.findIndex((m) => m.id === draggingMod.value);
  const toIndex = modList.value.findIndex((m) => m.id === targetMod.id);
  if (fromIndex === -1 || toIndex === -1) return;

  const newList = [...modList.value];
  const [moved] = newList.splice(fromIndex, 1);
  newList.splice(toIndex, 0, moved);
  modList.value = newList;
  dragOverMod.value = null;

  try {
    await reorderMods(newList.map((m) => m.id));
  } catch (err) {
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
const regexGroupFilter = ref('');
const regexImportText = ref('');
const showRegexImport = ref(false);
const dragIndex = ref(-1);

onMounted(loadRegexRules);

async function loadRegexRules() {
  if (!isExtensionsPage.value) {
    return;
  }
  regexLoading.value = true;
  try {
    regexRules.value = await fetchRegexRules(regexGroupFilter.value);
  } catch {
    // ignore
  } finally {
    regexLoading.value = false;
  }
}

async function handleToggleRegexRule(ruleId) {
  try {
    await toggleRegexRule(ruleId);
    await loadRegexRules();
    notify.success('规则状态已切换');
  } catch (err) {
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
  const items = [...regexRules.value];
  const [moved] = items.splice(dragIndex.value, 1);
  items.splice(dropIndex, 0, moved);
  regexRules.value = items;
  dragIndex.value = -1;
  try {
    await reorderRegexRules(items.map((r) => r.id));
    notify.success('排序已保存');
  } catch (err) {
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

async function importRegexRules() {
  try {
    const parsed = JSON.parse(regexImportText.value);
    const result = await importRegexRuleSet(Array.isArray(parsed) ? { rules: parsed } : parsed);
    const imported = result.imported || 0;
    regexImportText.value = '';
    showRegexImport.value = false;
    await loadRegexRules();
    if (result.skipped?.length) {
      notify.warning(`已跳过 ${result.skipped.length} 条无效或无权限规则`);
    }
    notify.success(`已导入 ${imported} 条规则`);
  } catch (err) {
    notify.error('导入失败：JSON 格式不正确');
  }
}

function handleRegexImportFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    regexImportText.value = String(reader.result || '');
    importRegexRules();
  };
  reader.readAsText(file);
}

function scrollToSection(sectionId) {
  activeExtensionSection.value = sectionId;
  const el = document.getElementById(`extension-section-${sectionId}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
</script>

<template>
  <section class="page-stack narrow-page">
    <div class="section-heading">
      <div>
        <p>{{ isExtensionsPage ? '扩展管理' : '个人中心' }}</p>
        <h1>{{ isExtensionsPage ? '标签、预设、Mod 与正则' : '账户、权限与 AI 资产' }}</h1>
      </div>
    </div>

    <!-- Extension Section Navigation -->
    <nav v-if="isExtensionsPage" class="form-section-nav">
      <button
        v-for="section in extensionSections"
        :key="section.id"
        class="form-section-tab"
        :class="{ active: activeExtensionSection === section.id }"
        @click="scrollToSection(section.id)"
      >
        {{ section.label }}
      </button>
    </nav>

    <p v-if="isPersonalPage && form.apiKeyNeedsReset" class="error-text">
      已保存的 API Key 无法解密。请重新粘贴 SK 并保存设置，之后再获取模型或查询余额。
    </p>
    <p v-if="isPersonalPage && loading" class="muted-text">正在加载设置...</p>

    <section v-if="isPersonalPage" class="form-panel profile-panel">
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

    <form v-if="isPersonalPage && !loading" class="form-panel" @submit.prevent="submit">
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
      <div class="tag-add-row">
        <input v-model="newTagName" placeholder="新标签名称" maxlength="30" @keyup.enter="addTag" />
        <button class="ghost-button" type="button" :disabled="!newTagName.trim()" @click="addTag">
          <Plus :size="17" />
          <span>添加</span>
        </button>
      </div>
      <div v-if="tagList.length" class="tag-manage-list">
        <div v-for="tag in tagList" :key="tag.id" class="tag-manage-item">
          <span class="tag-badge" :style="tag.color ? { '--tag-color': tag.color } : {}">{{ tag.name }}</span>
          <span class="tag-usage">{{ tag.usageCount || 0 }} 个角色</span>
          <button class="icon-button danger" type="button" title="删除标签" @click="removeTag(tag.id, tag.name)">
            <Trash2 :size="16" />
          </button>
        </div>
      </div>
      <p v-else class="muted-text">还没有标签，在角色卡编辑页或这里创建。</p>
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

      <!-- Preset Editor -->
      <form v-if="presetEditing !== null || presetForm.name !== ''" class="preset-editor" @submit.prevent="savePreset">
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
          <button class="ghost-button" type="button" @click="presetEditing = null; startNewPreset()">
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
            <button class="icon-button" type="button" title="编辑" @click="startEditPreset(preset)">
              <Sliders :size="16" />
            </button>
            <button v-if="!preset.isDefault" class="icon-button" type="button" title="设为默认" @click="makeDefaultPreset(preset.id)">
              <Save :size="16" />
            </button>
            <button class="icon-button danger" type="button" title="删除" @click="removePreset(preset.id, preset.name)">
              <Trash2 :size="16" />
            </button>
          </div>
        </div>
      </div>
      <p v-else class="muted-text">还没有预设，点击「新建预设」创建第一个。</p>
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

      <!-- Mod Editor -->
      <form v-if="modEditing !== null || modForm.name !== ''" class="preset-editor" @submit.prevent="saveMod">
        <h3>{{ modEditing ? '编辑 Mod' : '新建 Mod' }}</h3>
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
          <textarea v-model="modForm.content" rows="5" placeholder="输入要注入的提示词或文风要求..." required />
        </label>
        <label class="checkbox-line">
          <input v-model="modForm.enabled" type="checkbox" />
          <span>启用此 Mod</span>
        </label>
        <div class="form-actions">
          <button class="primary-button" type="submit">
            <Save :size="18" />
            <span>{{ modEditing ? '保存修改' : '创建 Mod' }}</span>
          </button>
          <button class="ghost-button" type="button" @click="modEditing = null; startNewMod()">
            取消
          </button>
        </div>
      </form>

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
              <span v-if="!mod.enabled" class="mod-disabled-badge">已禁用</span>
            </div>
            <p v-if="mod.description" class="mod-card-desc">{{ mod.description }}</p>
            <p class="mod-card-preview">{{ mod.content.slice(0, 120) }}{{ mod.content.length > 120 ? '...' : '' }}</p>
          </div>
          <div class="mod-card-actions">
            <button class="icon-button" :class="{ active: mod.enabled }" type="button" :title="mod.enabled ? '禁用' : '启用'" @click="toggleMod(mod)">
              <Power :size="16" />
            </button>
            <button class="icon-button" type="button" title="编辑" @click="startEditMod(mod)">
              <Sliders :size="16" />
            </button>
            <button class="icon-button danger" type="button" title="删除" @click="removeMod(mod.id, mod.name)">
              <Trash2 :size="16" />
            </button>
          </div>
        </div>
      </div>
      <p v-else class="muted-text">还没有 Mod，点击「新建 Mod」创建第一个。拖拽卡片可调整顺序。</p>
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
        <select v-model="regexGroupFilter" @change="loadRegexRules">
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
      <p v-if="regexLoading" class="muted-text">正在加载...</p>
      <div v-else-if="regexRules.length" class="regex-rule-list">
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
            @click="handleToggleRegexRule(rule.id)"
          >
            <Power :size="16" />
          </button>
        </div>
      </div>
      <p v-else class="muted-text">还没有正则规则。在角色编辑页创建规则后会在这里显示。</p>
    </section>

    <section v-if="isPersonalPage && balance" class="balance-panel">
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
