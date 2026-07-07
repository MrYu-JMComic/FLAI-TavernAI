<script setup>
import { computed } from 'vue';
import { ChevronLeft, ChevronRight, X } from '@lucide/vue';

const WORLD_BOOK_SORT_OPTIONS = [
  { value: 'updatedDesc', label: '最近更新' },
  { value: 'nameAsc', label: '名称 A-Z' },
  { value: 'entryCountDesc', label: '条目多到少' }
];

const props = defineProps({
  canEdit: { type: Boolean, default: true },
  optionsLoading: { type: Boolean, default: false },
  optionsLoadError: { type: String, default: '' },
  pagedWorldBooks: { type: Array, default: () => [] },
  filteredWorldBooks: { type: Array, default: () => [] },
  search: { type: String, default: '' },
  selectedWorldBookIds: { type: Array, default: () => [] },
  sort: { type: String, default: 'updatedDesc' },
  worldBookPage: { type: Number, default: 1 },
  worldBookPageCount: { type: Number, default: 1 },
  worldBookPageEnd: { type: Number, default: 0 },
  worldBookPageStart: { type: Number, default: 0 }
});

const emit = defineEmits([
  'clear-search',
  'close',
  'page',
  'toggle',
  'update:search',
  'update:sort'
]);

const searchModel = computed({
  get: () => props.search,
  set: (value) => emit('update:search', value)
});

const sortModel = computed({
  get: () => props.sort,
  set: (value) => emit('update:sort', value)
});

function isWorldBookSelected(bookId) {
  for (const id of props.selectedWorldBookIds) {
    if (id === bookId) {
      return true;
    }
  }
  return false;
}
</script>

<template>
  <div class="world-book-dialog-overlay" @click.self="emit('close')">
    <section
      class="world-book-dialog form-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="world-book-dialog-title"
      tabindex="-1"
      @keydown.esc.prevent="emit('close')"
    >
      <div class="world-book-dialog-header">
        <div>
          <h2 id="world-book-dialog-title">关联世界书</h2>
          <p>搜索、排序并勾选要随角色绑定的世界书。</p>
        </div>
        <button
          class="icon-button"
          type="button"
          title="关闭"
          aria-label="关闭关联世界书选择"
          @click="emit('close')"
        >
          <X :size="18" />
        </button>
      </div>

      <div class="world-book-dialog-tools">
        <label class="field compact world-book-dialog-search">
          <span>搜索</span>
          <input
            v-model="searchModel"
            type="search"
            placeholder="按名称或描述搜索"
            aria-label="搜索世界书"
          />
        </label>
        <label class="field compact world-book-dialog-sort">
          <span>排序</span>
          <select v-model="sortModel" aria-label="世界书排序">
            <option
              v-for="option in WORLD_BOOK_SORT_OPTIONS"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </label>
        <button
          class="ghost-button world-book-clear-search"
          type="button"
          :disabled="!search.trim()"
          @click="emit('clear-search')"
        >
          <X :size="15" />
          <span>清空</span>
        </button>
      </div>

      <div class="world-book-dialog-summary" aria-live="polite">
        <span>已选 {{ selectedWorldBookIds.length }} 本</span>
        <span>{{ filteredWorldBooks.length }} 个匹配结果</span>
      </div>

      <div v-if="optionsLoading" class="world-book-dialog-state">
        正在加载世界书...
      </div>
      <div v-else-if="optionsLoadError" class="world-book-dialog-state error-text" role="alert">
        {{ optionsLoadError }}
      </div>
      <div v-else-if="!filteredWorldBooks.length" class="world-book-dialog-state">
        没有匹配的世界书。
      </div>
      <div v-else class="world-book-dialog-list">
        <label
          v-for="book in pagedWorldBooks"
          :key="book.id"
          class="world-book-dialog-option"
          :class="{ selected: isWorldBookSelected(book.id) }"
        >
          <input
            type="checkbox"
            :checked="isWorldBookSelected(book.id)"
            :disabled="!canEdit"
            @change="emit('toggle', book.id)"
          />
          <span class="world-book-dialog-option-main">
            <strong>{{ book.name }}</strong>
            <small v-if="book.description">{{ book.description }}</small>
            <small v-else class="muted-text">暂无描述</small>
          </span>
          <span class="world-book-dialog-meta">
            <small>{{ book.entryCount || 0 }} 条目</small>
            <small>深度 {{ book.scanDepth || 4 }}</small>
            <small>预算 {{ book.lorebookContextPercent || 25 }}%</small>
          </span>
        </label>
      </div>

      <div class="world-book-dialog-footer">
        <div class="world-book-pagination" aria-live="polite">
          <button
            class="icon-button"
            type="button"
            title="上一页"
            aria-label="上一页"
            :disabled="worldBookPage <= 1"
            @click="emit('page', worldBookPage - 1)"
          >
            <ChevronLeft :size="17" />
          </button>
          <span>{{ worldBookPageStart }}-{{ worldBookPageEnd }} / {{ filteredWorldBooks.length }} · 第 {{ worldBookPage }} / {{ worldBookPageCount }} 页</span>
          <button
            class="icon-button"
            type="button"
            title="下一页"
            aria-label="下一页"
            :disabled="worldBookPage >= worldBookPageCount"
            @click="emit('page', worldBookPage + 1)"
          >
            <ChevronRight :size="17" />
          </button>
        </div>
        <button class="primary-button" type="button" @click="emit('close')">
          完成
        </button>
      </div>
    </section>
  </div>
</template>
