<script setup>
import { computed, ref, watch } from 'vue';
import { BookOpen, Check, ChevronDown } from '@lucide/vue';

const props = defineProps({
  changes: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
  characterContext: { type: Boolean, default: false },
  deferSave: { type: Boolean, default: false }
});
const emit = defineEmits(['apply', 'reload', 'discard', 'update-add-to-character']);
const excluded = ref([]);
const unlinked = ref([]);
watch(() => props.changes.map(change => change.ref).join('|'), () => {
  excluded.value = excluded.value.filter(ref => props.changes.some(change => change.ref === ref));
  unlinked.value = unlinked.value.filter(ref => props.changes.some(change => change.ref === ref));
});
const selected = computed(() => props.changes.filter(change => !excluded.value.includes(change.ref)));
function toggle(kind, ref, checked) {
  const list = kind === 'excluded' ? excluded : unlinked;
  list.value = checked ? list.value.filter(value => value !== ref) : [...new Set([...list.value, ref])];
}
function label(change) { return change.name || change.profile?.name || change.before?.name || '世界书'; }
function additions(change) { return change.bookId ? (change.upserts || []).filter(entry => !entry.entryId).length : (change.entries || []).length; }
function modifications(change) { return (change.upserts || []).filter(entry => entry.entryId).length; }
function format(value) {
  if (value === undefined || value === null || value === '') return '空';
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}
const fieldLabels = { name:'名称', description:'描述', scanDepth:'扫描深度', lorebookContextPercent:'上下文预算', content:'内容', triggerKeys:'触发词', keysSecondary:'副关键词', enabled:'启用', alwaysActive:'始终生效', regexMode:'正则模式', position:'注入位置', depth:'深度', selective:'选择性匹配', selectiveLogic:'匹配逻辑', probability:'概率', useProbability:'使用概率', group:'分组', groupWeight:'分组权重', role:'角色', sticky:'持续轮数', cooldown:'冷却轮数', delay:'延迟轮数', orderIndex:'排序', knowledgeVisibility:'知情范围', audienceCastKeys:'角色标识' };
function apply() {
  emit('apply', selected.value.map(change => ({ ...change, addToCharacter: !unlinked.value.includes(change.ref) })));
}
</script>

<template>
  <section v-if="changes.length" class="worldbook-changes" aria-label="待应用世界书变更">
    <header class="worldbook-changes-heading"><strong><BookOpen :size="16" />待应用变更</strong><small>{{ changes.length }} 本世界书</small></header>
    <article v-for="change in changes" :key="change.ref" class="worldbook-change">
      <div class="worldbook-change-head">
        <label><input v-if="!deferSave" type="checkbox" :checked="!excluded.includes(change.ref)" :disabled="busy" @change="toggle('excluded', change.ref, $event.target.checked)"><strong>{{ label(change) }}</strong></label>
        <span class="worldbook-change-type">{{ change.bookId ? '更新原书' : '新建世界书' }}</span>
      </div>
      <p class="worldbook-change-counts">
        <span v-if="change.bookId && Object.keys(change.profile || {}).length">资料 {{ Object.keys(change.profile).length }} 项</span>
        <span v-if="additions(change)">新增 {{ additions(change) }} 条</span>
        <span v-if="modifications(change)">修改 {{ modifications(change) }} 条</span>
        <span v-if="change.removals?.length">删除 {{ change.removals.length }} 条</span>
      </p>
      <details class="worldbook-change-detail">
        <summary>{{ change.bookId ? '查看具体变化' : '查看新书内容' }}<ChevronDown :size="14" /></summary>
        <dl v-if="Object.keys(change.profile || {}).length" class="worldbook-field-diff">
          <template v-for="(value, field) in change.profile" :key="field"><dt>{{ fieldLabels[field] || field }}</dt><dd><p v-if="change.bookId && change.before && Object.hasOwn(change.before, field)" class="worldbook-before">原：{{ format(change.before[field]) }}</p><p>{{ change.bookId ? '新：' : '' }}{{ format(value) }}</p></dd></template>
        </dl>
        <div v-for="(entry, index) in change.entries || []" :key="`new-${index}`" class="worldbook-entry-diff"><strong>{{ entry.name }}</strong><p>{{ entry.content }}</p><small>{{ entry.alwaysActive ? '始终生效' : entry.triggerKeys }}</small></div>
        <div v-for="(entry, index) in change.upserts || []" :key="entry.entryId || entry.localId || index" class="worldbook-entry-diff">
          <strong>{{ entry.patch?.name || entry.before?.name || '新增条目' }}</strong>
          <dl class="worldbook-field-diff"><template v-for="(value, field) in entry.patch" :key="field"><dt>{{ fieldLabels[field] || field }}</dt><dd><p v-if="entry.before && Object.hasOwn(entry.before, field)" class="worldbook-before">原：{{ format(entry.before[field]) }}</p><p>新：{{ format(value) }}</p></dd></template></dl>
        </div>
        <p v-for="(entry, index) in change.removedEntries || change.removals || []" :key="`remove-${index}`" class="worldbook-removed">删除：{{ typeof entry === 'string' ? entry : entry.before?.name || entry.entryId }}</p>
        <div v-if="change.bookId" class="worldbook-reload">
          <small>重新读取会放弃本书待应用修改，保留其他书的草稿。</small>
          <button type="button" class="ghost-button" :disabled="busy" @click="emit('reload', change)">重新读取原书</button>
        </div>
        <button type="button" class="ghost-button worldbook-discard" :disabled="busy" @click="emit('discard', change)">放弃此项</button>
      </details>
      <p v-if="change.linkedCharacterCount > 1" class="worldbook-shared-note">同时供 {{ change.linkedCharacterCount }} 个角色使用</p>
      <label v-if="characterContext && !change.bookId" class="worldbook-add-link"><input type="checkbox" :checked="deferSave ? change.addToCharacter !== false : !unlinked.includes(change.ref)" :disabled="busy" @change="deferSave ? emit('update-add-to-character', change, $event.target.checked) : toggle('unlinked', change.ref, $event.target.checked)">加入当前角色的关联列表</label>
    </article>
    <button v-if="!deferSave" class="primary-button worldbook-apply" type="button" :disabled="busy || !selected.length" :aria-busy="busy" @click="apply"><Check :size="17" />{{ busy ? '正在应用...' : `应用 ${selected.length} 项变更` }}</button>
    <p v-if="deferSave" class="worldbook-shared-note">世界书修改保留在草稿，点击保存角色后生效。不需要的修改可选择“放弃此项”。</p>
    <p v-else-if="characterContext" class="worldbook-shared-note">新书加入关联列表后，保存角色完成关联。</p>
  </section>
</template>

<style scoped>
.worldbook-changes { display: grid; gap: 10px; min-width: 0; }
.worldbook-changes-heading, .worldbook-changes-heading > strong, .worldbook-change-head { display: flex; align-items: center; gap: 8px; }
.worldbook-changes-heading { justify-content: space-between; }
.worldbook-changes-heading small, .worldbook-change-counts, .worldbook-shared-note, .worldbook-entry-diff small { color: var(--muted); font-size: .76rem; }
.worldbook-change { min-width: 0; padding: 13px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); }
.worldbook-change-head { justify-content: space-between; align-items: flex-start; }
.worldbook-change-head label { display: flex; align-items: flex-start; gap: 8px; min-width: 0; overflow-wrap: anywhere; }
.worldbook-change input[type="checkbox"] { width: 16px; height: 16px; min-height: 16px; flex: 0 0 16px; padding: 0; accent-color: var(--primary); }
.worldbook-change-head label { flex: 1; }
.worldbook-change-head label input { margin-top: 5px; }
.worldbook-change-head strong { font-size: .86rem; }
.worldbook-change-type { flex-shrink: 0; font-size: .7rem; border-radius: 5px; padding: 3px 6px; background: var(--primary-soft); color: var(--primary); }
.worldbook-change-counts { display: flex; gap: 10px; flex-wrap: wrap; margin: 7px 0; }
.worldbook-change-detail { border-top: 1px solid var(--line); padding-top: 9px; }
.worldbook-change-detail > summary { display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-size: .79rem; }
.worldbook-field-diff { margin: 10px 0 0; font-size: .79rem; }
.worldbook-field-diff dt { color: var(--muted); margin-top: 8px; }
.worldbook-field-diff dd { margin: 3px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.worldbook-field-diff p, .worldbook-entry-diff p { margin: 4px 0; }
.worldbook-before { color: var(--muted); }
.worldbook-entry-diff { border-top: 1px dashed var(--line); margin-top: 10px; padding-top: 10px; font-size: .8rem; white-space: pre-wrap; overflow-wrap: anywhere; }
.worldbook-removed { color: var(--danger); font-size: .8rem; overflow-wrap: anywhere; }
.worldbook-add-link { display: flex; align-items: center; gap: 6px; font-size: .76rem; margin-top: 10px; }
.worldbook-shared-note { margin: 7px 0 0; }
.worldbook-apply { width: 100%; }
.worldbook-reload { display: grid; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line); }
.worldbook-reload small { color: var(--muted); font-size: .74rem; }
.worldbook-reload button { justify-self: start; font-size: .76rem; }
.worldbook-discard { margin-top: 10px; font-size: .76rem; color: var(--muted); }
@media (pointer: coarse) { .worldbook-change-head label, .worldbook-add-link, .worldbook-change-detail > summary { min-height: 44px; align-items: center; } }
</style>
