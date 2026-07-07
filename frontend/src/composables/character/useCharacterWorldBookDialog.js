import { computed, ref, watch } from 'vue';

export const WORLD_BOOK_SELECTOR_PAGE_SIZE = 8;

export function useCharacterWorldBookDialog({
  worldBooks,
  selectedWorldBookIds
} = {}) {
  const showWorldBookDialog = ref(false);
  const worldBookSearch = ref('');
  const worldBookSort = ref('updatedDesc');
  const worldBookPage = ref(1);
  const selectedWorldBooks = computed(() => getSelectedWorldBooks(worldBooks?.value, selectedWorldBookIds?.value));
  const selectedWorldBookPreview = computed(() => selectedWorldBooks.value.slice(0, 4));
  const hiddenSelectedWorldBookCount = computed(() => Math.max(0, selectedWorldBooks.value.length - selectedWorldBookPreview.value.length));
  const filteredWorldBooks = computed(() => filterAndSortWorldBooks(worldBooks?.value, worldBookSearch.value, worldBookSort.value));
  const worldBookPageCount = computed(() => Math.max(1, Math.ceil(filteredWorldBooks.value.length / WORLD_BOOK_SELECTOR_PAGE_SIZE)));
  const pagedWorldBooks = computed(() => getWorldBookPageItems(filteredWorldBooks.value, worldBookPage.value, WORLD_BOOK_SELECTOR_PAGE_SIZE));
  const worldBookPageStart = computed(() => {
    if (!filteredWorldBooks.value.length) {
      return 0;
    }
    return ((worldBookPage.value - 1) * WORLD_BOOK_SELECTOR_PAGE_SIZE) + 1;
  });
  const worldBookPageEnd = computed(() => Math.min(filteredWorldBooks.value.length, worldBookPage.value * WORLD_BOOK_SELECTOR_PAGE_SIZE));

  watch([worldBookSearch, worldBookSort], () => {
    setWorldBookPage(1);
  });

  watch(worldBookPageCount, (pageCount) => {
    if (worldBookPage.value > pageCount) {
      setWorldBookPage(pageCount);
    }
  });

  function openWorldBookDialog() {
    if (!worldBooks?.value?.length) {
      return;
    }
    showWorldBookDialog.value = true;
    setWorldBookPage(worldBookPage.value);
  }

  function closeWorldBookDialog() {
    showWorldBookDialog.value = false;
  }

  function clearWorldBookSearch() {
    worldBookSearch.value = '';
    setWorldBookPage(1);
  }

  function setWorldBookPage(page) {
    const nextPage = clampWorldBookPage(page, worldBookPageCount.value);
    if (worldBookPage.value !== nextPage) {
      worldBookPage.value = nextPage;
    }
  }

  return {
    clearWorldBookSearch,
    closeWorldBookDialog,
    filteredWorldBooks,
    hiddenSelectedWorldBookCount,
    openWorldBookDialog,
    pagedWorldBooks,
    selectedWorldBookPreview,
    setWorldBookPage,
    showWorldBookDialog,
    worldBookPage,
    worldBookPageCount,
    worldBookPageEnd,
    worldBookPageStart,
    worldBookSearch,
    worldBookSort
  };
}

function getSelectedWorldBooks(books, selectedIds) {
  const bookById = new Map();
  for (const book of Array.isArray(books) ? books : []) {
    const id = String(book?.id || '');
    if (id) {
      bookById.set(id, book);
    }
  }
  const selected = [];
  for (const rawId of Array.isArray(selectedIds) ? selectedIds : []) {
    const id = String(rawId || '');
    if (id) {
      selected.push(bookById.get(id) || { id, name: id, entryCount: 0 });
    }
  }
  return selected;
}

function filterAndSortWorldBooks(books, rawSearch, sortKey) {
  const sourceBooks = Array.isArray(books) ? books : [];
  const search = String(rawSearch || '').trim().toLowerCase();
  const matches = [];
  for (const book of sourceBooks) {
    const haystack = `${book?.name || ''} ${book?.description || ''}`.toLowerCase();
    if (!search || haystack.includes(search)) {
      matches.push(book);
    }
  }
  return sortWorldBooks(matches, sortKey);
}

function sortWorldBooks(books, sortKey) {
  const sortedBooks = Array.isArray(books) ? [...books] : [];
  if (sortKey === 'nameAsc') {
    sortedBooks.sort(compareWorldBookNames);
    return sortedBooks;
  }
  if (sortKey === 'entryCountDesc') {
    sortedBooks.sort((current, next) => (
      Number(next?.entryCount || 0) - Number(current?.entryCount || 0)
    ) || compareWorldBookNames(current, next));
    return sortedBooks;
  }
  sortedBooks.sort((current, next) => (
    getWorldBookSortTime(next) - getWorldBookSortTime(current)
  ) || compareWorldBookNames(current, next));
  return sortedBooks;
}

function compareWorldBookNames(current = {}, next = {}) {
  return String(current?.name || '').localeCompare(String(next?.name || ''), 'zh-Hans-CN');
}

function getWorldBookSortTime(book = {}) {
  const timestamp = Date.parse(book?.updatedAt || book?.createdAt || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getWorldBookPageItems(books, page, pageSize) {
  const currentBooks = Array.isArray(books) ? books : [];
  const safePageSize = Math.max(1, Number(pageSize) || WORLD_BOOK_SELECTOR_PAGE_SIZE);
  const start = (clampWorldBookPage(page, Math.max(1, Math.ceil(currentBooks.length / safePageSize))) - 1) * safePageSize;
  return currentBooks.slice(start, start + safePageSize);
}

function clampWorldBookPage(page, pageCount) {
  const safePageCount = Math.max(1, Number(pageCount) || 1);
  const numericPage = Number(page);
  const safePage = Number.isFinite(numericPage) ? Math.floor(numericPage) : 1;
  return Math.max(1, Math.min(safePage, safePageCount));
}
