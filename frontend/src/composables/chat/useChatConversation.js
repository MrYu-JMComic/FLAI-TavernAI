import { computed, nextTick, ref } from 'vue';
import { isViewportMatch } from '../useViewport.js';
import {
  createConversation,
  deleteConversation,
  deleteConversations,
  fetchCharacters,
  fetchConversations,
  fetchPresets
} from '../../api.js';

export function useChatConversation({ route, emit, showError }) {
  const conversation = ref(null);
  const conversations = ref([]);
  const characters = ref([]);
  const messages = ref([]);
  const loading = ref(false);
  const error = ref('');
  const sidebarLoadError = ref('');
  const sidebarLoading = ref(false);
  const historySearch = ref('');
  const sidebarOpen = ref(isViewportMatch('(min-width: 981px)'));
  const settingsDrawerOpen = ref(false);
  const selectedConversationIds = ref(new Set());
  const conversationActionBusy = ref(false);
  const startConversationBusy = ref(false);
  const savePanelOpen = ref(false);
  const npcPanelOpen = ref(false);
  const economyPanelOpen = ref(false);
  const presetList = ref([]);
  const selectedPresetId = ref('');
  let sidebarLoadToken = 0;
  let startConversationToken = 0;
  let conversationActionToken = 0;
  let conversationDisposed = false;

  const filteredConversations = computed(() => filterConversationSummaries(conversations.value, historySearch.value));
  const visibleConversationIds = computed(() => collectConversationIds(filteredConversations.value));
  const visibleConversationSelection = computed(() => {
    return summarizeVisibleConversationSelection(visibleConversationIds.value, selectedConversationIds.value);
  });
  const selectedConversationCount = computed(() => visibleConversationSelection.value.selectedCount);
  const allVisibleConversationsSelected = computed(() => visibleConversationSelection.value.allSelected);
  const conversationReady = computed(() => Boolean(conversation.value?.id) && !loading.value);

  async function loadSidebarData() {
    if (conversationDisposed) {
      return;
    }
    const requestToken = ++sidebarLoadToken;
    const currentCharacterId = conversation.value?.characterId;
    sidebarLoading.value = true;
    try {
      const [historyResult, characterResult, presetResult] = await Promise.allSettled([
        fetchConversations({ characterId: currentCharacterId }),
        fetchCharacters(),
        fetchPresets()
      ]);
      if (!isCurrentSidebarLoad(requestToken, currentCharacterId)) {
        return;
      }

      const failures = [];
      if (historyResult.status === 'fulfilled') {
        setListRefIfChanged(conversations, historyResult.value, sameConversationSummary);
      } else {
        setListRefIfChanged(conversations, [], sameConversationSummary);
        failures.push(['会话历史', historyResult.reason]);
      }

      if (characterResult.status === 'fulfilled') {
        setListRefIfChanged(characters, characterResult.value, sameCharacterSummary);
      } else {
        setListRefIfChanged(characters, [], sameCharacterSummary);
        failures.push(['角色列表', characterResult.reason]);
      }

      if (presetResult.status === 'fulfilled') {
        setListRefIfChanged(presetList, presetResult.value, samePresetSummary);
      } else {
        setListRefIfChanged(presetList, [], samePresetSummary);
        selectedPresetId.value = '';
        failures.push(['预设列表', presetResult.reason]);
      }

      syncSelectedPresetId();
      sidebarLoadError.value = formatSidebarLoadError(failures);
      pruneSelectedConversations();
    } finally {
      if (isLatestSidebarLoad(requestToken)) {
        sidebarLoading.value = false;
      }
    }
  }

  async function reloadSidebarData() {
    if (conversationDisposed || sidebarLoading.value || conversationActionBusy.value || startConversationBusy.value) {
      return;
    }
    await loadSidebarData();
  }

  function setListRefIfChanged(listRef, nextItems, sameItem) {
    const normalizedItems = Array.isArray(nextItems) ? nextItems : [];
    const currentItems = Array.isArray(listRef.value) ? listRef.value : [];
    if (sameListItems(currentItems, normalizedItems, sameItem)) {
      return false;
    }
    listRef.value = normalizedItems;
    return true;
  }

  function setActiveConversationIfChanged(nextConversation) {
    const normalizedConversation = nextConversation || null;
    if (sameStableValue(conversation.value, normalizedConversation)) {
      return false;
    }
    conversation.value = normalizedConversation;
    return true;
  }

  function setMessagesIfChanged(nextMessages) {
    return setListRefIfChanged(messages, nextMessages, sameMessageSummary);
  }

  function filterConversationSummaries(items, rawQuery) {
    const query = rawQuery.trim().toLowerCase();
    if (!query) {
      return items;
    }

    const matches = [];
    for (const item of items) {
      if (`${item.title} ${item.character?.name || ''}`.toLowerCase().includes(query)) {
        matches.push(item);
      }
    }
    return matches;
  }

  function collectConversationIds(items) {
    const ids = [];
    for (const item of items) {
      ids.push(item.id);
    }
    return ids;
  }

  function collectConversationIdSet(items) {
    const ids = new Set();
    for (const item of items) {
      ids.add(item.id);
    }
    return ids;
  }

  function summarizeVisibleConversationSelection(visibleIds, selectedIds) {
    let selectedCount = 0;
    for (const id of visibleIds) {
      if (selectedIds.has(id)) {
        selectedCount += 1;
      }
    }
    return {
      selectedCount,
      allSelected: visibleIds.length > 0 && selectedCount === visibleIds.length
    };
  }

  function collectSelectedVisibleConversationIds(selectedIds, visibleIds) {
    if (!selectedIds.size || !visibleIds.length) {
      return [];
    }

    const visible = new Set(visibleIds);
    const ids = [];
    for (const id of selectedIds) {
      if (visible.has(id)) {
        ids.push(id);
      }
    }
    return ids;
  }

  function sameListItems(currentItems, nextItems, sameItem) {
    if (currentItems === nextItems) {
      return true;
    }
    if (currentItems.length !== nextItems.length) {
      return false;
    }
    for (let index = 0; index < currentItems.length; index += 1) {
      if (!sameItem(currentItems[index], nextItems[index])) {
        return false;
      }
    }
    return true;
  }

  function sameConversationSummary(current = {}, next = {}) {
    return current?.id === next?.id
      && current?.title === next?.title
      && current?.characterId === next?.characterId
      && current?.character?.name === next?.character?.name
      && current?.usage?.totalTokens === next?.usage?.totalTokens
      && current?.usage?.totalCostCny === next?.usage?.totalCostCny;
  }

  function sameMessageSummary(current = {}, next = {}) {
    return sameStableValue(current, next);
  }

  function sameCharacterSummary(current = {}, next = {}) {
    return current?.id === next?.id
      && current?.name === next?.name
      && current?.avatarUrl === next?.avatarUrl
      && current?.visibility === next?.visibility
      && sameRenderPluginList(current?.renderPlugins, next?.renderPlugins);
  }

  function samePresetSummary(current = {}, next = {}) {
    return current?.id === next?.id
      && current?.name === next?.name
      && current?.isDefault === next?.isDefault;
  }

  function sameRenderPluginList(currentItems = [], nextItems = []) {
    const currentList = Array.isArray(currentItems) ? currentItems : [];
    const nextList = Array.isArray(nextItems) ? nextItems : [];
    if (currentList.length !== nextList.length) {
      return false;
    }
    for (let index = 0; index < currentList.length; index += 1) {
      if (!sameRenderPlugin(currentList[index], nextList[index])) {
        return false;
      }
    }
    return true;
  }

  function sameRenderPlugin(current = {}, next = {}) {
    return (current?.enabled !== false) === (next?.enabled !== false)
      && (current?.type || 'fold') === (next?.type || 'fold')
      && (current?.pattern || '') === (next?.pattern || '')
      && (current?.flags || '') === (next?.flags || '')
      && (current?.titleTemplate || current?.label || '') === (next?.titleTemplate || next?.label || '');
  }

  function sameStableValue(current, next) {
    if (current === next) {
      return true;
    }
    return stableSerialize(current) === stableSerialize(next);
  }

  function stableSerialize(value) {
    if (typeof value === 'undefined') {
      return 'undefined';
    }
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return stableSerializeArray(value);
    }
    return stableSerializeObject(value);
  }

  function stableSerializeArray(items) {
    let serialized = '[';
    for (let index = 0; index < items.length; index += 1) {
      if (index > 0) {
        serialized += ',';
      }
      if (Object.prototype.hasOwnProperty.call(items, index)) {
        const serializedItem = stableSerialize(items[index]);
        if (typeof serializedItem !== 'undefined') {
          serialized += serializedItem;
        }
      }
    }
    return `${serialized}]`;
  }

  function stableSerializeObject(value) {
    const keys = Object.keys(value).sort();
    let serialized = '{';
    for (let index = 0; index < keys.length; index += 1) {
      if (index > 0) {
        serialized += ',';
      }
      const key = keys[index];
      serialized += `${JSON.stringify(key)}:${stableSerialize(value[key])}`;
    }
    return `${serialized}}`;
  }

  function formatSidebarLoadError(failures) {
    if (!failures.length) {
      return '';
    }
    let labels = '';
    let firstMessage = '';
    for (let index = 0; index < failures.length; index += 1) {
      const [label, reason] = failures[index];
      const labelText = label == null ? '' : String(label);
      labels = labels ? `${labels}、${labelText}` : labelText;
      if (!firstMessage && reason?.message) {
        firstMessage = reason.message;
      }
    }
    return firstMessage ? `${labels}加载失败：${firstMessage}` : `${labels}加载失败`;
  }

  async function startNewConversation() {
    if (conversationDisposed || startConversationBusy.value || conversationActionBusy.value) {
      return;
    }
    error.value = '';
    const characterId = conversation.value?.characterId || characters.value[0]?.id;
    if (!characterId) {
      emit('navigate', 'home');
      return;
    }

    const requestToken = ++startConversationToken;
    startConversationBusy.value = true;
    try {
      const created = await createConversation(characterId);
      if (!isCurrentStartConversation(requestToken)) {
        return;
      }
      await loadSidebarData();
      if (!isCurrentStartConversation(requestToken)) {
        return;
      }
      closeSidebar();
      emit('navigate', 'chat', { id: created.id });
    } catch (err) {
      if (isCurrentStartConversation(requestToken)) {
        showError(err.message);
      }
    } finally {
      if (isCurrentStartConversation(requestToken)) {
        startConversationBusy.value = false;
      }
    }
  }

  function openConversation(conversationId) {
    if (conversationDisposed || conversationActionBusy.value) {
      return;
    }
    const navigationId = normalizeConversationSelectionId(conversationId);
    if (!navigationId) {
      return;
    }
    if (navigationId === route.params.id) {
      closeSidebar();
      return;
    }
    if (!hasConversationListItem(navigationId)) {
      return;
    }
    closeSidebar();
    emit('navigate', 'chat', { id: navigationId });
  }

  function openSidebar() {
    closeSettings();
    sidebarOpen.value = true;
  }

  function closeSidebar() {
    sidebarOpen.value = false;
  }

  function openSettings() {
    closeSidebar();
    settingsDrawerOpen.value = true;
  }

  function closeSettings() {
    settingsDrawerOpen.value = false;
  }

  function openSavePanel() {
    if (!conversationReady.value) {
      return;
    }
    savePanelOpen.value = true;
  }

  function closeSavePanel() {
    savePanelOpen.value = false;
  }

  async function openNpcPanel() {
    const panelConversationId = conversation.value?.id || '';
    if (!isCurrentPanelConversation(panelConversationId)) {
      return;
    }
    if (npcPanelOpen.value) {
      npcPanelOpen.value = false;
      await nextTick();
    }
    if (!isCurrentPanelConversation(panelConversationId)) {
      return;
    }
    npcPanelOpen.value = true;
  }

  function closeNpcPanel() {
    npcPanelOpen.value = false;
  }

  function openEconomyPanel() {
    if (!conversationReady.value) {
      return;
    }
    economyPanelOpen.value = true;
  }

  function closeEconomyPanel() {
    economyPanelOpen.value = false;
  }

  function toggleConversationSelection(conversationId) {
    if (conversationActionBusy.value) {
      return;
    }
    const selectionId = normalizeConversationSelectionId(conversationId);
    if (!selectionId) {
      return;
    }
    const selectedIds = selectedConversationIds.value;
    const alreadySelected = selectedIds.has(selectionId);
    if (!alreadySelected && !hasConversationListItem(selectionId)) {
      return;
    }
    const next = new Set(selectedIds);
    if (alreadySelected) {
      next.delete(selectionId);
    } else {
      next.add(selectionId);
    }
    selectedConversationIds.value = next;
  }

  function normalizeConversationSelectionId(conversationId) {
    return String(conversationId ?? '').trim();
  }

  function hasConversationListItem(conversationId) {
    const targetId = normalizeConversationSelectionId(conversationId);
    if (!targetId) {
      return false;
    }
    const currentConversations = Array.isArray(conversations.value) ? conversations.value : [];
    for (const item of currentConversations) {
      if (item?.id === targetId) {
        return true;
      }
    }
    return false;
  }

  function toggleAllVisibleConversations() {
    if (conversationActionBusy.value) {
      return;
    }
    const visibleIds = visibleConversationIds.value;
    if (!visibleIds.length) {
      return;
    }
    const selectedIds = selectedConversationIds.value;
    const next = new Set(selectedIds);
    if (allVisibleConversationsSelected.value) {
      for (const id of visibleIds) {
        next.delete(id);
      }
    } else {
      for (const id of visibleIds) {
        next.add(id);
      }
    }
    selectedConversationIds.value = next;
  }

  async function deleteOneConversation(item) {
    const deletionId = normalizeConversationSelectionId(item?.id);
    if (conversationDisposed || conversationActionBusy.value || !deletionId || !hasConversationListItem(deletionId)) {
      return;
    }
    if (!window.confirm(`删除会话「${item.title}」？不会删除其他会话。`)) {
      return;
    }

    const actionToken = ++conversationActionToken;
    conversationActionBusy.value = true;
    try {
      await deleteConversation(deletionId);
      if (!isCurrentConversationAction(actionToken)) {
        return;
      }
      removeDeletedConversations([deletionId]);
    } catch (err) {
      if (isCurrentConversationAction(actionToken)) {
        showError(err.message);
      }
    } finally {
      if (isCurrentConversationAction(actionToken)) {
        conversationActionBusy.value = false;
      }
    }
  }

  async function deleteSelectedConversations() {
    if (conversationDisposed || conversationActionBusy.value) {
      return;
    }
    const ids = collectSelectedVisibleConversationIds(selectedConversationIds.value, visibleConversationIds.value);
    if (!ids.length) {
      return;
    }
    if (!window.confirm(`删除选中的 ${ids.length} 个会话？不会影响未选中的会话。`)) {
      return;
    }

    const actionToken = ++conversationActionToken;
    conversationActionBusy.value = true;
    try {
      const result = await deleteConversations(ids);
      if (!isCurrentConversationAction(actionToken)) {
        return;
      }
      removeDeletedConversations(result.deletedIds || ids);
    } catch (err) {
      if (isCurrentConversationAction(actionToken)) {
        showError(err.message);
      }
    } finally {
      if (isCurrentConversationAction(actionToken)) {
        conversationActionBusy.value = false;
      }
    }
  }

  function removeDeletedConversations(ids) {
    if (conversationDisposed) {
      return;
    }
    const deleted = new Set(ids);
    const nextConversations = [];
    let conversationsChanged = false;
    for (const item of conversations.value) {
      if (deleted.has(item.id)) {
        conversationsChanged = true;
      } else {
        nextConversations.push(item);
      }
    }
    if (conversationsChanged) {
      conversations.value = nextConversations;
    }
    pruneSelectedConversationIds((id) => !deleted.has(id));

    if (deleted.has(route.params.id)) {
      const nextConversation = conversations.value[0];
      if (nextConversation) {
        emit('navigate', 'chat', { id: nextConversation.id });
      } else {
        emit('navigate', 'home');
      }
    }
  }

  function pruneSelectedConversations() {
    const valid = collectConversationIdSet(conversations.value);
    pruneSelectedConversationIds((id) => valid.has(id));
  }

  function pruneSelectedConversationIds(shouldKeep) {
    const selectedIds = selectedConversationIds.value;
    if (!selectedIds.size) {
      return false;
    }
    const next = new Set();
    let changed = false;
    for (const id of selectedIds) {
      if (shouldKeep(id)) {
        next.add(id);
      } else {
        changed = true;
      }
    }
    if (!changed) {
      return false;
    }
    selectedConversationIds.value = next;
    return true;
  }

  function syncSelectedPresetId() {
    const currentId = selectedPresetId.value;
    let fallbackId = '';
    for (const preset of presetList.value) {
      if (!fallbackId && preset?.isDefault) {
        fallbackId = preset?.id || '';
      }
      if (preset?.id === currentId) {
        return false;
      }
    }
    if (currentId === fallbackId) {
      return false;
    }
    selectedPresetId.value = fallbackId;
    return true;
  }

  function formatConversationUsage(item) {
    const usage = item.usage || {};
    return `总 token ${formatTokens(usage.totalTokens)} · 总费用 ${formatCost(usage)}`;
  }

  function formatTokens(value) {
    const number = Number(value || 0);
    return number.toLocaleString('zh-CN');
  }

  function formatCost(usage) {
    const cost = Number(usage.totalCostCny);
    if (!Number.isFinite(cost)) {
      return '未计价';
    }

    const digits = cost > 0 && cost < 0.01 ? 6 : 4;
    return `¥${cost.toFixed(digits)}`;
  }

  function isCurrentSidebarLoad(requestToken, characterId) {
    return !conversationDisposed
      && requestToken === sidebarLoadToken
      && conversation.value?.characterId === characterId;
  }

  function isLatestSidebarLoad(requestToken) {
    return !conversationDisposed && requestToken === sidebarLoadToken;
  }

  function isCurrentStartConversation(requestToken) {
    return !conversationDisposed && requestToken === startConversationToken;
  }

  function isCurrentConversationAction(actionToken) {
    return !conversationDisposed && actionToken === conversationActionToken;
  }

  function isCurrentPanelConversation(conversationId) {
    return !conversationDisposed
      && conversationReady.value
      && conversation.value?.id === conversationId
      && route.params.id === conversationId;
  }

  function cleanup() {
    conversationDisposed = true;
    sidebarLoadToken += 1;
    startConversationToken += 1;
    conversationActionToken += 1;
    sidebarLoading.value = false;
    startConversationBusy.value = false;
    conversationActionBusy.value = false;
  }

  return {
    conversation,
    conversations,
    characters,
    messages,
    loading,
    error,
    sidebarLoadError,
    sidebarLoading,
    historySearch,
    sidebarOpen,
    settingsDrawerOpen,
    selectedConversationIds,
    conversationActionBusy,
    startConversationBusy,
    savePanelOpen,
    npcPanelOpen,
    economyPanelOpen,
    presetList,
    selectedPresetId,
    filteredConversations,
    visibleConversationIds,
    selectedConversationCount,
    allVisibleConversationsSelected,
    conversationReady,
    setActiveConversationIfChanged,
    setMessagesIfChanged,
    loadSidebarData,
    reloadSidebarData,
    startNewConversation,
    openConversation,
    openSidebar,
    closeSidebar,
    openSettings,
    closeSettings,
    openSavePanel,
    closeSavePanel,
    openNpcPanel,
    closeNpcPanel,
    openEconomyPanel,
    closeEconomyPanel,
    toggleConversationSelection,
    toggleAllVisibleConversations,
    deleteOneConversation,
    deleteSelectedConversations,
    removeDeletedConversations,
    pruneSelectedConversations,
    formatConversationUsage,
    formatTokens,
    formatCost,
    cleanup
  };
}
