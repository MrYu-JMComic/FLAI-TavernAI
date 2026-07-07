<script setup>
import { Plus, RefreshCw, Tag, Trash2 } from '@lucide/vue';

const props = defineProps({
  actionBusyId: { type: String, default: '' },
  controlsBusy: { type: Boolean, default: false },
  loadError: { type: String, default: '' },
  loadLimit: { type: Number, default: 80 },
  loading: { type: Boolean, default: false },
  newTagName: { type: String, default: '' },
  normalizedLoadLimit: { type: Number, default: 80 },
  tagList: { type: Array, default: () => [] }
});

const emit = defineEmits([
  'add',
  'load',
  'remove',
  'update-load-limit',
  'update-load-limit-draft',
  'update-new-tag-name'
]);

function readInputValue(event) {
  const target = event?.target;
  return target && target.value !== undefined ? target.value : '';
}

function readNumericInputValue(event) {
  const value = Number(readInputValue(event));
  return Number.isFinite(value) ? value : props.normalizedLoadLimit;
}

function tagDeleteActionId(id) {
  return `tag-delete:${id}`;
}

function isTagDeleteBusy(id) {
  return props.actionBusyId === tagDeleteActionId(id);
}
</script>

<template>
  <section id="extension-section-tags" class="form-panel tag-management-panel form-section-group">
    <div class="inline-heading">
      <div>
        <h2>标签管理</h2>
        <p>创建和管理角色卡标签，支持按标签筛选。</p>
      </div>
      <Tag :size="20" />
    </div>
    <div class="tag-toolbar-row">
      <div class="tag-add-row">
        <input
          :value="newTagName"
          placeholder="新标签名称"
          maxlength="30"
          aria-label="新标签名称"
          :disabled="controlsBusy"
          @input="emit('update-new-tag-name', readInputValue($event))"
          @keyup.enter="emit('add')"
        />
        <button
          class="ghost-button"
          type="button"
          :disabled="controlsBusy || !newTagName.trim()"
          :aria-busy="actionBusyId === 'tag-add'"
          @click="emit('add')"
        >
          <Plus :size="17" />
          <span>添加</span>
        </button>
      </div>
      <label class="tag-load-limit-field">
        <span>最多加载</span>
        <input
          :value="loadLimit"
          type="number"
          min="1"
          max="500"
          step="1"
          aria-label="标签最多加载数量"
          :disabled="controlsBusy"
          @input="emit('update-load-limit-draft', readNumericInputValue($event))"
          @change="emit('update-load-limit')"
          @keyup.enter="emit('update-load-limit')"
        />
      </label>
    </div>
    <p v-if="tagList.length" class="tag-load-summary" aria-live="polite">
      当前显示 {{ tagList.length }} / {{ normalizedLoadLimit }} 个标签
    </p>
    <p v-if="loading" class="muted-text" aria-live="polite">正在加载标签...</p>
    <div v-if="loadError" class="section-load-status error-state" role="alert">
      <span>{{ loadError }}</span>
      <button class="ghost-button compact-button" type="button" :disabled="controlsBusy" @click="emit('load')">
        <RefreshCw :size="17" />
        <span>{{ loading ? '重试中...' : '重试' }}</span>
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
          :disabled="controlsBusy"
          :aria-busy="isTagDeleteBusy(tag.id)"
          @click="emit('remove', tag.id, tag.name)"
        >
          <Trash2 :size="16" />
        </button>
      </div>
    </div>
    <p v-else-if="!loading && !loadError" class="muted-text">还没有标签，在角色卡编辑页或这里创建。</p>
  </section>
</template>
