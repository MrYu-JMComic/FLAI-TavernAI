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

  const filteredConversations = computed(() => {
    const query = historySearch.value.trim().toLowerCase();
    if (!query) {
      return conversations.value;
    }
    return conversations.value.filter((item) => {
      return `${item.title} ${item.character?.name || ''}`.toLowerCase().includes(query);
    });
  });

  const visibleConversationIds = computed(() => filteredConversations.value.map((item) => item.id));
  const selectedConversationCount = computed(() => {
    return visibleConversationIds.value.filter((id) => selectedConversationIds.value.has(id)).length;
  });
  const allVisibleConversationsSelected = computed(() => {
    return visibleConversationIds.value.length > 0
      && visibleConversationIds.value.every((id) => selectedConversationIds.value.has(id));
  });
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
        conversations.value = historyResult.value;
      } else {
        conversations.value = [];
        failures.push(['会话历史', historyResult.reason]);
      }

      if (characterResult.status === 'fulfilled') {
        characters.value = characterResult.value;
      } else {
        characters.value = [];
        failures.push(['角色列表', characterResult.reason]);
      }

      if (presetResult.status === 'fulfilled') {
        presetList.value = presetResult.value;
      } else {
        presetList.value = [];
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

  function formatSidebarLoadError(failures) {
    if (!failures.length) {
      return '';
    }
    const labels = failures.map(([label]) => label).join('、');
    const firstMessage = failures.map(([, reason]) => reason?.message).find(Boolean);
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
    if (conversationId === route.params.id) {
      closeSidebar();
      return;
    }
    closeSidebar();
    emit('navigate', 'chat', { id: conversationId });
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
    if (conversationDisposed || !conversationReady.value) {
      return;
    }
    if (npcPanelOpen.value) {
      npcPanelOpen.value = false;
      await nextTick();
    }
    if (conversationDisposed) {
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
    const next = new Set(selectedConversationIds.value);
    if (next.has(conversationId)) {
      next.delete(conversationId);
    } else {
      next.add(conversationId);
    }
    selectedConversationIds.value = next;
  }

  function toggleAllVisibleConversations() {
    if (conversationActionBusy.value) {
      return;
    }
    if (allVisibleConversationsSelected.value) {
      selectedConversationIds.value = new Set(
        [...selectedConversationIds.value].filter((id) => !visibleConversationIds.value.includes(id))
      );
      return;
    }
    selectedConversationIds.value = new Set([...selectedConversationIds.value, ...visibleConversationIds.value]);
  }

  async function deleteOneConversation(item) {
    if (conversationDisposed || conversationActionBusy.value || !item?.id) {
      return;
    }
    if (!window.confirm(`删除会话「${item.title}」？不会删除其他会话。`)) {
      return;
    }

    const actionToken = ++conversationActionToken;
    conversationActionBusy.value = true;
    try {
      await deleteConversation(item.id);
      if (!isCurrentConversationAction(actionToken)) {
        return;
      }
      removeDeletedConversations([item.id]);
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
    const ids = [...selectedConversationIds.value].filter((id) => visibleConversationIds.value.includes(id));
    if (conversationDisposed || !ids.length || conversationActionBusy.value) {
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
    conversations.value = conversations.value.filter((item) => !deleted.has(item.id));
    selectedConversationIds.value = new Set([...selectedConversationIds.value].filter((id) => !deleted.has(id)));

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
    const valid = new Set(conversations.value.map((item) => item.id));
    selectedConversationIds.value = new Set([...selectedConversationIds.value].filter((id) => valid.has(id)));
  }

  function syncSelectedPresetId() {
    if (!presetList.value.length) {
      selectedPresetId.value = '';
      return;
    }
    if (presetList.value.some((preset) => preset.id === selectedPresetId.value)) {
      return;
    }
    const defaultPreset = presetList.value.find((preset) => preset.isDefault);
    selectedPresetId.value = defaultPreset?.id || '';
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
    loadSidebarData,
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
