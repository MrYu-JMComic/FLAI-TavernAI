<script setup>
import { computed, ref } from 'vue';
import { BookOpen, ChevronDown, Plus, Search, Sparkles } from '@lucide/vue';

const props = defineProps({
  books: { type: Array, default: () => [] },
  selectedIds: { type: Array, default: () => [] },
  automatic: { type: Boolean, default: true },
  busy: { type: Boolean, default: false },
  sourceLabel: { type: String, default: '' }
});
const emit = defineEmits(['update:selectedIds', 'update:automatic', 'new-book']);
const expanded = ref(false);
const search = ref('');
const selectedBooks = computed(() => props.selectedIds.map(id => props.books.find(book => book.id === id)).filter(Boolean));
const filteredBooks = computed(() => {
  const term = search.value.trim().toLocaleLowerCase();
  return props.books.filter(book => !term || `${book.name} ${book.description || ''}`.toLocaleLowerCase().includes(term));
});
function toggleBook(id, checked) {
  emit('update:selectedIds', checked ? [...new Set([...props.selectedIds, id])] : props.selectedIds.filter(value => value !== id));
  emit('update:automatic', false);
}
</script>

<template>
  <section class="worldbook-target-picker" aria-label="本次使用的世界书">
    <div class="worldbook-target-heading">
      <strong><BookOpen :size="16" />本次使用的世界书</strong>
      <div class="worldbook-target-actions">
        <button class="ghost-button" type="button" :disabled="busy" :aria-expanded="expanded" @click="expanded = !expanded">
          调整<ChevronDown :size="14" />
        </button>
        <button class="ghost-button" type="button" :disabled="busy" @click="emit('new-book')"><Plus :size="15" />新建世界书</button>
      </div>
    </div>
    <div class="worldbook-target-summary" aria-live="polite">
      <span v-for="book in selectedBooks" :key="book.id" class="worldbook-target-chip">{{ book.name }}<small>{{ book.entryCount ?? book.entries?.length ?? 0 }} 条</small></span>
      <span v-if="automatic" class="worldbook-target-source"><Sparkles :size="13" />让助手根据对话自主选择</span>
      <span v-else-if="sourceLabel" class="worldbook-target-source">{{ sourceLabel }}</span>
      <span v-if="!automatic && !selectedIds.length" class="worldbook-target-source">尚未选择世界书，可直接描述要创建的内容</span>
    </div>
    <p class="worldbook-target-hint">可更新所选世界书，也可随时创建独立新书。</p>
    <div v-if="expanded" class="worldbook-target-options">
      <label class="worldbook-target-auto"><input type="checkbox" :checked="automatic" :disabled="busy" @change="emit('update:automatic', $event.target.checked)">让助手自主查找其他世界书</label>
      <label class="worldbook-target-search"><Search :size="15" /><input v-model="search" type="search" placeholder="搜索书名或描述" aria-label="搜索本次使用的世界书" :disabled="busy"></label>
      <div class="worldbook-target-list">
        <label v-for="book in filteredBooks" :key="book.id" class="worldbook-target-option">
          <input type="checkbox" :checked="selectedIds.includes(book.id)" :disabled="busy" @change="toggleBook(book.id, $event.target.checked)">
          <span><strong>{{ book.name }}</strong><small>{{ book.description || '暂无描述' }}</small><small>{{ book.entryCount ?? book.entries?.length ?? 0 }} 条 · {{ book.id.slice(0, 8) }}</small></span>
        </label>
        <p v-if="!filteredBooks.length" class="worldbook-target-hint">{{ books.length ? '没有匹配的世界书' : '还没有世界书，直接描述需求即可新建。' }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.worldbook-target-picker { padding: 14px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); min-width: 0; }
.worldbook-target-heading, .worldbook-target-heading > strong, .worldbook-target-actions, .worldbook-target-summary, .worldbook-target-source { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.worldbook-target-heading { justify-content: space-between; gap: 10px; }
.worldbook-target-heading > strong { font-size: .88rem; }
.worldbook-target-actions .ghost-button { padding: 6px 9px; min-height: 34px; font-size: .78rem; }
.worldbook-target-summary { margin-top: 10px; }
.worldbook-target-chip { display: inline-flex; align-items: center; gap: 7px; padding: 4px 8px; border-radius: 6px; background: var(--surface-strong); font-size: .8rem; overflow-wrap: anywhere; }
.worldbook-target-chip small, .worldbook-target-source, .worldbook-target-hint { color: var(--muted); font-size: .75rem; }
.worldbook-target-hint { margin: 8px 0 0; line-height: 1.6; }
.worldbook-target-options { border-top: 1px solid var(--line); margin-top: 12px; padding-top: 12px; display: grid; gap: 10px; }
.worldbook-target-auto, .worldbook-target-search { display: flex; align-items: center; gap: 8px; font-size: .8rem; }
.worldbook-target-picker input[type="checkbox"] { width: 16px; height: 16px; min-height: 16px; flex: 0 0 16px; padding: 0; accent-color: var(--primary); }
.worldbook-target-search input { width: 100%; min-width: 0; }
.worldbook-target-list { display: grid; gap: 5px; max-height: 230px; overflow-y: auto; }
.worldbook-target-option { display: flex; align-items: flex-start; gap: 8px; padding: 8px; border-radius: 7px; background: var(--surface-strong); }
.worldbook-target-option > input { margin-top: 5px; }
.worldbook-target-option > span { display: grid; gap: 3px; min-width: 0; overflow-wrap: anywhere; }
.worldbook-target-option strong { font-size: .83rem; }
.worldbook-target-option small { color: var(--muted); font-size: .74rem; }
@media (pointer: coarse) { .worldbook-target-actions .ghost-button, .worldbook-target-auto { min-height: 44px; } }
</style>
