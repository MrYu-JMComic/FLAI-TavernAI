import { computed, onScopeDispose, reactive, ref, unref, watch } from 'vue';
import {
  cleanupCastMembers,
  createCastBehavior,
  createCastItem,
  createCastMember,
  createCastMemory,
  deleteCastBehavior,
  deleteCastItem,
  deleteCastMemory,
  fetchCastAudit,
  fetchCastBehaviors,
  fetchCastItems,
  fetchCastMember,
  fetchCastMemories,
  fetchCastRoster,
  rollbackCastAudit,
  streamCastOrganization,
  streamCastSync,
  transferCastItem,
  updateCastAppearance,
  updateCastBehavior,
  updateCastItem,
  updateCastMember,
  updateCastMemory
} from '../../api/cast.js';

export const CAST_MANAGER_TABS = Object.freeze(['profile', 'memories', 'behaviors', 'items', 'audit']);

export function formatCastSyncError(status = {}) {
  const parts = [String(status.error || '人物同步失败')];
  if (status.code) parts.push(String(status.code));
  const issue = Array.isArray(status.details) ? status.details[0] : null;
  if (issue?.path || issue?.message) {
    parts.push([issue.path, issue.message].filter(Boolean).join(': '));
  }
  if (status.repairAttempted === true) parts.push('已自动修复重试一次');
  return parts.filter(Boolean).join(' · ');
}

export function useCastManager(options = {}) {
  const conversationId = computed(() => String(unref(options.conversationId) || '').trim());
  const isOpen = computed(() => Boolean(unref(options.open)));
  const notify = options.notify || {};
  const roster = ref(emptyRoster());
  const selectedMemberId = ref('');
  const detail = ref(null);
  const memories = ref(emptyPage());
  const behaviors = ref([]);
  const items = ref([]);
  const audit = ref(emptyAudit());
  const activeTab = ref('profile');
  const search = ref('');
  const visibilityFilter = ref('visible');
  const syncStatus = ref({ status: 'idle', summary: '', error: '', at: '' });
  const loading = reactive({
    roster: false,
    detail: false,
    memories: false,
    behaviors: false,
    items: false,
    audit: false,
  });
  const errors = reactive({
    roster: '',
    detail: '',
    memories: '',
    behaviors: '',
    items: '',
    audit: '',
    mutation: '',
    sync: '',
  });
  const busy = reactive({ mutation: false, kind: '' });
  const editor = reactive({ kind: '', mode: '', record: null });
  const organizer = reactive({
    scope: 'member',
    requirement: '',
    running: false,
    phase: 'idle',
    error: '',
    summary: '',
    applied: 0,
  });
  const dirtySources = reactive(new Set());
  const loaded = reactive({ memories: false, behaviors: false, items: false, audit: false });
  const requestTokens = reactive({ roster: 0, detail: 0, memories: 0, behaviors: 0, items: 0, audit: 0 });
  let sessionToken = 0;
  let syncController = null;
  let organizerController = null;

  const members = computed(() => [roster.value.protagonist, ...roster.value.npcs].filter(Boolean));
  const selectedMember = computed(() => (
    members.value.find((member) => member.id === selectedMemberId.value) || null
  ));
  const filteredNpcs = computed(() => {
    const query = normalizeSearch(search.value);
    return roster.value.npcs.filter((member) => {
      if (visibilityFilter.value !== 'all' && member.visibility !== visibilityFilter.value) return false;
      if (!query) return true;
      const haystack = [
        member.canonicalName,
        ...(Array.isArray(member.aliases) ? member.aliases : []),
        member.status,
        member.relationship,
        member.currentLocationLabel,
      ].map(normalizeSearch).join('\n');
      return haystack.includes(query);
    });
  });
  const hasUnsavedChanges = computed(() => dirtySources.size > 0 || Boolean(editor.kind));

  watch(
    [isOpen, conversationId],
    ([opened, currentConversationId]) => {
      beginSession();
      resetData();
      if (!opened || !currentConversationId) return;
      const currentSession = sessionToken;
      void loadRoster({ session: currentSession, refreshDetail: true });
      startSyncStream(currentSession, currentConversationId);
    },
    { immediate: true }
  );

  async function loadRoster(options = {}) {
    const session = options.session ?? sessionToken;
    const currentConversationId = conversationId.value;
    if (!isCurrentSession(session, currentConversationId)) return null;
    const requestToken = ++requestTokens.roster;
    loading.roster = true;
    errors.roster = '';
    try {
      const result = await fetchCastRoster(currentConversationId, { includeHidden: true });
      if (!isCurrentRequest('roster', requestToken, session, currentConversationId)) return null;
      roster.value = normalizeRoster(result);
      if (result.sync) syncStatus.value = { ...syncStatus.value, ...result.sync };
      const nextSelection = chooseSelection(roster.value, selectedMemberId.value);
      const selectionChanged = nextSelection !== selectedMemberId.value;
      selectedMemberId.value = nextSelection;
      if (selectionChanged) {
        resetMemberData();
        clearEditing();
      }
      if (nextSelection && options.refreshDetail !== false && !hasUnsavedChanges.value) {
        await loadSelectedMember({ session, memberId: nextSelection });
      }
      return roster.value;
    } catch (error) {
      if (!isCurrentRequest('roster', requestToken, session, currentConversationId)) return null;
      errors.roster = readableError(error, '人物名册加载失败');
      return null;
    } finally {
      if (isCurrentRequest('roster', requestToken, session, currentConversationId)) {
        loading.roster = false;
      }
    }
  }

  async function selectMember(memberId) {
    const normalized = String(memberId || '');
    if (!members.value.some((member) => member.id === normalized)) return false;
    selectedMemberId.value = normalized;
    resetMemberData();
    clearEditing();
    await loadSelectedMember({ session: sessionToken, memberId: normalized });
    return true;
  }

  async function loadSelectedMember(options = {}) {
    const session = options.session ?? sessionToken;
    const currentConversationId = conversationId.value;
    const memberId = String(options.memberId || selectedMemberId.value || '');
    if (!isCurrentMemberRequest(session, currentConversationId, memberId)) return null;
    const requestToken = ++requestTokens.detail;
    loading.detail = true;
    errors.detail = '';
    try {
      const result = await fetchCastMember(currentConversationId, memberId);
      if (!isCurrentMemberRequest(session, currentConversationId, memberId)
        || requestTokens.detail !== requestToken) return null;
      detail.value = result;
      await loadActiveTab({ session, memberId });
      return result;
    } catch (error) {
      if (!isCurrentMemberRequest(session, currentConversationId, memberId)
        || requestTokens.detail !== requestToken) return null;
      errors.detail = readableError(error, '人物详情加载失败');
      return null;
    } finally {
      if (isCurrentMemberRequest(session, currentConversationId, memberId)
        && requestTokens.detail === requestToken) loading.detail = false;
    }
  }

  async function setActiveTab(tab) {
    if (!CAST_MANAGER_TABS.includes(tab)) return false;
    activeTab.value = tab;
    clearEditing();
    await loadActiveTab({ session: sessionToken, memberId: selectedMemberId.value });
    return true;
  }

  function loadActiveTab(options = {}) {
    if (activeTab.value === 'memories') return loadMemories(options);
    if (activeTab.value === 'behaviors') return loadBehaviors(options);
    if (activeTab.value === 'items') return loadItems(options);
    if (activeTab.value === 'audit') return loadAudit(options);
    return Promise.resolve(null);
  }

  async function loadMemories(options = {}) {
    const context = resourceContext(options, 'memories');
    if (!context) return null;
    const append = options.append === true;
    loading.memories = true;
    errors.memories = '';
    try {
      const result = await fetchCastMemories(context.conversationId, context.memberId, {
        limit: 50,
        offset: append ? memories.value.items.length : 0,
        includeForgotten: true,
      });
      if (!isCurrentResource(context)) return null;
      memories.value = append
        ? { ...result, items: [...memories.value.items, ...(result.items || [])] }
        : normalizePage(result);
      loaded.memories = true;
      return memories.value;
    } catch (error) {
      if (!isCurrentResource(context)) return null;
      errors.memories = readableError(error, '记忆加载失败');
      return null;
    } finally {
      if (isCurrentResource(context)) loading.memories = false;
    }
  }

  async function loadBehaviors(options = {}) {
    const context = resourceContext(options, 'behaviors');
    if (!context) return null;
    loading.behaviors = true;
    errors.behaviors = '';
    try {
      const result = await fetchCastBehaviors(context.conversationId, context.memberId);
      if (!isCurrentResource(context)) return null;
      behaviors.value = Array.isArray(result) ? result : [];
      loaded.behaviors = true;
      return behaviors.value;
    } catch (error) {
      if (!isCurrentResource(context)) return null;
      errors.behaviors = readableError(error, '行为规则加载失败');
      return null;
    } finally {
      if (isCurrentResource(context)) loading.behaviors = false;
    }
  }

  async function loadItems(options = {}) {
    const context = resourceContext(options, 'items');
    if (!context) return null;
    loading.items = true;
    errors.items = '';
    try {
      const result = await fetchCastItems(context.conversationId, context.memberId, { limit: 300, offset: 0 });
      if (!isCurrentResource(context)) return null;
      items.value = Array.isArray(result) ? result : [];
      loaded.items = true;
      return items.value;
    } catch (error) {
      if (!isCurrentResource(context)) return null;
      errors.items = readableError(error, '物品加载失败');
      return null;
    } finally {
      if (isCurrentResource(context)) loading.items = false;
    }
  }

  async function loadAudit(options = {}) {
    const context = resourceContext(options, 'audit');
    if (!context) return null;
    const append = options.append === true;
    loading.audit = true;
    errors.audit = '';
    try {
      const cursor = append ? audit.value.nextCursor : null;
      const result = await fetchCastAudit(context.conversationId, context.memberId, {
        limit: 30,
        beforeCreatedAt: cursor?.createdAt,
        beforeId: cursor?.id,
      });
      if (!isCurrentResource(context)) return null;
      audit.value = append
        ? { ...result, items: [...audit.value.items, ...(result.items || [])] }
        : normalizeAudit(result);
      loaded.audit = true;
      return audit.value;
    } catch (error) {
      if (!isCurrentResource(context)) return null;
      errors.audit = readableError(error, '审计记录加载失败');
      return null;
    } finally {
      if (isCurrentResource(context)) loading.audit = false;
    }
  }

  function openEditor(kind, record = null) {
    editor.kind = String(kind || '');
    editor.mode = record ? 'edit' : 'create';
    editor.record = record ? cloneValue(record) : null;
  }

  function closeEditor() {
    editor.kind = '';
    editor.mode = '';
    editor.record = null;
    clearDirty('editor');
  }

  function setDirty(source, value) {
    const key = String(source || 'editor');
    if (value) dirtySources.add(key);
    else dirtySources.delete(key);
  }

  function clearDirty(source = '') {
    if (source) dirtySources.delete(source);
    else dirtySources.clear();
  }

  async function addMember(payload) {
    return runMutation('member.create', () => createCastMember(conversationId.value, payload), {
      successMessage: '人物已添加',
      clearDirty: 'create-member',
      after: async (created) => {
        await loadRoster({ refreshDetail: false });
        if (created?.id) await selectMember(created.id);
      },
    });
  }

  async function saveProfile(payload) {
    const memberId = selectedMemberId.value;
    return runMutation('member.update', () => updateCastMember(conversationId.value, memberId, payload), {
      successMessage: '人物资料已保存',
      clearDirty: 'profile',
      after: async (member) => {
        if (member?.id === memberId && detail.value?.member?.id === memberId) {
          detail.value = { ...detail.value, member };
        }
        await loadRoster({ refreshDetail: false });
      },
    });
  }

  async function saveAppearance(payload) {
    const memberId = selectedMemberId.value;
    return runMutation('appearance.update', () => updateCastAppearance(conversationId.value, memberId, payload), {
      successMessage: '外貌资料已保存',
      clearDirty: 'appearance',
      after: async (appearance) => {
        if (appearance?.memberId === memberId && detail.value?.member?.id === memberId) {
          detail.value = { ...detail.value, appearance };
        }
      },
    });
  }

  async function hideEmptyMembers() {
    return runMutation('member.cleanup', () => cleanupCastMembers(conversationId.value), {
      successMessage: '空人物记录已整理',
      after: async () => loadRoster({ refreshDetail: true }),
    });
  }

  async function saveMemory(payload, record = null) {
    const memberId = selectedMemberId.value;
    const action = record
      ? () => updateCastMemory(conversationId.value, memberId, record.id, { ...payload, revision: record.revision })
      : () => createCastMemory(conversationId.value, memberId, payload);
    return runMutation(record ? 'memory.update' : 'memory.create', action, {
      successMessage: record ? '记忆已更新' : '记忆已添加',
      after: async () => {
        closeEditor();
        await Promise.all([loadMemories(), refreshRosterCounts()]);
      },
    });
  }

  async function removeMemory(record) {
    return runMutation(
      'memory.delete',
      () => deleteCastMemory(conversationId.value, selectedMemberId.value, record.id, record.revision),
      {
        successMessage: '记忆已删除',
        after: async () => Promise.all([loadMemories(), refreshRosterCounts()]),
      }
    );
  }

  async function saveBehavior(payload, record = null) {
    const memberId = selectedMemberId.value;
    const action = record
      ? () => updateCastBehavior(conversationId.value, memberId, record.id, { ...payload, revision: record.revision })
      : () => createCastBehavior(conversationId.value, memberId, payload);
    return runMutation(record ? 'behavior.update' : 'behavior.create', action, {
      successMessage: record ? '行为规则已更新' : '行为规则已添加',
      after: async () => {
        closeEditor();
        await Promise.all([loadBehaviors(), refreshRosterCounts()]);
      },
    });
  }

  async function removeBehavior(record) {
    return runMutation(
      'behavior.delete',
      () => deleteCastBehavior(conversationId.value, selectedMemberId.value, record.id, record.revision),
      {
        successMessage: '行为规则已删除',
        after: async () => Promise.all([loadBehaviors(), refreshRosterCounts()]),
      }
    );
  }

  async function saveItem(payload, record = null) {
    const memberId = selectedMemberId.value;
    const action = record
      ? () => updateCastItem(conversationId.value, memberId, record.id, { ...payload, revision: record.revision })
      : () => createCastItem(conversationId.value, memberId, payload);
    return runMutation(record ? 'item.update' : 'item.create', action, {
      successMessage: record ? '物品已更新' : '物品已添加',
      after: async () => {
        closeEditor();
        await Promise.all([loadItems(), refreshRosterCounts()]);
      },
    });
  }

  async function moveItem(record, destinationMemberId) {
    return runMutation(
      'item.transfer',
      () => transferCastItem(conversationId.value, selectedMemberId.value, record.id, {
        memberId: destinationMemberId,
        revision: record.revision,
      }),
      {
        successMessage: '物品已转交',
        after: async () => Promise.all([loadItems(), refreshRosterCounts()]),
      }
    );
  }

  async function removeItem(record) {
    return runMutation(
      'item.delete',
      () => deleteCastItem(conversationId.value, selectedMemberId.value, record.id, record.revision),
      {
        successMessage: '物品已删除',
        after: async () => Promise.all([loadItems(), refreshRosterCounts()]),
      }
    );
  }

  async function rollbackAuditEvent(event) {
    return runMutation('audit.rollback', () => rollbackCastAudit(conversationId.value, event.id), {
      successMessage: '变更已回滚',
      after: async () => {
        clearEditing();
        await Promise.all([refreshCurrentMember(), loadAudit()]);
      },
    });
  }

  async function runOrganization(input = {}) {
    if (organizer.running || hasUnsavedChanges.value || !conversationId.value) return null;
    const scope = input.scope === 'conversation' ? 'conversation' : 'member';
    const memberId = scope === 'member' ? selectedMemberId.value : '';
    if (scope === 'member' && !memberId) return null;
    const session = sessionToken;
    const currentConversationId = conversationId.value;
    organizerController = new AbortController();
    organizer.scope = scope;
    organizer.requirement = String(input.requirement ?? organizer.requirement ?? '').slice(0, 2_000);
    organizer.running = true;
    organizer.phase = 'context';
    organizer.error = '';
    organizer.summary = '';
    organizer.applied = 0;
    try {
      await streamCastOrganization(currentConversationId, {
        scope,
        ...(memberId ? { memberId } : {}),
        requirement: organizer.requirement,
      }, {
        progress(data = {}) {
          if (!isCurrentSession(session, currentConversationId)) return;
          organizer.phase = String(data.phase || organizer.phase);
          if (data.summary) organizer.summary = String(data.summary);
          if (Number.isFinite(Number(data.applied))) organizer.applied = Number(data.applied);
        },
        error(data = {}) {
          if (!isCurrentSession(session, currentConversationId)) return;
          organizer.error = String(data.error || '人物整理失败');
        },
      }, organizerController.signal);
      if (!isCurrentSession(session, currentConversationId) || organizerController.signal.aborted) return null;
      await loadRoster({ session, refreshDetail: true });
      notify.success?.('人物资料整理完成');
      return { applied: organizer.applied, summary: organizer.summary };
    } catch (error) {
      if (!isCurrentSession(session, currentConversationId) || organizerController.signal.aborted) return null;
      organizer.phase = 'error';
      organizer.error = organizer.error || readableError(error, '人物整理失败');
      notify.error?.(organizer.error);
      return null;
    } finally {
      if (isCurrentSession(session, currentConversationId)) organizer.running = false;
      organizerController = null;
    }
  }

  function cancelOrganization() {
    if (!organizer.running) return false;
    organizerController?.abort();
    organizer.running = false;
    organizer.phase = 'cancelled';
    organizer.summary = '已取消';
    return true;
  }

  async function refreshCurrentMember() {
    await Promise.all([
      loadRoster({ refreshDetail: false }),
      loadSelectedMember({ memberId: selectedMemberId.value }),
    ]);
  }

  async function refreshRosterCounts() {
    await loadRoster({ refreshDetail: false });
    if (detail.value?.member?.id === selectedMemberId.value) {
      await loadSelectedDetailOnly();
    }
  }

  async function loadSelectedDetailOnly() {
    const session = sessionToken;
    const currentConversationId = conversationId.value;
    const memberId = selectedMemberId.value;
    if (!isCurrentMemberRequest(session, currentConversationId, memberId)) return null;
    const requestToken = ++requestTokens.detail;
    try {
      const result = await fetchCastMember(currentConversationId, memberId);
      if (isCurrentMemberRequest(session, currentConversationId, memberId)
        && requestTokens.detail === requestToken) detail.value = result;
      return result;
    } catch {
      return null;
    }
  }

  async function runMutation(kind, action, mutationOptions = {}) {
    if (busy.mutation || !conversationId.value) return null;
    const session = sessionToken;
    const currentConversationId = conversationId.value;
    busy.mutation = true;
    busy.kind = kind;
    errors.mutation = '';
    try {
      const result = await action();
      if (!isCurrentSession(session, currentConversationId)) return null;
      if (mutationOptions.after) await mutationOptions.after(result);
      if (!isCurrentSession(session, currentConversationId)) return null;
      clearMutationDirty(mutationOptions.clearDirty);
      notify.success?.(mutationOptions.successMessage || '修改已保存');
      return result;
    } catch (error) {
      if (!isCurrentSession(session, currentConversationId)) return null;
      errors.mutation = error?.status === 409
        ? '数据已在其他位置更新，已重新载入，请再次确认修改。'
        : readableError(error, '修改失败');
      notify.error?.(errors.mutation);
      if (error?.status === 409) await refreshCurrentMember();
      return null;
    } finally {
      if (isCurrentSession(session, currentConversationId)) {
        busy.mutation = false;
        busy.kind = '';
      }
    }
  }

  function clearMutationDirty(source) {
    if (Array.isArray(source)) {
      for (const entry of source) clearDirty(entry);
      return;
    }
    if (source) clearDirty(source);
  }

  function startSyncStream(session, currentConversationId) {
    syncController = new AbortController();
    void runSyncStream(session, currentConversationId, syncController.signal);
  }

  async function runSyncStream(session, currentConversationId, signal) {
    try {
      await streamCastSync(currentConversationId, {
        'cast-sync': (status = {}) => {
          if (!isCurrentSession(session, currentConversationId) || signal.aborted) return;
          syncStatus.value = { ...syncStatus.value, ...status };
          errors.sync = status.status === 'error' ? formatCastSyncError(status) : '';
          if (status.status === 'applied') {
            void loadRoster({ session, refreshDetail: !hasUnsavedChanges.value });
          }
        },
      }, signal);
      if (isCurrentSession(session, currentConversationId) && !signal.aborted) {
        errors.sync = '人物同步连接已断开，重新打开面板可恢复。';
      }
    } catch (error) {
      if (isCurrentSession(session, currentConversationId) && !signal.aborted) {
        errors.sync = readableError(error, '人物同步连接失败');
      }
    }
  }

  function resourceContext(options, key) {
    const session = options.session ?? sessionToken;
    const currentConversationId = conversationId.value;
    const memberId = String(options.memberId || selectedMemberId.value || '');
    if (!isCurrentMemberRequest(session, currentConversationId, memberId)) return null;
    return {
      key,
      token: ++requestTokens[key],
      session,
      conversationId: currentConversationId,
      memberId,
    };
  }

  function isCurrentResource(context) {
    return requestTokens[context.key] === context.token
      && isCurrentMemberRequest(context.session, context.conversationId, context.memberId);
  }

  function isCurrentRequest(key, token, session, currentConversationId) {
    return requestTokens[key] === token && isCurrentSession(session, currentConversationId);
  }

  function isCurrentMemberRequest(session, currentConversationId, memberId) {
    return Boolean(memberId)
      && selectedMemberId.value === memberId
      && isCurrentSession(session, currentConversationId);
  }

  function isCurrentSession(session, currentConversationId) {
    return session === sessionToken
      && isOpen.value
      && conversationId.value === currentConversationId;
  }

  function beginSession() {
    sessionToken += 1;
    syncController?.abort();
    organizerController?.abort();
    syncController = null;
    organizerController = null;
  }

  function resetData() {
    roster.value = emptyRoster();
    selectedMemberId.value = '';
    detail.value = null;
    search.value = '';
    visibilityFilter.value = 'visible';
    activeTab.value = 'profile';
    syncStatus.value = { status: 'idle', summary: '', error: '', at: '' };
    for (const key of Object.keys(loading)) loading[key] = false;
    for (const key of Object.keys(errors)) errors[key] = '';
    busy.mutation = false;
    busy.kind = '';
    organizer.scope = 'member';
    organizer.requirement = '';
    organizer.running = false;
    organizer.phase = 'idle';
    organizer.error = '';
    organizer.summary = '';
    organizer.applied = 0;
    resetMemberData();
    clearEditing();
  }

  function resetMemberData() {
    detail.value = null;
    memories.value = emptyPage();
    behaviors.value = [];
    items.value = [];
    audit.value = emptyAudit();
    for (const key of Object.keys(loaded)) loaded[key] = false;
    for (const key of ['detail', 'memories', 'behaviors', 'items', 'audit', 'mutation']) errors[key] = '';
  }

  function clearEditing() {
    closeEditor();
    clearDirty();
  }

  function dispose() {
    beginSession();
    resetData();
  }

  onScopeDispose(dispose);

  return {
    roster,
    members,
    filteredNpcs,
    selectedMemberId,
    selectedMember,
    detail,
    memories,
    behaviors,
    items,
    audit,
    activeTab,
    search,
    visibilityFilter,
    syncStatus,
    loading,
    errors,
    busy,
    loaded,
    editor,
    organizer,
    hasUnsavedChanges,
    loadRoster,
    loadSelectedMember,
    loadMemories,
    loadBehaviors,
    loadItems,
    loadAudit,
    selectMember,
    setActiveTab,
    openEditor,
    closeEditor,
    setDirty,
    clearDirty,
    addMember,
    saveProfile,
    saveAppearance,
    hideEmptyMembers,
    saveMemory,
    removeMemory,
    saveBehavior,
    removeBehavior,
    saveItem,
    moveItem,
    removeItem,
    rollbackAuditEvent,
    runOrganization,
    cancelOrganization,
    refreshCurrentMember,
    dispose,
  };
}

function emptyRoster() {
  return {
    protagonist: null,
    npcs: [],
    stats: { total: 0, visibleNpcs: 0, hiddenNpcs: 0, sealed: 0 },
    sync: { status: 'idle', appliedAt: '', summary: '' },
  };
}

function normalizeRoster(value = {}) {
  return {
    protagonist: value.protagonist || null,
    npcs: Array.isArray(value.npcs) ? value.npcs : [],
    stats: { ...emptyRoster().stats, ...(value.stats || {}) },
    sync: { ...emptyRoster().sync, ...(value.sync || {}) },
  };
}

function emptyPage() {
  return { items: [], total: 0, limit: 50, offset: 0 };
}

function normalizePage(value = {}) {
  return {
    items: Array.isArray(value.items) ? value.items : [],
    total: Math.max(0, Number(value.total || 0)),
    limit: Math.max(1, Number(value.limit || 50)),
    offset: Math.max(0, Number(value.offset || 0)),
  };
}

function emptyAudit() {
  return { items: [], hasMore: false, nextCursor: null };
}

function normalizeAudit(value = {}) {
  return {
    items: Array.isArray(value.items) ? value.items : [],
    hasMore: Boolean(value.hasMore),
    nextCursor: value.nextCursor || null,
  };
}

function chooseSelection(value, currentId) {
  const all = [value.protagonist, ...value.npcs].filter(Boolean);
  if (all.some((member) => member.id === currentId)) return currentId;
  return value.protagonist?.id || value.npcs[0]?.id || '';
}

function normalizeSearch(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function readableError(error, fallback) {
  return String(error?.message || fallback || '请求失败');
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}
