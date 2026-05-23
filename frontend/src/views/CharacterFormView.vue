<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ArrowLeft, Plus, Save, Trash2, Upload } from '@lucide/vue';
import { createCharacter, deleteCharacter, fetchCharacter, updateCharacter } from '../api';

const props = defineProps({
  route: {
    type: Object,
    required: true
  }
});
const emit = defineEmits(['navigate']);

const isEditing = computed(() => props.route.name === 'characterEdit');
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const previewInput = ref('猫在雨里说你好');
const form = reactive(emptyCharacter());
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

onMounted(async () => {
  if (!isEditing.value) {
    return;
  }

  loading.value = true;
  try {
    Object.assign(form, normalizeForForm(await fetchCharacter(props.route.params.id)));
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
});

async function submit() {
  if (!canEdit.value) {
    return;
  }

  saving.value = true;
  error.value = '';
  try {
    const payload = toPayload();
    const saved = isEditing.value
      ? await updateCharacter(props.route.params.id, payload)
      : await createCharacter(payload);
    emit('navigate', 'characterEdit', { id: saved.id });
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function removeCharacter() {
  if (!isEditing.value || !canEdit.value || !window.confirm('确定删除这个角色和相关对话吗？')) {
    return;
  }

  await deleteCharacter(props.route.params.id);
  emit('navigate', 'home');
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
    enabled: true
  });
}

function removeRule(index) {
  if (!canEdit.value) {
    return;
  }

  form.regexRules.splice(index, 1);
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
    error.value = '头像仅支持 PNG、JPG 或 WebP';
    return;
  }

  if (file.size > 2 * 1024 * 1024) {
    error.value = '头像不能超过 2MB';
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
    regexRules: form.regexRules,
    tags: form.tagsText
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
  };
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
    regexRules: [],
    canEdit: true,
    canUse: true,
    isOwner: true
  };
}

function normalizeForForm(character) {
  return {
    ...emptyCharacter(),
    ...character,
    visibility: character.visibility || 'private',
    canEdit: character.canEdit !== false,
    canUse: character.canUse !== false,
    isOwner: character.isOwner === true,
    tagsText: (character.tags || []).join(', '),
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

    <p v-if="error" class="error-text">{{ error }}</p>
    <p v-if="loading" class="muted-text">正在加载角色...</p>
    <p v-if="!loading" class="permission-note" :class="{ readonly: !canEdit }">{{ permissionText }}</p>

    <form v-if="!loading" class="editor-layout" @submit.prevent="submit">
      <section class="form-panel">
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
          <label class="field">
            <span>标签</span>
            <input v-model="form.tagsText" placeholder="情报商, 温柔, 悬疑" :disabled="!canEdit" />
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

        <label class="field">
          <span>背景</span>
          <textarea v-model="form.background" rows="4" :disabled="!canEdit" />
        </label>
        <label class="field">
          <span>世界观</span>
          <textarea v-model="form.worldview" rows="4" :disabled="!canEdit" />
        </label>
        <label class="field">
          <span>人设</span>
          <textarea v-model="form.persona" rows="5" required :disabled="!canEdit" />
        </label>
        <label class="field">
          <span>开场白</span>
          <textarea v-model="form.openingMessage" rows="4" :disabled="!canEdit" />
        </label>
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
          <button v-if="canEdit" class="primary-button" type="submit" :disabled="saving">
            <Save :size="18" />
            <span>{{ saving ? '保存中...' : '保存角色' }}</span>
          </button>
          <button v-else class="primary-button" type="button" @click="emit('navigate', 'home')">
            <span>返回角色大厅</span>
          </button>
        </div>
      </section>
    </form>
  </section>
</template>
