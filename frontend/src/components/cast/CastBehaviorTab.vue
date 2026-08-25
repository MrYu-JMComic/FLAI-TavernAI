<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { ListChecks, Pencil, Plus, Power, Save, Search, Trash2, X } from '@lucide/vue';
import { useCastManagerContext } from './castManagerContext.js';

const emit = defineEmits(['delete']);
const manager = useCastManagerContext();
const query = ref('');
const actionRef = ref(null);
const baseline = ref('');
const form = reactive(emptyForm());
const editing = computed(() => manager.editor.kind === 'behavior');
const dirty = computed(() => editing.value && baseline.value && JSON.stringify(form) !== baseline.value);
const filtered = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase();
  if (!needle) return manager.behaviors.value;
  return manager.behaviors.value.filter((behavior) => (
    [behavior.action, behavior.triggerCondition, behavior.behaviorType]
      .join('\n').toLocaleLowerCase().includes(needle)
  ));
});

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
      behaviorType: record.behaviorType || 'reaction',
      triggerCondition: record.triggerCondition || '',
      action: record.action || '',
      priority: Number(record.priority || 0),
      enabled: record.enabled !== false,
    });
    baseline.value = JSON.stringify(form);
    await nextTick();
    actionRef.value?.focus({ preventScroll: true });
  },
  { immediate: true }
);
watch(dirty, (value) => manager.setDirty('editor', value));

async function submit() {
  if (!form.action.trim()) return;
  await manager.saveBehavior({
    behaviorType: form.behaviorType,
    triggerCondition: form.triggerCondition.trim(),
    action: form.action.trim(),
    priority: Number(form.priority),
    enabled: form.enabled,
  }, manager.editor.record);
}

async function toggleBehavior(behavior) {
  await manager.saveBehavior({
    behaviorType: behavior.behaviorType,
    triggerCondition: behavior.triggerCondition,
    action: behavior.action,
    priority: behavior.priority,
    enabled: !behavior.enabled,
  }, behavior);
}

function emptyForm() {
  return { behaviorType: 'reaction', triggerCondition: '', action: '', priority: 0, enabled: true };
}

onBeforeUnmount(() => manager.setDirty('editor', false));
</script>

<template>
  <section class="cast-tab-panel" role="tabpanel" aria-labelledby="cast-tab-behaviors">
    <header class="cast-list-toolbar">
      <div>
        <h3 tabindex="-1">行为规则</h3>
        <p>{{ manager.behaviors.value.length }} 条规则</p>
      </div>
      <label class="cast-inline-search">
        <Search :size="16" aria-hidden="true" />
        <span class="sr-only">搜索行为规则</span>
        <input v-model="query" type="search" placeholder="搜索触发或动作" />
      </label>
      <button type="button" class="cast-button primary" :disabled="manager.busy.mutation || manager.hasUnsavedChanges.value" @click="manager.openEditor('behavior')">
        <Plus :size="16" aria-hidden="true" />
        添加规则
      </button>
    </header>

    <form v-if="editing" class="cast-inline-editor" @submit.prevent="submit">
      <header>
        <h4>{{ manager.editor.mode === 'edit' ? '编辑行为规则' : '添加行为规则' }}</h4>
        <button type="button" class="cast-icon-button" aria-label="关闭行为编辑" title="关闭" @click="manager.closeEditor">
          <X :size="17" aria-hidden="true" />
        </button>
      </header>
      <div class="cast-form-grid two-column">
        <label>
          <span>类型</span>
          <select v-model="form.behaviorType">
            <option value="reaction">反应</option>
            <option value="habit">习惯</option>
            <option value="goal">目标</option>
            <option value="constraint">约束</option>
          </select>
        </label>
        <label>
          <span>优先级</span>
          <input v-model.number="form.priority" type="number" min="-1000" max="1000" step="1" />
        </label>
        <label class="full-width">
          <span>触发条件</span>
          <textarea v-model="form.triggerCondition" maxlength="2000" rows="2"></textarea>
        </label>
        <label class="full-width">
          <span>执行动作</span>
          <textarea ref="actionRef" v-model="form.action" maxlength="4000" rows="3" required></textarea>
        </label>
      </div>
      <label class="cast-check-row compact">
        <input v-model="form.enabled" type="checkbox" />
        <Power :size="17" aria-hidden="true" />
        <span><b>启用规则</b></span>
      </label>
      <footer>
        <button type="button" class="cast-button secondary" :disabled="manager.busy.mutation" @click="manager.closeEditor">取消</button>
        <button type="submit" class="cast-button primary" :disabled="!form.action.trim() || manager.busy.mutation">
          <Save :size="16" aria-hidden="true" />
          {{ manager.busy.kind.startsWith('behavior.') ? '保存中' : '保存规则' }}
        </button>
      </footer>
    </form>

    <div v-if="manager.loading.behaviors && !manager.loaded.behaviors" class="cast-row-skeleton" aria-label="正在加载行为规则">
      <span v-for="index in 5" :key="index"></span>
    </div>
    <div v-else-if="manager.errors.behaviors" class="cast-error-state" role="alert">
      <p>{{ manager.errors.behaviors }}</p>
      <button type="button" class="cast-button secondary" @click="manager.loadBehaviors()">重试</button>
    </div>
    <div v-else-if="!filtered.length" class="cast-empty-state">
      <ListChecks :size="28" aria-hidden="true" />
      <h4>{{ query ? '没有匹配规则' : '暂无行为规则' }}</h4>
    </div>
    <div v-else class="cast-record-list">
      <article v-for="behavior in filtered" :key="behavior.id" class="cast-record-row" :class="{ disabled: !behavior.enabled }">
        <button
          type="button"
          class="cast-rule-toggle"
          role="switch"
          :aria-checked="behavior.enabled"
          :aria-label="behavior.enabled ? '停用行为规则' : '启用行为规则'"
          :title="behavior.enabled ? '停用' : '启用'"
          :disabled="manager.busy.mutation || manager.hasUnsavedChanges.value"
          @click="toggleBehavior(behavior)"
        >
          <span aria-hidden="true"></span>
        </button>
        <div class="cast-record-main">
          <div class="cast-record-meta">
            <span>{{ behavior.behaviorType || 'reaction' }}</span>
            <span>优先级 {{ behavior.priority || 0 }}</span>
            <span>{{ behavior.enabled ? '已启用' : '已停用' }}</span>
          </div>
          <small v-if="behavior.triggerCondition">当 {{ behavior.triggerCondition }}</small>
          <p>{{ behavior.action }}</p>
        </div>
        <div class="cast-row-actions">
          <button type="button" class="cast-icon-button" aria-label="编辑行为规则" title="编辑" :disabled="manager.busy.mutation || manager.hasUnsavedChanges.value" @click="manager.openEditor('behavior', behavior)">
            <Pencil :size="16" aria-hidden="true" />
          </button>
          <button type="button" class="cast-icon-button danger" aria-label="删除行为规则" title="删除" :disabled="manager.busy.mutation || manager.hasUnsavedChanges.value" @click="emit('delete', behavior)">
            <Trash2 :size="16" aria-hidden="true" />
          </button>
        </div>
      </article>
    </div>
  </section>
</template>
