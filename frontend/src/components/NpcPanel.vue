<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import {
  Brain,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
  Zap
} from '@lucide/vue';
import {
  addNpcBehavior,
  addNpcMemory,
  deleteNpcBehavior,
  deleteNpcMemory,
  fetchConversationNpcs,
  fetchNpcBehaviors,
  fetchNpcMemories,
  hideConversationNpc,
  hideEmptyConversationNpcs,
  updateConversationNpc,
  updateNpcBehavior
} from '../api';
import { useNotify } from '../composables/useNotify';

const props = defineProps({
  conversationId: { type: String, required: true },
  open: { type: Boolean, default: false },
  refreshKey: { type: Number, default: 0 },
  updateStatus: { type: String, default: 'not-updated' }
});
const emit = defineEmits(['close', 'update:open', 'npcs-loaded']);

const notify = useNotify();
const loading = ref(false);
const loadError = ref('');
const npcs = ref([]);
const selectedNpc = ref('');
const memories = ref([]);
const behaviors = ref([]);
const detailTab = ref('memories');
const detailLoading = ref(false);
const detailError = ref('');
const addMemoryOpen = ref(false);
const addBehaviorOpen = ref(false);
const npcActionBusyId = ref('');
let npcLoadToken = 0;
let npcDetailToken = 0;
let npcMutationToken = 0;
let npcPanelDisposed = false;
const memoryForm = reactive({ memoryType: 'event', content: '' });
const behaviorForm = reactive({
  behaviorType: 'reaction',
  triggerCondition: '',
  action: '',
  priority: 0,
  enabled: true
});
const npcMetaForm = reactive({
  status: 'active',
  customStatus: '',
  aliasesText: '',
  memorySealed: false
});
const UPDATE_STATUS_META = {
  updating: { key: 'updating', label: '更新中' },
  updated: { key: 'updated', label: '已更新' },
  'not-updated': { key: 'not-updated', label: '未更新' }
};

const selectedNpcData = computed(() => getCurrentNpcByName(selectedNpc.value));
const updateStatusMeta = computed(() => UPDATE_STATUS_META[props.updateStatus] || UPDATE_STATUS_META['not-updated']);
const npcPanelSummary = computed(() => {
  const sourceNpcs = Array.isArray(npcs.value) ? npcs.value : [];
  const stats = {
    npcCount: sourceNpcs.length,
    memoryCount: 0,
    behaviorCount: 0
  };
  const emptyNpcNames = [];

  for (const npc of sourceNpcs) {
    const memoryCount = Number(npc?.memoryCount || 0);
    const behaviorCount = Number(npc?.behaviorCount || 0);
    stats.memoryCount += memoryCount;
    stats.behaviorCount += behaviorCount;
    if (memoryCount === 0 && behaviorCount === 0) {
      emptyNpcNames.push(npc?.name);
    }
  }

  return { stats, emptyNpcNames };
});
const npcPanelStats = computed(() => npcPanelSummary.value.stats);

const selectedNpcStats = computed(() => ({
  memoryCount: memories.value.length,
  behaviorCount: behaviors.value.length,
  aliasCount: selectedNpcData.value?.aliases?.length || 0
}));
const selectedNpcMemorySealActive = computed(() => Boolean(selectedNpcData.value?.memorySealActive));
const emptyNpcNames = computed(() => npcPanelSummary.value.emptyNpcNames);
const npcActionBusy = computed(() => Boolean(npcActionBusyId.value));

const memoryTypeOptions = [
  { value: 'event', label: '事件' },
  { value: 'relationship', label: '关系' },
  { value: 'opinion', label: '看法' },
  { value: 'knowledge', label: '知识' },
  { value: 'emotion', label: '情感' }
];

const behaviorTypeOptions = [
  { value: 'reaction', label: '反应' },
  { value: 'dialogue', label: '对话' },
  { value: 'action', label: '行动' },
  { value: 'emotion', label: '情绪' },
  { value: 'movement', label: '移动' }
];

const npcStatusOptions = [
  { value: 'active', label: '活跃' },
  { value: 'left', label: '离开' },
  { value: 'permanently_left', label: '永久离开' },
  { value: 'dead', label: '死亡' },
  { value: 'on_mission', label: '执行任务' },
  { value: 'following', label: '跟随' },
  { value: 'custom', label: '自定义' }
];

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    loadNpcs();
  }
}, { immediate: true });

watch(() => props.refreshKey, () => {
  if (props.open) {
    loadNpcs();
  }
});

watch(() => props.conversationId, () => {
  resetNpcState();
  if (props.open) {
    loadNpcs();
  }
});

watch(selectedNpcData, (npc) => {
  syncNpcMetaForm(npc);
}, { immediate: true });

onBeforeUnmount(() => {
  npcPanelDisposed = true;
  resetNpcState();
});

function requestClose() {
  emit('update:open', false);
  emit('close');
}

function resetNpcState() {
  npcLoadToken += 1;
  npcDetailToken += 1;
  npcMutationToken += 1;
  setNpcsIfChanged([]);
  setSelectedNpc('');
  setMemoriesIfChanged([]);
  setBehaviorsIfChanged([]);
  loadError.value = '';
  detailError.value = '';
  addMemoryOpen.value = false;
  addBehaviorOpen.value = false;
  npcActionBusyId.value = '';
  resetNpcForms();
  loading.value = false;
  detailLoading.value = false;
}

function setSelectedNpc(name) {
  const nextName = String(name || '');
  if (nextName !== selectedNpc.value) {
    resetNpcForms();
  }
  selectedNpc.value = nextName;
}

function resetNpcForms() {
  memoryForm.memoryType = 'event';
  memoryForm.content = '';
  behaviorForm.behaviorType = 'reaction';
  behaviorForm.triggerCondition = '';
  behaviorForm.action = '';
  behaviorForm.priority = 0;
  behaviorForm.enabled = true;
  resetNpcMetaForm();
}

function resetNpcMetaForm() {
  npcMetaForm.status = 'active';
  npcMetaForm.customStatus = '';
  npcMetaForm.aliasesText = '';
  npcMetaForm.memorySealed = false;
}

function syncNpcMetaForm(npc) {
  if (!npc) {
    resetNpcMetaForm();
    return;
  }
  npcMetaForm.status = npc.status || 'active';
  npcMetaForm.customStatus = npc.customStatus || '';
  npcMetaForm.aliasesText = Array.isArray(npc.aliases) ? npc.aliases.join('\n') : '';
  npcMetaForm.memorySealed = Boolean(npc.memorySealed);
}

function parseNpcAliasesText(value) {
  const aliases = [];
  const seen = new Set();
  for (const raw of String(value || '').split(/[\n,;|]+/)) {
    const alias = raw.trim();
    const key = alias.toLowerCase();
    if (!alias || seen.has(key)) continue;
    aliases.push(alias.slice(0, 80));
    seen.add(key);
    if (aliases.length >= 20) break;
  }
  return aliases;
}

function isCurrentNpcMutation(mutationToken, conversationId, npcName = null) {
  return !npcPanelDisposed
    && mutationToken === npcMutationToken
    && conversationId === props.conversationId
    && (npcName === null || npcName === selectedNpc.value);
}

function startNpcAction(actionId) {
  if (npcActionBusy.value) return false;
  npcActionBusyId.value = actionId;
  return true;
}

function finishNpcAction(actionId, mutationToken, conversationId, npcName = null) {
  if (npcActionBusyId.value !== actionId) return;
  if (!isCurrentNpcMutation(mutationToken, conversationId, npcName)) return;
  npcActionBusyId.value = '';
}

function isNpcActionBusy(actionId) {
  return npcActionBusyId.value === actionId;
}

function memoryActionId(memoryId) {
  return `memory-delete:${memoryId}`;
}

function behaviorToggleActionId(behaviorId) {
  return `behavior-toggle:${behaviorId}`;
}

function behaviorDeleteActionId(behaviorId) {
  return `behavior-delete:${behaviorId}`;
}

function getCurrentMemory(memoryId) {
  return memories.value.find((memory) => (
    memory?.id === memoryId
      && memory?.conversationId === props.conversationId
      && memory?.npcName === selectedNpc.value
  )) || null;
}

function getCurrentBehavior(behaviorId) {
  return behaviors.value.find((behavior) => (
    behavior?.id === behaviorId
      && behavior?.conversationId === props.conversationId
      && behavior?.npcName === selectedNpc.value
  )) || null;
}

function setNpcsIfChanged(nextNpcs) {
  const normalizedNpcs = Array.isArray(nextNpcs) ? nextNpcs : [];
  const currentNpcs = Array.isArray(npcs.value) ? npcs.value : [];
  if (sameListItems(currentNpcs, normalizedNpcs, sameNpcSummary)) {
    return false;
  }
  npcs.value = normalizedNpcs;
  return true;
}

function setMemoriesIfChanged(nextMemories) {
  const normalizedMemories = Array.isArray(nextMemories) ? nextMemories : [];
  const currentMemories = Array.isArray(memories.value) ? memories.value : [];
  if (sameListItems(currentMemories, normalizedMemories, sameMemorySummary)) {
    return false;
  }
  memories.value = normalizedMemories;
  return true;
}

function setBehaviorsIfChanged(nextBehaviors) {
  const normalizedBehaviors = Array.isArray(nextBehaviors) ? nextBehaviors : [];
  const currentBehaviors = Array.isArray(behaviors.value) ? behaviors.value : [];
  if (sameListItems(currentBehaviors, normalizedBehaviors, sameBehaviorSummary)) {
    return false;
  }
  behaviors.value = normalizedBehaviors;
  return true;
}

function sameListItems(currentItems, nextItems, sameItem) {
  if (currentItems === nextItems) {
    return true;
  }
  if (currentItems.length !== nextItems.length) {
    return false;
  }
  return currentItems.every((item, index) => sameItem(item, nextItems[index]));
}

function sameNpcSummary(current = {}, next = {}) {
  return current?.name === next?.name
    && Number(current?.memoryCount || 0) === Number(next?.memoryCount || 0)
    && Number(current?.behaviorCount || 0) === Number(next?.behaviorCount || 0)
    && String(current?.source || '') === String(next?.source || '')
    && Number(current?.confidence || 0) === Number(next?.confidence || 0)
    && String(current?.evidence || '') === String(next?.evidence || '')
    && String(current?.status || '') === String(next?.status || '')
    && String(current?.customStatus || '') === String(next?.customStatus || '')
    && Boolean(current?.memorySealed) === Boolean(next?.memorySealed)
    && Boolean(current?.memorySealActive) === Boolean(next?.memorySealActive)
    && sameListItems(normalizeStringList(current?.aliases), normalizeStringList(next?.aliases), Object.is);
}

function sameMemorySummary(current = {}, next = {}) {
  return current?.id === next?.id
    && current?.conversationId === next?.conversationId
    && current?.npcName === next?.npcName
    && current?.memoryType === next?.memoryType
    && current?.content === next?.content
    && current?.createdAt === next?.createdAt;
}

function sameBehaviorSummary(current = {}, next = {}) {
  return current?.id === next?.id
    && current?.conversationId === next?.conversationId
    && current?.npcName === next?.npcName
    && current?.behaviorType === next?.behaviorType
    && current?.triggerCondition === next?.triggerCondition
    && current?.action === next?.action
    && Number(current?.priority || 0) === Number(next?.priority || 0)
    && Boolean(current?.enabled) === Boolean(next?.enabled)
    && current?.createdAt === next?.createdAt;
}

function normalizeStringList(value) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function getCurrentNpcByName(name, sourceNpcs = npcs.value) {
  const targetName = String(name || '').trim();
  if (!targetName) {
    return null;
  }
  const currentNpcs = Array.isArray(sourceNpcs) ? sourceNpcs : [];
  for (const npc of currentNpcs) {
    if (npc?.name === targetName) {
      return npc;
    }
  }
  return null;
}

function removeMemoryByIdIfPresent(memoryId) {
  const nextMemories = [];
  let changed = false;
  for (const memory of memories.value) {
    if (memory?.id === memoryId) {
      changed = true;
    } else {
      nextMemories.push(memory);
    }
  }
  if (changed) {
    setMemoriesIfChanged(nextMemories);
  }
  return changed;
}

function prependMemoryIfChanged(memory) {
  if (!memory) return false;
  const nextMemories = [memory];
  const currentMemories = Array.isArray(memories.value) ? memories.value : [];
  for (const currentMemory of currentMemories) {
    nextMemories.push(currentMemory);
  }
  return setMemoriesIfChanged(nextMemories);
}

function updateNpcByNameIfChanged(npcName, nextNpc) {
  const nextNpcs = [];
  let changed = false;
  for (const npc of npcs.value) {
    if (npc?.name === npcName) {
      const mergedNpc = { ...npc, ...nextNpc };
      if (!sameNpcSummary(npc, mergedNpc)) {
        changed = true;
        nextNpcs.push(mergedNpc);
      } else {
        nextNpcs.push(npc);
      }
    } else {
      nextNpcs.push(npc);
    }
  }
  if (changed) {
    setNpcsIfChanged(nextNpcs);
  }
  return changed;
}

function updateBehaviorByIdIfChanged(behaviorId, nextBehavior) {
  const nextBehaviors = [];
  let changed = false;
  for (const behavior of behaviors.value) {
    if (behavior?.id === behaviorId) {
      if (!sameBehaviorSummary(behavior, nextBehavior)) {
        changed = true;
        nextBehaviors.push(nextBehavior);
      } else {
        nextBehaviors.push(behavior);
      }
    } else {
      nextBehaviors.push(behavior);
    }
  }
  if (changed) {
    setBehaviorsIfChanged(nextBehaviors);
  }
  return changed;
}

function appendBehaviorIfChanged(behavior) {
  if (!behavior) return false;
  const nextBehaviors = [];
  const currentBehaviors = Array.isArray(behaviors.value) ? behaviors.value : [];
  for (const currentBehavior of currentBehaviors) {
    nextBehaviors.push(currentBehavior);
  }
  nextBehaviors.push(behavior);
  return setBehaviorsIfChanged(nextBehaviors);
}

function removeBehaviorByIdIfPresent(behaviorId) {
  const nextBehaviors = [];
  let changed = false;
  for (const behavior of behaviors.value) {
    if (behavior?.id === behaviorId) {
      changed = true;
    } else {
      nextBehaviors.push(behavior);
    }
  }
  if (changed) {
    setBehaviorsIfChanged(nextBehaviors);
  }
  return changed;
}

async function loadNpcs(options = {}) {
  if (npcPanelDisposed) return;
  const allowWhileBusy = Boolean(options.allowWhileBusy);
  const conversationId = props.conversationId;
  if (!conversationId) {
    resetNpcState();
    return;
  }
  if (!allowWhileBusy && npcActionBusy.value) return;
  const requestToken = ++npcLoadToken;
  loading.value = true;
  loadError.value = '';
  try {
    const nextNpcs = await fetchConversationNpcs(conversationId);
    if (npcPanelDisposed || requestToken !== npcLoadToken || conversationId !== props.conversationId) return;
    loadError.value = '';
    setNpcsIfChanged(nextNpcs);
    emit('npcs-loaded', { conversationId, npcs: nextNpcs });
    if (selectedNpc.value && !getCurrentNpcByName(selectedNpc.value)) {
      setSelectedNpc('');
    }
    if (!selectedNpc.value && npcs.value.length > 0) {
      setSelectedNpc(npcs.value[0].name);
    }
    if (selectedNpc.value) {
      await loadNpcDetail({ allowWhileBusy });
    } else {
      setMemoriesIfChanged([]);
      setBehaviorsIfChanged([]);
    }
  } catch (err) {
    if (npcPanelDisposed || requestToken !== npcLoadToken || conversationId !== props.conversationId) return;
    loadError.value = err.message || '加载 NPC 列表失败';
    notify.error(loadError.value);
    if (!npcs.value.length) {
      setSelectedNpc('');
      setMemoriesIfChanged([]);
      setBehaviorsIfChanged([]);
      detailError.value = '';
    }
  } finally {
    if (!npcPanelDisposed && requestToken === npcLoadToken && conversationId === props.conversationId) {
      loading.value = false;
    }
  }
}

async function selectNpc(name) {
  if (npcPanelDisposed || npcActionBusy.value) return;
  if (name !== selectedNpc.value) {
    npcMutationToken += 1;
    npcActionBusyId.value = '';
  }
  setSelectedNpc(name);
  setMemoriesIfChanged([]);
  setBehaviorsIfChanged([]);
  detailError.value = '';
  addMemoryOpen.value = false;
  addBehaviorOpen.value = false;
  await loadNpcDetail();
}

async function loadNpcDetail(options = {}) {
  if (npcPanelDisposed) return;
  const allowWhileBusy = Boolean(options.allowWhileBusy);
  const conversationId = props.conversationId;
  const npcName = selectedNpc.value;
  if (!conversationId || !npcName) {
    detailError.value = '';
    setMemoriesIfChanged([]);
    setBehaviorsIfChanged([]);
    return;
  }
  if (!allowWhileBusy && npcActionBusy.value) return;
  const requestToken = ++npcDetailToken;
  detailLoading.value = true;
  detailError.value = '';
  try {
    const [mem, beh] = await Promise.all([
      fetchNpcMemories(conversationId, npcName),
      fetchNpcBehaviors(conversationId, npcName)
    ]);
    if (npcPanelDisposed || requestToken !== npcDetailToken || conversationId !== props.conversationId || npcName !== selectedNpc.value) return;
    detailError.value = '';
    setMemoriesIfChanged(mem);
    setBehaviorsIfChanged(beh);
  } catch (err) {
    if (npcPanelDisposed || requestToken !== npcDetailToken || conversationId !== props.conversationId || npcName !== selectedNpc.value) return;
    detailError.value = err.message || '加载 NPC 详情失败';
    notify.error(detailError.value);
  } finally {
    if (!npcPanelDisposed && requestToken === npcDetailToken && conversationId === props.conversationId && npcName === selectedNpc.value) {
      detailLoading.value = false;
    }
  }
}

async function submitNpcMeta() {
  if (npcPanelDisposed) return;
  const conversationId = props.conversationId;
  const npcName = selectedNpc.value;
  if (!conversationId || !npcName) return;
  const actionId = 'npc-meta-save';
  if (!startNpcAction(actionId)) return;
  const mutationToken = npcMutationToken;
  try {
    const updated = await updateConversationNpc(conversationId, npcName, {
      status: npcMetaForm.status,
      customStatus: npcMetaForm.customStatus.trim(),
      aliases: parseNpcAliasesText(npcMetaForm.aliasesText),
      memorySealed: npcMetaForm.memorySealed
    });
    if (!isCurrentNpcMutation(mutationToken, conversationId, npcName)) return;
    updateNpcByNameIfChanged(npcName, updated);
    syncNpcMetaForm(updated);
    await loadNpcs({ allowWhileBusy: true });
    if (!isCurrentNpcMutation(mutationToken, conversationId, npcName)) return;
    notify.success('NPC 资料已保存');
  } catch (err) {
    if (!isCurrentNpcMutation(mutationToken, conversationId, npcName)) return;
    notify.error(err.message || '保存 NPC 资料失败');
  } finally {
    finishNpcAction(actionId, mutationToken, conversationId, npcName);
  }
}

async function submitMemory() {
  if (npcPanelDisposed) return;
  if (!memoryForm.content.trim()) {
    notify.warning('请输入记忆内容');
    return;
  }
  const conversationId = props.conversationId;
  const npcName = selectedNpc.value;
  if (!conversationId || !npcName) return;
  const actionId = 'memory-create';
  if (!startNpcAction(actionId)) return;
  const mutationToken = npcMutationToken;
  try {
    const mem = await addNpcMemory(conversationId, npcName, {
      memoryType: memoryForm.memoryType,
      content: memoryForm.content.trim()
    });
    if (!isCurrentNpcMutation(mutationToken, conversationId, npcName)) return;
    prependMemoryIfChanged(mem);
    memoryForm.content = '';
    addMemoryOpen.value = false;
    await loadNpcs({ allowWhileBusy: true });
    if (!isCurrentNpcMutation(mutationToken, conversationId, npcName)) return;
    notify.success('记忆已添加');
  } catch (err) {
    if (!isCurrentNpcMutation(mutationToken, conversationId, npcName)) return;
    notify.error(err.message || '添加记忆失败');
  } finally {
    finishNpcAction(actionId, mutationToken, conversationId, npcName);
  }
}

async function removeMemory(memoryId) {
  if (npcPanelDisposed) return;
  const conversationId = props.conversationId;
  const npcName = selectedNpc.value;
  const currentMemory = getCurrentMemory(memoryId);
  if (!conversationId || !npcName || !currentMemory) return;
  const actionId = memoryActionId(currentMemory.id);
  if (!startNpcAction(actionId)) return;
  const mutationToken = npcMutationToken;
  try {
    await deleteNpcMemory(conversationId, npcName, currentMemory.id);
    if (!isCurrentNpcMutation(mutationToken, conversationId, npcName)) return;
    removeMemoryByIdIfPresent(currentMemory.id);
    await loadNpcs({ allowWhileBusy: true });
    if (!isCurrentNpcMutation(mutationToken, conversationId, npcName)) return;
    notify.success('记忆已删除');
  } catch (err) {
    if (!isCurrentNpcMutation(mutationToken, conversationId, npcName)) return;
    notify.error(err.message || '删除记忆失败');
  } finally {
    finishNpcAction(actionId, mutationToken, conversationId, npcName);
  }
}

async function submitBehavior() {
  if (npcPanelDisposed) return;
  if (!behaviorForm.action.trim()) {
    notify.warning('请输入行为动作');
    return;
  }
  const conversationId = props.conversationId;
  const npcName = selectedNpc.value;
  if (!conversationId || !npcName) return;
  const actionId = 'behavior-create';
  if (!startNpcAction(actionId)) return;
  const mutationToken = npcMutationToken;
  try {
    const beh = await addNpcBehavior(conversationId, npcName, {
      behaviorType: behaviorForm.behaviorType,
      triggerCondition: behaviorForm.triggerCondition.trim(),
      action: behaviorForm.action.trim(),
      priority: behaviorForm.priority,
      enabled: behaviorForm.enabled
    });
    if (!isCurrentNpcMutation(mutationToken, conversationId, npcName)) return;
    appendBehaviorIfChanged(beh);
    behaviorForm.triggerCondition = '';
    behaviorForm.action = '';
    behaviorForm.priority = 0;
    addBehaviorOpen.value = false;
    await loadNpcs({ allowWhileBusy: true });
    if (!isCurrentNpcMutation(mutationToken, conversationId, npcName)) return;
    notify.success('行为规则已添加');
  } catch (err) {
    if (!isCurrentNpcMutation(mutationToken, conversationId, npcName)) return;
    notify.error(err.message || '添加行为规则失败');
  } finally {
    finishNpcAction(actionId, mutationToken, conversationId, npcName);
  }
}

async function toggleBehavior(behavior) {
  if (npcPanelDisposed) return;
  const conversationId = props.conversationId;
  const npcName = selectedNpc.value;
  const currentBehavior = getCurrentBehavior(behavior?.id);
  if (!conversationId || !npcName || !currentBehavior) return;
  const behaviorId = currentBehavior.id;
  const actionId = behaviorToggleActionId(behaviorId);
  if (!startNpcAction(actionId)) return;
  const mutationToken = npcMutationToken;
  try {
    const updated = await updateNpcBehavior(conversationId, npcName, behaviorId, {
      enabled: !currentBehavior.enabled
    });
    if (!isCurrentNpcMutation(mutationToken, conversationId, npcName)) return;
    if (!getCurrentBehavior(behaviorId)) return;
    updateBehaviorByIdIfChanged(behaviorId, updated);
  } catch (err) {
    if (!isCurrentNpcMutation(mutationToken, conversationId, npcName)) return;
    notify.error(err.message || '更新失败');
  } finally {
    finishNpcAction(actionId, mutationToken, conversationId, npcName);
  }
}

async function removeBehavior(behaviorId) {
  if (npcPanelDisposed) return;
  const conversationId = props.conversationId;
  const npcName = selectedNpc.value;
  const currentBehavior = getCurrentBehavior(behaviorId);
  if (!conversationId || !npcName || !currentBehavior) return;
  const actionId = behaviorDeleteActionId(currentBehavior.id);
  if (!startNpcAction(actionId)) return;
  const mutationToken = npcMutationToken;
  try {
    await deleteNpcBehavior(conversationId, npcName, currentBehavior.id);
    if (!isCurrentNpcMutation(mutationToken, conversationId, npcName)) return;
    removeBehaviorByIdIfPresent(currentBehavior.id);
    await loadNpcs({ allowWhileBusy: true });
    if (!isCurrentNpcMutation(mutationToken, conversationId, npcName)) return;
    notify.success('行为规则已删除');
  } catch (err) {
    if (!isCurrentNpcMutation(mutationToken, conversationId, npcName)) return;
    notify.error(err.message || '删除行为规则失败');
  } finally {
    finishNpcAction(actionId, mutationToken, conversationId, npcName);
  }
}

async function removeSelectedNpc() {
  if (npcPanelDisposed) return;
  if (!selectedNpc.value) return;
  const conversationId = props.conversationId;
  const npcName = selectedNpc.value;
  if (!conversationId) return;
  if (!window.confirm(`从 NPC 列表移除“${npcName}”？已有记忆和行为不会被删除。`)) {
    return;
  }
  const actionId = 'npc-remove-selected';
  if (!startNpcAction(actionId)) return;
  const mutationToken = npcMutationToken;
  try {
    await hideConversationNpc(conversationId, npcName);
    if (!isCurrentNpcMutation(mutationToken, conversationId, npcName)) return;
    setSelectedNpc('');
    setMemoriesIfChanged([]);
    setBehaviorsIfChanged([]);
    await loadNpcs({ allowWhileBusy: true });
    if (!isCurrentNpcMutation(mutationToken, conversationId)) return;
    notify.success('NPC 已从列表移除');
  } catch (err) {
    if (!isCurrentNpcMutation(mutationToken, conversationId, npcName)) return;
    notify.error(err.message || '移除 NPC 失败');
  } finally {
    finishNpcAction(actionId, mutationToken, conversationId);
  }
}

async function removeEmptyNpcs() {
  if (npcPanelDisposed) return;
  const conversationId = props.conversationId;
  const names = emptyNpcNames.value;
  if (!conversationId || !names.length) return;
  const preview = names.slice(0, 5).join('、');
  const suffix = names.length > 5 ? `等 ${names.length} 个` : `${names.length} 个`;
  if (!window.confirm(`从 NPC 列表移除 ${suffix}没有记忆和行为的 NPC？\n${preview}\n已有记忆和行为不会被删除。`)) {
    return;
  }
  const actionId = 'npc-remove-empty';
  if (!startNpcAction(actionId)) return;
  const mutationToken = npcMutationToken;
  try {
    const result = await hideEmptyConversationNpcs(conversationId);
    if (!isCurrentNpcMutation(mutationToken, conversationId)) return;
    if (names.includes(selectedNpc.value)) {
      setSelectedNpc('');
      setMemoriesIfChanged([]);
      setBehaviorsIfChanged([]);
    }
    await loadNpcs({ allowWhileBusy: true });
    if (!isCurrentNpcMutation(mutationToken, conversationId)) return;
    notify.success(`已移除 ${result?.count ?? names.length} 个空 NPC`);
  } catch (err) {
    if (!isCurrentNpcMutation(mutationToken, conversationId)) return;
    notify.error(err.message || '批量移除空 NPC 失败');
  } finally {
    finishNpcAction(actionId, mutationToken, conversationId);
  }
}

function memoryTypeLabel(type) {
  return memoryTypeOptions.find((o) => o.value === type)?.label || type;
}

function behaviorTypeLabel(type) {
  return behaviorTypeOptions.find((o) => o.value === type)?.label || type;
}

function npcStatusLabel(npc) {
  const status = npc?.status || 'active';
  if (status === 'custom') {
    return npc?.customStatus || '自定义';
  }
  return npcStatusOptions.find((o) => o.value === status)?.label || status;
}

function shouldShowNpcStatus(npc) {
  return Boolean(npc && npcStatusLabel(npc) && (npc.status || 'active') !== 'active');
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="npc-panel-overlay" @click.self="requestClose" @pointerdown.self="requestClose">
      <aside class="npc-panel" role="dialog" aria-label="NPC 管理面板">
          <header class="npc-panel-header">
            <div class="npc-panel-title">
              <Users :size="20" />
              <h2>NPC 管理</h2>
              <span
                class="npc-update-badge"
                :class="`is-${updateStatusMeta.key}`"
                role="status"
                aria-live="polite"
              >
                <span class="npc-update-dot" aria-hidden="true"></span>
                <span>{{ updateStatusMeta.label }}</span>
              </span>
            </div>
            <button
              class="npc-close"
              type="button"
              aria-label="关闭 NPC 管理面板"
              @pointerdown.stop
              @click.stop="requestClose"
            >
              <X :size="18" />
            </button>
          </header>

          <section class="npc-panel-summary" aria-label="NPC 记忆概览">
            <div class="npc-summary-card">
              <span>NPC</span>
              <strong>{{ npcPanelStats.npcCount }}</strong>
            </div>
            <div class="npc-summary-card memory">
              <span>记忆</span>
              <strong>{{ npcPanelStats.memoryCount }}</strong>
            </div>
            <div class="npc-summary-card behavior">
              <span>行为</span>
              <strong>{{ npcPanelStats.behaviorCount }}</strong>
            </div>
          </section>

          <div class="npc-panel-body">
            <!-- NPC List -->
            <div class="npc-list-section">
              <div class="npc-list-header">
                <span>NPC 列表</span>
                <div class="npc-list-actions">
                  <button
                    class="npc-empty-remove"
                    type="button"
                    :disabled="!emptyNpcNames.length || loading || npcActionBusy"
                    :aria-busy="isNpcActionBusy('npc-remove-empty')"
                    title="移除没有记忆和行为的 NPC"
                    @click="removeEmptyNpcs"
                  >
                    清理空项
                  </button>
                  <button
                    class="npc-refresh"
                    type="button"
                    title="刷新"
                    aria-label="刷新 NPC 列表"
                    :disabled="loading || npcActionBusy"
                    :aria-busy="loading"
                    @click="loadNpcs"
                  >
                    <RefreshCw :size="15" />
                  </button>
                </div>
              </div>
              <div v-if="loading" class="npc-empty">加载中...</div>
              <div v-else-if="loadError && !npcs.length" class="npc-empty npc-error-state">
                <p>{{ loadError }}</p>
                <button class="npc-retry-button" type="button" :disabled="loading || npcActionBusy" @click="loadNpcs">
                  <RefreshCw :size="14" />
                  <span>重试</span>
                </button>
              </div>
              <template v-else>
                <div v-if="loadError" class="npc-inline-error">
                  <span>{{ loadError }}</span>
                  <button class="npc-retry-button" type="button" :disabled="loading || npcActionBusy" @click="loadNpcs">
                    <RefreshCw :size="14" />
                    <span>重试</span>
                  </button>
                </div>
                <div v-if="!npcs.length" class="npc-empty">
                  暂无 NPC。AI 回复中出现的角色会自动识别。
                </div>
                <div v-else class="npc-list">
                  <button
                    v-for="npc in npcs"
                    :key="npc.name"
                    class="npc-item"
                    :class="{ active: npc.name === selectedNpc }"
                    type="button"
                    :disabled="npcActionBusy"
                    @click="selectNpc(npc.name)"
                  >
                    <span class="npc-item-main">
                      <span class="npc-item-name">{{ npc.name }}</span>
                      <span v-if="shouldShowNpcStatus(npc)" class="npc-status-pill">{{ npcStatusLabel(npc) }}</span>
                    </span>
                    <span class="npc-item-counts">
                      <span title="记忆数" class="npc-badge">🧠 {{ npc.memoryCount }}</span>
                      <span title="行为规则数" class="npc-badge">⚡ {{ npc.behaviorCount }}</span>
                      <span v-if="npc.memorySealActive" title="记忆已封存" class="npc-badge">封存</span>
                    </span>
                  </button>
                </div>
              </template>
            </div>

            <!-- NPC Detail -->
            <div v-if="selectedNpc" class="npc-detail-section">
              <div class="npc-detail-header">
                <h3>{{ selectedNpc }}</h3>
                <div class="npc-detail-metrics">
                  <span v-if="selectedNpcData">{{ npcStatusLabel(selectedNpcData) }}</span>
                  <span v-if="selectedNpcStats.aliasCount">{{ selectedNpcStats.aliasCount }} 个别名</span>
                  <span v-if="selectedNpcMemorySealActive">记忆封存</span>
                  <span>{{ selectedNpcStats.memoryCount }} 记忆</span>
                  <span>{{ selectedNpcStats.behaviorCount }} 行为</span>
                  <button
                    class="npc-detail-remove"
                    type="button"
                    title="从列表移除"
                    :disabled="npcActionBusy"
                    :aria-busy="isNpcActionBusy('npc-remove-selected')"
                    @click="removeSelectedNpc"
                  >
                    <Trash2 :size="13" />
                    <span>移除</span>
                  </button>
                </div>
              </div>

              <div class="npc-tabs">
                <button
                  class="npc-tab"
                  :class="{ active: detailTab === 'profile' }"
                  type="button"
                  @click="detailTab = 'profile'"
                >
                  <SlidersHorizontal :size="15" />
                  <span>资料</span>
                </button>
                <button
                  class="npc-tab"
                  :class="{ active: detailTab === 'memories' }"
                  type="button"
                  @click="detailTab = 'memories'"
                >
                  <Brain :size="15" />
                  <span>记忆 ({{ memories.length }})</span>
                </button>
                <button
                  class="npc-tab"
                  :class="{ active: detailTab === 'behaviors' }"
                  type="button"
                  @click="detailTab = 'behaviors'"
                >
                  <Zap :size="15" />
                  <span>行为 ({{ behaviors.length }})</span>
                </button>
              </div>

              <div v-if="detailLoading" class="npc-empty">加载中...</div>
              <div v-else-if="detailError" class="npc-empty npc-error-state">
                <p>{{ detailError }}</p>
                <button class="npc-retry-button" type="button" :disabled="detailLoading || npcActionBusy" @click="loadNpcDetail">
                  <RefreshCw :size="14" />
                  <span>重试</span>
                </button>
              </div>

              <!-- Profile Tab -->
              <template v-else-if="detailTab === 'profile'">
                <div class="npc-form npc-meta-form">
                  <label class="npc-field-label">
                    <span>状态</span>
                    <select v-model="npcMetaForm.status" class="npc-select" aria-label="NPC 状态" :disabled="npcActionBusy">
                      <option v-for="opt in npcStatusOptions" :key="opt.value" :value="opt.value">
                        {{ opt.label }}
                      </option>
                    </select>
                  </label>
                  <label v-if="npcMetaForm.status === 'custom'" class="npc-field-label">
                    <span>自定义状态</span>
                    <input
                      v-model="npcMetaForm.customStatus"
                      class="npc-input"
                      maxlength="80"
                      placeholder="例如：潜伏、被囚禁、养伤"
                      aria-label="NPC 自定义状态"
                      :disabled="npcActionBusy"
                    />
                  </label>
                  <label class="npc-field-label">
                    <span>别名</span>
                    <textarea
                      v-model="npcMetaForm.aliasesText"
                      class="npc-textarea"
                      rows="3"
                      placeholder="每行一个精确别名"
                      aria-label="NPC 别名"
                      :disabled="npcActionBusy"
                    />
                  </label>
                  <label class="npc-seal-toggle">
                    <input
                      v-model="npcMetaForm.memorySealed"
                      class="npc-seal-input"
                      type="checkbox"
                      aria-label="记忆封存"
                      :disabled="npcActionBusy"
                    />
                    <span class="npc-seal-control" aria-hidden="true"></span>
                    <span class="npc-seal-copy">
                      <strong>记忆封存</strong>
                      <small>状态为死亡或永久离开时，主回复不读取该 NPC 记忆</small>
                    </span>
                  </label>
                  <p v-if="selectedNpcMemorySealActive" class="npc-meta-note">
                    已封存的记忆不会删除；状态恢复后会再次参与主回复上下文。
                  </p>
                  <div class="npc-form-actions">
                    <button
                      class="npc-save"
                      type="button"
                      :disabled="npcActionBusy"
                      :aria-busy="isNpcActionBusy('npc-meta-save')"
                      @click="submitNpcMeta"
                    >
                      保存
                    </button>
                  </div>
                </div>
              </template>

              <!-- Memories Tab -->
              <template v-else-if="detailTab === 'memories'">
                <button
                  v-if="!addMemoryOpen"
                  class="npc-add-button"
                  type="button"
                  :disabled="npcActionBusy"
                  @click="addMemoryOpen = true"
                >
                  <Plus :size="15" />
                  <span>添加记忆</span>
                </button>
                <div v-if="addMemoryOpen" class="npc-form">
                  <select v-model="memoryForm.memoryType" class="npc-select" aria-label="记忆类型" :disabled="npcActionBusy">
                    <option v-for="opt in memoryTypeOptions" :key="opt.value" :value="opt.value">
                      {{ opt.label }}
                    </option>
                  </select>
                  <textarea
                    v-model="memoryForm.content"
                    class="npc-textarea"
                    rows="3"
                    placeholder="输入 NPC 记忆内容..."
                    aria-label="NPC 记忆内容"
                    :disabled="npcActionBusy"
                  />
                  <div class="npc-form-actions">
                    <button
                      class="npc-save"
                      type="button"
                      :disabled="npcActionBusy"
                      :aria-busy="isNpcActionBusy('memory-create')"
                      @click="submitMemory"
                    >
                      保存
                    </button>
                    <button class="npc-cancel" type="button" :disabled="npcActionBusy" @click="addMemoryOpen = false">取消</button>
                  </div>
                </div>
                <div v-if="!memories.length && !addMemoryOpen" class="npc-empty">
                  暂无记忆
                </div>
                <div v-else class="npc-list">
                  <div v-for="mem in memories" :key="mem.id" class="npc-card npc-memory-card">
                    <div class="npc-card-header">
                      <span class="npc-card-type">{{ memoryTypeLabel(mem.memoryType) }}</span>
                      <span class="npc-card-time">{{ formatTime(mem.createdAt) }}</span>
                      <button
                        class="npc-card-delete"
                        type="button"
                        title="删除"
                        aria-label="删除记忆"
                        :disabled="npcActionBusy"
                        :aria-busy="isNpcActionBusy(memoryActionId(mem.id))"
                        @click="removeMemory(mem.id)"
                      >
                        <Trash2 :size="14" />
                      </button>
                    </div>
                    <p class="npc-card-content">{{ mem.content }}</p>
                  </div>
                </div>
              </template>

              <!-- Behaviors Tab -->
              <template v-else-if="detailTab === 'behaviors'">
                <button
                  v-if="!addBehaviorOpen"
                  class="npc-add-button"
                  type="button"
                  :disabled="npcActionBusy"
                  @click="addBehaviorOpen = true"
                >
                  <Plus :size="15" />
                  <span>添加行为规则</span>
                </button>
                <div v-if="addBehaviorOpen" class="npc-form">
                  <select v-model="behaviorForm.behaviorType" class="npc-select" aria-label="行为类型" :disabled="npcActionBusy">
                    <option v-for="opt in behaviorTypeOptions" :key="opt.value" :value="opt.value">
                      {{ opt.label }}
                    </option>
                  </select>
                  <input
                    v-model="behaviorForm.triggerCondition"
                    class="npc-input"
                    placeholder="触发条件（可选）"
                    aria-label="行为触发条件"
                    :disabled="npcActionBusy"
                  />
                  <textarea
                    v-model="behaviorForm.action"
                    class="npc-textarea"
                    rows="3"
                    placeholder="行为动作描述..."
                    aria-label="行为动作描述"
                    :disabled="npcActionBusy"
                  />
                  <label class="npc-priority-label">
                    优先级
                    <input
                      v-model.number="behaviorForm.priority"
                      type="range"
                      min="0"
                      max="100"
                      class="npc-range"
                      :disabled="npcActionBusy"
                    />
                    <span>{{ behaviorForm.priority }}</span>
                  </label>
                  <label class="npc-checkbox-label">
                    <input v-model="behaviorForm.enabled" type="checkbox" :disabled="npcActionBusy" />
                    <span>启用</span>
                  </label>
                  <div class="npc-form-actions">
                    <button
                      class="npc-save"
                      type="button"
                      :disabled="npcActionBusy"
                      :aria-busy="isNpcActionBusy('behavior-create')"
                      @click="submitBehavior"
                    >
                      保存
                    </button>
                    <button class="npc-cancel" type="button" :disabled="npcActionBusy" @click="addBehaviorOpen = false">取消</button>
                  </div>
                </div>
                <div v-if="!behaviors.length && !addBehaviorOpen" class="npc-empty">
                  暂无行为规则
                </div>
                <div v-else class="npc-list">
                  <div
                    v-for="beh in behaviors"
                    :key="beh.id"
                    class="npc-card"
                    :class="{ disabled: !beh.enabled }"
                  >
                    <div class="npc-card-header">
                      <span class="npc-card-type">{{ behaviorTypeLabel(beh.behaviorType) }}</span>
                      <span class="npc-card-priority" title="优先级">P{{ beh.priority }}</span>
                      <button
                        class="npc-card-toggle"
                        type="button"
                        :title="beh.enabled ? '点击禁用' : '点击启用'"
                        :aria-label="beh.enabled ? '禁用行为规则' : '启用行为规则'"
                        :disabled="npcActionBusy"
                        :aria-busy="isNpcActionBusy(behaviorToggleActionId(beh.id))"
                        @click="toggleBehavior(beh)"
                      >
                        {{ beh.enabled ? '✓' : '✗' }}
                      </button>
                      <button
                        class="npc-card-delete"
                        type="button"
                        title="删除"
                        aria-label="删除行为规则"
                        :disabled="npcActionBusy"
                        :aria-busy="isNpcActionBusy(behaviorDeleteActionId(beh.id))"
                        @click="removeBehavior(beh.id)"
                      >
                        <Trash2 :size="14" />
                      </button>
                    </div>
                    <p v-if="beh.triggerCondition" class="npc-card-trigger">
                      触发：{{ beh.triggerCondition }}
                    </p>
                    <p class="npc-card-content">{{ beh.action }}</p>
                  </div>
                </div>
              </template>
            </div>

            <div v-else-if="!loading && npcs.length" class="npc-empty npc-select-hint">
              ← 点击左侧 NPC 查看详情
            </div>
          </div>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.npc-panel-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
  background: color-mix(in srgb, #0c0b0a 46%, transparent);
  backdrop-filter: blur(3px);
}

.npc-panel {
  width: min(520px, 94vw);
  height: 100%;
  transform: none !important;
  border-left: 1px solid color-mix(in srgb, var(--line, #2a2a3e) 78%, transparent);
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--surface, #1a1a2e) 96%, transparent),
      color-mix(in srgb, var(--bg, #11111f) 82%, transparent));
  color: var(--text, #e8e6e3);
  display: flex;
  flex-direction: column;
  box-shadow: -18px 0 52px rgba(0, 0, 0, 0.26);
}

.npc-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--line, #2a2a3e) 70%, transparent);
  background: color-mix(in srgb, var(--surface, #1a1a2e) 86%, transparent);
  backdrop-filter: blur(14px);
}

.npc-panel-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.npc-panel-title h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
}

.npc-update-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 24px;
  padding: 0 9px;
  border: 1px solid color-mix(in srgb, var(--text-muted, #888) 24%, transparent);
  border-radius: 999px;
  color: var(--text-muted, #888);
  background: color-mix(in srgb, var(--text-muted, #888) 8%, transparent);
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
  white-space: nowrap;
}

.npc-update-badge.is-updating {
  border-color: color-mix(in srgb, #d97706 36%, transparent);
  color: #d97706;
  background: color-mix(in srgb, #f59e0b 13%, transparent);
}

.npc-update-badge.is-updated {
  border-color: color-mix(in srgb, #16a34a 32%, transparent);
  color: #16a34a;
  background: color-mix(in srgb, #22c55e 12%, transparent);
}

.npc-update-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.75;
}

.npc-update-badge.is-updating .npc-update-dot {
  animation: npcUpdatePulse 1s ease-in-out infinite;
}

.npc-close {
  background: none;
  border: none;
  color: var(--text-muted, #888);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: flex;
  align-items: center;
}
.npc-close:hover {
  background: var(--hover, rgba(255,255,255,0.08));
  color: var(--text, #e8e6e3);
}

@keyframes npcUpdatePulse {
  0%, 100% {
    opacity: 0.45;
    transform: scale(0.82);
  }
  50% {
    opacity: 1;
    transform: scale(1.15);
  }
}

.npc-panel-body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  scrollbar-gutter: stable;
}

.npc-panel-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--line, #2a2a3e) 64%, transparent);
  background: color-mix(in srgb, var(--surface, #1a1a2e) 78%, transparent);
}

.npc-summary-card {
  display: grid;
  gap: 3px;
  padding: 10px;
  border: 1px solid color-mix(in srgb, var(--line, #2a2a3e) 72%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface, #1a1a2e) 70%, transparent);
}

.npc-summary-card span {
  color: var(--text-muted, #888);
  font-size: 12px;
  font-weight: 700;
}

.npc-summary-card strong {
  color: var(--text, #e8e6e3);
  font-size: 20px;
  line-height: 1;
}

.npc-summary-card.memory strong {
  color: #8f6ee8;
}

.npc-summary-card.behavior strong {
  color: #2f9f7b;
}

.npc-list-section {
  border-bottom: 1px solid color-mix(in srgb, var(--line, #2a2a3e) 64%, transparent);
  max-height: 240px;
  overflow-y: auto;
}

.npc-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px 6px;
  font-size: 13px;
  color: var(--text-muted, #888);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.npc-list-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.npc-empty-remove {
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, #ef4444 28%, var(--line, #2a2a3e));
  border-radius: 8px;
  color: #ef4444;
  background: color-mix(in srgb, #ef4444 7%, transparent);
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.npc-empty-remove:hover:not(:disabled) {
  background: color-mix(in srgb, #ef4444 13%, transparent);
}

.npc-empty-remove:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.npc-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid color-mix(in srgb, var(--line, #2a2a3e) 72%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface, #1a1a2e) 70%, transparent);
  color: var(--text-muted, #888);
  cursor: pointer;
}
.npc-refresh:hover:not(:disabled) {
  background: var(--hover, rgba(255,255,255,0.08));
  color: var(--accent, #818cf8);
}

.npc-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 12px 10px;
}

.npc-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface, #1a1a2e) 50%, transparent);
  color: var(--text, #e8e6e3);
  cursor: pointer;
  text-align: left;
  font-size: 14px;
  transition: background 0.15s;
}
.npc-item:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent, #818cf8) 26%, transparent);
  background: var(--hover, rgba(255,255,255,0.06));
}
.npc-item.active {
  border-color: color-mix(in srgb, var(--accent, #818cf8) 38%, transparent);
  background: var(--accent-bg, rgba(99, 102, 241, 0.15));
  color: var(--accent, #818cf8);
}

.npc-item-name {
  font-weight: 500;
}

.npc-item-main {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.npc-status-pill {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 6px;
  border: 1px solid color-mix(in srgb, var(--green, #2f6d5a) 34%, transparent);
  border-radius: 999px;
  color: var(--green, #2f6d5a);
  background: color-mix(in srgb, var(--green, #2f6d5a) 10%, transparent);
  font-size: 10px;
  font-weight: 800;
}

.npc-item-counts {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.npc-badge {
  font-size: 12px;
  opacity: 0.7;
}

.npc-detail-section {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.npc-detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 20px 4px;
}

.npc-detail-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
}

.npc-detail-metrics {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.npc-detail-metrics span {
  padding: 2px 7px;
  border: 1px solid color-mix(in srgb, var(--line, #2a2a3e) 70%, transparent);
  border-radius: 999px;
  color: var(--text-muted, #888);
  background: color-mix(in srgb, var(--surface, #1a1a2e) 62%, transparent);
  font-size: 11px;
  font-weight: 700;
}

.npc-detail-remove {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 24px;
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, #ef4444 32%, var(--line, #2a2a3e));
  border-radius: 999px;
  color: #ef4444;
  background: color-mix(in srgb, #ef4444 8%, transparent);
  font: inherit;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
}

.npc-detail-remove:hover:not(:disabled) {
  background: color-mix(in srgb, #ef4444 14%, transparent);
}

.npc-tabs {
  display: flex;
  gap: 8px;
  padding: 10px 20px;
  border-bottom: 1px solid color-mix(in srgb, var(--line, #2a2a3e) 64%, transparent);
}

.npc-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: none;
  border: none;
  border-radius: 8px;
  color: var(--text-muted, #888);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s;
}
.npc-tab:hover {
  background: var(--hover, rgba(255,255,255,0.06));
}
.npc-tab.active {
  background: var(--accent-bg, rgba(99, 102, 241, 0.15));
  color: var(--accent, #818cf8);
}

.npc-add-button {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 12px 20px;
  padding: 8px 14px;
  background: var(--accent-bg, rgba(99, 102, 241, 0.12));
  border: 1px dashed color-mix(in srgb, var(--accent, #818cf8) 70%, transparent);
  border-radius: 10px;
  color: var(--accent, #818cf8);
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
}
.npc-add-button:hover:not(:disabled) {
  background: var(--accent-bg-hover, rgba(99, 102, 241, 0.2));
}

.npc-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 12px 20px;
  padding: 14px;
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--surface, #fbfaf6) 94%, var(--surface-strong, #edf5ef)),
      color-mix(in srgb, var(--surface, #fbfaf6) 82%, transparent));
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--line, rgba(44, 57, 48, 0.14)) 78%, transparent);
  box-shadow: 0 10px 24px color-mix(in srgb, var(--text, #20241f) 10%, transparent);
}

.npc-select,
.npc-input,
.npc-textarea {
  width: 100%;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--surface, #fbfaf6) 92%, transparent);
  border: 1px solid color-mix(in srgb, var(--line, rgba(44, 57, 48, 0.14)) 92%, transparent);
  border-radius: 6px;
  color: var(--text, #20241f);
  font-size: 13px;
  font-family: inherit;
  box-sizing: border-box;
}
.npc-input::placeholder,
.npc-textarea::placeholder {
  color: color-mix(in srgb, var(--muted, #657064) 72%, transparent);
}
.npc-textarea {
  resize: vertical;
  min-height: 60px;
}
.npc-input:focus,
.npc-textarea:focus,
.npc-select:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--primary, #8d4a43) 55%, var(--line, rgba(44, 57, 48, 0.14)));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary, #8d4a43) 14%, transparent);
}

.npc-priority-label {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text-muted, #888);
}
.npc-range {
  flex: 1;
  accent-color: var(--accent, #818cf8);
}

.npc-checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-muted, #888);
  cursor: pointer;
}
.npc-checkbox-label input {
  accent-color: var(--accent, #818cf8);
}

.npc-field-label {
  display: grid;
  gap: 6px;
  color: var(--muted, #657064);
  font-size: 12px;
  font-weight: 800;
}

.npc-meta-form {
  gap: 12px;
}

.npc-meta-note {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--green, #2f6d5a) 24%, var(--line, rgba(44, 57, 48, 0.14)));
  border-radius: 8px;
  color: var(--muted, #657064);
  background: color-mix(in srgb, var(--green, #2f6d5a) 8%, var(--surface, #fbfaf6));
  font-size: 12px;
  line-height: 1.45;
}

.npc-seal-toggle {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--line, rgba(44, 57, 48, 0.14)) 82%, transparent);
  border-radius: 8px;
  color: var(--text, #20241f);
  background: color-mix(in srgb, var(--surface, #fbfaf6) 72%, var(--surface-strong, #edf5ef));
  cursor: pointer;
  line-height: 1.35;
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    box-shadow 0.16s ease;
}

.npc-seal-toggle:hover {
  border-color: color-mix(in srgb, var(--primary, #8d4a43) 34%, var(--line, rgba(44, 57, 48, 0.14)));
}

.npc-seal-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.npc-seal-control {
  position: relative;
  width: 44px;
  height: 24px;
  border: 1px solid color-mix(in srgb, var(--line, rgba(44, 57, 48, 0.14)) 92%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--muted, #657064) 18%, var(--surface, #fbfaf6));
  box-shadow: inset 0 1px 2px color-mix(in srgb, var(--text, #20241f) 10%, transparent);
  transition:
    border-color 0.16s ease,
    background 0.16s ease;
}

.npc-seal-control::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--surface, #fbfaf6);
  box-shadow: 0 2px 6px color-mix(in srgb, var(--text, #20241f) 22%, transparent);
  transition:
    background 0.16s ease,
    transform 0.16s ease;
}

.npc-seal-input:checked + .npc-seal-control {
  border-color: color-mix(in srgb, var(--primary, #8d4a43) 70%, var(--line, rgba(44, 57, 48, 0.14)));
  background: color-mix(in srgb, var(--primary, #8d4a43) 78%, var(--green, #2f6d5a));
}

.npc-seal-input:checked + .npc-seal-control::after {
  transform: translateX(20px);
  background: #fffaf2;
}

.npc-seal-input:focus-visible + .npc-seal-control {
  outline: 2px solid color-mix(in srgb, var(--primary, #8d4a43) 40%, transparent);
  outline-offset: 2px;
}

.npc-seal-input:disabled + .npc-seal-control,
.npc-seal-input:disabled ~ .npc-seal-copy {
  opacity: 0.62;
}

.npc-seal-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.npc-seal-copy strong {
  color: var(--text, #20241f);
  font-size: 13px;
  font-weight: 800;
}

.npc-seal-copy small {
  color: var(--muted, #657064);
  font-size: 12px;
}

.npc-form-actions {
  display: flex;
  gap: 8px;
}

.npc-save,
.npc-cancel {
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
}
.npc-save {
  background: var(--accent, #818cf8);
  color: #fff;
}
.npc-save:hover:not(:disabled) {
  opacity: 0.9;
}
.npc-cancel {
  background: var(--hover, rgba(255,255,255,0.08));
  color: var(--text-muted, #888);
}
.npc-cancel:hover:not(:disabled) {
  background: var(--hover-strong, rgba(255,255,255,0.12));
}

.npc-empty {
  padding: 20px;
  text-align: center;
  color: var(--text-muted, #666);
  font-size: 13px;
}

.npc-error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
  color: #ef4444;
}

.npc-error-state p {
  margin: 0;
  color: var(--text, #e8e6e3);
}

.npc-inline-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 0 12px 10px;
  padding: 9px 10px;
  border: 1px solid color-mix(in srgb, #ef4444 26%, var(--line, #2a2a3e));
  border-radius: 9px;
  color: var(--text, #e8e6e3);
  background: color-mix(in srgb, #ef4444 9%, transparent);
  font-size: 12px;
  font-weight: 700;
}

.npc-inline-error span {
  min-width: 0;
}

.npc-retry-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--accent, #818cf8) 34%, var(--line, #2a2a3e));
  border-radius: 8px;
  color: var(--accent, #818cf8);
  background: color-mix(in srgb, var(--accent, #818cf8) 12%, transparent);
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  white-space: nowrap;
}

.npc-retry-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent, #818cf8) 18%, transparent);
}

.npc-select-hint {
  padding-top: 40px;
}

.npc-card {
  position: relative;
  overflow: hidden;
  padding: 12px 14px;
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--surface, #fbfaf6) 96%, rgba(255, 255, 255, 0.72)),
      color-mix(in srgb, var(--surface, #fbfaf6) 86%, var(--surface-strong, #edf5ef))),
    var(--surface, #fbfaf6);
  border: 1px solid color-mix(in srgb, var(--line, rgba(44, 57, 48, 0.14)) 82%, transparent);
  border-radius: 8px;
  box-shadow:
    0 10px 24px color-mix(in srgb, var(--text, #20241f) 9%, transparent),
    inset 0 1px 0 color-mix(in srgb, #ffffff 56%, transparent);
}

.npc-memory-card {
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--surface, #fbfaf6) 98%, rgba(255, 255, 255, 0.78)),
      color-mix(in srgb, var(--surface, #fbfaf6) 92%, var(--surface-strong, #edf5ef))),
    var(--surface, #fbfaf6);
}
.npc-card.disabled {
  opacity: 0.5;
}

.npc-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.npc-card-type {
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--primary, #8d4a43) 24%, var(--line, rgba(44, 57, 48, 0.14)));
  border-radius: 999px;
  color: var(--primary-strong, #713932);
  background: color-mix(in srgb, var(--primary-soft, #efe1dc) 74%, var(--surface, #fbfaf6));
  font-weight: 800;
}

.npc-card-time {
  font-size: 11px;
  color: var(--muted, #657064);
  margin-left: auto;
}

.npc-card-priority {
  font-size: 11px;
  color: var(--muted, #657064);
  margin-left: auto;
}

.npc-card-toggle,
.npc-card-delete {
  background: none;
  border: none;
  color: color-mix(in srgb, var(--muted, #657064) 72%, transparent);
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
  display: flex;
  align-items: center;
}
.npc-refresh:disabled,
.npc-retry-button:disabled,
.npc-item:disabled,
.npc-detail-remove:disabled,
.npc-add-button:disabled,
.npc-save:disabled,
.npc-cancel:disabled,
.npc-card-toggle:disabled,
.npc-card-delete:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}
.npc-card-toggle:hover:not(:disabled) {
  color: var(--accent, #818cf8);
}
.npc-card-delete:hover:not(:disabled) {
  color: #ef4444;
}

.npc-card-trigger {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--muted, #657064);
}

.npc-card-content {
  margin: 0;
  color: var(--text, #20241f);
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

:root[data-theme="dark"] .npc-card {
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--surface-strong, #222c27) 84%, transparent),
      color-mix(in srgb, var(--surface, #1a211e) 92%, transparent)),
    var(--surface, #1a211e);
  box-shadow:
    0 12px 26px rgba(0, 0, 0, 0.26),
    inset 0 1px 0 color-mix(in srgb, #ffffff 8%, transparent);
}

:root[data-theme="dark"] .npc-memory-card {
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--surface-strong, #222c27) 72%, var(--surface, #1a211e)),
      color-mix(in srgb, var(--surface, #1a211e) 96%, transparent)),
    var(--surface, #1a211e);
}

/* Transition */
.npc-panel-enter-active,
.npc-panel-leave-active {
  transition: opacity 0.25s ease;
}
.npc-panel-enter-active .npc-panel,
.npc-panel-leave-active .npc-panel {
  transition: none;
}
.npc-panel-enter-from {
  opacity: 0;
}
.npc-panel-enter-from .npc-panel {
  transform: none !important;
}
.npc-panel-leave-to {
  opacity: 0;
}
.npc-panel-leave-to .npc-panel {
  transform: none !important;
}
</style>
