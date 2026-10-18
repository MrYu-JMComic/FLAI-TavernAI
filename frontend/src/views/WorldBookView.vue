<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Download,
  Plus,
  Save,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Upload
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
} from '../api/worldBooks.js';
import { exportEnvelope, importEnvelope } from '../api/envelopes.js';
import WorldBookAiPanel from '../components/worldbook/WorldBookAiPanel.vue';
import WorldBookMatchLab from '../components/worldbook/WorldBookMatchLab.vue';
import { useNotify } from '../composables/useNotify';
import { useWorldBookAi } from '../composables/worldbook/useWorldBookAi';
import { downloadJsonFile, todayStamp } from '../utils/downloadJson.js';

const props = defineProps({
  route: { type: Object, required: true },
  provider: { type: Object, default: null }
});
const emit = defineEmits(['navigate']);

const notify = useNotify();
const loading = ref(false);
const manualSaving = ref(false);
const saving = computed({ get: () => manualSaving.value || aiSaving.value, set: value => { manualSaving.value = value; } });
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

// The assistant owns its own runtime settings, plan gate and process monitor;
// this view only supplies the current draft and persists the produced book.
const {
  aiContext,
  aiWorkspace,
  aiChanges,
  aiHistory,
  aiSelectedBookIds,
  aiAutomatic,
  aiSaving,
  aiLoading,
  aiPlan,
  aiPlanExtraRequirement,
  aiPlanPhase,
  aiPlanStepStatus,
  aiProcess,
  aiReasoning,
  aiRequirement,
  aiStatus,
  aiStatusMessage,
  aiToolCalls,
  assistantModel,
  assistantModelOptions,
  assistantPlanMode,
  assistantStreamingEnabled,
  assistantThinkingLevel,
  assistantThinkingOptions,
  assistantThinkingSupported,
  cancelWorldBookAi,
  completeWorldBookWithAi,
  discardWorldBookPlan,
  executeWorldBookPlan,
  replanWorldBookAi,
  setAiContextValue,
  applyAiWorldBookChanges,
  reloadAiWorldBook,
  discardAiWorldBook,
  setSelectedBookIds,
  setAutomatic,
  prepareNewWorldBook,
  stopWorldBookAi,
  toggleAiPlanStep,
  updateAiPlanStep
} = useWorldBookAi({
  providerRef: computed(() => props.provider),
  isCurrentRun: () => isCurrentWorldBookRouteMutation(activeAiMutationToken, activeAiRouteKey),
  notify,
  onApplied: handleWorldBooksApplied
});
let activeAiMutationToken = 0;
let activeAiRouteKey = 'list';

const aiPanelProps = computed(() => ({
  context: aiContext.value,
  books: books.value,
  selectedIds: aiSelectedBookIds.value,
  automatic: aiAutomatic.value,
  changes: aiChanges.value,
  history: aiHistory.value,
  targets: aiWorkspace.value?.targets || [],
  loading: aiLoading.value,
  saving: saving.value || aiSaving.value,
  assistantModel: assistantModel.value,
  modelOptions: assistantModelOptions.value,
  thinkingLevel: assistantThinkingLevel.value,
  thinkingOptions: assistantThinkingOptions.value,
  thinkingSupported: assistantThinkingSupported.value,
  streamingEnabled: assistantStreamingEnabled.value,
  planMode: assistantPlanMode.value,
  plan: aiPlan.value,
  planPhase: aiPlanPhase.value,
  planExtraRequirement: aiPlanExtraRequirement.value,
  planStepStatus: aiPlanStepStatus,
  requirement: aiRequirement.value,
  process: aiProcess.value,
  toolCalls: aiToolCalls.value,
  reasoning: aiReasoning.value,
  status: aiStatus.value,
  statusMessage: aiStatusMessage.value
}));
const aiPanelEvents = {
  'update:assistantModel': value => { assistantModel.value = value; },
  'update:thinkingLevel': value => { assistantThinkingLevel.value = value; },
  'update:streamingEnabled': value => { assistantStreamingEnabled.value = value; },
  'update:planMode': value => { assistantPlanMode.value = value; },
  'update:planExtraRequirement': value => { aiPlanExtraRequirement.value = value; },
  'update:requirement': value => { aiRequirement.value = value; },
  'update:selectedIds': setSelectedBookIds,
  'update:automatic': setAutomatic,
  'new-book': prepareNewWorldBook,
  complete: runWorldBookAi,
  apply: applyWorldBookAiResults,
  reload: reloadAiWorldBook,
  discard: discardAiWorldBook,
  stop: stopWorldBookAi,
  'set-context': setAiContextValue,
  'discard-plan': discardWorldBookPlan,
  'execute-plan': runWorldBookPlan,
  replan: replanWorldBook,
  'toggle-plan-step': toggleAiPlanStep,
  'update-plan-step': updateAiPlanStep
};

const isDetailView = computed(() => Boolean(props.route.params.id));
const bookId = computed(() => props.route.params.id);
const bookListStats = computed(() => {
  const sourceBooks = Array.isArray(books.value) ? books.value : [];
  let totalEntries = 0;
  let withEntries = 0;
  for (const book of sourceBooks) {
    const entryCount = Number(book?.entryCount || 0);
    totalEntries += entryCount;
    if (entryCount > 0) {
      withEntries += 1;
    }
  }
  return {
    totalEntries,
    withEntries,
    averageEntries: sourceBooks.length ? Math.round(totalEntries / sourceBooks.length) : 0
  };
});
const totalEntryCount = computed(() => bookListStats.value.totalEntries);
const booksWithEntriesCount = computed(() => bookListStats.value.withEntries);
const averageEntryCount = computed(() => bookListStats.value.averageEntries);
const currentEntries = computed(() => currentBook.value?.entries || []);
const currentEntryStats = computed(() => {
  const stats = {
    enabled: 0,
    disabled: 0,
    alwaysActive: 0,
    probability: 0
  };
  const entries = Array.isArray(currentEntries.value) ? currentEntries.value : [];
  for (const entry of entries) {
    if (entry?.enabled !== false) {
      stats.enabled += 1;
    }
    if (entry?.alwaysActive) {
      stats.alwaysActive += 1;
    }
    if (entry?.useProbability) {
      stats.probability += 1;
    }
  }
  stats.disabled = Math.max(0, entries.length - stats.enabled);
  return stats;
});
const enabledEntryCount = computed(() => currentEntryStats.value.enabled);
const disabledEntryCount = computed(() => currentEntryStats.value.disabled);
const alwaysActiveEntryCount = computed(() => currentEntryStats.value.alwaysActive);
const probabilityEntryCount = computed(() => currentEntryStats.value.probability);

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
      setCurrentBookIfChanged(null);
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
  cancelWorldBookAi();
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
    setBooksIfChanged(nextBooks);
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
    const [nextBook, nextBooks] = await Promise.all([fetchWorldBook(id), fetchWorldBooks()]);
    if (!isCurrentBookLoad(requestToken, id)) return;
    setBooksIfChanged(nextBooks);
    setCurrentBookIfChanged(nextBook);
    setSelectedBookIds([nextBook.id]);
    setAutomatic(false);
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

function setBooksIfChanged(nextBooks) {
  const normalizedNextBooks = Array.isArray(nextBooks) ? nextBooks : [];
  if (sameBookList(books.value, normalizedNextBooks)) {
    return false;
  }
  books.value = normalizedNextBooks;
  return true;
}

function removeBookFromListIfPresent(id) {
  const currentBooks = Array.isArray(books.value) ? books.value : [];
  let nextBooks = null;
  for (let index = 0; index < currentBooks.length; index += 1) {
    const book = currentBooks[index];
    if (book?.id === id) {
      if (!nextBooks) {
        nextBooks = [];
        for (let copyIndex = 0; copyIndex < index; copyIndex += 1) {
          nextBooks.push(currentBooks[copyIndex]);
        }
      }
      continue;
    }
    if (nextBooks) {
      nextBooks.push(book);
    }
  }
  return nextBooks ? setBooksIfChanged(nextBooks) : false;
}

function setCurrentBookIfChanged(nextBook) {
  if (!nextBook) {
    if (!currentBook.value) {
      return false;
    }
    currentBook.value = null;
    return true;
  }
  if (sameBookDetail(currentBook.value, nextBook)) {
    return false;
  }
  currentBook.value = nextBook;
  return true;
}

function sameBookList(currentBooks, nextBooks) {
  if (!Array.isArray(currentBooks) || !Array.isArray(nextBooks) || currentBooks.length !== nextBooks.length) {
    return false;
  }
  for (let index = 0; index < currentBooks.length; index += 1) {
    if (!sameBookSummary(currentBooks[index], nextBooks[index])) {
      return false;
    }
  }
  return true;
}

function sameBookSummary(currentBookSummary, nextBookSummary) {
  return currentBookSummary?.id === nextBookSummary?.id
    && currentBookSummary?.name === nextBookSummary?.name
    && currentBookSummary?.description === nextBookSummary?.description
    && currentBookSummary?.characterId === nextBookSummary?.characterId
    && Number(currentBookSummary?.scanDepth || 4) === Number(nextBookSummary?.scanDepth || 4)
    && Number(currentBookSummary?.lorebookContextPercent || 25) === Number(nextBookSummary?.lorebookContextPercent || 25)
    && Number(currentBookSummary?.entryCount || 0) === Number(nextBookSummary?.entryCount || 0);
}

function sameBookDetail(currentDetail, nextDetail) {
  return sameBookSummary(currentDetail, nextDetail)
    && sameEntryList(currentDetail?.entries || [], nextDetail?.entries || []);
}

function sameEntryList(currentEntries, nextEntries) {
  if (!Array.isArray(currentEntries) || !Array.isArray(nextEntries) || currentEntries.length !== nextEntries.length) {
    return false;
  }
  for (let index = 0; index < currentEntries.length; index += 1) {
    if (!sameEntrySummary(currentEntries[index], nextEntries[index])) {
      return false;
    }
  }
  return true;
}

function sameEntrySummary(currentEntry, nextEntry) {
  return currentEntry?.id === nextEntry?.id
    && currentEntry?.name === nextEntry?.name
    && currentEntry?.triggerKeys === nextEntry?.triggerKeys
    && currentEntry?.content === nextEntry?.content
    && currentEntry?.position === nextEntry?.position
    && Boolean(currentEntry?.enabled !== false) === Boolean(nextEntry?.enabled !== false)
    && Boolean(currentEntry?.regexMode) === Boolean(nextEntry?.regexMode)
    && Boolean(currentEntry?.alwaysActive) === Boolean(nextEntry?.alwaysActive)
    && Number(currentEntry?.depth || 0) === Number(nextEntry?.depth || 0)
    && Number(currentEntry?.role || 0) === Number(nextEntry?.role || 0)
    && nullableComparable(currentEntry?.sticky) === nullableComparable(nextEntry?.sticky)
    && nullableComparable(currentEntry?.cooldown) === nullableComparable(nextEntry?.cooldown)
    && nullableComparable(currentEntry?.delay) === nullableComparable(nextEntry?.delay)
    && Boolean(currentEntry?.selective) === Boolean(nextEntry?.selective)
    && Number(currentEntry?.selectiveLogic || 0) === Number(nextEntry?.selectiveLogic || 0)
    && currentEntry?.keysSecondary === nextEntry?.keysSecondary
    && Boolean(currentEntry?.useProbability) === Boolean(nextEntry?.useProbability)
    && Number(currentEntry?.probability ?? 100) === Number(nextEntry?.probability ?? 100)
    && currentEntry?.group === nextEntry?.group
    && Number(currentEntry?.groupWeight || 0) === Number(nextEntry?.groupWeight || 0)
    && Number(currentEntry?.orderIndex || 0) === Number(nextEntry?.orderIndex || 0);
}

function nullableComparable(value) {
  return value === null || value === undefined || value === '' ? null : Number(value);
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

function navigateFromWorldBookMutation(page, params) {
  worldBookMutationToken += 1;
  emit('navigate', page, params);
}

function openCreateBook() {
  if (saving.value) return;
  Object.assign(editingBook, createEmptyBook());
  editingBookId.value = null;
  showBookForm.value = true;
}

function openEditBook(book) {
  if (saving.value) return;
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
  if (saving.value) return;
  resetBookFormState();
}

function resetBookFormState() {
  showBookForm.value = false;
  editingBookId.value = null;
}

async function saveBook() {
  if (saving.value) return;
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
      resetBookFormState();
      notify.success('世界书已更新');
    } else {
      const book = await createWorldBook(payload);
      if (!isCurrentWorldBookRouteMutation(mutationToken, routeKey)) return;
      resetBookFormState();
      notify.success('世界书已创建');
      navigateFromWorldBookMutation('worldBookDetail', { id: book.id });
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
  if (saving.value) return;
  if (!window.confirm('确定删除这个世界书及其所有条目吗？')) return;
  const routeKey = currentWorldBookRouteKey();
  const mutationToken = worldBookMutationToken;
  saving.value = true;
  try {
    await deleteWorldBook(id);
    if (!isCurrentWorldBookRouteMutation(mutationToken, routeKey)) return;
    removeBookFromListIfPresent(id);
    if (currentBook.value?.id === id) {
      setCurrentBookIfChanged(null);
    }
    notify.success('世界书已删除');
    if (isDetailView.value) {
      navigateFromWorldBookMutation('worldBooks');
    } else {
      await loadBooks();
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

async function exportWorldBooks() {
  if (saving.value || isDetailView.value) return;
  const routeKey = currentWorldBookRouteKey();
  const mutationToken = worldBookMutationToken;
  saving.value = true;
  try {
    const envelope = await exportEnvelope('world-books');
    if (!isCurrentWorldBookRouteMutation(mutationToken, routeKey)) return;
    downloadJsonFile(envelope, `flai-world-books-${todayStamp()}.json`);
    notify.success('世界书已导出');
  } catch (err) {
    if (!isCurrentWorldBookRouteMutation(mutationToken, routeKey)) return;
    notify.error(err?.message || '世界书导出失败');
  } finally {
    if (isCurrentWorldBookRouteMutation(mutationToken, routeKey)) {
      saving.value = false;
    }
  }
}

async function importWorldBooks(importText, mutationToken = worldBookMutationToken, routeKey = currentWorldBookRouteKey()) {
  try {
    const parsed = JSON.parse(String(importText || ''));
    const result = await importEnvelope('world-books', parsed);
    if (!isCurrentWorldBookRouteMutation(mutationToken, routeKey)) return;
    await loadBooks();
    if (!isCurrentWorldBookRouteMutation(mutationToken, routeKey)) return;
    if (result?.skipped?.length) {
      notify.warning(`已跳过 ${result.skipped.length} 本无效世界书`);
    }
    notify.success(`已导入 ${Number(result?.imported || 0)} 本世界书`);
  } catch (err) {
    if (!isCurrentWorldBookRouteMutation(mutationToken, routeKey)) return;
    notify.error(err instanceof SyntaxError ? '导入失败：JSON 格式不正确' : err?.message || '导入失败');
  } finally {
    if (isCurrentWorldBookRouteMutation(mutationToken, routeKey)) {
      saving.value = false;
    }
  }
}

function handleWorldBookImportFile(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (input) {
    input.value = '';
  }
  if (!file || saving.value || isDetailView.value) return;
  const routeKey = currentWorldBookRouteKey();
  const mutationToken = worldBookMutationToken;
  const reader = new FileReader();
  saving.value = true;
  reader.onload = async () => {
    if (!isCurrentWorldBookRouteMutation(mutationToken, routeKey)) return;
    await importWorldBooks(reader.result, mutationToken, routeKey);
  };
  reader.onerror = () => {
    if (!isCurrentWorldBookRouteMutation(mutationToken, routeKey)) return;
    notify.error('导入失败：文件读取失败');
    saving.value = false;
  };
  try {
    reader.readAsText(file);
  } catch {
    reader.onerror?.();
  }
}

function openCreateEntry() {
  if (saving.value) return;
  Object.assign(editingEntry, createEmptyEntry());
  editingEntryId.value = null;
  showEntryForm.value = true;
}

function openEditEntry(entry) {
  if (saving.value) return;
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
  if (saving.value) return;
  resetEntryFormState();
}

function resetEntryFormState() {
  showEntryForm.value = false;
  editingEntryId.value = null;
}

async function saveEntry() {
  if (saving.value) return;
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
    resetEntryFormState();
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
  if (saving.value) return;
  if (!window.confirm('确定删除这个条目吗？')) return;
  const targetBookId = bookId.value;
  if (!targetBookId) return;
  const mutationToken = worldBookMutationToken;
  saving.value = true;
  try {
    await deleteWorldBookEntry(targetBookId, entryId);
    if (!isCurrentWorldBookMutation(mutationToken, targetBookId)) return;
    await loadBook(targetBookId);
    if (!isCurrentWorldBookMutation(mutationToken, targetBookId)) return;
    notify.success('条目已删除');
  } catch (err) {
    if (!isCurrentWorldBookMutation(mutationToken, targetBookId)) return;
    notify.error(err.message);
  } finally {
    if (isCurrentWorldBookMutation(mutationToken, targetBookId)) {
      saving.value = false;
    }
  }
}

async function toggleEntry(entry) {
  if (saving.value) return;
  const targetBookId = bookId.value;
  if (!targetBookId) return;
  const mutationToken = worldBookMutationToken;
  saving.value = true;
  try {
    await updateWorldBookEntry(targetBookId, entry.id, { enabled: !entry.enabled });
    if (!isCurrentWorldBookMutation(mutationToken, targetBookId)) return;
    await loadBook(targetBookId);
  } catch (err) {
    if (!isCurrentWorldBookMutation(mutationToken, targetBookId)) return;
    notify.error(err.message);
  } finally {
    if (isCurrentWorldBookMutation(mutationToken, targetBookId)) {
      saving.value = false;
    }
  }
}

async function moveEntry(index, direction) {
  if (saving.value) return;
  const entries = currentBook.value?.entries;
  if (!entries) return;
  const targetBookId = bookId.value;
  if (!targetBookId) return;
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= entries.length) return;

  const current = entries[index];
  const target = entries[targetIndex];
  const mutationToken = worldBookMutationToken;
  saving.value = true;
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
  } finally {
    if (isCurrentWorldBookMutation(mutationToken, targetBookId)) {
      saving.value = false;
    }
  }
}

function positionLabel(value) {
  return getPositionOptionByValue(value)?.label || value;
}

function getPositionOptionByValue(value) {
  for (const option of positionOptions) {
    if (option.value === value) {
      return option;
    }
  }
  return null;
}

// Every assistant run is scoped to the route it started on, so navigating away
// mid-run discards its results instead of writing them into another book.
function beginWorldBookAiRun() {
  activeAiRouteKey = currentWorldBookRouteKey();
  activeAiMutationToken = worldBookMutationToken;
}

function runWorldBookAi() {
  if (saving.value) return;
  beginWorldBookAiRun();
  completeWorldBookWithAi();
}

function runWorldBookPlan() {
  if (saving.value) return;
  beginWorldBookAiRun();
  executeWorldBookPlan();
}

function replanWorldBook() {
  if (saving.value) return;
  beginWorldBookAiRun();
  replanWorldBookAi();
}

async function applyWorldBookAiResults(changes) {
  if (saving.value) return;
  if (showBookForm.value || showEntryForm.value) {
    notify.warning('请先保存或关闭正在编辑的表单，再应用 AI 变更。');
    return;
  }
  await applyAiWorldBookChanges(changes);
}

function handleWorldBooksApplied(results) {
  const next = [...books.value];
  for (const { book } of results) {
    const index = next.findIndex(item => item.id === book.id);
    if (index >= 0) next[index] = book;
    else next.unshift(book);
    if (currentBook.value?.id === book.id) setCurrentBookIfChanged(book);
  }
  setBooksIfChanged(next);
}

function retryLoad() {
  if (loading.value) return;
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
          <button class="primary-button" :disabled="saving" :aria-busy="saving" @click="openCreateBook">
            <Plus :size="18" />
            <span>新建世界书</span>
          </button>
          <button class="ghost-button" type="button" :disabled="saving || !books.length" :aria-busy="saving" @click="exportWorldBooks">
            <Download :size="18" />
            <span>导出</span>
          </button>
          <label class="ghost-button file-import-button" :class="{ disabled: saving }" :aria-busy="saving">
            <Upload :size="18" />
            <span>导入</span>
            <input type="file" accept=".json" :disabled="saving" @change="handleWorldBookImportFile" />
          </label>
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
      <WorldBookAiPanel v-bind="aiPanelProps" v-on="aiPanelEvents" />

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
        <div class="empty-state-actions">
          <button class="ghost-button" :disabled="loading" :aria-busy="loading" @click="retryLoad">
            <span>重试</span>
          </button>
          <button class="primary-button" :disabled="saving" :aria-busy="saving" @click="openCreateBook">
            <Plus :size="18" />
            <span>新建世界书</span>
          </button>
          <button class="ghost-button" @click="emit('navigate', 'home')">
            <span>返回首页</span>
          </button>
        </div>
      </div>

      <div v-else-if="!books.length" class="empty-state">
        <BookOpen :size="48" />
        <h2>还没有世界书</h2>
        <p>世界书用于在对话中自动注入背景设定。</p>
        <button class="primary-button" :disabled="saving" :aria-busy="saving" @click="openCreateBook">
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
              <button class="icon-button" title="编辑" :aria-label="`编辑世界书：${book.name}`" :disabled="saving" :aria-busy="saving" @click="openEditBook(book)">
                <Save :size="16" />
              </button>
              <button class="icon-button danger" title="删除" :aria-label="`删除世界书：${book.name}`" :disabled="saving" :aria-busy="saving" @click="removeBook(book.id)">
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
          <button class="ghost-button" :disabled="loading" :aria-busy="loading" @click="retryLoad">
            <span>重试</span>
          </button>
          <button class="ghost-button" @click="emit('navigate', 'worldBooks')">
            <span>返回列表</span>
          </button>
        </div>
      </div>

      <template v-else-if="currentBook">
        <WorldBookAiPanel v-bind="aiPanelProps" v-on="aiPanelEvents" />
        <div class="book-info-panel form-panel">
          <div class="inline-heading">
            <div>
              <h2>基本信息</h2>
              <p>{{ currentBook.description || '暂无描述' }}</p>
            </div>
            <div class="inline-actions">
              <button class="ghost-button" :disabled="saving" :aria-busy="saving" @click="openEditBook(currentBook)">编辑信息</button>
              <button class="danger-button" :disabled="saving" :aria-busy="saving" @click="removeBook(currentBook.id)">
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

        <WorldBookMatchLab
          :world-book-id="currentBook.id"
          :disabled="saving || loading"
        />

        <div class="form-panel entries-panel">
          <div class="inline-heading">
            <div>
              <h2>条目列表</h2>
              <p>触发词匹配时自动注入对应内容到上下文。</p>
            </div>
            <button class="primary-button" :disabled="saving" :aria-busy="saving" @click="openCreateEntry">
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
                    :disabled="saving || index === 0"
                    :aria-busy="saving"
                    title="上移"
                    :aria-label="`上移条目：${entry.name || `第 ${index + 1} 个条目`}`"
                    @click="moveEntry(index, -1)"
                  >
                    <ChevronUp :size="14" />
                  </button>
                  <button
                    class="icon-button ghost"
                    :disabled="saving || index === currentBook.entries.length - 1"
                    :aria-busy="saving"
                    title="下移"
                    :aria-label="`下移条目：${entry.name || `第 ${index + 1} 个条目`}`"
                    @click="moveEntry(index, 1)"
                  >
                    <ChevronDown :size="14" />
                  </button>
                </div>
                <button
                  class="icon-button toggle"
                  :disabled="saving"
                  :aria-busy="saving"
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
                <button class="icon-button" title="编辑" :aria-label="`编辑条目：${entry.name || `第 ${index + 1} 个条目`}`" :disabled="saving" :aria-busy="saving" @click="openEditEntry(entry)">
                  <Save :size="16" />
                </button>
                <button class="icon-button danger" title="删除" :aria-label="`删除条目：${entry.name || `第 ${index + 1} 个条目`}`" :disabled="saving" :aria-busy="saving" @click="removeEntry(entry.id)">
                  <Trash2 :size="16" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>

    <div v-if="showBookForm" class="modal-overlay" @click.self="closeBookForm">
      <div class="modal-content form-panel" :aria-busy="saving">
        <h2>{{ editingBookId ? '编辑世界书' : '新建世界书' }}</h2>
        <label class="field">
          <span>名称</span>
          <input v-model.trim="editingBook.name" maxlength="80" placeholder="世界书名称" :disabled="saving" />
        </label>
        <label class="field">
          <span>描述</span>
          <textarea v-model="editingBook.description" rows="3" placeholder="可选描述" :disabled="saving" />
        </label>
        <label class="field">
          <span>关联角色 ID</span>
          <input v-model.trim="editingBook.characterId" placeholder="可选，留空则不关联" :disabled="saving" />
        </label>
        <div class="worldbook-settings-grid">
          <label class="field">
            <span>扫描深度</span>
            <input v-model.number="editingBook.scanDepth" type="number" min="1" max="50" :disabled="saving" />
          </label>
          <label class="field">
            <span>上下文预算 %</span>
            <input v-model.number="editingBook.lorebookContextPercent" type="number" min="1" max="100" :disabled="saving" />
          </label>
        </div>
        <div class="form-actions">
          <button class="ghost-button" :disabled="saving" @click="closeBookForm">取消</button>
          <button class="primary-button" :disabled="saving" :aria-busy="saving" @click="saveBook">
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="showEntryForm" class="modal-overlay" @click.self="closeEntryForm">
      <div class="modal-content form-panel entry-modal" :aria-busy="saving">
        <h2>{{ editingEntryId ? '编辑条目' : '添加条目' }}</h2>
        <label class="field">
          <span>条目名称</span>
          <input v-model.trim="editingEntry.name" maxlength="120" placeholder="例如：魔法系统" :disabled="saving" />
        </label>
        <label class="field">
          <span>触发词（逗号分隔）</span>
          <input v-model="editingEntry.triggerKeys" placeholder="例如：魔法,魔力,法术,咒语" :disabled="saving" />
        </label>
        <label class="field">
          <span>注入位置</span>
          <select v-model="editingEntry.position" :disabled="saving">
            <option v-for="opt in positionOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </label>
        <label class="field">
          <span>注入内容</span>
          <textarea v-model="editingEntry.content" rows="8" placeholder="当触发词匹配时，这段内容会被注入到 AI 上下文中。" :disabled="saving" />
        </label>
        <label class="checkbox-line">
          <input v-model="editingEntry.enabled" type="checkbox" :disabled="saving" />
          <span>启用</span>
        </label>
        <div class="worldbook-entry-switches">
          <label class="checkbox-line">
            <input v-model="editingEntry.regexMode" type="checkbox" :disabled="saving" />
            <span>正则触发</span>
          </label>
          <label class="checkbox-line">
            <input v-model="editingEntry.alwaysActive" type="checkbox" :disabled="saving" />
            <span>总是激活</span>
          </label>
          <label class="checkbox-line">
            <input v-model="editingEntry.selective" type="checkbox" :disabled="saving" />
            <span>副关键词过滤</span>
          </label>
          <label class="checkbox-line">
            <input v-model="editingEntry.useProbability" type="checkbox" :disabled="saving" />
            <span>概率激活</span>
          </label>
        </div>
        <div class="worldbook-settings-grid">
          <label class="field">
            <span>副关键词</span>
            <input v-model="editingEntry.keysSecondary" placeholder="可选，逗号分隔" :disabled="saving" />
          </label>
          <label class="field">
            <span>过滤逻辑</span>
            <select v-model.number="editingEntry.selectiveLogic" :disabled="saving">
              <option v-for="opt in selectiveLogicOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
          </label>
        </div>
        <div class="worldbook-settings-grid">
          <label class="field">
            <span>概率 %</span>
            <input v-model.number="editingEntry.probability" type="number" min="0" max="100" :disabled="saving" />
          </label>
          <label class="field">
            <span>互斥分组</span>
            <input v-model.trim="editingEntry.group" placeholder="同组只注入一个" :disabled="saving" />
          </label>
        </div>
        <div class="worldbook-settings-grid">
          <label class="field">
            <span>分组权重</span>
            <input v-model.number="editingEntry.groupWeight" type="number" min="0" :disabled="saving" />
          </label>
          <label class="field">
            <span>at_depth 角色</span>
            <select v-model.number="editingEntry.role" :disabled="saving">
              <option v-for="opt in roleOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
          </label>
        </div>
        <div class="worldbook-settings-grid compact-numbers">
          <label class="field">
            <span>深度</span>
            <input v-model.number="editingEntry.depth" type="number" min="0" max="10" :disabled="saving" />
          </label>
          <label class="field">
            <span>Sticky</span>
            <input v-model.number="editingEntry.sticky" type="number" min="0" placeholder="空" :disabled="saving" />
          </label>
          <label class="field">
            <span>Cooldown</span>
            <input v-model.number="editingEntry.cooldown" type="number" min="0" placeholder="空" :disabled="saving" />
          </label>
          <label class="field">
            <span>Delay</span>
            <input v-model.number="editingEntry.delay" type="number" min="0" placeholder="空" :disabled="saving" />
          </label>
        </div>
        <div class="form-actions">
          <button class="ghost-button" :disabled="saving" @click="closeEntryForm">取消</button>
          <button class="primary-button" :disabled="saving" :aria-busy="saving" @click="saveEntry">
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
  grid-template-columns: minmax(0, 1fr);
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

  .worldbook-panel-head {
    display: grid;
    gap: 4px;
  }
}
</style>
