import { computed, ref } from 'vue';
import {
  createTag,
  deleteTag,
  fetchTags
} from '../../api/tags.js';
import {
  getListItemById,
  prependListItemByIdWithLimit,
  removeListItemByIdIfPresent,
  setListIfChanged
} from './settingsListState.js';

const TAG_LOAD_LIMIT_DEFAULT = 80;
const TAG_LOAD_LIMIT_MAX = 500;
const TAG_LOAD_LIMIT_STORAGE_KEY = 'flai-tag-load-limit';

export function useSettingsTags({ isExtensionsPage, notify } = {}) {
  const tagList = ref([]);
  const newTagName = ref('');
  const tagLoadLimit = ref(readStoredTagLoadLimit());
  const tagLoading = ref(false);
  const tagLoadError = ref('');
  const tagActionBusyId = ref('');
  const normalizedTagLoadLimit = computed(() => normalizeTagLoadLimit(tagLoadLimit.value));
  const tagActionBusy = computed(() => Boolean(tagActionBusyId.value));
  const tagControlsBusy = computed(() => tagLoading.value || tagActionBusy.value);
  let tagLoadToken = 0;
  let tagMutationToken = 0;

  async function loadTags() {
    if (!isExtensionPageReady() || tagControlsBusy.value) {
      return;
    }
    const requestToken = ++tagLoadToken;
    const limit = normalizedTagLoadLimit.value;
    tagLoadLimit.value = limit;
    saveStoredTagLoadLimit(limit);
    tagLoading.value = true;
    tagLoadError.value = '';
    try {
      const nextTags = await fetchTags({ limit });
      if (!isCurrentTagLoad(requestToken)) return;
      setListIfChanged(tagList, nextTags);
    } catch (err) {
      if (!isCurrentTagLoad(requestToken)) return;
      tagLoadError.value = loadFailureMessage(err, '标签加载失败');
    } finally {
      if (isCurrentTagLoad(requestToken)) {
        tagLoading.value = false;
      }
    }
  }

  function isCurrentTagLoad(requestToken) {
    return requestToken === tagLoadToken && isExtensionPageReady();
  }

  function resetTagMutationScope() {
    tagMutationToken += 1;
  }

  function resetTagAsyncScope() {
    tagLoadToken += 1;
    tagLoading.value = false;
    tagActionBusyId.value = '';
    resetTagMutationScope();
  }

  function tagDeleteActionId(id) {
    return `tag-delete:${id}`;
  }

  function beginTagMutation(actionId) {
    resetTagAsyncScope();
    tagActionBusyId.value = actionId;
    return tagMutationToken;
  }

  function finishTagMutation(mutationToken) {
    if (mutationToken === tagMutationToken) {
      tagActionBusyId.value = '';
    }
  }

  function isCurrentTagMutation(mutationToken) {
    return mutationToken === tagMutationToken && isExtensionPageReady();
  }

  function getCurrentTag(id) {
    return getListItemById(tagList, id);
  }

  function updateNewTagName(value) {
    newTagName.value = String(value || '');
  }

  function updateTagLoadLimitDraft(value) {
    tagLoadLimit.value = value;
  }

  function updateTagLoadLimit() {
    if (tagControlsBusy.value) return;
    resetTagAsyncScope();
    tagLoadLimit.value = normalizedTagLoadLimit.value;
    saveStoredTagLoadLimit(tagLoadLimit.value);
    loadTags();
  }

  async function addTag() {
    const name = newTagName.value.trim();
    if (!name || tagControlsBusy.value) return;
    const mutationToken = beginTagMutation('tag-add');
    try {
      const tag = await createTag({ name });
      if (!isCurrentTagMutation(mutationToken)) return;
      prependListItemByIdWithLimit(tagList, tag, normalizedTagLoadLimit.value);
      newTagName.value = '';
      notify?.success?.(`标签「${tag.name}」已创建`);
    } catch (err) {
      if (!isCurrentTagMutation(mutationToken)) return;
      notify?.error?.(err.message);
    } finally {
      finishTagMutation(mutationToken);
    }
  }

  async function removeTag(id, name) {
    if (tagControlsBusy.value) return;
    const currentTag = getCurrentTag(id);
    if (!currentTag) return;
    name = currentTag.name || name;
    if (!window.confirm(`确定删除标签「${name}」吗？关联的角色卡将失去此标签。`)) return;
    const mutationToken = beginTagMutation(tagDeleteActionId(currentTag.id));
    try {
      await deleteTag(currentTag.id);
      if (!isCurrentTagMutation(mutationToken)) return;
      removeListItemByIdIfPresent(tagList, currentTag.id);
      notify?.success?.(`标签「${name}」已删除`);
    } catch (err) {
      if (!isCurrentTagMutation(mutationToken)) return;
      if (/标签不存在/.test(err.message || '')) {
        removeListItemByIdIfPresent(tagList, currentTag.id);
        notify?.info?.(`标签「${name}」已从列表移除`);
        return;
      }
      notify?.error?.(err.message);
    } finally {
      finishTagMutation(mutationToken);
    }
  }

  function isExtensionPageReady() {
    return isExtensionsPage?.value === true;
  }

  return {
    addTag,
    loadTags,
    newTagName,
    normalizedTagLoadLimit,
    removeTag,
    resetTagAsyncScope,
    tagActionBusy,
    tagActionBusyId,
    tagControlsBusy,
    tagList,
    tagLoadError,
    tagLoading,
    tagLoadLimit,
    updateNewTagName,
    updateTagLoadLimit,
    updateTagLoadLimitDraft
  };
}

function loadFailureMessage(error, fallback) {
  return error?.message || fallback;
}

function normalizeTagLoadLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit < 1) {
    return TAG_LOAD_LIMIT_DEFAULT;
  }
  return Math.min(Math.floor(limit), TAG_LOAD_LIMIT_MAX);
}

function readStoredTagLoadLimit() {
  if (typeof localStorage === 'undefined') {
    return TAG_LOAD_LIMIT_DEFAULT;
  }
  return normalizeTagLoadLimit(localStorage.getItem(TAG_LOAD_LIMIT_STORAGE_KEY));
}

function saveStoredTagLoadLimit(limit) {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(TAG_LOAD_LIMIT_STORAGE_KEY, String(limit));
}
