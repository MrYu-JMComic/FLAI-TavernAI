import { computed, ref } from 'vue';
import { createTag, fetchTags } from '../../api/tags.js';
import { fetchWorldBooks } from '../../api/worldBooks.js';
import { sameListItems } from '../../utils/listReferences';

export function useCharacterFormOptions({
  canEdit,
  isDisposed = () => false,
  notify,
  selectedTags
} = {}) {
  const worldBooks = ref([]);
  const selectedWorldBookIds = ref([]);
  const availableTags = ref([]);
  const optionsLoading = ref(false);
  const optionsLoadError = ref('');
  const tagSearch = ref('');
  const tagCreating = ref(false);
  let formOptionsLoadToken = 0;
  let tagCreateToken = 0;

  const filteredTags = computed(() => filterTagsBySearch(availableTags.value, tagSearch.value));
  const canCreateSearchedTag = computed(() => canCreateTagFromSearch(availableTags.value, tagSearch.value));

  async function loadFormOptions() {
    if (isDisposed()) return;
    const loadToken = ++formOptionsLoadToken;
    optionsLoading.value = true;
    optionsLoadError.value = '';
    try {
      const [nextWorldBooks, nextTags] = await Promise.all([fetchWorldBooks(), fetchTags()]);
      if (!isCurrentFormOptionsLoad(loadToken)) return;
      setWorldBooksIfChanged(nextWorldBooks);
      setAvailableTagsIfChanged(nextTags);
    } catch (err) {
      if (!isCurrentFormOptionsLoad(loadToken)) return;
      optionsLoadError.value = err?.message || '标签和世界书选项加载失败';
      notify?.error?.(optionsLoadError.value);
    } finally {
      if (isCurrentFormOptionsLoad(loadToken)) {
        optionsLoading.value = false;
      }
    }
  }

  function cancelCharacterFormOptions() {
    formOptionsLoadToken += 1;
    tagCreateToken += 1;
    optionsLoading.value = false;
    tagCreating.value = false;
  }

  function isCurrentFormOptionsLoad(loadToken) {
    return !isDisposed() && loadToken === formOptionsLoadToken;
  }

  function setWorldBooksIfChanged(nextBooks) {
    const normalizedBooks = Array.isArray(nextBooks) ? nextBooks : [];
    if (sameListItems(worldBooks.value, normalizedBooks, sameWorldBookOption)) {
      return false;
    }
    worldBooks.value = normalizedBooks;
    return true;
  }

  function setAvailableTagsIfChanged(nextTags) {
    const normalizedTags = Array.isArray(nextTags) ? nextTags : [];
    if (sameListItems(availableTags.value, normalizedTags, sameTagOption)) {
      return false;
    }
    availableTags.value = normalizedTags;
    return true;
  }

  function appendAvailableTagIfMissing(tag) {
    if (!tag?.name) {
      return false;
    }
    const currentTags = Array.isArray(availableTags.value) ? availableTags.value : [];
    const nextTags = [];
    let tagExists = false;
    for (const currentTag of currentTags) {
      if (currentTag?.name === tag?.name) {
        tagExists = true;
      }
      nextTags.push(currentTag);
    }
    if (tagExists) {
      return false;
    }
    nextTags.push(tag);
    return setAvailableTagsIfChanged(nextTags);
  }

  function normalizeWorldBookIds(nextIds) {
    const normalizedIds = [];
    for (const id of Array.isArray(nextIds) ? nextIds : []) {
      normalizedIds.push(String(id || ''));
    }
    return normalizedIds;
  }

  function setSelectedWorldBookIdsFromBooksIfChanged(nextBooks) {
    const nextIds = [];
    for (const book of Array.isArray(nextBooks) ? nextBooks : []) {
      nextIds.push(book?.id);
    }
    return setSelectedWorldBookIdsIfChanged(nextIds);
  }

  function setSelectedWorldBookIdsIfChanged(nextIds) {
    const normalizedIds = normalizeWorldBookIds(nextIds);
    if (sameListItems(selectedWorldBookIds.value, normalizedIds, Object.is)) {
      return false;
    }
    selectedWorldBookIds.value = normalizedIds;
    return true;
  }

  function toggleTagSelection(name) {
    if (!canEdit?.value || tagCreating.value) {
      return;
    }
    const selectedTagList = getSelectedTagList();
    const idx = selectedTagList.indexOf(name);
    if (idx >= 0) {
      selectedTagList.splice(idx, 1);
    } else {
      selectedTagList.push(name);
    }
  }

  function toggleWorldBook(bookId) {
    if (!canEdit?.value) {
      return;
    }
    const normalizedId = String(bookId || '');
    if (!normalizedId) {
      return;
    }
    const currentIds = selectedWorldBookIds.value;
    const nextIds = [];
    let removedSelectedId = false;
    for (const id of currentIds) {
      if (id === normalizedId) {
        removedSelectedId = true;
        continue;
      }
      nextIds.push(id);
    }
    if (!removedSelectedId) {
      nextIds.push(normalizedId);
    }
    setSelectedWorldBookIdsIfChanged(nextIds);
  }

  async function createAndSelectTag() {
    if (isDisposed() || tagCreating.value || !canEdit?.value) return;
    const name = tagSearch.value.trim();
    if (!name) return;
    if (getSelectedTagList().includes(name)) return;
    const createToken = ++tagCreateToken;
    tagCreating.value = true;
    try {
      const tag = await createTag({ name });
      if (!isCurrentTagCreate(createToken, name)) return;
      appendAvailableTagIfMissing(tag);
      const selectedTagList = getSelectedTagList();
      if (!selectedTagList.includes(name)) {
        selectedTagList.push(name);
      }
      tagSearch.value = '';
    } catch (err) {
      if (!isCurrentTagCreate(createToken, name)) return;
      notify?.error?.(err.message);
    } finally {
      if (isActiveTagCreate(createToken)) {
        tagCreating.value = false;
      }
    }
  }

  function isCurrentTagCreate(createToken, name) {
    return isActiveTagCreate(createToken)
      && tagSearch.value.trim() === name;
  }

  function isActiveTagCreate(createToken) {
    return !isDisposed() && createToken === tagCreateToken;
  }

  function getSelectedTagList() {
    return Array.isArray(selectedTags?.value) ? selectedTags.value : [];
  }

  return {
    availableTags,
    canCreateSearchedTag,
    cancelCharacterFormOptions,
    createAndSelectTag,
    filteredTags,
    loadFormOptions,
    normalizeWorldBookIds,
    optionsLoadError,
    optionsLoading,
    selectedWorldBookIds,
    setSelectedWorldBookIdsFromBooksIfChanged,
    setSelectedWorldBookIdsIfChanged,
    tagCreating,
    tagSearch,
    toggleTagSelection,
    toggleWorldBook,
    worldBooks
  };
}

function filterTagsBySearch(tags, rawSearch) {
  const currentTags = Array.isArray(tags) ? tags : [];
  const search = String(rawSearch || '').trim().toLowerCase();
  if (!search) {
    return currentTags;
  }
  const matches = [];
  for (const tag of currentTags) {
    if (String(tag?.name || '').toLowerCase().includes(search)) {
      matches.push(tag);
    }
  }
  return matches;
}

function canCreateTagFromSearch(tags, rawSearch) {
  const name = String(rawSearch || '').trim();
  if (!name) {
    return false;
  }
  for (const tag of Array.isArray(tags) ? tags : []) {
    if (tag?.name === name) {
      return false;
    }
  }
  return true;
}

function sameWorldBookOption(current = {}, next = {}) {
  return String(current?.id || '') === String(next?.id || '')
    && String(current?.name || '') === String(next?.name || '')
    && String(current?.description || '') === String(next?.description || '')
    && String(current?.characterId || '') === String(next?.characterId || '')
    && Number(current?.scanDepth || 4) === Number(next?.scanDepth || 4)
    && Number(current?.lorebookContextPercent || 25) === Number(next?.lorebookContextPercent || 25)
    && Number(current?.entryCount || 0) === Number(next?.entryCount || 0);
}

function sameTagOption(current = {}, next = {}) {
  return String(current?.id || '') === String(next?.id || '')
    && String(current?.name || '') === String(next?.name || '')
    && String(current?.color || '') === String(next?.color || '')
    && Number(current?.usageCount || 0) === Number(next?.usageCount || 0);
}
