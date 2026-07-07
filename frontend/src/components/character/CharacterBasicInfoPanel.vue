<script setup>
import { ListChecks, Plus, RotateCcw, Upload, X } from '@lucide/vue';

defineProps({
  canCreateSearchedTag: { type: Boolean, default: false },
  canEdit: { type: Boolean, default: false },
  filteredTags: { type: Array, default: () => [] },
  form: { type: Object, required: true },
  hiddenSelectedWorldBookCount: { type: Number, default: 0 },
  optionsLoadError: { type: String, default: '' },
  optionsLoading: { type: Boolean, default: false },
  selectedWorldBookIds: { type: Array, default: () => [] },
  selectedWorldBookPreview: { type: Array, default: () => [] },
  tagCreating: { type: Boolean, default: false },
  tagSearch: { type: String, default: '' },
  userVariableValue: { type: String, default: '' },
  worldBooks: { type: Array, default: () => [] }
});

const emit = defineEmits([
  'avatar-change',
  'create-tag',
  'open-world-book-dialog',
  'retry-options',
  'toggle-tag',
  'toggle-world-book',
  'update-field',
  'update:tagSearch'
]);

function readInputValue(event) {
  return event?.target && 'value' in event.target ? event.target.value : '';
}
</script>

<template>
  <section id="section-basic" class="form-panel form-section-group character-basic-panel">
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
        <input type="file" accept="image/png,image/jpeg,image/webp" @change="emit('avatar-change', $event)" />
      </label>
      <div v-else class="permission-chip">只读展示</div>
    </div>

    <div class="form-grid two-col">
      <div class="field full-span">
        <span>展示权限</span>
        <div class="visibility-picker" :class="{ disabled: !canEdit }">
          <label>
            <input
              :checked="form.visibility === 'private'"
              type="radio"
              value="private"
              :disabled="!canEdit"
              @change="emit('update-field', 'visibility', readInputValue($event))"
            />
            <span>
              私人角色
              <small>仅拥有者可见、可编辑、可使用</small>
            </span>
          </label>
          <label>
            <input
              :checked="form.visibility === 'public'"
              type="radio"
              value="public"
              :disabled="!canEdit"
              @change="emit('update-field', 'visibility', readInputValue($event))"
            />
            <span>
              公开角色
              <small>所有登录用户可查看和使用，仅拥有者可编辑</small>
            </span>
          </label>
        </div>
      </div>
      <label class="field">
        <span>角色名</span>
        <input
          :value="form.name"
          required
          maxlength="40"
          :disabled="!canEdit"
          @input="emit('update-field', 'name', readInputValue($event).trim())"
        />
      </label>
      <div v-if="optionsLoading || optionsLoadError" class="field full-span">
        <p v-if="optionsLoading" class="muted-text" aria-live="polite">正在加载标签和世界书选项...</p>
        <div v-else class="section-load-status error-state" role="alert">
          <span>{{ optionsLoadError }}</span>
          <button class="ghost-button compact-button" type="button" :disabled="optionsLoading" @click="emit('retry-options')">
            <RotateCcw :size="17" />
            <span>{{ optionsLoading ? '重试中...' : '重试' }}</span>
          </button>
        </div>
      </div>
      <div class="field">
        <span>标签</span>
        <div class="tag-selector" :class="{ disabled: !canEdit || tagCreating }">
          <div v-if="form.selectedTags.length" class="selected-tags">
            <span
              v-for="tagName in form.selectedTags"
              :key="tagName"
              class="tag-badge removable"
              @click="canEdit && !tagCreating && emit('toggle-tag', tagName)"
            >
              {{ tagName }}
              <span v-if="canEdit && !tagCreating" class="tag-remove">×</span>
            </span>
          </div>
          <div v-if="canEdit" class="tag-input-row">
            <input
              :value="tagSearch"
              placeholder="搜索或创建标签..."
              class="tag-search-input"
              aria-label="搜索或创建角色标签"
              :disabled="tagCreating"
              :aria-busy="tagCreating"
              @input="emit('update:tagSearch', readInputValue($event))"
            />
            <button
              v-if="canCreateSearchedTag"
              class="ghost-button tag-create-btn"
              type="button"
              :disabled="tagCreating"
              :aria-busy="tagCreating"
              @click="emit('create-tag')"
            >
              <Plus :size="14" />
              {{ tagCreating ? '创建中...' : '创建' }}
            </button>
          </div>
          <div v-if="canEdit && tagSearch.trim()" class="tag-dropdown">
            <button
              v-for="tag in filteredTags"
              :key="tag.id"
              class="tag-option"
              :class="{ selected: form.selectedTags.includes(tag.name) }"
              type="button"
              :disabled="tagCreating"
              @click="emit('toggle-tag', tag.name)"
            >
              {{ tag.name }}
              <span v-if="form.selectedTags.includes(tag.name)" class="tag-check">✓</span>
            </button>
            <p v-if="!filteredTags.length" class="muted-text tag-empty">无匹配标签</p>
          </div>
        </div>
        <small v-if="!optionsLoadError" class="muted-text">选择已有标签或输入新标签名创建</small>
        <small v-else class="muted-text">选项加载失败时仍可输入新标签，重试后可查看已有标签和世界书。</small>
      </div>
      <div class="field full-span world-book-field">
        <div class="field-heading compact">
          <span>关联世界书</span>
          <small v-if="worldBooks.length">{{ worldBooks.length }} 本可选</small>
        </div>
        <div class="world-book-picker">
          <button
            class="world-book-picker-button"
            type="button"
            :disabled="optionsLoading || !worldBooks.length"
            @click="emit('open-world-book-dialog')"
          >
            <ListChecks :size="17" />
            <span>{{ selectedWorldBookIds.length ? `已关联 ${selectedWorldBookIds.length} 本世界书` : '选择世界书' }}</span>
          </button>
          <div v-if="selectedWorldBookPreview.length" class="world-book-selected-preview" aria-live="polite">
            <button
              v-for="book in selectedWorldBookPreview"
              :key="book.id"
              class="world-book-selected-chip"
              type="button"
              :disabled="!canEdit"
              :title="canEdit ? `取消关联：${book.name}` : book.name"
              @click="emit('toggle-world-book', book.id)"
            >
              <span>{{ book.name }}</span>
              <small>{{ book.entryCount || 0 }} 条目</small>
              <X v-if="canEdit" :size="12" />
            </button>
            <span v-if="hiddenSelectedWorldBookCount" class="world-book-selected-more">
              +{{ hiddenSelectedWorldBookCount }}
            </span>
          </div>
          <small v-if="selectedWorldBookIds.length" class="muted-text">已选世界书会按角色绑定顺序注入。</small>
          <small v-else-if="worldBooks.length" class="muted-text">选择世界书后，对话中触发词匹配时会自动注入设定。</small>
          <small v-else-if="!optionsLoading && !optionsLoadError" class="muted-text">还没有世界书，去 <a href="#/world-books">世界书管理</a> 创建</small>
        </div>
      </div>
      <label class="field">
        <span>性别</span>
        <input
          :value="form.gender"
          maxlength="24"
          :disabled="!canEdit"
          @input="emit('update-field', 'gender', readInputValue($event).trim())"
        />
      </label>
      <label class="field">
        <span>年龄</span>
        <input
          :value="form.age"
          maxlength="24"
          :disabled="!canEdit"
          @input="emit('update-field', 'age', readInputValue($event).trim())"
        />
      </label>
    </div>
  </section>
</template>
