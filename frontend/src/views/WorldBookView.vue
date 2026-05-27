<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Plus,
  Save,
  ToggleLeft,
  ToggleRight,
  Trash2
} from '@lucide/vue';
import {
  createWorldBook,
  createWorldBookEntry,
  deleteWorldBook,
  deleteWorldBookEntry,
  fetchWorldBook,
  fetchWorldBooks,
  updateWorldBook,
  updateWorldBookEntry
} from '../api';
import { useNotify } from '../composables/useNotify';

const props = defineProps({
  route: { type: Object, required: true }
});
const emit = defineEmits(['navigate']);

const notify = useNotify();
const loading = ref(false);
const saving = ref(false);
const books = ref([]);
const currentBook = ref(null);
const editingBook = reactive({ name: '', description: '', characterId: '' });
const editingEntry = reactive({
  name: '',
  triggerKeys: '',
  content: '',
  position: 'before_char',
  enabled: true
});
const showBookForm = ref(false);
const editingBookId = ref(null);
const showEntryForm = ref(false);
const editingEntryId = ref(null);

const isDetailView = computed(() => Boolean(props.route.params.id));
const bookId = computed(() => props.route.params.id);

const positionOptions = [
  { value: 'at_start', label: '最前面 (at_start)' },
  { value: 'before_char', label: '角色设定前 (before_char)' },
  { value: 'after_char', label: '角色设定后 (after_char)' }
];

onMounted(async () => {
  if (isDetailView.value) {
    await loadBook(bookId.value);
  } else {
    await loadBooks();
  }
});

watch(
  () => props.route.params.id,
  async (id) => {
    if (id) {
      await loadBook(id);
    } else {
      currentBook.value = null;
      await loadBooks();
    }
  }
);

async function loadBooks() {
  loading.value = true;
  try {
    books.value = await fetchWorldBooks();
  } catch (err) {
    notify.error(err.message);
  } finally {
    loading.value = false;
  }
}

async function loadBook(id) {
  loading.value = true;
  try {
    currentBook.value = await fetchWorldBook(id);
  } catch (err) {
    notify.error(err.message);
    emit('navigate', 'worldBooks');
  } finally {
    loading.value = false;
  }
}

function openCreateBook() {
  editingBook.name = '';
  editingBook.description = '';
  editingBook.characterId = '';
  editingBookId.value = null;
  showBookForm.value = true;
}

function openEditBook(book) {
  editingBook.name = book.name;
  editingBook.description = book.description || '';
  editingBook.characterId = book.characterId || '';
  editingBookId.value = book.id;
  showBookForm.value = true;
}

function closeBookForm() {
  showBookForm.value = false;
  editingBookId.value = null;
}

async function saveBook() {
  if (!editingBook.name.trim()) {
    notify.warning('请输入世界书名称');
    return;
  }
  saving.value = true;
  try {
    const payload = {
      name: editingBook.name.trim(),
      description: editingBook.description.trim(),
      characterId: editingBook.characterId.trim() || null
    };
    if (editingBookId.value) {
      await updateWorldBook(editingBookId.value, payload);
      notify.success('世界书已更新');
      if (isDetailView.value) {
        await loadBook(bookId.value);
      } else {
        await loadBooks();
      }
    } else {
      const book = await createWorldBook(payload);
      notify.success('世界书已创建');
      closeBookForm();
      emit('navigate', 'worldBookDetail', { id: book.id });
    }
  } catch (err) {
    notify.error(err.message);
  } finally {
    saving.value = false;
  }
}

async function removeBook(id) {
  if (!window.confirm('确定删除这个世界书及其所有条目吗？')) return;
  try {
    await deleteWorldBook(id);
    notify.success('世界书已删除');
    if (isDetailView.value) {
      emit('navigate', 'worldBooks');
    } else {
      await loadBooks();
    }
  } catch (err) {
    notify.error(err.message);
  }
}

function openCreateEntry() {
  editingEntry.name = '';
  editingEntry.triggerKeys = '';
  editingEntry.content = '';
  editingEntry.position = 'before_char';
  editingEntry.enabled = true;
  editingEntryId.value = null;
  showEntryForm.value = true;
}

function openEditEntry(entry) {
  editingEntry.name = entry.name;
  editingEntry.triggerKeys = entry.triggerKeys;
  editingEntry.content = entry.content;
  editingEntry.position = entry.position;
  editingEntry.enabled = entry.enabled;
  editingEntryId.value = entry.id;
  showEntryForm.value = true;
}

function closeEntryForm() {
  showEntryForm.value = false;
  editingEntryId.value = null;
}

async function saveEntry() {
  saving.value = true;
  try {
    const payload = {
      name: editingEntry.name.trim(),
      triggerKeys: editingEntry.triggerKeys.trim(),
      content: editingEntry.content,
      position: editingEntry.position,
      enabled: editingEntry.enabled
    };
    if (editingEntryId.value) {
      await updateWorldBookEntry(bookId.value, editingEntryId.value, payload);
      notify.success('条目已更新');
    } else {
      await createWorldBookEntry(bookId.value, payload);
      notify.success('条目已添加');
    }
    closeEntryForm();
    await loadBook(bookId.value);
  } catch (err) {
    notify.error(err.message);
  } finally {
    saving.value = false;
  }
}

async function removeEntry(entryId) {
  if (!window.confirm('确定删除这个条目吗？')) return;
  try {
    await deleteWorldBookEntry(bookId.value, entryId);
    notify.success('条目已删除');
    await loadBook(bookId.value);
  } catch (err) {
    notify.error(err.message);
  }
}

async function toggleEntry(entry) {
  try {
    await updateWorldBookEntry(bookId.value, entry.id, { enabled: !entry.enabled });
    await loadBook(bookId.value);
  } catch (err) {
    notify.error(err.message);
  }
}

async function moveEntry(index, direction) {
  const entries = currentBook.value?.entries;
  if (!entries) return;
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= entries.length) return;

  const current = entries[index];
  const target = entries[targetIndex];

  try {
    await Promise.all([
      updateWorldBookEntry(bookId.value, current.id, { orderIndex: target.orderIndex }),
      updateWorldBookEntry(bookId.value, target.id, { orderIndex: current.orderIndex })
    ]);
    await loadBook(bookId.value);
  } catch (err) {
    notify.error(err.message);
  }
}

function positionLabel(value) {
  return positionOptions.find((o) => o.value === value)?.label || value;
}
</script>

<template>
  <section class="page-stack">
    <!-- List View -->
    <template v-if="!isDetailView">
      <div class="section-heading">
        <div>
          <p>世界书管理</p>
          <h1>世界书</h1>
        </div>
        <div class="heading-actions">
          <button class="primary-button" @click="openCreateBook">
            <Plus :size="18" />
            <span>新建世界书</span>
          </button>
          <button class="ghost-button" @click="emit('navigate', 'home')">
            <ArrowLeft :size="18" />
            <span>返回</span>
          </button>
        </div>
      </div>

      <p v-if="loading" class="muted-text">正在加载...</p>

      <div v-if="!loading && !books.length" class="empty-state">
        <BookOpen :size="48" />
        <p>还没有世界书</p>
        <p class="muted-text">世界书用于在对话中自动注入背景设定</p>
      </div>

      <div v-if="!loading && books.length" class="book-grid">
        <div
          v-for="book in books"
          :key="book.id"
          class="book-card"
          @click="emit('navigate', 'worldBookDetail', { id: book.id })"
        >
          <div class="book-card-body">
            <h3>{{ book.name }}</h3>
            <p v-if="book.description" class="book-desc">{{ book.description }}</p>
            <p v-else class="muted-text">暂无描述</p>
          </div>
          <div class="book-card-footer">
            <span class="entry-count">{{ book.entryCount }} 个条目</span>
            <div class="book-card-actions" @click.stop>
              <button class="icon-button" title="编辑" @click="openEditBook(book)">
                <Save :size="16" />
              </button>
              <button class="icon-button danger" title="删除" @click="removeBook(book.id)">
                <Trash2 :size="16" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Detail View -->
    <template v-else>
      <div class="section-heading">
        <div>
          <p>世界书详情</p>
          <h1>{{ currentBook?.name || '加载中...' }}</h1>
        </div>
        <div class="heading-actions">
          <button class="ghost-button" @click="emit('navigate', 'worldBooks')">
            <ArrowLeft :size="18" />
            <span>返回列表</span>
          </button>
        </div>
      </div>

      <p v-if="loading" class="muted-text">正在加载...</p>

      <template v-if="!loading && currentBook">
        <div class="book-info-panel form-panel">
          <div class="inline-heading">
            <div>
              <h2>基本信息</h2>
              <p>{{ currentBook.description || '暂无描述' }}</p>
            </div>
            <div class="inline-actions">
              <button class="ghost-button" @click="openEditBook(currentBook)">编辑信息</button>
              <button class="danger-button" @click="removeBook(currentBook.id)">
                <Trash2 :size="16" />
                <span>删除世界书</span>
              </button>
            </div>
          </div>
          <p v-if="currentBook.characterId" class="muted-text">
            关联角色 ID: {{ currentBook.characterId }}
          </p>
        </div>

        <div class="form-panel entries-panel">
          <div class="inline-heading">
            <div>
              <h2>条目列表</h2>
              <p>触发词匹配时自动注入对应内容到上下文</p>
            </div>
            <button class="primary-button" @click="openCreateEntry">
              <Plus :size="17" />
              <span>添加条目</span>
            </button>
          </div>

          <div v-if="!currentBook.entries.length" class="empty-entries">
            <p class="muted-text">还没有条目，点击上方按钮添加</p>
          </div>

          <div v-for="(entry, index) in currentBook.entries" :key="entry.id" class="entry-row" :class="{ disabled: !entry.enabled }">
            <div class="entry-controls">
              <div class="entry-order-buttons">
                <button
                  class="icon-button ghost"
                  :disabled="index === 0"
                  title="上移"
                  @click="moveEntry(index, -1)"
                >
                  <ChevronUp :size="14" />
                </button>
                <button
                  class="icon-button ghost"
                  :disabled="index === currentBook.entries.length - 1"
                  title="下移"
                  @click="moveEntry(index, 1)"
                >
                  <ChevronDown :size="14" />
                </button>
              </div>
              <button
                class="icon-button toggle"
                :title="entry.enabled ? '点击禁用' : '点击启用'"
                @click="toggleEntry(entry)"
              >
                <ToggleRight v-if="entry.enabled" :size="20" />
                <ToggleLeft v-else :size="20" />
              </button>
            </div>
            <div class="entry-info">
              <div class="entry-header">
                <strong>{{ entry.name || '未命名条目' }}</strong>
                <span class="entry-position">{{ positionLabel(entry.position) }}</span>
              </div>
              <p v-if="entry.triggerKeys" class="entry-keys">
                触发词: {{ entry.triggerKeys }}
              </p>
              <p class="entry-content-preview">{{ entry.content || '空内容' }}</p>
            </div>
            <div class="entry-actions">
              <button class="icon-button" title="编辑" @click="openEditEntry(entry)">
                <Save :size="16" />
              </button>
              <button class="icon-button danger" title="删除" @click="removeEntry(entry.id)">
                <Trash2 :size="16" />
              </button>
            </div>
          </div>
        </div>
      </template>
    </template>

    <!-- Book Form Modal -->
    <div v-if="showBookForm" class="modal-overlay" @click.self="closeBookForm">
      <div class="modal-content form-panel">
        <h2>{{ editingBookId ? '编辑世界书' : '新建世界书' }}</h2>
        <label class="field">
          <span>名称</span>
          <input v-model.trim="editingBook.name" maxlength="80" placeholder="世界书名称" />
        </label>
        <label class="field">
          <span>描述</span>
          <textarea v-model="editingBook.description" rows="3" placeholder="可选描述" />
        </label>
        <label class="field">
          <span>关联角色 ID</span>
          <input v-model.trim="editingBook.characterId" placeholder="可选，留空则不关联" />
        </label>
        <div class="form-actions">
          <button class="ghost-button" @click="closeBookForm">取消</button>
          <button class="primary-button" :disabled="saving" @click="saveBook">
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Entry Form Modal -->
    <div v-if="showEntryForm" class="modal-overlay" @click.self="closeEntryForm">
      <div class="modal-content form-panel entry-modal">
        <h2>{{ editingEntryId ? '编辑条目' : '添加条目' }}</h2>
        <label class="field">
          <span>条目名称</span>
          <input v-model.trim="editingEntry.name" maxlength="120" placeholder="例如：魔法系统" />
        </label>
        <label class="field">
          <span>触发词（逗号分隔）</span>
          <input v-model="editingEntry.triggerKeys" placeholder="例如：魔法,魔力,法术,咒语" />
        </label>
        <label class="field">
          <span>注入位置</span>
          <select v-model="editingEntry.position">
            <option v-for="opt in positionOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>注入内容</span>
          <textarea v-model="editingEntry.content" rows="8" placeholder="当触发词匹配时，这段内容会被注入到 AI 上下文中" />
        </label>
        <label class="checkbox-line">
          <input v-model="editingEntry.enabled" type="checkbox" />
          <span>启用</span>
        </label>
        <div class="form-actions">
          <button class="ghost-button" @click="closeEntryForm">取消</button>
          <button class="primary-button" :disabled="saving" @click="saveEntry">
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.book-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.book-card {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  cursor: pointer;
  transition: box-shadow 0.2s, border-color 0.2s;
  display: flex;
  flex-direction: column;
}

.book-card:hover {
  border-color: var(--primary);
  box-shadow: var(--shadow);
}

.book-card-body {
  padding: 16px;
  flex: 1;
}

.book-card-body h3 {
  margin: 0 0 8px;
  font-size: 1.05rem;
}

.book-desc {
  margin: 0;
  color: var(--muted);
  font-size: 0.88rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.book-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-top: 1px solid var(--line);
}

.entry-count {
  font-size: 0.82rem;
  color: var(--muted);
}

.book-card-actions {
  display: flex;
  gap: 4px;
}

.empty-state {
  text-align: center;
  padding: 48px 24px;
  color: var(--muted);
}

.empty-state svg {
  opacity: 0.4;
  margin-bottom: 12px;
}

.heading-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.book-info-panel {
  margin-bottom: 16px;
}

.inline-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.entries-panel {
  margin-top: 0;
}

.entry-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  margin-bottom: 8px;
  background: color-mix(in srgb, var(--surface) 86%, transparent);
}

.entry-row.disabled {
  opacity: 0.55;
}

.entry-controls {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.entry-order-buttons {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.entry-info {
  flex: 1;
  min-width: 0;
}

.entry-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.entry-position {
  font-size: 0.78rem;
  color: var(--muted);
  background: var(--surface-strong);
  padding: 1px 8px;
  border-radius: 4px;
}

.entry-keys {
  font-size: 0.82rem;
  color: var(--muted);
  margin: 2px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.entry-content-preview {
  font-size: 0.84rem;
  color: var(--text);
  margin: 4px 0 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  opacity: 0.8;
}

.entry-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.icon-button.toggle {
  color: var(--green);
}

.entry-row.disabled .icon-button.toggle {
  color: var(--muted);
}

.empty-entries {
  text-align: center;
  padding: 32px;
}

.entry-modal {
  max-width: 600px;
  width: 90vw;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
}

.modal-content {
  background: var(--surface);
  border-radius: 16px;
  padding: 24px;
  max-width: 480px;
  width: 90vw;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: var(--shadow);
}

.modal-content h2 {
  margin-top: 0;
}

/* ── Mobile Responsive ── */

@media (max-width: 768px) {
  .book-grid {
    grid-template-columns: 1fr;
  }

  .heading-actions {
    flex-wrap: wrap;
    gap: 6px;
  }

  .heading-actions .ghost-button span,
  .heading-actions .primary-button span {
    display: inline;
  }

  .entry-row {
    flex-wrap: wrap;
  }

  .entry-controls {
    flex-direction: row;
    width: 100%;
    justify-content: space-between;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line);
    margin-bottom: 8px;
  }

  .entry-order-buttons {
    flex-direction: row;
  }

  .entry-info {
    flex-basis: 100%;
  }

  .entry-actions {
    width: 100%;
    justify-content: flex-end;
    padding-top: 8px;
    border-top: 1px solid var(--line);
  }

  .inline-actions {
    flex-wrap: wrap;
    gap: 6px;
  }

  .modal-overlay {
    padding: 0;
    align-items: flex-end;
  }

  .modal-content {
    max-width: none;
    width: 100%;
    max-height: 92vh;
    border-radius: 16px 16px 0 0;
  }

  .entry-modal {
    max-width: none;
    width: 100%;
  }
}

@media (max-width: 480px) {
  .book-card-body h3 {
    font-size: 0.95rem;
  }

  .book-card-body {
    padding: 12px;
  }

  .book-card-footer {
    padding: 8px 12px;
  }

  .modal-content {
    padding: 16px;
  }

  .entry-row {
    padding: 10px;
  }
}
</style>
