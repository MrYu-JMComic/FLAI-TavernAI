<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { Archive, Brain, Pencil, Plus, Save, Search, Trash2, X } from '@lucide/vue';
import { useCastManagerContext } from './castManagerContext.js';

const emit = defineEmits(['delete']);
const manager = useCastManagerContext();
const query = ref('');
const contentRef = ref(null);
const baseline = ref('');
const form = reactive(emptyForm());

const editing = computed(() => manager.editor.kind === 'memory');
const filtered = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase();
  if (!needle) return manager.memories.value.items;
  return manager.memories.value.items.filter((memory) => (
    [memory.content, memory.memoryType, memory.layer].join('\n').toLocaleLowerCase().includes(needle)
  ));
});
const dirty = computed(() => editing.value && baseline.value && JSON.stringify(form) !== baseline.value);

watch(
  () => [manager.editor.kind, manager.editor.record?.id, manager.editor.record?.revision],
  async () => {
    if (!editing.value) {
      Object.assign(form, emptyForm());
      baseline.value = '';
      manager.setDirty('editor', false);
      return;
    }
    const record = manager.editor.record || {};
    Object.assign(form, {
      content: record.content || '',
      memoryType: record.memoryType || 'event',
      layer: record.layer || 'working',
      importance: Number(record.importance ?? 0.5),
      emotionalIntensity: Number(record.emotionalIntensity ?? 0),
      decayRate: Number(record.decayRate ?? 0),
    });
    baseline.value = JSON.stringify(form);
    await nextTick();
    contentRef.value?.focus({ preventScroll: true });
  },
  { immediate: true }
);
watch(dirty, (value) => manager.setDirty('editor', value));

async function submit() {
  if (!form.content.trim()) return;
  await manager.saveMemory({
    content: form.content.trim(),
    memoryType: form.memoryType,
    layer: form.layer,
    importance: Number(form.importance),
    emotionalIntensity: Number(form.emotionalIntensity),
    decayRate: Number(form.decayRate),
  }, manager.editor.record);
}

function startCreate() {
  manager.openEditor('memory');
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString('zh-CN');
}

function emptyForm() {
  return {
    content: '', memoryType: 'event', layer: 'working', importance: 0.5,
    emotionalIntensity: 0, decayRate: 0,
  };
}

onBeforeUnmount(() => manager.setDirty('editor', false));
</script>

<template>
  <section class="cast-tab-panel" role="tabpanel" aria-labelledby="cast-tab-memories">
    <header class="cast-list-toolbar">
      <div>
        <h3 tabindex="-1">人物记忆</h3>
        <p>{{ manager.memories.value.total }} 条记录</p>
      </div>
      <label class="cast-inline-search">
        <Search :size="16" aria-hidden="true" />
        <span class="sr-only">搜索记忆</span>
        <input v-model="query" type="search" placeholder="搜索记忆" />
      </label>
      <button type="button" class="cast-button primary" :disabled="manager.busy.mutation || manager.hasUnsavedChanges.value" @click="startCreate">
        <Plus :size="16" aria-hidden="true" />
        添加记忆
      </button>
    </header>

    <form v-if="editing" class="cast-inline-editor" @submit.prevent="submit">
      <header>
        <h4>{{ manager.editor.mode === 'edit' ? '编辑记忆' : '添加记忆' }}</h4>
        <button type="button" class="cast-icon-button" aria-label="关闭记忆编辑" title="关闭" @click="manager.closeEditor">
          <X :size="17" aria-hidden="true" />
        </button>
      </header>
      <label class="full-width">
        <span>内容</span>
        <textarea ref="contentRef" v-model="form.content" maxlength="20000" rows="4" required></textarea>
      </label>
      <div class="cast-form-grid three-column">
        <label>
          <span>类型</span>
          <select v-model="form.memoryType">
            <option value="event">事件</option>
            <option value="relationship">关系</option>
            <option value="knowledge">知识</option>
            <option value="emotion">情绪</option>
          </select>
        </label>
        <label>
          <span>层级</span>
          <select v-model="form.layer">
            <option value="working">工作记忆</option>
            <option value="episodic">情节记忆</option>
            <option value="semantic">语义记忆</option>
            <option value="core">核心记忆</option>
          </select>
        </label>
        <label>
          <span>重要度 {{ Math.round(form.importance * 100) }}%</span>
          <input v-model.number="form.importance" type="range" min="0" max="1" step="0.05" />
        </label>
        <label>
          <span>情绪强度 {{ Math.round(form.emotionalIntensity * 100) }}%</span>
          <input v-model.number="form.emotionalIntensity" type="range" min="0" max="1" step="0.05" />
        </label>
        <label>
          <span>衰减率 {{ Math.round(form.decayRate * 100) }}%</span>
          <input v-model.number="form.decayRate" type="range" min="0" max="1" step="0.05" />
        </label>
      </div>
      <footer>
        <button type="button" class="cast-button secondary" :disabled="manager.busy.mutation" @click="manager.closeEditor">取消</button>
        <button type="submit" class="cast-button primary" :disabled="!form.content.trim() || manager.busy.mutation">
          <Save :size="16" aria-hidden="true" />
          {{ manager.busy.kind.startsWith('memory.') ? '保存中' : '保存记忆' }}
        </button>
      </footer>
    </form>

    <div v-if="manager.loading.memories && !manager.loaded.memories" class="cast-row-skeleton" aria-label="正在加载记忆">
      <span v-for="index in 5" :key="index"></span>
    </div>
    <div v-else-if="manager.errors.memories" class="cast-error-state" role="alert">
      <p>{{ manager.errors.memories }}</p>
      <button type="button" class="cast-button secondary" @click="manager.loadMemories()">重试</button>
    </div>
    <div v-else-if="!filtered.length" class="cast-empty-state">
      <Brain :size="28" aria-hidden="true" />
      <h4>{{ query ? '没有匹配记忆' : '暂无记忆' }}</h4>
    </div>
    <div v-else class="cast-record-list">
      <article v-for="memory in filtered" :key="memory.id" class="cast-record-row">
        <div class="cast-record-main">
          <div class="cast-record-meta">
            <span>{{ memory.memoryType || 'event' }}</span>
            <span>{{ memory.layer || 'working' }}</span>
            <span>重要度 {{ Math.round((memory.importance || 0) * 100) }}%</span>
            <span v-if="memory.forgottenAt" class="cast-state-label"><Archive :size="13" aria-hidden="true" />已遗忘</span>
          </div>
          <p>{{ memory.content }}</p>
          <small v-if="memory.updatedAt">{{ formatDate(memory.updatedAt) }}</small>
        </div>
        <div class="cast-row-actions">
          <button type="button" class="cast-icon-button" aria-label="编辑记忆" title="编辑" :disabled="manager.busy.mutation || manager.hasUnsavedChanges.value" @click="manager.openEditor('memory', memory)">
            <Pencil :size="16" aria-hidden="true" />
          </button>
          <button type="button" class="cast-icon-button danger" aria-label="删除记忆" title="删除" :disabled="manager.busy.mutation || manager.hasUnsavedChanges.value" @click="emit('delete', memory)">
            <Trash2 :size="16" aria-hidden="true" />
          </button>
        </div>
      </article>
    </div>

    <button
      v-if="manager.memories.value.items.length < manager.memories.value.total"
      type="button"
      class="cast-load-more"
      :disabled="manager.loading.memories"
      @click="manager.loadMemories({ append: true })"
    >
      {{ manager.loading.memories ? '加载中' : '加载更多' }}
    </button>
  </section>
</template>
