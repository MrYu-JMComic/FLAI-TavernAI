<script setup>
import { Download, GripVertical, Plus, Power, Puzzle, RefreshCw, Save, Sliders, Trash2, Upload, X } from '@lucide/vue';
import {
  characterVisibilityText,
  modScopeLabel,
  modTypeColor as resolveModTypeColor,
  modTypeLabel,
  normalizeModCharacterIds
} from '../../utils/modDisplay';

const props = defineProps({
  actionBusy: { type: Boolean, default: false },
  actionBusyId: { type: String, default: '' },
  characterOptions: { type: Array, default: () => [] },
  charactersLoadError: { type: String, default: '' },
  charactersLoading: { type: Boolean, default: false },
  controlsBusy: { type: Boolean, default: false },
  dragOverMod: { type: String, default: null },
  draggingMod: { type: String, default: null },
  editing: { type: [String, Number], default: null },
  form: { type: Object, required: true },
  loadError: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  modList: { type: Array, default: () => [] },
  showEditor: { type: Boolean, default: false }
});

const emit = defineEmits([
  'cancel-edit',
  'clear-characters',
  'drag-end',
  'drag-over',
  'drag-start',
  'drop',
  'export',
  'import-file',
  'load',
  'load-characters',
  'remove',
  'save',
  'select-all-characters',
  'start-edit',
  'start-new',
  'toggle',
  'update-form-field'
]);

function readInputValue(event) {
  const target = event?.target;
  return target && target.value !== undefined ? target.value : '';
}

function readInputChecked(event) {
  return Boolean(event?.target?.checked);
}

function updateField(key, value) {
  emit('update-form-field', key, value);
}

function updateTrimmedField(key, event) {
  updateField(key, readInputValue(event).trim());
}

function modToggleActionId(id) {
  return `mod-toggle:${id}`;
}

function modDeleteActionId(id) {
  return `mod-delete:${id}`;
}

function isModToggleBusy(id) {
  return props.actionBusyId === modToggleActionId(id);
}

function isModDeleteBusy(id) {
  return props.actionBusyId === modDeleteActionId(id);
}

function modTypeColor(type) {
  return resolveModTypeColor(type);
}

function isCharacterSelected(id) {
  const selectedId = String(id || '').trim();
  if (!selectedId) return false;
  for (const characterId of Array.isArray(props.form.characterIds) ? props.form.characterIds : []) {
    if (String(characterId || '').trim() === selectedId) {
      return true;
    }
  }
  return false;
}

function updateCharacterSelection(id, checked) {
  const selectedId = String(id || '').trim();
  if (!selectedId) return;
  const currentIds = normalizeModCharacterIds(props.form.characterIds);
  const nextIds = [];
  let found = false;
  for (const currentId of currentIds) {
    if (currentId === selectedId) {
      found = true;
      if (checked) {
        nextIds.push(currentId);
      }
    } else {
      nextIds.push(currentId);
    }
  }
  if (checked && !found) {
    nextIds.push(selectedId);
  }
  updateField('characterIds', nextIds);
}
</script>

<template>
  <section id="extension-section-mods" class="form-panel mod-management-panel form-section-group">
    <div class="inline-heading">
      <div>
        <h2>Mod 管理</h2>
        <p>管理聊天 Mod，可注入提示词、增强文风或自定义指令。启用的 Mod 会在聊天时自动生效。</p>
      </div>
      <Puzzle :size="20" />
    </div>
    <div class="preset-actions-row">
      <button class="ghost-button" type="button" :disabled="controlsBusy" @click="emit('start-new')">
        <Plus :size="17" />
        <span>新建 Mod</span>
      </button>
      <button class="ghost-button" type="button" :disabled="controlsBusy || !modList.length" @click="emit('export')">
        <Download :size="17" />
        <span>导出</span>
      </button>
      <label class="ghost-button file-import-button" :class="{ disabled: controlsBusy }" :aria-busy="actionBusyId === 'mod-import'">
        <Upload :size="17" />
        <span>导入</span>
        <input type="file" accept=".json" :disabled="controlsBusy" @change="emit('import-file', $event)" />
      </label>
    </div>
    <p v-if="loading" class="muted-text" aria-live="polite">正在加载 Mod...</p>
    <div v-if="loadError" class="section-load-status error-state" role="alert">
      <span>{{ loadError }}</span>
      <button class="ghost-button compact-button" type="button" :disabled="controlsBusy" @click="emit('load')">
        <RefreshCw :size="17" />
        <span>{{ loading ? '重试中...' : '重试' }}</span>
      </button>
    </div>

    <Teleport to="body">
      <div v-if="showEditor" class="mod-editor-overlay" @click.self="emit('cancel-edit')">
        <form class="preset-editor mod-editor-modal" role="dialog" aria-modal="true" :aria-busy="actionBusy" @submit.prevent="emit('save')" @keydown.esc.prevent="emit('cancel-edit')">
          <div class="mod-editor-header">
            <div>
              <span>Mod</span>
              <h3>{{ editing ? '编辑 Mod' : '新建 Mod' }}</h3>
            </div>
            <button class="icon-button" type="button" title="关闭" aria-label="关闭 Mod 编辑器" :disabled="actionBusy" @click="emit('cancel-edit')">
              <X :size="17" />
            </button>
          </div>
          <div class="mod-editor-body">
            <div class="form-grid two-col">
              <label class="field">
                <span>Mod 名称</span>
                <input :value="form.name" placeholder="如：文风增强、世界观注入" maxlength="80" :disabled="actionBusy" required @input="updateTrimmedField('name', $event)" />
              </label>
              <label class="field">
                <span>类型</span>
                <select :value="form.type" :disabled="actionBusy" @change="updateField('type', readInputValue($event))">
                  <option value="prompt_inject">提示词注入</option>
                  <option value="style_enhance">文风增强</option>
                  <option value="custom">自定义</option>
                </select>
              </label>
            </div>
            <label class="field">
              <span>描述</span>
              <input :value="form.description" placeholder="可选，简要描述此 Mod 的作用" maxlength="200" :disabled="actionBusy" @input="updateTrimmedField('description', $event)" />
            </label>
            <label class="field">
              <span>内容</span>
              <textarea :value="form.content" rows="8" placeholder="输入要注入的提示词或文风要求..." :disabled="actionBusy" required @input="updateField('content', readInputValue($event))" />
            </label>
            <div class="field mod-scope-field">
              <span>加载范围</span>
              <div class="mod-scope-grid" role="radiogroup" aria-label="Mod 加载范围">
                <label class="mod-scope-option" :class="{ active: form.scope === 'global' }">
                  <input :checked="form.scope === 'global'" type="radio" value="global" aria-describedby="mod-scope-global-desc" :disabled="actionBusy" @change="updateField('scope', 'global')" />
                  <span class="mod-scope-text">
                    <strong>全局加载</strong>
                    <small id="mod-scope-global-desc">所有聊天都会注入，适合通用规则。</small>
                  </span>
                </label>
                <label class="mod-scope-option" :class="{ active: form.scope === 'all_characters' }">
                  <input :checked="form.scope === 'all_characters'" type="radio" value="all_characters" aria-describedby="mod-scope-all-desc" :disabled="actionBusy" @change="updateField('scope', 'all_characters')" />
                  <span class="mod-scope-text">
                    <strong>全角色加载</strong>
                    <small id="mod-scope-all-desc">所有角色卡聊天生效，不影响无角色场景。</small>
                  </span>
                </label>
                <label class="mod-scope-option" :class="{ active: form.scope === 'characters' }">
                  <input :checked="form.scope === 'characters'" type="radio" value="characters" aria-describedby="mod-scope-characters-desc" :disabled="actionBusy" @change="updateField('scope', 'characters')" />
                  <span class="mod-scope-text">
                    <strong>指定角色</strong>
                    <small id="mod-scope-characters-desc">只对下方绑定的角色生效。</small>
                  </span>
                </label>
              </div>
            </div>
            <div v-if="form.scope === 'characters'" class="mod-character-picker">
              <div class="mod-character-tools">
                <span>绑定角色 · {{ form.characterIds.length }}</span>
                <div class="mod-character-actions">
                  <button class="ghost-button compact-button" type="button" :disabled="actionBusy || !characterOptions.length" @click="emit('select-all-characters')">
                    全选
                  </button>
                  <button class="ghost-button compact-button" type="button" :disabled="actionBusy || !form.characterIds.length" @click="emit('clear-characters')">
                    清空
                  </button>
                </div>
              </div>
              <p v-if="charactersLoading" class="muted-text" aria-live="polite">正在加载角色...</p>
              <div v-if="charactersLoadError" class="section-load-status error-state" role="alert">
                <span>{{ charactersLoadError }}</span>
                <button class="ghost-button compact-button" type="button" :disabled="charactersLoading || actionBusy" @click="emit('load-characters')">
                  <RefreshCw :size="17" />
                  <span>{{ charactersLoading ? '重试中...' : '重试' }}</span>
                </button>
              </div>
              <div v-if="characterOptions.length" class="mod-character-list">
                <label v-for="character in characterOptions" :key="character.id" class="mod-character-option">
                  <input :checked="isCharacterSelected(character.id)" type="checkbox" :value="character.id" :disabled="actionBusy" @change="updateCharacterSelection(character.id, readInputChecked($event))" />
                  <span>{{ character.name }}</span>
                  <small>{{ characterVisibilityText(character.visibility) }}</small>
                </label>
              </div>
              <p v-else-if="!charactersLoading && !charactersLoadError" class="muted-text">暂无可绑定角色</p>
            </div>
            <label class="checkbox-line">
              <input :checked="form.enabled" type="checkbox" :disabled="actionBusy" @change="updateField('enabled', readInputChecked($event))" />
              <span>启用此 Mod</span>
            </label>
          </div>
          <div class="form-actions mod-editor-actions">
            <button class="ghost-button" type="button" :disabled="actionBusy" @click="emit('cancel-edit')">
              取消
            </button>
            <button class="primary-button" type="submit" :disabled="actionBusy" :aria-busy="actionBusyId === 'mod-save'">
              <Save :size="18" />
              <span>{{ actionBusyId === 'mod-save' ? '保存中...' : editing ? '保存修改' : '创建 Mod' }}</span>
            </button>
          </div>
        </form>
      </div>
    </Teleport>

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
        :draggable="!controlsBusy"
        :aria-busy="isModToggleBusy(mod.id) || isModDeleteBusy(mod.id) || actionBusyId === 'mod-reorder'"
        @dragstart="emit('drag-start', $event, mod)"
        @dragover="emit('drag-over', $event, mod)"
        @dragend="emit('drag-end')"
        @drop="emit('drop', $event, mod)"
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
            :disabled="controlsBusy"
            :aria-busy="isModToggleBusy(mod.id)"
            @click="emit('toggle', mod)"
          >
            <Power :size="16" />
          </button>
          <button class="icon-button" type="button" title="编辑" :aria-label="`编辑 Mod：${mod.name}`" :disabled="controlsBusy" @click="emit('start-edit', mod)">
            <Sliders :size="16" />
          </button>
          <button class="icon-button danger" type="button" title="删除" :aria-label="`删除 Mod：${mod.name}`" :disabled="controlsBusy" :aria-busy="isModDeleteBusy(mod.id)" @click="emit('remove', mod.id, mod.name)">
            <Trash2 :size="16" />
          </button>
        </div>
      </div>
    </div>
    <p v-else-if="!loading && !loadError" class="muted-text">还没有 Mod，点击「新建 Mod」创建第一个。拖拽卡片可调整顺序。</p>
  </section>
</template>
