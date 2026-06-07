<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Plus,
  Save,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Trash2,
  WandSparkles
} from '@lucide/vue';
import {
  createWorldBook,
  createWorldBookEntry,
  deleteWorldBook,
  deleteWorldBookEntry,
  fetchWorldBook,
  fetchWorldBooks,
  streamWorldBookDraft,
  updateWorldBook,
  updateWorldBookEntry
} from '../api';
import { useNotify } from '../composables/useNotify';
import { useProviderModels } from '../composables/useProviderModels';

const props = defineProps({
  route: { type: Object, required: true },
  provider: { type: Object, default: null }
});
const emit = defineEmits(['navigate']);

const notify = useNotify();
const loading = ref(false);
const saving = ref(false);
const aiLoading = ref(false);
const aiRequirement = ref('');
const aiDraft = ref(null);
const aiToolCalls = ref([]);
const aiProcess = ref([]);
const aiReasoning = ref('');
const aiAbortController = ref(null);
const ASSISTANT_MODEL_STORAGE_KEY = 'flai-assistant-model';
const assistantModel = ref(loadAssistantModel());
const { providerModelOptionsFor } = useProviderModels(computed(() => props.provider));
const assistantModelOptions = computed(() => providerModelOptionsFor(assistantModel.value, '使用全局模型'));
const books = ref([]);
const currentBook = ref(null);
const error = ref(null);
const editingBook = reactive(createEmptyBook());
const editingEntry = reactive(createEmptyEntry());
const showBookForm = ref(false);
const editingBookId = ref(null);
const showEntryForm = ref(false);
const editingEntryId = ref(null);
let worldBookLoadToken = 0;
let worldBookMutationToken = 0;

const isDetailView = computed(() => Boolean(props.route.params.id));
const bookId = computed(() => props.route.params.id);
const aiDraftEntryCount = computed(() => aiDraft.value?.entries?.length || 0);
const totalEntryCount = computed(() => books.value.reduce((sum, book) => sum + Number(book.entryCount || 0), 0));
const booksWithEntriesCount = computed(() => books.value.filter((book) => Number(book.entryCount || 0) > 0).length);
const averageEntryCount = computed(() => {
  if (!books.value.length) return 0;
  return Math.round(totalEntryCount.value / books.value.length);
});
const currentEntries = computed(() => currentBook.value?.entries || []);
const enabledEntryCount = computed(() => currentEntries.value.filter((entry) => entry.enabled !== false).length);
const disabledEntryCount = computed(() => Math.max(0, currentEntries.value.length - enabledEntryCount.value));
const alwaysActiveEntryCount = computed(() => currentEntries.value.filter((entry) => entry.alwaysActive).length);
const probabilityEntryCount = computed(() => currentEntries.value.filter((entry) => entry.useProbability).length);

const positionOptions = [
  { value: 'at_start', label: '最前面 (at_start)' },
  { value: 'before_char', label: '角色设定前 (before_char)' },
  { value: 'after_char', label: '角色设定后 (after_char)' },
  { value: 'at_depth', label: '按深度插入 (at_depth)' }
];

const roleOptions = [
  { value: 0, label: 'System' },
  { value: 1, label: 'User' },
  { value: 2, label: 'Assistant' }
];

const selectiveLogicOptions = [
  { value: 0, label: '副关键词命中时激活' },
  { value: 1, label: '副关键词命中时阻止' },
  { value: 2, label: '全部副关键词命中时阻止' }
];

function loadAssistantModel() {
  try {
    return localStorage.getItem(ASSISTANT_MODEL_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

watch(assistantModel, (value) => {
  try {
    localStorage.setItem(ASSISTANT_MODEL_STORAGE_KEY, String(value || '').trim());
  } catch {}
});

onMounted(async () => {
  if (isDetailView.value) {
    await loadBook(bookId.value);
  } else {
    await loadBooks();
  }
});
onBeforeUnmount(resetWorldBookAsyncScope);

watch(
  () => props.route.params.id,
  async (id) => {
    resetWorldBookAsyncScope();
    if (id) {
      await loadBook(id);
    } else {
      currentBook.value = null;
      await loadBooks();
    }
  }
);

function resetWorldBookAsyncScope() {
  worldBookLoadToken += 1;
  loading.value = false;
  resetWorldBookInteractionState();
}

function resetWorldBookInteractionState() {
  worldBookMutationToken += 1;
  saving.value = false;
  aiAbortController.value?.abort();
  aiLoading.value = false;
  aiAbortController.value = null;
  closeBookForm();
  closeEntryForm();
}

async function loadBooks() {
  const requestToken = ++worldBookLoadToken;
  loading.value = true;
  error.value = null;
  try {
    const nextBooks = await fetchWorldBooks();
    if (!isCurrentBooksLoad(requestToken)) return;
    books.value = nextBooks;
  } catch (err) {
    if (!isCurrentBooksLoad(requestToken)) return;
    error.value = err.message;
    notify.error(err.message);
  } finally {
    if (isCurrentBooksLoad(requestToken)) {
      loading.value = false;
    }
  }
}

async function loadBook(id) {
  const requestToken = ++worldBookLoadToken;
  loading.value = true;
  error.value = null;
  try {
    const nextBook = await fetchWorldBook(id);
    if (!isCurrentBookLoad(requestToken, id)) return;
    currentBook.value = nextBook;
  } catch (err) {
    if (!isCurrentBookLoad(requestToken, id)) return;
    error.value = err.message;
    notify.error(err.message);
  } finally {
    if (isCurrentBookLoad(requestToken, id)) {
      loading.value = false;
    }
  }
}

function isCurrentBooksLoad(requestToken) {
  return requestToken === worldBookLoadToken && !isDetailView.value;
}

function isCurrentBookLoad(requestToken, id) {
  return requestToken === worldBookLoadToken && isDetailView.value && String(bookId.value) === String(id);
}

function isCurrentWorldBookMutation(mutationToken, id) {
  return mutationToken === worldBookMutationToken && isDetailView.value && String(bookId.value) === String(id);
}

function currentWorldBookRouteKey() {
  return isDetailView.value ? `detail:${String(bookId.value)}` : 'list';
}

function isCurrentWorldBookRouteMutation(mutationToken, routeKey) {
  return mutationToken === worldBookMutationToken && currentWorldBookRouteKey() === routeKey;
}

function openCreateBook() {
  Object.assign(editingBook, createEmptyBook());
  editingBookId.value = null;
  showBookForm.value = true;
}

function openEditBook(book) {
  Object.assign(editingBook, {
    name: book.name || '',
    description: book.description || '',
    characterId: book.characterId || '',
    scanDepth: book.scanDepth || 4,
    lorebookContextPercent: book.lorebookContextPercent || 25
  });
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
  const routeKey = currentWorldBookRouteKey();
  const routeBookId = bookId.value;
  const targetBookId = editingBookId.value;
  const mutationToken = worldBookMutationToken;
  saving.value = true;
  try {
    const payload = {
      name: editingBook.name.trim(),
      description: editingBook.description.trim(),
      characterId: editingBook.characterId.trim(),
      scanDepth: clampNumber(editingBook.scanDepth, 1, 50, 4),
      lorebookContextPercent: clampNumber(editingBook.lorebookContextPercent, 1, 100, 25)
    };
    if (targetBookId) {
      await updateWorldBook(targetBookId, payload);
      if (!isCurrentWorldBookRouteMutation(mutationToken, routeKey)) return;
      if (routeBookId) {
        await loadBook(routeBookId);
      } else {
        await loadBooks();
      }
      if (!isCurrentWorldBookRouteMutation(mutationToken, routeKey)) return;
      notify.success('世界书已更新');
    } else {
      const book = await createWorldBook(payload);
      if (!isCurrentWorldBookRouteMutation(mutationToken, routeKey)) return;
      closeBookForm();
      notify.success('世界书已创建');
      emit('navigate', 'worldBookDetail', { id: book.id });
    }
  } catch (err) {
    if (!isCurrentWorldBookRouteMutation(mutationToken, routeKey)) return;
    notify.error(err.message);
  } finally {
    if (isCurrentWorldBookRouteMutation(mutationToken, routeKey)) {
      saving.value = false;
    }
  }
}

async function removeBook(id) {
  if (!window.confirm('确定删除这个世界书及其所有条目吗？')) return;
  const routeKey = currentWorldBookRouteKey();
  const mutationToken = worldBookMutationToken;
  try {
    await deleteWorldBook(id);
    if (!isCurrentWorldBookRouteMutation(mutationToken, routeKey)) return;
    books.value = books.value.filter((book) => book.id !== id);
    if (currentBook.value?.id === id) {
      currentBook.value = null;
    }
    notify.success('世界书已删除');
    if (isDetailView.value) {
      emit('navigate', 'worldBooks');
    } else {
      await loadBooks();
    }
  } catch (err) {
    if (!isCurrentWorldBookRouteMutation(mutationToken, routeKey)) return;
    notify.error(err.message);
  }
}

function openCreateEntry() {
  Object.assign(editingEntry, createEmptyEntry());
  editingEntryId.value = null;
  showEntryForm.value = true;
}

function openEditEntry(entry) {
  Object.assign(editingEntry, {
    ...createEmptyEntry(),
    name: entry.name || '',
    triggerKeys: entry.triggerKeys || '',
    content: entry.content || '',
    position: entry.position || 'before_char',
    enabled: entry.enabled !== false,
    regexMode: Boolean(entry.regexMode),
    alwaysActive: Boolean(entry.alwaysActive),
    depth: entry.depth ?? 0,
    role: entry.role ?? 0,
    sticky: entry.sticky ?? null,
    cooldown: entry.cooldown ?? null,
    delay: entry.delay ?? null,
    selective: Boolean(entry.selective),
    selectiveLogic: entry.selectiveLogic ?? 0,
    keysSecondary: entry.keysSecondary || '',
    useProbability: Boolean(entry.useProbability),
    probability: entry.probability ?? 100,
    group: entry.group || '',
    groupWeight: entry.groupWeight ?? 0
  });
  editingEntryId.value = entry.id;
  showEntryForm.value = true;
}

function closeEntryForm() {
  showEntryForm.value = false;
  editingEntryId.value = null;
}

async function saveEntry() {
  const targetBookId = bookId.value;
  if (!targetBookId) return;
  const targetEntryId = editingEntryId.value;
  const mutationToken = worldBookMutationToken;
  saving.value = true;
  try {
    const payload = {
      name: editingEntry.name.trim(),
      triggerKeys: editingEntry.triggerKeys.trim(),
      content: editingEntry.content,
      position: editingEntry.position,
      enabled: editingEntry.enabled,
      regexMode: editingEntry.regexMode,
      alwaysActive: editingEntry.alwaysActive,
      depth: clampNumber(editingEntry.depth, 0, 10, 0),
      role: clampNumber(editingEntry.role, 0, 2, 0),
      sticky: nullableNumber(editingEntry.sticky),
      cooldown: nullableNumber(editingEntry.cooldown),
      delay: nullableNumber(editingEntry.delay),
      selective: editingEntry.selective,
      selectiveLogic: clampNumber(editingEntry.selectiveLogic, 0, 2, 0),
      keysSecondary: editingEntry.keysSecondary.trim(),
      useProbability: editingEntry.useProbability,
      probability: clampNumber(editingEntry.probability, 0, 100, 100),
      group: editingEntry.group.trim(),
      groupWeight: Math.max(0, Number(editingEntry.groupWeight) || 0)
    };
    if (targetEntryId) {
      await updateWorldBookEntry(targetBookId, targetEntryId, payload);
    } else {
      await createWorldBookEntry(targetBookId, payload);
    }
    if (!isCurrentWorldBookMutation(mutationToken, targetBookId)) return;
    closeEntryForm();
    await loadBook(targetBookId);
    if (!isCurrentWorldBookMutation(mutationToken, targetBookId)) return;
    notify.success(targetEntryId ? '条目已更新' : '条目已添加');
  } catch (err) {
    if (!isCurrentWorldBookMutation(mutationToken, targetBookId)) return;
    notify.error(err.message);
  } finally {
    if (isCurrentWorldBookMutation(mutationToken, targetBookId)) {
      saving.value = false;
    }
  }
}

async function removeEntry(entryId) {
  if (!window.confirm('确定删除这个条目吗？')) return;
  const targetBookId = bookId.value;
  if (!targetBookId) return;
  const mutationToken = worldBookMutationToken;
  try {
    await deleteWorldBookEntry(targetBookId, entryId);
    if (!isCurrentWorldBookMutation(mutationToken, targetBookId)) return;
    await loadBook(targetBookId);
    if (!isCurrentWorldBookMutation(mutationToken, targetBookId)) return;
    notify.success('条目已删除');
  } catch (err) {
    if (!isCurrentWorldBookMutation(mutationToken, targetBookId)) return;
    notify.error(err.message);
  }
}

async function toggleEntry(entry) {
  const targetBookId = bookId.value;
  if (!targetBookId) return;
  const mutationToken = worldBookMutationToken;
  try {
    await updateWorldBookEntry(targetBookId, entry.id, { enabled: !entry.enabled });
    if (!isCurrentWorldBookMutation(mutationToken, targetBookId)) return;
    await loadBook(targetBookId);
  } catch (err) {
    if (!isCurrentWorldBookMutation(mutationToken, targetBookId)) return;
    notify.error(err.message);
  }
}

async function moveEntry(index, direction) {
  const entries = currentBook.value?.entries;
  if (!entries) return;
  const targetBookId = bookId.value;
  if (!targetBookId) return;
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= entries.length) return;

  const current = entries[index];
  const target = entries[targetIndex];
  const mutationToken = worldBookMutationToken;
  try {
    await Promise.all([
      updateWorldBookEntry(targetBookId, current.id, { orderIndex: target.orderIndex }),
      updateWorldBookEntry(targetBookId, target.id, { orderIndex: current.orderIndex })
    ]);
    if (!isCurrentWorldBookMutation(mutationToken, targetBookId)) return;
    await loadBook(targetBookId);
  } catch (err) {
    if (!isCurrentWorldBookMutation(mutationToken, targetBookId)) return;
    notify.error(err.message);
  }
}

function positionLabel(value) {
  return positionOptions.find((o) => o.value === value)?.label || value;
}

function currentWorldBookDraft() {
  return {
    name: editingBook.name || currentBook.value?.name || '',
    description: editingBook.description || currentBook.value?.description || '',
    characterId: editingBook.characterId || currentBook.value?.characterId || '',
    scanDepth: editingBook.scanDepth || currentBook.value?.scanDepth || 4,
    lorebookContextPercent: editingBook.lorebookContextPercent || currentBook.value?.lorebookContextPercent || 25,
    entries: currentBook.value?.entries || []
  };
}

async function completeWorldBookWithAi() {
  const requirement = aiRequirement.value.trim();
  if (!requirement && !currentWorldBookDraft().name && !currentWorldBookDraft().description) {
    notify.warning('请先输入世界书主题，或保留已有世界书内容作为参考。');
    return;
  }

  const routeKey = currentWorldBookRouteKey();
  const mutationToken = worldBookMutationToken;
  const abortController = new AbortController();
  aiLoading.value = true;
  aiToolCalls.value = [];
  aiProcess.value = [{ round: 1, reasoning: '等待模型响应...', content: '', tools: [] }];
  aiReasoning.value = '';
  aiAbortController.value = abortController;
  try {
    const result = await streamWorldBookDraft({
      requirement,
      worldBook: currentWorldBookDraft(),
      modelOverride: assistantModel.value.trim()
    }, aiStreamHandlers(mutationToken, routeKey), abortController.signal);
    if (!isCurrentWorldBookRouteMutation(mutationToken, routeKey)) return;
    if (result?.aborted) {
      notify.info('AI 世界书生成已暂停');
      return;
    }
    aiDraft.value = result.worldBook;
    aiToolCalls.value = result.toolCalls || [];
    aiProcess.value = result.process || [];
    aiReasoning.value = result.reasoning || '';
    if (!aiDraftEntryCount.value) {
      aiDraft.value = null;
      notify.warning('AI 没有生成有效条目，请补充更具体的世界书主题后重试。');
      return;
    }
    notify.success(`AI 已生成 ${aiDraftEntryCount.value} 个世界书条目`);
  } catch (err) {
    if (!isCurrentWorldBookRouteMutation(mutationToken, routeKey)) return;
    if (abortController.signal.aborted || err.name === 'AbortError') {
      notify.info('AI 世界书生成已暂停');
      return;
    }
    aiProcess.value = [{ round: 1, reasoning: err.message, content: '', tools: [] }];
    notify.error(err.message);
  } finally {
    if (isCurrentWorldBookRouteMutation(mutationToken, routeKey)) {
      aiLoading.value = false;
      if (aiAbortController.value === abortController) {
        aiAbortController.value = null;
      }
    }
  }
}

function stopWorldBookAi() {
  aiAbortController.value?.abort();
}

async function createBookFromAiDraft() {
  if (!aiDraft.value?.name) {
    notify.warning('请先生成世界书草稿');
    return;
  }
  if (!aiDraftEntryCount.value) {
    notify.warning('AI 草稿没有可创建的条目，请重新生成。');
    return;
  }

  const routeKey = currentWorldBookRouteKey();
  const mutationToken = worldBookMutationToken;
  saving.value = true;
  let createdBook = null;
  try {
    createdBook = await createWorldBook({
      name: aiDraft.value.name,
      description: aiDraft.value.description || '',
      characterId: aiDraft.value.characterId || '',
      scanDepth: aiDraft.value.scanDepth || 4,
      lorebookContextPercent: aiDraft.value.lorebookContextPercent || 25
    });
    for (const entry of aiDraft.value.entries || []) {
      await createWorldBookEntry(createdBook.id, normalizeAiEntryForCreate(entry));
    }
    if (!isCurrentWorldBookRouteMutation(mutationToken, routeKey)) return;
    notify.success(`世界书已创建，并写入 ${aiDraftEntryCount.value} 个条目`);
    aiDraft.value = null;
    emit('navigate', 'worldBookDetail', { id: createdBook.id });
  } catch (err) {
    if (createdBook?.id) {
      await deleteWorldBook(createdBook.id).catch(() => null);
    }
    if (!isCurrentWorldBookRouteMutation(mutationToken, routeKey)) return;
    notify.error(err.message);
  } finally {
    if (isCurrentWorldBookRouteMutation(mutationToken, routeKey)) {
      saving.value = false;
    }
  }
}

function retryLoad() {
  if (isDetailView.value) {
    loadBook(bookId.value);
  } else {
    loadBooks();
  }
}

function createEmptyBook() {
  return {
    name: '',
    description: '',
    characterId: '',
    scanDepth: 4,
    lorebookContextPercent: 25
  };
}

function createEmptyEntry() {
  return {
    name: '',
    triggerKeys: '',
    content: '',
    position: 'before_char',
    enabled: true,
    regexMode: false,
    alwaysActive: false,
    depth: 0,
    role: 0,
    sticky: null,
    cooldown: null,
    delay: null,
    selective: false,
    selectiveLogic: 0,
    keysSecondary: '',
    useProbability: false,
    probability: 100,
    group: '',
    groupWeight: 0
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  return Math.max(0, Math.floor(Number(value) || 0));
}

function normalizeAiEntryForCreate(entry = {}) {
  return {
    ...entry,
    position: positionOptions.some((option) => option.value === entry.position) ? entry.position : 'before_char',
    depth: clampNumber(entry.depth, 0, 10, 0),
    role: clampNumber(entry.role, 0, 2, 0),
    probability: clampNumber(entry.probability, 0, 100, 100),
    groupWeight: Math.max(0, Number(entry.groupWeight) || 0),
    sticky: nullableNumber(entry.sticky),
    cooldown: nullableNumber(entry.cooldown),
    delay: nullableNumber(entry.delay)
  };
}

function aiStreamHandlers(mutationToken, routeKey) {
  return {
    step: (step) => {
      if (!isCurrentWorldBookRouteMutation(mutationToken, routeKey)) return;
      const target = ensureAiProcessStep(step.round || 1);
      Object.assign(target, {
        ...step,
        content: target.content || step.content || '',
        reasoning: target.reasoning === '等待模型响应...' ? step.reasoning || '' : target.reasoning || step.reasoning || '',
        tools: target.tools?.length ? target.tools : step.tools || []
      });
    },
    reasoning: ({ round = 1, text = '' } = {}) => {
      if (!isCurrentWorldBookRouteMutation(mutationToken, routeKey)) return;
      const target = ensureAiProcessStep(round);
      if (target.reasoning === '等待模型响应...') target.reasoning = '';
      target.reasoning += text;
      aiReasoning.value += text;
    },
    content: ({ round = 1, text = '' } = {}) => {
      if (!isCurrentWorldBookRouteMutation(mutationToken, routeKey)) return;
      const target = ensureAiProcessStep(round);
      target.content += text;
    },
    nudge: ({ round = 1, text = '' } = {}) => {
      if (!isCurrentWorldBookRouteMutation(mutationToken, routeKey)) return;
      const target = ensureAiProcessStep(round);
      target.content += `${target.content ? '\n\n' : ''}系统提醒：${text}`;
    },
    tool: (call = {}) => {
      if (!isCurrentWorldBookRouteMutation(mutationToken, routeKey)) return;
      const target = ensureAiProcessStep(call.round || 1);
      const log = {
        name: call.name,
        arguments: call.arguments,
        result: call.result
      };
      target.tools.push(log);
      aiToolCalls.value.push(log);
    }
  };
}

function ensureAiProcessStep(round = 1) {
  let step = aiProcess.value.find((item) => item.round === round);
  if (!step) {
    step = { round, reasoning: '', content: '', tools: [] };
    aiProcess.value.push(step);
  }
  return step;
}

function formatAiValue(value) {
  if (value === null || value === undefined || value === '') return '空';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toolResultLabel(result = {}) {
  if (result?.ok === false) return result.error || '失败';
  if (typeof result?.count === 'number') return `写入 ${result.count} 项`;
  if (result?.applied?.entries && Array.isArray(result.applied.entries)) return `写入 ${result.applied.entries.length} 个条目`;
  if (result?.applied && typeof result.applied === 'object') return `更新 ${Object.keys(result.applied).length} 项`;
  return result?.ok === true ? '成功' : '已返回';
}
</script>

<template>
  <section class="page-stack worldbook-page">
    <template v-if="!isDetailView">
      <section class="worldbook-overview">
        <div class="worldbook-overview-copy">
          <p class="worldbook-eyebrow">Lorebook Studio</p>
          <h1>世界书</h1>
          <p>管理触发词、注入位置、扫描深度和上下文预算，让角色对话能按场景自动补全世界观。</p>
        </div>
        <div class="worldbook-overview-actions">
          <button class="primary-button" @click="openCreateBook">
            <Plus :size="18" />
            <span>新建世界书</span>
          </button>
          <button class="ghost-button" @click="emit('navigate', 'home')">
            <ArrowLeft :size="18" />
            <span>返回</span>
          </button>
        </div>
        <div class="worldbook-stat-strip" aria-label="世界书概览">
          <div>
            <strong>{{ books.length }}</strong>
            <span>世界书</span>
          </div>
          <div>
            <strong>{{ totalEntryCount }}</strong>
            <span>条目</span>
          </div>
          <div>
            <strong>{{ booksWithEntriesCount }}</strong>
            <span>已配置</span>
          </div>
          <div>
            <strong>{{ averageEntryCount }}</strong>
            <span>平均条目</span>
          </div>
        </div>
      </section>

      <div class="worldbook-workbench">
      <section class="form-panel worldbook-ai-panel">
        <div class="inline-heading">
          <div>
            <h2>AI 世界书创建助手</h2>
            <p>生成关键词触发、扫描深度、上下文预算、概率、分组和深度注入，适合 Tavern / SillyTavern 风格 lorebook。</p>
          </div>
          <Sparkles :size="20" />
        </div>
        <label class="field">
          <span>世界书需求</span>
          <textarea
            v-model="aiRequirement"
            rows="4"
            placeholder="例如：现代豪门恋爱世界书，包含家族、公司、别墅、秘密关系和触发词。"
            :disabled="aiLoading"
          />
        </label>
        <label class="field">
          <span>助手模型</span>
          <select
            v-model="assistantModel"
            :disabled="aiLoading"
          >
            <option v-for="model in assistantModelOptions" :key="model.id || '__global'" :value="model.id">
              {{ model.label || model.id }}
            </option>
          </select>
        </label>
        <div class="form-actions">
          <button class="primary-button" type="button" :disabled="aiLoading" @click="completeWorldBookWithAi">
            <WandSparkles :size="18" />
            <span>{{ aiLoading ? 'AI 正在生成...' : '生成世界书草稿' }}</span>
          </button>
          <button v-if="aiLoading" class="ghost-button" type="button" @click="stopWorldBookAi">
            <span>暂停</span>
          </button>
          <button class="ghost-button" type="button" :disabled="!aiDraft || !aiDraftEntryCount || saving" @click="createBookFromAiDraft">
            <Save :size="18" />
            <span>{{ saving ? '创建中...' : '创建书和条目' }}</span>
          </button>
        </div>
        <div v-if="aiProcess.length || aiToolCalls.length" class="ai-process-panel">
          <div class="ai-tool-title">
            <span>AI 过程 {{ aiProcess.length || 1 }} 轮 · 工具 {{ aiToolCalls.length }}</span>
          </div>
          <div v-if="aiReasoning" class="ai-reasoning-box">
            <strong>思考摘要</strong>
            <p>{{ aiReasoning }}</p>
          </div>
          <details v-for="(step, stepIndex) in aiProcess" :key="`wb-step-${step.round || stepIndex}`" class="ai-process-step" open>
            <summary>
              <span>第 {{ step.round || stepIndex + 1 }} 轮</span>
              <small>{{ step.tools?.length || 0 }} 个工具</small>
            </summary>
            <p v-if="step.reasoning" class="ai-process-text">{{ step.reasoning }}</p>
            <p v-if="step.content" class="ai-process-text">{{ step.content }}</p>
            <div v-if="step.tools?.length" class="ai-tool-detail-list">
              <details v-for="(call, index) in step.tools" :key="`${call.name}-${index}`" class="ai-tool-detail">
                <summary>
                  <span>{{ call.name }}</span>
                  <small>{{ toolResultLabel(call.result) }}</small>
                </summary>
                <strong>参数</strong>
                <pre>{{ formatAiValue(call.arguments) }}</pre>
                <strong>结果</strong>
                <pre>{{ formatAiValue(call.result) }}</pre>
              </details>
            </div>
          </details>
          <div v-if="!aiProcess.length && aiToolCalls.length" class="ai-tool-list">
            <span v-for="(call, index) in aiToolCalls" :key="`${call.name}-${index}`">{{ call.name }}</span>
          </div>
        </div>
        <div v-if="aiDraft" class="worldbook-ai-preview">
          <div>
            <strong>{{ aiDraft.name }}</strong>
            <p>{{ aiDraft.description }}</p>
            <small>scan {{ aiDraft.scanDepth }} | budget {{ aiDraft.lorebookContextPercent }}% | {{ aiDraftEntryCount }} entries</small>
          </div>
          <div class="worldbook-ai-entry-list">
            <article v-for="(entry, index) in aiDraft.entries" :key="index" class="worldbook-ai-entry">
              <strong>{{ entry.name }}</strong>
              <small>{{ entry.position }} | {{ entry.triggerKeys || 'Always' }}</small>
              <p>{{ entry.content }}</p>
            </article>
          </div>
        </div>
      </section>

      <section class="worldbook-library-panel" aria-label="世界书列表">
        <div class="worldbook-panel-head">
          <div>
            <p class="worldbook-eyebrow">Library</p>
            <h2>我的世界书</h2>
          </div>
          <span>{{ books.length }} 本 · {{ totalEntryCount }} 条目</span>
        </div>

      <div v-if="loading" class="loading-state">
        <div class="loading-spinner"></div>
        <p>正在加载世界书...</p>
      </div>

      <div v-else-if="error" class="empty-state error-state">
        <AlertCircle :size="48" />
        <h2>加载失败</h2>
        <p>{{ error }}</p>
        <button class="ghost-button" @click="retryLoad">
          <span>重试</span>
        </button>
      </div>

      <div v-else-if="!books.length" class="empty-state">
        <BookOpen :size="48" />
        <h2>还没有世界书</h2>
        <p>世界书用于在对话中自动注入背景设定。</p>
        <button class="primary-button" @click="openCreateBook">
          <Plus :size="18" />
          <span>创建第一个世界书</span>
        </button>
      </div>

      <div v-else class="book-grid">
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
            <div class="book-card-meta">
              <span>scan {{ book.scanDepth || 4 }}</span>
              <span>budget {{ book.lorebookContextPercent || 25 }}%</span>
            </div>
          </div>
          <div class="book-card-footer">
            <span class="entry-count">{{ book.entryCount }} 个条目</span>
            <div class="book-card-actions" @click.stop>
              <button class="icon-button" title="编辑" :aria-label="`编辑世界书：${book.name}`" @click="openEditBook(book)">
                <Save :size="16" />
              </button>
              <button class="icon-button danger" title="删除" :aria-label="`删除世界书：${book.name}`" @click="removeBook(book.id)">
                <Trash2 :size="16" />
              </button>
            </div>
          </div>
        </div>
      </div>
      </section>
      </div>
    </template>

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

      <div v-if="loading" class="loading-state">
        <div class="loading-spinner"></div>
        <p>正在加载世界书详情...</p>
      </div>

      <div v-else-if="error" class="empty-state error-state">
        <AlertCircle :size="48" />
        <h2>加载失败</h2>
        <p>{{ error }}</p>
        <div class="empty-state-actions">
          <button class="ghost-button" @click="retryLoad">
            <span>重试</span>
          </button>
          <button class="ghost-button" @click="emit('navigate', 'worldBooks')">
            <span>返回列表</span>
          </button>
        </div>
      </div>

      <template v-else-if="currentBook">
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
          <div class="worldbook-meta-row">
            <span>扫描深度 {{ currentBook.scanDepth }}</span>
            <span>上下文预算 {{ currentBook.lorebookContextPercent }}%</span>
            <span v-if="currentBook.characterId">关联角色 ID: {{ currentBook.characterId }}</span>
          </div>
          <div class="worldbook-detail-stats" aria-label="当前世界书条目概览">
            <div>
              <strong>{{ currentEntries.length }}</strong>
              <span>总条目</span>
            </div>
            <div>
              <strong>{{ enabledEntryCount }}</strong>
              <span>启用</span>
            </div>
            <div>
              <strong>{{ disabledEntryCount }}</strong>
              <span>禁用</span>
            </div>
            <div>
              <strong>{{ alwaysActiveEntryCount }}</strong>
              <span>常驻</span>
            </div>
            <div>
              <strong>{{ probabilityEntryCount }}</strong>
              <span>概率</span>
            </div>
          </div>
        </div>

        <div class="form-panel entries-panel">
          <div class="inline-heading">
            <div>
              <h2>条目列表</h2>
              <p>触发词匹配时自动注入对应内容到上下文。</p>
            </div>
            <button class="primary-button" @click="openCreateEntry">
              <Plus :size="17" />
              <span>添加条目</span>
            </button>
          </div>

          <div v-if="!currentBook.entries.length" class="empty-entries">
            <BookOpen :size="36" />
            <p>还没有条目</p>
            <p class="muted-text">点击上方按钮添加触发词和内容。</p>
          </div>

          <div v-else class="entry-list">
            <div v-for="(entry, index) in currentBook.entries" :key="entry.id" class="entry-row" :class="{ disabled: !entry.enabled }">
              <div class="entry-controls">
                <div class="entry-order-buttons">
                  <button
                    class="icon-button ghost"
                    :disabled="index === 0"
                    title="上移"
                    :aria-label="`上移条目：${entry.name || `第 ${index + 1} 个条目`}`"
                    @click="moveEntry(index, -1)"
                  >
                    <ChevronUp :size="14" />
                  </button>
                  <button
                    class="icon-button ghost"
                    :disabled="index === currentBook.entries.length - 1"
                    title="下移"
                    :aria-label="`下移条目：${entry.name || `第 ${index + 1} 个条目`}`"
                    @click="moveEntry(index, 1)"
                  >
                    <ChevronDown :size="14" />
                  </button>
                </div>
                <button
                  class="icon-button toggle"
                  :title="entry.enabled ? '点击禁用' : '点击启用'"
                  :aria-label="entry.enabled ? `禁用条目：${entry.name || `第 ${index + 1} 个条目`}` : `启用条目：${entry.name || `第 ${index + 1} 个条目`}`"
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
                  <div class="entry-chips">
                    <span v-if="entry.regexMode" class="entry-chip">Regex</span>
                    <span v-if="entry.alwaysActive" class="entry-chip">Always</span>
                    <span v-if="entry.useProbability" class="entry-chip">{{ entry.probability }}%</span>
                    <span v-if="entry.group" class="entry-chip">G:{{ entry.group }}</span>
                    <span v-if="entry.position === 'at_depth'" class="entry-chip">D:{{ entry.depth }}</span>
                    <span v-if="entry.sticky != null" class="entry-chip">Sticky:{{ entry.sticky }}</span>
                    <span v-if="entry.cooldown != null" class="entry-chip">CD:{{ entry.cooldown }}</span>
                    <span v-if="entry.delay != null" class="entry-chip">Delay:{{ entry.delay }}</span>
                  </div>
                </div>
                <p v-if="entry.triggerKeys" class="entry-keys">触发词：{{ entry.triggerKeys }}</p>
                <p v-if="entry.keysSecondary" class="entry-keys">副关键词：{{ entry.keysSecondary }}</p>
                <p class="entry-content-preview">{{ entry.content || '空内容' }}</p>
              </div>
              <div class="entry-actions">
                <button class="icon-button" title="编辑" :aria-label="`编辑条目：${entry.name || `第 ${index + 1} 个条目`}`" @click="openEditEntry(entry)">
                  <Save :size="16" />
                </button>
                <button class="icon-button danger" title="删除" :aria-label="`删除条目：${entry.name || `第 ${index + 1} 个条目`}`" @click="removeEntry(entry.id)">
                  <Trash2 :size="16" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>

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
        <div class="worldbook-settings-grid">
          <label class="field">
            <span>扫描深度</span>
            <input v-model.number="editingBook.scanDepth" type="number" min="1" max="50" />
          </label>
          <label class="field">
            <span>上下文预算 %</span>
            <input v-model.number="editingBook.lorebookContextPercent" type="number" min="1" max="100" />
          </label>
        </div>
        <div class="form-actions">
          <button class="ghost-button" @click="closeBookForm">取消</button>
          <button class="primary-button" :disabled="saving" @click="saveBook">
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>

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
            <option v-for="opt in positionOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </label>
        <label class="field">
          <span>注入内容</span>
          <textarea v-model="editingEntry.content" rows="8" placeholder="当触发词匹配时，这段内容会被注入到 AI 上下文中。" />
        </label>
        <label class="checkbox-line">
          <input v-model="editingEntry.enabled" type="checkbox" />
          <span>启用</span>
        </label>
        <div class="worldbook-entry-switches">
          <label class="checkbox-line">
            <input v-model="editingEntry.regexMode" type="checkbox" />
            <span>正则触发</span>
          </label>
          <label class="checkbox-line">
            <input v-model="editingEntry.alwaysActive" type="checkbox" />
            <span>总是激活</span>
          </label>
          <label class="checkbox-line">
            <input v-model="editingEntry.selective" type="checkbox" />
            <span>副关键词过滤</span>
          </label>
          <label class="checkbox-line">
            <input v-model="editingEntry.useProbability" type="checkbox" />
            <span>概率激活</span>
          </label>
        </div>
        <div class="worldbook-settings-grid">
          <label class="field">
            <span>副关键词</span>
            <input v-model="editingEntry.keysSecondary" placeholder="可选，逗号分隔" />
          </label>
          <label class="field">
            <span>过滤逻辑</span>
            <select v-model.number="editingEntry.selectiveLogic">
              <option v-for="opt in selectiveLogicOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
          </label>
        </div>
        <div class="worldbook-settings-grid">
          <label class="field">
            <span>概率 %</span>
            <input v-model.number="editingEntry.probability" type="number" min="0" max="100" />
          </label>
          <label class="field">
            <span>互斥分组</span>
            <input v-model.trim="editingEntry.group" placeholder="同组只注入一个" />
          </label>
        </div>
        <div class="worldbook-settings-grid">
          <label class="field">
            <span>分组权重</span>
            <input v-model.number="editingEntry.groupWeight" type="number" min="0" />
          </label>
          <label class="field">
            <span>at_depth 角色</span>
            <select v-model.number="editingEntry.role">
              <option v-for="opt in roleOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
          </label>
        </div>
        <div class="worldbook-settings-grid compact-numbers">
          <label class="field">
            <span>深度</span>
            <input v-model.number="editingEntry.depth" type="number" min="0" max="10" />
          </label>
          <label class="field">
            <span>Sticky</span>
            <input v-model.number="editingEntry.sticky" type="number" min="0" placeholder="空" />
          </label>
          <label class="field">
            <span>Cooldown</span>
            <input v-model.number="editingEntry.cooldown" type="number" min="0" placeholder="空" />
          </label>
          <label class="field">
            <span>Delay</span>
            <input v-model.number="editingEntry.delay" type="number" min="0" placeholder="空" />
          </label>
        </div>
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
.worldbook-page {
  gap: 18px;
}

.worldbook-overview {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: end;
  padding: clamp(16px, 3vw, 24px);
  border: 1px solid color-mix(in srgb, var(--line) 72%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  box-shadow: 0 12px 34px rgba(67, 45, 30, 0.08);
}

.worldbook-overview-copy {
  min-width: 0;
}

.worldbook-eyebrow {
  margin: 0 0 6px;
  color: color-mix(in srgb, var(--primary) 72%, var(--muted));
  font-size: 0.76rem;
  font-weight: 900;
  letter-spacing: 0;
  text-transform: uppercase;
}

.worldbook-overview h1 {
  margin: 0;
  font-size: 2.1rem;
  line-height: 1.08;
}

.worldbook-overview-copy > p:last-child {
  max-width: 680px;
  margin: 10px 0 0;
  color: var(--muted);
  line-height: 1.6;
}

.worldbook-overview-actions,
.worldbook-panel-head,
.book-card-meta,
.worldbook-detail-stats {
  display: flex;
  align-items: center;
  gap: 8px;
}

.worldbook-overview-actions {
  justify-content: flex-end;
  flex-wrap: wrap;
}

.worldbook-stat-strip {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.worldbook-stat-strip > div,
.worldbook-detail-stats > div {
  display: grid;
  gap: 2px;
  min-width: 0;
  border: 1px solid color-mix(in srgb, var(--line) 62%, transparent);
  border-radius: 10px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--surface) 76%, transparent);
}

.worldbook-stat-strip strong,
.worldbook-detail-stats strong {
  color: var(--text);
  font-size: 1.1rem;
  line-height: 1;
}

.worldbook-stat-strip span,
.worldbook-detail-stats span,
.book-card-meta span,
.worldbook-panel-head > span {
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 700;
}

.worldbook-workbench {
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(0, 1.1fr);
  gap: 16px;
  align-items: start;
}

.worldbook-library-panel {
  display: grid;
  min-width: 0;
  gap: 12px;
}

.worldbook-panel-head {
  justify-content: space-between;
  min-height: 42px;
}

.worldbook-panel-head h2 {
  margin: 0;
  font-size: 1.12rem;
}

.book-card-meta {
  flex-wrap: wrap;
  margin-top: 12px;
}

.book-card-meta span {
  border: 1px solid color-mix(in srgb, var(--line) 62%, transparent);
  border-radius: 999px;
  padding: 3px 8px;
  background: color-mix(in srgb, var(--surface) 68%, transparent);
}

.worldbook-detail-stats {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  margin-top: 14px;
}

.worldbook-ai-panel {
  display: grid;
  gap: 14px;
}

.worldbook-ai-preview {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 86%, transparent);
}

.worldbook-ai-preview p {
  margin: 4px 0 0;
  color: var(--muted);
  line-height: 1.55;
}

.worldbook-ai-preview small {
  color: var(--muted);
}

.worldbook-ai-entry-list {
  display: grid;
  gap: 8px;
  max-height: 360px;
  overflow: auto;
}

.worldbook-ai-entry {
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
}

.worldbook-ai-entry p {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.book-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.book-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
  cursor: pointer;
  transition: box-shadow 0.2s, border-color 0.2s;
}

.book-card:hover {
  border-color: var(--primary);
  box-shadow: var(--shadow);
}

.book-card-body {
  flex: 1;
  padding: 16px;
}

.book-card-body h3 {
  margin: 0 0 8px;
  font-size: 1.05rem;
}

.book-desc {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 0.88rem;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.book-card-footer,
.heading-actions,
.inline-actions,
.worldbook-meta-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.book-card-footer {
  justify-content: space-between;
  padding: 10px 16px;
  border-top: 1px solid var(--line);
}

.entry-count,
.worldbook-meta-row {
  color: var(--muted);
  font-size: 0.82rem;
}

.book-card-actions {
  display: flex;
  gap: 4px;
}

.worldbook-meta-row {
  flex-wrap: wrap;
  margin-top: 10px;
}

.book-info-panel .inline-heading,
.entries-panel .inline-heading {
  align-items: flex-start;
  min-width: 0;
}

.book-info-panel .inline-heading > div:first-child,
.entries-panel .inline-heading > div:first-child {
  min-width: 0;
}

.book-info-panel .inline-heading p,
.entries-panel .inline-heading p {
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.book-info-panel .inline-actions {
  flex: 0 1 auto;
  justify-content: flex-end;
  min-width: 0;
  max-width: 100%;
}

.book-info-panel .inline-actions > button,
.entries-panel .inline-heading > .primary-button {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

.book-info-panel .inline-actions > button span,
.entries-panel .inline-heading > .primary-button span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.book-info-panel {
  container-type: inline-size;
  margin-bottom: 16px;
}

.entries-panel {
  container-type: inline-size;
  margin-top: 0;
}

.entry-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.entry-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 86%, transparent);
  transition: border-color 0.15s, opacity 0.15s;
}

.entry-row:hover {
  border-color: color-mix(in srgb, var(--primary) 30%, var(--line));
}

.entry-row.disabled {
  opacity: 0.55;
}

.entry-controls {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  align-items: center;
  gap: 4px;
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
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 4px;
}

.entry-header strong {
  min-width: 0;
  overflow-wrap: anywhere;
}

.entry-position {
  padding: 1px 8px;
  border-radius: 4px;
  background: var(--surface-strong);
  color: var(--muted);
  font-size: 0.78rem;
}

.entry-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.entry-chip {
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 700;
}

.entry-keys {
  margin: 2px 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 0.82rem;
  text-overflow: ellipsis;
  overflow-wrap: anywhere;
}

.entry-content-preview {
  display: -webkit-box;
  margin: 4px 0 0;
  overflow: hidden;
  color: var(--text);
  font-size: 0.84rem;
  opacity: 0.8;
  overflow-wrap: anywhere;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.entry-actions {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
}

.icon-button.toggle {
  color: var(--green);
}

.entry-row.disabled .icon-button.toggle {
  color: var(--muted);
}

.empty-entries {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px;
  text-align: center;
}

.empty-entries svg {
  color: var(--muted);
  opacity: 0.4;
}

.empty-entries p {
  margin: 0;
}

.entry-modal {
  max-width: 720px;
  width: 92vw;
}

.worldbook-settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.worldbook-settings-grid.compact-numbers {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.worldbook-entry-switches {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 10px;
}

.modal-overlay {
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.45);
}

.modal-content {
  width: 90vw;
  max-width: 480px;
  max-height: 80vh;
  overflow-y: auto;
  padding: 24px;
  border-radius: 16px;
  background: var(--surface);
  box-shadow: var(--shadow);
}

.modal-content h2 {
  margin-top: 0;
}

@container (max-width: 620px) {
  .book-info-panel .inline-heading,
  .entries-panel .inline-heading {
    flex-direction: column;
    align-items: stretch;
  }

  .book-info-panel .inline-actions,
  .entries-panel .inline-heading > .primary-button {
    width: 100%;
  }

  .book-info-panel .inline-actions {
    justify-content: stretch;
  }

  .book-info-panel .inline-actions > button,
  .entries-panel .inline-heading > .primary-button {
    flex: 1 1 0;
    min-width: 0;
  }

  .book-info-panel .inline-actions > button span,
  .entries-panel .inline-heading > .primary-button span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

@container (max-width: 640px) {
  .entry-row {
    flex-wrap: wrap;
  }

  .entry-controls {
    flex-direction: row;
    justify-content: space-between;
    width: 100%;
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line);
  }

  .entry-order-buttons {
    flex-direction: row;
  }

  .entry-info {
    flex: 1 1 100%;
  }

  .entry-actions {
    justify-content: flex-end;
    width: 100%;
    padding-top: 8px;
    border-top: 1px solid var(--line);
  }
}

@media (max-width: 768px) {
  .book-grid,
  .worldbook-settings-grid,
  .worldbook-settings-grid.compact-numbers,
  .worldbook-entry-switches {
    grid-template-columns: 1fr;
  }

  .heading-actions,
  .inline-actions {
    flex-wrap: wrap;
  }

  .entry-row {
    flex-wrap: wrap;
  }

  .entry-controls {
    flex-direction: row;
    justify-content: space-between;
    width: 100%;
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line);
  }

  .entry-order-buttons {
    flex-direction: row;
  }

  .entry-info {
    flex-basis: 100%;
  }

  .entry-actions {
    justify-content: flex-end;
    width: 100%;
    padding-top: 8px;
    border-top: 1px solid var(--line);
  }

  .modal-overlay {
    align-items: flex-end;
    padding: 0;
  }

  .modal-content,
  .entry-modal {
    width: 100%;
    max-width: none;
    max-height: 92vh;
    border-radius: 16px 16px 0 0;
  }
}

/* uiuxpromax world book polish */
.worldbook-ai-panel {
  position: relative;
  overflow: hidden;
  border-color: color-mix(in srgb, var(--line) 78%, transparent);
  background: color-mix(in srgb, var(--surface) 94%, transparent);
}

.worldbook-ai-preview,
.worldbook-ai-entry,
.book-info-panel,
.entries-panel {
  border-color: color-mix(in srgb, var(--line) 72%, transparent);
  box-shadow: 0 10px 26px rgba(67, 45, 30, 0.07);
}

.book-grid {
  align-items: stretch;
}

.book-card {
  position: relative;
  overflow: hidden;
  min-height: 188px;
  border-color: color-mix(in srgb, var(--line) 74%, transparent);
  background: var(--surface);
  box-shadow: 0 8px 22px rgba(67, 45, 30, 0.06);
}

.book-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--primary) 34%, var(--line));
  box-shadow: 0 16px 36px rgba(67, 45, 30, 0.12);
}

.book-card-body {
  padding: 18px;
}

.book-card-footer {
  background: color-mix(in srgb, var(--surface-strong) 48%, transparent);
}

.entry-row {
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface) 90%, transparent);
  box-shadow: 0 8px 20px rgba(67, 45, 30, 0.05);
}

.entry-row.disabled {
  filter: saturate(0.65);
}

.entry-position,
.entry-chip {
  border: 1px solid color-mix(in srgb, var(--line) 64%, transparent);
  background: color-mix(in srgb, var(--surface) 72%, transparent);
}

.entry-chip {
  color: color-mix(in srgb, var(--primary) 70%, var(--text));
}

.entry-actions .icon-button,
.entry-controls .icon-button {
  border-radius: 8px;
}

.modal-content {
  border: 1px solid color-mix(in srgb, var(--line) 78%, transparent);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.28);
}

/* World book workspace refinement */
@media (min-width: 981px) {
  .worldbook-ai-panel {
    position: sticky;
    top: 18px;
  }
}

.worldbook-library-panel .loading-state,
.worldbook-library-panel .empty-state {
  min-height: 280px;
  border: 1px dashed color-mix(in srgb, var(--line) 72%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface) 64%, transparent);
}

.book-card {
  min-height: 158px;
}

.book-card-body {
  display: grid;
  align-content: start;
}

.book-card-body h3 {
  display: -webkit-box;
  overflow: hidden;
  line-height: 1.25;
  overflow-wrap: anywhere;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.book-card-footer {
  min-height: 58px;
}

@media (max-width: 980px) {
  .worldbook-workbench {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .worldbook-page {
    gap: 14px;
  }

  .worldbook-overview {
    grid-template-columns: 1fr;
    gap: 14px;
    padding: 16px;
    border-radius: 12px;
  }

  .worldbook-overview h1 {
    font-size: 1.65rem;
  }

  .worldbook-overview-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .worldbook-overview-actions > button {
    width: 100%;
    min-width: 0;
  }

  .worldbook-stat-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .worldbook-panel-head {
    align-items: flex-start;
  }

  .worldbook-detail-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .book-card {
    min-height: 142px;
  }
}

@media (max-width: 460px) {
  .worldbook-overview-actions {
    grid-template-columns: 1fr;
  }

  .worldbook-stat-strip > div,
  .worldbook-detail-stats > div {
    padding: 9px 10px;
  }

  .worldbook-ai-panel .form-actions {
    display: grid;
    grid-template-columns: 1fr;
  }

  .worldbook-panel-head {
    display: grid;
    gap: 4px;
  }
}
</style>
