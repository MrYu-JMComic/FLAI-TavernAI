<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ArrowLeft, Download, ListChecks, Plus, Save, Settings, Sparkles, Trash2, Upload, WandSparkles } from '@lucide/vue';
import { completeCharacterDraft, createCharacter, createTag, deleteCharacter, exportCharacter, fetchCharacter, fetchTags, fetchWorldBooks, updateCharacter } from '../api';
import MarkdownContent from '../components/MarkdownContent.vue';
import VariableEditor from '../components/VariableEditor.vue';
import { useNotify } from '../composables/useNotify';

const props = defineProps({
  route: {
    type: Object,
    required: true
  },
  user: {
    type: Object,
    default: null
  }
});
const emit = defineEmits(['navigate']);
const notify = useNotify();

const isEditing = computed(() => props.route.name === 'characterEdit');
const loading = ref(false);
const saving = ref(false);
const aiLoading = ref(false);
const aiRequirement = ref('');
const aiToolCalls = ref([]);
const previewInput = ref('猫在雨里说你好');
const worldBooks = ref([]);
const availableTags = ref([]);
const tagSearch = ref('');
const activeSection = ref('basic');
const form = reactive(emptyCharacter());

const formSections = [
  { id: 'basic', label: '基础信息' },
  { id: 'settings', label: '角色设定' },
  { id: 'advanced', label: '高级功能' }
];

function scrollToSection(id) {
  activeSection.value = id;
  const el = document.getElementById(`section-${id}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
const accessorySkillItems = [
  { key: 'npcAgent', label: 'NPC Agent', auto: false },
  { key: 'statusBarAgent', label: '状态栏 Agent', auto: true },
  { key: 'economyAgent', label: '经济识别', auto: false },
  { key: 'talentPrompt', label: '天赋提示', auto: false },
  { key: 'cgScene', label: 'CG 场景', auto: false }
];
const canEdit = computed(() => !isEditing.value || form.canEdit !== false);
const permissionText = computed(() => {
  if (!isEditing.value) {
    return '你将成为这个角色的拥有者';
  }
  return form.canEdit ? '你是角色拥有者，可编辑全部设置' : '你是角色使用者，只能查看和发起对话';
});

const regexPreview = computed(() => {
  return applyLocalRules(previewInput.value, form.regexRules, 'input');
});
const enabledRenderPlugins = computed(() => form.renderPlugins.filter((plugin) => plugin.enabled !== false && plugin.pattern));
const renderPluginPreviewText = computed(() => {
  return [form.background, form.worldview, form.persona, form.openingMessage]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('\n\n');
});
const userVariableValue = computed(() => {
  return props.user?.displayName || props.user?.accountName || props.user?.username || '用户';
});
const filteredTags = computed(() => {
  const search = tagSearch.value.trim().toLowerCase();
  if (!search) return availableTags.value;
  return availableTags.value.filter((t) => t.name.toLowerCase().includes(search));
});

onMounted(async () => {
  try {
    [worldBooks.value, availableTags.value] = await Promise.all([fetchWorldBooks(), fetchTags()]);
  } catch {
    // ignore
  }

  if (!isEditing.value) {
    return;
  }

  loading.value = true;
  try {
    const character = await fetchCharacter(props.route.params.id);
    Object.assign(form, normalizeForForm(character));
  } catch (err) {
    notify.error(err.message);
  } finally {
    loading.value = false;
  }
});

async function submit() {
  if (!canEdit.value) {
    return;
  }

  saving.value = true;
  try {
    const payload = toPayload();
    const saved = isEditing.value
      ? await updateCharacter(props.route.params.id, payload)
      : await createCharacter(payload);
    notify.success(isEditing.value ? '角色已保存' : '角色已创建');
    emit('navigate', 'characterEdit', { id: saved.id });
  } catch (err) {
    notify.error(err.message);
  } finally {
    saving.value = false;
  }
}

async function completeWithAi() {
  const requirement = aiRequirement.value.trim();
  if (!requirement && !hasDraftSeed()) {
    notify.warning('请先写一点角色要求，或保留已有设定作为参考');
    return;
  }

  aiLoading.value = true;
  aiToolCalls.value = [];
  try {
    const result = await completeCharacterDraft({
      requirement,
      character: toPayload()
    });
    applyAiDraft(result.character || {});
    aiToolCalls.value = result.toolCalls || [];
    notify.success(`AI 已完善设定，调用 ${aiToolCalls.value.length} 次工具`);
  } catch (err) {
    notify.error(err.message);
  } finally {
    aiLoading.value = false;
  }
}

async function removeCharacter() {
  if (!isEditing.value || !canEdit.value || !window.confirm('确定删除这个角色和相关对话吗？')) {
    return;
  }

  try {
    await deleteCharacter(props.route.params.id);
    notify.success('角色已删除');
    emit('navigate', 'home');
  } catch (err) {
    notify.error(err.message);
  }
}

function addRule() {
  if (!canEdit.value) {
    return;
  }

  form.regexRules.push({
    label: `规则 ${form.regexRules.length + 1}`,
    pattern: '',
    replacement: '',
    flags: 'g',
    scope: 'input',
    enabled: true,
    groupName: '全局',
    priority: 0
  });
}

function removeRule(index) {
  if (!canEdit.value) {
    return;
  }

  form.regexRules.splice(index, 1);
}

function addRenderPlugin(preset = false) {
  if (!canEdit.value) {
    return;
  }

  form.renderPlugins.push({
    ...defaultRenderPlugin(),
    label: preset ? '档案标题折叠' : `渲染插件 ${form.renderPlugins.length + 1}`,
    pattern: preset ? defaultRenderPlugin().pattern : ''
  });
}

function removeRenderPlugin(index) {
  if (!canEdit.value) {
    return;
  }

  form.renderPlugins.splice(index, 1);
}

function insertUserVariable(field) {
  if (!canEdit.value || typeof form[field] !== 'string') {
    return;
  }
  form[field] = form[field] ? `${form[field]}{user}` : '{user}';
}

async function handleAvatar(event) {
  if (!canEdit.value) {
    return;
  }

  const file = event.target.files?.[0];
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

  form.avatarUrl = await readAsDataUrl(file);
}

function toPayload() {
  return {
    name: form.name,
    avatarUrl: form.avatarUrl,
    gender: form.gender,
    age: form.age,
    background: form.background,
    worldview: form.worldview,
    persona: form.persona,
    openingMessage: form.openingMessage,
    visibility: form.visibility,
    authorAdvancedSettings: {
      desktopBackgroundUrl: form.authorAdvancedSettings.desktopBackgroundUrl,
      mobileBackgroundUrl: form.authorAdvancedSettings.mobileBackgroundUrl,
      customCss: form.authorAdvancedSettings.customCss,
      customJs: form.authorAdvancedSettings.customJs,
      statusBarPrompt: form.authorAdvancedSettings.statusBarPrompt,
      accessorySkills: normalizeAccessorySkillsForPayload(form.authorAdvancedSettings.accessorySkills)
    },
    renderPlugins: form.renderPlugins,
    regexRules: form.regexRules,
    worldBookId: form.worldBookId || null,
    tags: form.selectedTags.length ? form.selectedTags : form.tagsText.split(',').map((tag) => tag.trim()).filter(Boolean)
  };
}

function toggleTagSelection(name) {
  const idx = form.selectedTags.indexOf(name);
  if (idx >= 0) {
    form.selectedTags.splice(idx, 1);
  } else {
    form.selectedTags.push(name);
  }
}

async function createAndSelectTag() {
  const name = tagSearch.value.trim();
  if (!name) return;
  if (form.selectedTags.includes(name)) return;
  try {
    const tag = await createTag({ name });
    availableTags.value = [...availableTags.value, tag];
    form.selectedTags.push(name);
    tagSearch.value = '';
  } catch (err) {
    notify.error(err.message);
  }
}

function applyAiDraft(character = {}) {
  for (const key of ['name', 'avatarUrl', 'gender', 'age', 'background', 'worldview', 'persona', 'openingMessage', 'visibility']) {
    if (Object.prototype.hasOwnProperty.call(character, key)) {
      form[key] = character[key] || '';
    }
  }
  if (Array.isArray(character.tags)) {
    form.tagsText = character.tags.join(', ');
  }
  if (Array.isArray(character.regexRules)) {
    form.regexRules = character.regexRules;
  }
  if (Array.isArray(character.renderPlugins)) {
    form.renderPlugins = character.renderPlugins;
  }
  if (character.authorAdvancedSettings || character.advancedSettings) {
    const nextSettings = character.authorAdvancedSettings || character.advancedSettings;
    Object.assign(form.authorAdvancedSettings, nextSettings);
    form.authorAdvancedSettings.accessorySkills = normalizeAccessorySkillsForPayload(nextSettings.accessorySkills);
  }
}

function hasDraftSeed() {
  const payload = toPayload();
  return ['name', 'gender', 'age', 'background', 'worldview', 'persona', 'openingMessage']
    .some((key) => String(payload[key] || '').trim())
    || payload.tags.length > 0
    || payload.regexRules.length > 0;
}

function emptyCharacter() {
  return {
    name: '',
    avatarUrl: '',
    gender: '',
    age: '',
    background: '',
    worldview: '',
    persona: '',
    openingMessage: '',
    visibility: 'private',
    tagsText: '',
    selectedTags: [],
    worldBookId: '',
    renderPlugins: [defaultRenderPlugin()],
    authorAdvancedSettings: {
      desktopBackgroundUrl: '',
      mobileBackgroundUrl: '',
      customCss: '',
      customJs: '',
      statusBarPrompt: '',
      accessorySkills: createDefaultAccessorySkills()
    },
    regexRules: [],
    canEdit: true,
    canUse: true,
    isOwner: true
  };
}

function defaultRenderPlugin() {
  return {
    label: '档案标题折叠',
    type: 'fold',
    pattern: '^[>▸▾▶▼◆◇✦✧★☆*+\\-\\s]*[【\\[]([^】\\]\\n]*(?:档案|情报|状态栏|记忆栏|设定|剧情|世界观|摘要|面板|资料)[^】\\]\\n]*)[】\\]][◆◇✦✧★☆*+\\-\\s]*$',
    flags: 'u',
    titleTemplate: '$1',
    enabled: true
  };
}

function createDefaultAccessorySkills() {
  return {
    npcAgent: { enabled: false, modelOverride: '' },
    statusBarAgent: { enabled: 'auto', modelOverride: '' },
    economyAgent: { enabled: false, modelOverride: '' },
    talentPrompt: { enabled: false, modelOverride: '' },
    cgScene: { enabled: false, modelOverride: '' }
  };
}

function normalizeAccessorySkillsForPayload(input = {}) {
  const defaults = createDefaultAccessorySkills();
  return Object.fromEntries(
    Object.keys(defaults).map((key) => {
      const source = input?.[key] || {};
      return [
        key,
        {
          enabled: normalizeSkillEnabled(source.enabled, defaults[key].enabled),
          modelOverride: String(source.modelOverride || source.model_override || '').trim()
        }
      ];
    })
  );
}

function normalizeSkillEnabled(value, fallback = false) {
  if (value === 'auto') return 'auto';
  if (value === true || value === 'true' || value === 'on') return true;
  if (value === false || value === 'false' || value === 'off') return false;
  return fallback;
}

function normalizeForForm(character) {
  return {
    ...emptyCharacter(),
    ...character,
    visibility: character.visibility || 'private',
    worldBookId: character.worldBookId || '',
    canEdit: character.canEdit !== false,
    canUse: character.canUse !== false,
    isOwner: character.isOwner === true,
    tagsText: (character.tags || []).join(', '),
    selectedTags: (character.characterTags || []).map((t) => t.name),
    renderPlugins: character.renderPlugins || [],
    authorAdvancedSettings: {
      ...emptyCharacter().authorAdvancedSettings,
      ...(character.authorAdvancedSettings || {}),
      accessorySkills: normalizeAccessorySkillsForPayload((character.authorAdvancedSettings || character.advancedSettings || {}).accessorySkills)
    },
    regexRules: character.regexRules || []
  };
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('头像读取失败'));
    reader.readAsDataURL(file);
  });
}

async function handleExport() {
  try {
    const data = await exportCharacter(props.route.params.id);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.character?.name || 'character'}.flai-char.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify.success('角色卡已导出');
  } catch (err) {
    notify.error(err.message);
  }
}

function applyLocalRules(text, rules, phase) {
  return rules.reduce((value, rule) => {
    if (!rule.enabled || !rule.pattern || !(rule.scope === phase || rule.scope === 'both')) {
      return value;
    }
    try {
      return value.replace(new RegExp(rule.pattern, rule.flags || 'g'), rule.replacement || '');
    } catch {
      return value;
    }
  }, text);
}

</script>

<template>
  <section class="page-stack">
    <div class="section-heading">
      <div>
        <p>{{ isEditing && !canEdit ? '查看角色' : isEditing ? '编辑角色' : '创建角色' }}</p>
        <h1>{{ isEditing ? form.name || '角色编辑' : '创建新的 AI 角色' }}</h1>
      </div>
      <button class="ghost-button" type="button" @click="emit('navigate', 'home')">
        <ArrowLeft :size="18" />
        <span>返回</span>
      </button>
    </div>

    <p v-if="loading" class="muted-text">正在加载角色...</p>
    <p v-if="!loading" class="permission-note" :class="{ readonly: !canEdit }">{{ permissionText }}</p>

    <nav v-if="!loading" class="form-section-nav">
      <button
        v-for="section in formSections"
        :key="section.id"
        class="form-section-tab"
        :class="{ active: activeSection === section.id }"
        type="button"
        @click="scrollToSection(section.id)"
      >
        {{ section.label }}
      </button>
    </nav>

    <form v-if="!loading" class="editor-layout" @submit.prevent="submit">
      <section class="form-panel">
        <div id="section-basic" class="form-section-group">
          <div class="inline-heading">
            <div>
              <h2>基础信息</h2>
              <p>
                <span class="variable-token">{user}</span>
                <span>当前：{{ userVariableValue }}</span>
              </p>
            </div>
          </div>

          <div class="avatar-editor">
            <div class="large-avatar">
              <img v-if="form.avatarUrl" :src="form.avatarUrl" :alt="form.name" />
              <span v-else>{{ form.name.slice(0, 1) || 'F' }}</span>
            </div>
            <label v-if="canEdit" class="file-button">
              <Upload :size="18" />
              <span>上传头像</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" @change="handleAvatar" />
            </label>
            <div v-else class="permission-chip">只读展示</div>
          </div>

          <div class="form-grid two-col">
            <div class="field full-span">
              <span>展示权限</span>
              <div class="visibility-picker" :class="{ disabled: !canEdit }">
                <label>
                  <input v-model="form.visibility" type="radio" value="private" :disabled="!canEdit" />
                  <span>
                    私人角色
                    <small>仅拥有者可见、可编辑、可使用</small>
                  </span>
                </label>
                <label>
                  <input v-model="form.visibility" type="radio" value="public" :disabled="!canEdit" />
                  <span>
                    公开角色
                    <small>所有登录用户可查看和使用，仅拥有者可编辑</small>
                  </span>
                </label>
              </div>
            </div>
            <label class="field">
              <span>角色名</span>
              <input v-model.trim="form.name" required maxlength="40" :disabled="!canEdit" />
            </label>
            <div class="field">
              <span>标签</span>
              <div class="tag-selector" :class="{ disabled: !canEdit }">
                <div v-if="form.selectedTags.length" class="selected-tags">
                  <span
                    v-for="tagName in form.selectedTags"
                    :key="tagName"
                    class="tag-badge removable"
                    @click="canEdit && toggleTagSelection(tagName)"
                  >
                    {{ tagName }}
                    <span v-if="canEdit" class="tag-remove">×</span>
                  </span>
                </div>
                <div v-if="canEdit" class="tag-input-row">
                  <input v-model="tagSearch" placeholder="搜索或创建标签..." class="tag-search-input" />
                  <button
                    v-if="tagSearch.trim() && !availableTags.some((t) => t.name === tagSearch.trim())"
                    class="ghost-button tag-create-btn"
                    type="button"
                    @click="createAndSelectTag"
                  >
                    <Plus :size="14" />
                    创建
                  </button>
                </div>
                <div v-if="canEdit && tagSearch.trim()" class="tag-dropdown">
                  <button
                    v-for="tag in filteredTags"
                    :key="tag.id"
                    class="tag-option"
                    :class="{ selected: form.selectedTags.includes(tag.name) }"
                    type="button"
                    @click="toggleTagSelection(tag.name)"
                  >
                    {{ tag.name }}
                    <span v-if="form.selectedTags.includes(tag.name)" class="tag-check">✓</span>
                  </button>
                  <p v-if="!filteredTags.length" class="muted-text tag-empty">无匹配标签</p>
                </div>
              </div>
              <small class="muted-text">选择已有标签或输入新标签名创建</small>
            </div>
            <label class="field full-span">
              <span>关联世界书</span>
              <select v-model="form.worldBookId" :disabled="!canEdit">
                <option value="">不关联</option>
                <option v-for="wb in worldBooks" :key="wb.id" :value="wb.id">{{ wb.name }}</option>
              </select>
              <small v-if="worldBooks.length" class="muted-text">选择世界书后，对话中触发词匹配时会自动注入设定</small>
              <small v-else class="muted-text">还没有世界书，去 <a href="#/world-books">世界书管理</a> 创建</small>
            </label>
            <label class="field">
              <span>性别</span>
              <input v-model.trim="form.gender" maxlength="24" :disabled="!canEdit" />
            </label>
            <label class="field">
              <span>年龄</span>
              <input v-model.trim="form.age" maxlength="24" :disabled="!canEdit" />
            </label>
          </div>
        </div>

        <div id="section-settings" class="form-section-group">
          <h3 class="form-section-title">角色设定</h3>
          <p class="form-section-desc">定义角色的背景、世界观、人设和开场白。支持 <span class="variable-token">{user}</span> 变量替换。</p>

          <div class="field">
            <div class="field-heading">
              <span>背景</span>
              <button class="variable-insert-button" type="button" :disabled="!canEdit" @click="insertUserVariable('background')">
                {user}
              </button>
            </div>
            <VariableEditor
              v-model="form.background"
              :rows="4"
              :disabled="!canEdit"
              :user-value="userVariableValue"
              placeholder=""
            />
          </div>
          <div class="field">
            <div class="field-heading">
              <span>世界观</span>
              <button class="variable-insert-button" type="button" :disabled="!canEdit" @click="insertUserVariable('worldview')">
                {user}
              </button>
            </div>
            <VariableEditor
              v-model="form.worldview"
              :rows="4"
              :disabled="!canEdit"
              :user-value="userVariableValue"
              placeholder=""
            />
          </div>
          <div class="field">
            <div class="field-heading">
              <span>人设</span>
              <button class="variable-insert-button" type="button" :disabled="!canEdit" @click="insertUserVariable('persona')">
                {user}
              </button>
            </div>
            <VariableEditor
              v-model="form.persona"
              :rows="5"
              :disabled="!canEdit"
              :user-value="userVariableValue"
              placeholder=""
            />
          </div>
          <div class="field">
            <div class="field-heading">
              <span>开场白</span>
              <button class="variable-insert-button" type="button" :disabled="!canEdit" @click="insertUserVariable('openingMessage')">
                {user}
              </button>
            </div>
            <VariableEditor
              v-model="form.openingMessage"
              :rows="4"
              :disabled="!canEdit"
              :user-value="userVariableValue"
              placeholder=""
            />
          </div>
        </div>
      </section>

      <div class="editor-side">
        <div id="section-advanced" class="form-section-group-advanced">
        <section v-if="canEdit" class="form-panel ai-draft-panel">
          <div class="inline-heading">
            <div>
              <h2>AI 完善设定</h2>
              <p>按你的要求自动补全角色字段和正则规则。</p>
            </div>
            <Sparkles :size="20" />
          </div>
          <label class="field">
            <span>完善要求</span>
            <textarea
              v-model="aiRequirement"
              rows="5"
              placeholder="例如：赛博茶馆老板娘，温柔但有边界，会把用户称作{user}；需要把用户输入里的'老板'替换成'掌柜'。"
              :disabled="aiLoading"
            />
          </label>
          <button class="primary-button ai-draft-button" type="button" :disabled="aiLoading" @click="completeWithAi">
            <WandSparkles :size="18" />
            <span>{{ aiLoading ? 'AI 正在调用工具...' : 'AI 完善角色设定' }}</span>
          </button>
          <div v-if="aiToolCalls.length" class="ai-tool-list">
            <div class="ai-tool-title">
              <ListChecks :size="16" />
              <span>工具调用 {{ aiToolCalls.length }}</span>
            </div>
            <span v-for="(call, index) in aiToolCalls" :key="`${call.name}-${index}`">
              {{ call.name }}
            </span>
          </div>
        </section>

        <section class="form-panel advanced-settings-panel">
          <div class="inline-heading">
            <div>
              <h2>作者高级设置</h2>
              <p>固定随角色进入对话；从聊天里打开时只读展示，使用者可另加自己的设置。</p>
            </div>
            <Settings :size="20" />
          </div>

          <div class="advanced-grid">
            <label class="field">
              <span>电脑端背景</span>
              <input
                v-model="form.authorAdvancedSettings.desktopBackgroundUrl"
                type="text"
                placeholder="图片链接、短链或 data URL，可留空"
                :disabled="!canEdit"
              />
            </label>
            <label class="field">
              <span>手机端背景</span>
              <input
                v-model="form.authorAdvancedSettings.mobileBackgroundUrl"
                type="text"
                placeholder="手机端专用背景，可留空"
                :disabled="!canEdit"
              />
            </label>
          </div>

          <label class="field">
            <span>状态栏提示词</span>
            <textarea
              v-model="form.authorAdvancedSettings.statusBarPrompt"
              rows="4"
              placeholder="例如：HP 降低、好感变化、获得金币时更新对应变量。"
              :disabled="!canEdit"
            />
          </label>

          <div class="accessory-defaults-panel">
            <div class="inline-heading compact">
              <div>
                <h3>附属技能默认值</h3>
                <p>作为新会话默认值；使用者仍可在会话中覆盖。</p>
              </div>
            </div>
            <div class="accessory-skills-grid">
              <div v-for="item in accessorySkillItems" :key="item.key" class="accessory-skill-row">
                <label class="field compact">
                  <span>{{ item.label }}</span>
                  <select v-model="form.authorAdvancedSettings.accessorySkills[item.key].enabled" :disabled="!canEdit">
                    <option :value="false">关闭</option>
                    <option :value="true">开启</option>
                    <option v-if="item.auto" value="auto">自动</option>
                  </select>
                </label>
                <label class="field compact">
                  <span>模型覆盖</span>
                  <input
                    v-model="form.authorAdvancedSettings.accessorySkills[item.key].modelOverride"
                    type="text"
                    placeholder="留空使用当前模型"
                    maxlength="100"
                    :disabled="!canEdit"
                  />
                </label>
              </div>
            </div>
          </div>

          <label class="field">
            <span>内置 CSS</span>
            <textarea
              v-model="form.authorAdvancedSettings.customCss"
              rows="5"
              placeholder=".deep-bubble { ... }"
              :disabled="!canEdit"
            />
          </label>

          <label class="field">
            <span>内置 JS</span>
            <textarea
              v-model="form.authorAdvancedSettings.customJs"
              rows="5"
              placeholder="return () => {}"
              :disabled="!canEdit"
            />
          </label>
        </section>

        <section class="form-panel render-plugin-panel">
          <div class="inline-heading">
            <div>
              <h2>消息渲染插件</h2>
              <p>用正则把角色回复中的指定标题行渲染成默认收起的折叠消息。</p>
            </div>
            <button class="ghost-button" type="button" :disabled="!canEdit" @click="addRenderPlugin(true)">
              <Plus :size="17" />
              <span>插件</span>
            </button>
          </div>

          <div v-for="(plugin, index) in form.renderPlugins" :key="index" class="render-plugin-row">
            <label class="checkbox-line plugin-enabled">
              <input v-model="plugin.enabled" type="checkbox" :disabled="!canEdit" />
              <span>启用</span>
            </label>
            <input v-model="plugin.label" class="plugin-label" placeholder="插件名称" :disabled="!canEdit" />
            <input v-model="plugin.pattern" class="plugin-pattern" placeholder="标题行正则，例如 ^【(.+档案.*)】$" :disabled="!canEdit" />
            <input v-model="plugin.titleTemplate" class="plugin-template" placeholder="标题模板，例如 $1" :disabled="!canEdit" />
            <input v-model="plugin.flags" class="flags-input plugin-flags" placeholder="u" :disabled="!canEdit" />
            <button
              v-if="canEdit"
              class="icon-button danger plugin-delete"
              type="button"
              title="删除插件"
              @click="removeRenderPlugin(index)"
            >
              <Trash2 :size="17" />
            </button>
          </div>

          <button v-if="canEdit && !form.renderPlugins.length" class="ghost-button add-plugin-empty" type="button" @click="addRenderPlugin(true)">
            <Plus :size="17" />
            <span>添加折叠插件</span>
          </button>

          <div class="render-plugin-preview">
            <label class="field">
              <span>角色内容预览</span>
              <textarea
                :value="renderPluginPreviewText || '当前角色还没有可预览的背景、世界观、人设或开场白。'"
                rows="6"
                readonly
              />
            </label>
            <div class="render-preview-card">
              <MarkdownContent
                v-if="renderPluginPreviewText"
                :text="renderPluginPreviewText"
                :render-plugins="enabledRenderPlugins"
              />
              <p v-else class="muted-text render-preview-empty">填写角色设定后，这里会直接预览真实角色内容的渲染效果。</p>
            </div>
          </div>
        </section>

        <section class="form-panel regex-panel">
        <div class="inline-heading">
          <div>
            <h2>高阶正则替换</h2>
            <p>按顺序应用，可选择输入、输出或双向作用域。</p>
          </div>
          <button class="ghost-button" type="button" :disabled="!canEdit" @click="addRule">
            <Plus :size="17" />
            <span>规则</span>
          </button>
        </div>

        <div v-for="(rule, index) in form.regexRules" :key="index" class="rule-row">
          <label class="checkbox-line rule-enabled">
            <input v-model="rule.enabled" type="checkbox" :disabled="!canEdit" />
            <span>启用</span>
          </label>
          <input v-model="rule.label" class="rule-name" placeholder="名称" :disabled="!canEdit" />
          <input v-model="rule.pattern" class="rule-pattern" placeholder="正则 pattern" :disabled="!canEdit" />
          <input v-model="rule.replacement" class="rule-replacement" placeholder="替换为" :disabled="!canEdit" />
          <input v-model="rule.flags" class="flags-input rule-flags" placeholder="gim" :disabled="!canEdit" />
          <select v-model="rule.scope" class="rule-scope" :disabled="!canEdit">
            <option value="input">输入</option>
            <option value="output">输出</option>
            <option value="both">双向</option>
          </select>
          <input v-model="rule.groupName" class="rule-group" placeholder="分组名" :disabled="!canEdit" maxlength="60" />
          <input v-model.number="rule.priority" class="rule-priority" type="number" min="0" placeholder="0" :disabled="!canEdit" title="优先级，数字越小越先执行" />
          <button
            v-if="canEdit"
            class="icon-button danger rule-delete"
            type="button"
            title="删除规则"
            @click="removeRule(index)"
          >
            <Trash2 :size="17" />
          </button>
        </div>

        <div class="preview-box">
          <label class="field">
            <span>预览输入</span>
            <input v-model="previewInput" />
          </label>
          <p>{{ regexPreview }}</p>
        </div>

        <div class="form-actions">
          <button v-if="isEditing && canEdit" class="danger-button" type="button" @click="removeCharacter">
            <Trash2 :size="18" />
            <span>删除</span>
          </button>
          <button v-if="isEditing" class="ghost-button" type="button" @click="handleExport">
            <Download :size="18" />
            <span>导出</span>
          </button>
          <button v-if="canEdit" class="primary-button" type="submit" :disabled="saving">
            <Save :size="18" />
            <span>{{ saving ? '保存中...' : '保存角色' }}</span>
          </button>
          <button v-else class="primary-button" type="button" @click="emit('navigate', 'home')">
            <span>返回角色大厅</span>
          </button>
        </div>
        </section>
        </div>
      </div>
    </form>
  </section>
</template>
