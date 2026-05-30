import { computed, ref } from 'vue';
import {
  createConversation,
  deleteConversation,
  deleteConversations,
  fetchCharacters,
  fetchConversations,
  fetchPresets
} from '../../api';

export function useChatConversation({ route, emit, showError }) {
  const conversation = ref(null);
  const conversations = ref([]);
  const characters = ref([]);
  const messages = ref([]);
  const loading = ref(false);
  const error = ref('');
  const historySearch = ref('');
  const sidebarOpen = ref(false);
  const settingsDrawerOpen = ref(false);
  const selectedConversationIds = ref(new Set());
  const conversationActionBusy = ref(false);
  const savePanelOpen = ref(false);
  const npcPanelOpen = ref(false);
  const economyPanelOpen = ref(false);
  const presetList = ref([]);
  const selectedPresetId = ref('');

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
  const selectedConversationCount = computed(() => selectedConversationIds.value.size);
  const allVisibleConversationsSelected = computed(() => {
    return visibleConversationIds.value.length > 0
      && visibleConversationIds.value.every((id) => selectedConversationIds.value.has(id));
  });

  async function loadSidebarData() {
    const currentCharacterId = conversation.value?.characterId;
    const [history, characterList, presets] = await Promise.all([
      fetchConversations({ characterId: currentCharacterId }).catch(() => []),
      fetchCharacters().catch(() => []),
      fetchPresets().catch(() => [])
    ]);
    conversations.value = history;
    characters.value = characterList;
    presetList.value = presets;
    if (!selectedPresetId.value && presets.length) {
      const defaultPreset = presets.find((p) => p.isDefault);
      selectedPresetId.value = defaultPreset?.id || '';
    }
    pruneSelectedConversations();
  }

  async function startNewConversation() {
    error.value = '';
    const characterId = conversation.value?.characterId || characters.value[0]?.id;
    if (!characterId) {
      emit('navigate', 'home');
      return;
    }

    try {
      const created = await createConversation(characterId);
      await loadSidebarData();
      closeSidebar();
      emit('navigate', 'chat', { id: created.id });
    } catch (err) {
      showError(err.message);
    }
  }

  function openConversation(conversationId) {
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
    savePanelOpen.value = true;
  }

  function closeSavePanel() {
    savePanelOpen.value = false;
  }

  function openNpcPanel() {
    npcPanelOpen.value = true;
  }

  function closeNpcPanel() {
    npcPanelOpen.value = false;
  }

  function openEconomyPanel() {
    economyPanelOpen.value = true;
  }

  function closeEconomyPanel() {
    economyPanelOpen.value = false;
  }

  function toggleConversationSelection(conversationId) {
    const next = new Set(selectedConversationIds.value);
    if (next.has(conversationId)) {
      next.delete(conversationId);
    } else {
      next.add(conversationId);
    }
    selectedConversationIds.value = next;
  }

  function toggleAllVisibleConversations() {
    if (allVisibleConversationsSelected.value) {
      selectedConversationIds.value = new Set(
        [...selectedConversationIds.value].filter((id) => !visibleConversationIds.value.includes(id))
      );
      return;
    }
    selectedConversationIds.value = new Set([...selectedConversationIds.value, ...visibleConversationIds.value]);
  }

  async function deleteOneConversation(item) {
    if (conversationActionBusy.value || !item?.id) {
      return;
    }
    if (!window.confirm(`删除会话「${item.title}」？不会删除其他会话。`)) {
      return;
    }

    conversationActionBusy.value = true;
    try {
      await deleteConversation(item.id);
      removeDeletedConversations([item.id]);
    } catch (err) {
      showError(err.message);
    } finally {
      conversationActionBusy.value = false;
    }
  }

  async function deleteSelectedConversations() {
    const ids = [...selectedConversationIds.value].filter((id) => visibleConversationIds.value.includes(id));
    if (!ids.length || conversationActionBusy.value) {
      return;
    }
    if (!window.confirm(`删除选中的 ${ids.length} 个会话？不会影响未选中的会话。`)) {
      return;
    }

    conversationActionBusy.value = true;
    try {
      const result = await deleteConversations(ids);
      removeDeletedConversations(result.deletedIds || ids);
    } catch (err) {
      showError(err.message);
    } finally {
      conversationActionBusy.value = false;
    }
  }

  function removeDeletedConversations(ids) {
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

  return {
    conversation,
    conversations,
    characters,
    messages,
    loading,
    error,
    historySearch,
    sidebarOpen,
    settingsDrawerOpen,
    selectedConversationIds,
    conversationActionBusy,
    savePanelOpen,
    npcPanelOpen,
    economyPanelOpen,
    presetList,
    selectedPresetId,
    filteredConversations,
    visibleConversationIds,
    selectedConversationCount,
    allVisibleConversationsSelected,
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
    formatCost
  };
}
