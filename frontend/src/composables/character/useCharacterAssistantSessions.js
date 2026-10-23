import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { recordFrontendDiagnostic } from '../../diagnostics.js';
import {
  createCharacterAssistantSession,
  deleteCharacterAssistantSession,
  fetchCharacterAssistantSession,
  fetchCharacterAssistantSessions,
  fetchCharacterAssistantVersions,
  resetCharacterAssistantDraftFromSavedCharacter,
  restoreCharacterAssistantVersion,
  updateCharacterAssistantSession
} from '../../api/characterAssistant.js';

export function useCharacterAssistantSessions({ editor, user }) {
  const sessions = ref([]);
  const activeSession = ref(null);
  const loading = ref(true);
  const busy = ref(false);
  const running = ref(false);
  const settling = ref(false);
  const error = ref('');
  const saveStatus = ref('');
  const pendingMessage = ref('');
  const pendingAttachments = ref([]);
  const versions = ref([]);
  const versionsLoading = ref(false);
  const versionsError = ref('');
  const resetDraftError = ref('');
  let resettingDraft = false;
  let disposed = false;
  let initialized = false;
  let selectionToken = 0;
  let autosaveTimer;
  let lastSnapshot = '';
  let saveQueue = Promise.resolve();

  function activeStorageKey() {
    return `flai-character-assistant-active:${user?.id || 'anonymous'}:${editor.editingCharacterId || 'new'}`;
  }

  function readActiveId() {
    try { return sessionStorage.getItem(activeStorageKey()) || ''; } catch { return ''; }
  }

  function rememberActiveId(id) {
    try {
      if (id) sessionStorage.setItem(activeStorageKey(), id);
      else sessionStorage.removeItem(activeStorageKey());
    } catch (err) { recordFrontendDiagnostic('characterAssistant.activeSession.remember', err); }
  }

  function snapshot() {
    return {
      character: editor.toPayload(),
      state: {
        ...editor.exportAiSessionState(),
        selectedWorldBookIds: [...(editor.selectedWorldBookIds || [])]
      }
    };
  }

  function newSessionState() {
    const worldBookLinkDraft = editor.exportAiSessionState?.().worldBookLinkDraft;
    return {
      providerProfileId: String(editor.assistantProviderProfileId || ''),
      modelOverride: String(editor.assistantModel || ''),
      selectedWorldBookIds: [...(editor.selectedWorldBookIds || [])],
      ...(worldBookLinkDraft
        ? { worldBookLinkDraft }
        : {})
    };
  }

  function queueSnapshotSave(id, serialized, { force = false } = {}) {
    const task = saveQueue.catch(() => {}).then(async () => {
      // Compare after older writes settle, including when this save clears a
      // value that an older queued save is still writing.
      if (!force && serialized === lastSnapshot) {
        if (!disposed && activeSession.value?.id === id) saveStatus.value = '会话已保存';
        return;
      }
      const { character, state } = JSON.parse(serialized);
      const previousState = lastSnapshot ? JSON.parse(lastSnapshot).state : {};
      const statePatch = Object.fromEntries(Object.entries(state).filter(([key, value]) => (
        JSON.stringify(value) !== JSON.stringify(previousState[key])
      )));
      const worldBookFields = ['worldBookWorkspace', 'worldBookChanges'].filter((key) => Object.hasOwn(statePatch, key));
      if (worldBookFields.length && statePatch.checkpoint && previousState.checkpoint?.character) {
        const character = { ...previousState.checkpoint.character };
        for (const key of worldBookFields) character[key] = statePatch[key];
        if (JSON.stringify(statePatch.checkpoint) === JSON.stringify({ ...previousState.checkpoint, character })) {
          delete statePatch.checkpoint;
        }
      }
      if (Object.hasOwn(statePatch, 'worldBookWorkspace') && statePatch.planContext && previousState.planContext?.worldBookContext) {
        const planContext = {
          ...previousState.planContext,
          worldBookContext: { ...previousState.planContext.worldBookContext, workspace: statePatch.worldBookWorkspace }
        };
        if (JSON.stringify(statePatch.planContext) === JSON.stringify(planContext)) delete statePatch.planContext;
      }
      // Server checkpoints and tool results may exceed request limits. Keep
      // unchanged fields on the server while still sending explicit clears.
      // The server also syncs checkpoint/plan copies of changed world books.
      const updated = await updateCharacterAssistantSession(id, { character, statePatch });
      if (activeSession.value?.id !== id) return updated;
      lastSnapshot = serialized;
      if (disposed) return updated;
      activeSession.value = { ...activeSession.value, ...updated };
      upsertSession(activeSession.value);
      saveStatus.value = '会话已保存';
      return updated;
    });
    saveQueue = task;
    return task;
  }

  function upsertSession(session) {
    if (!session?.id) return;
    sessions.value = [session, ...sessions.value.filter((item) => item.id !== session.id)]
      .sort((first, second) => String(second.updatedAt).localeCompare(String(first.updatedAt)));
  }

  function applySession(session, { restoreCharacter = true, restoreVersion = false } = {}) {
    clearTimeout(autosaveTimer);
    versions.value = [];
    versionsError.value = '';
    resetDraftError.value = '';
    activeSession.value = session;
    if (restoreCharacter && session.character && Object.keys(session.character).length) {
      editor.applyAssistantCharacter(session.character, { avatarDraft: session.state?.avatarDraft, restoreVersion });
    }
    editor.selectAiSession(session, { restoreVersion });
    settling.value = session.state?.status === 'running';
    if (settling.value) error.value = '助手仍在处理此会话，请稍后重新加载。';
    upsertSession(session);
    rememberActiveId(session.id);
    lastSnapshot = JSON.stringify(snapshot());
    saveStatus.value = '会话已保存';
  }

  async function initialize() {
    if (disposed || busy.value || editor.loading || editor.loadError || !editor.canEdit) return;
    loading.value = true;
    busy.value = true;
    error.value = '';
    const token = ++selectionToken;
    try {
      const list = await fetchCharacterAssistantSessions(editor.editingCharacterId || '');
      if (disposed || token !== selectionToken) return;
      sessions.value = list;
      const selected = list.find((session) => session.id === readActiveId()) || list[0];
      const session = selected
        ? await fetchCharacterAssistantSession(selected.id)
        : await createCharacterAssistantSession({ title: '新会话', characterId: editor.editingCharacterId || undefined, ...snapshot() });
      if (disposed || token !== selectionToken) return;
      applySession(session, { restoreCharacter: Boolean(selected) });
      initialized = true;
      if (session.state?.status === 'running') {
        void settleRunningSession(session.id, token);
      }
    } catch (err) {
      if (!disposed && token === selectionToken) error.value = err?.message || '加载助手会话失败';
    } finally {
      if (!disposed && token === selectionToken) {
        loading.value = false;
        busy.value = false;
      }
    }
  }

  async function settleRunningSession(id, token) {
    // A page reload or HMR update can leave the previous browser stream
    // closing while the server is still writing its final checkpoint. Poll
    // briefly so the rebuilt view shows the authoritative session outcome.
    for (const delay of [250, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000, 6000]) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (disposed || token !== selectionToken || activeSession.value?.id !== id) return;
      try {
        const session = await fetchCharacterAssistantSession(id);
        if (disposed || token !== selectionToken || activeSession.value?.id !== id) return;
        if (session.state?.status !== 'running') {
          applySession(session);
          return;
        }
      } catch (err) {
        if (!disposed && token === selectionToken && activeSession.value?.id === id) {
          error.value = err?.message || '更新助手会话状态失败';
        }
        return;
      }
    }
    if (!disposed && token === selectionToken && activeSession.value?.id === id && activeSession.value.state?.status === 'running') {
      error.value = '助手仍在处理此会话，请稍后重新加载。';
    }
  }

  async function persist({ force = false } = {}) {
    clearTimeout(autosaveTimer);
    if (disposed || resettingDraft || settling.value || editor.saving || !activeSession.value || !initialized || (editor.aiLoading && !force)) return;
    const id = activeSession.value.id;
    const serialized = JSON.stringify(snapshot());
    saveStatus.value = '正在保存会话…';
    const task = queueSnapshotSave(id, serialized, { force });
    try { return await task; } catch (err) {
      if (!disposed && activeSession.value?.id === id) {
        saveStatus.value = '会话保存失败';
        error.value = err?.message || '保存会话失败，请重试';
      }
      throw err;
    }
  }

  async function selectSession(id) {
    if (busy.value || running.value || settling.value || editor.aiLoading || activeSession.value?.id === id) return;
    busy.value = true;
    error.value = '';
    const token = ++selectionToken;
    try {
      await persist();
      const session = await fetchCharacterAssistantSession(id);
      if (!disposed && token === selectionToken) applySession(session);
    } catch (err) {
      if (!disposed) error.value = err?.message || '切换会话失败';
    } finally {
      if (!disposed && token === selectionToken) busy.value = false;
    }
  }

  async function newSession() {
    if (busy.value || running.value || settling.value || editor.aiLoading || !initialized) return;
    busy.value = true;
    error.value = '';
    try {
      await persist();
      const session = await createCharacterAssistantSession({
        title: '新会话',
        characterId: editor.editingCharacterId || undefined,
        character: editor.toPayload(),
        state: newSessionState()
      });
      if (!disposed) applySession(session, { restoreCharacter: false });
    } catch (err) {
      if (!disposed) error.value = err?.message || '创建会话失败';
    } finally { if (!disposed) busy.value = false; }
  }

  async function loadVersions() {
    if (!activeSession.value || running.value || settling.value || versionsLoading.value) return;
    const id = activeSession.value.id;
    versionsLoading.value = true;
    versionsError.value = '';
    try {
      const result = await fetchCharacterAssistantVersions(id);
      if (!disposed && activeSession.value?.id === id) versions.value = result;
    } catch (err) {
      if (!disposed && activeSession.value?.id === id) versionsError.value = err?.message || '读取历史版本失败';
    } finally {
      versionsLoading.value = false;
    }
  }

  async function restoreVersion(versionId) {
    if (!activeSession.value || busy.value || running.value || settling.value || editor.aiLoading) return false;
    const id = activeSession.value.id;
    busy.value = true;
    versionsError.value = '';
    try {
      // Flush manual edits first so the server can retain them for recovery.
      await persist();
      const session = await restoreCharacterAssistantVersion(id, versionId);
      if (disposed || activeSession.value?.id !== id) return false;
      applySession(session, { restoreVersion: true });
      saveStatus.value = '历史草稿已恢复，保存角色后生效';
      return true;
    } catch (err) {
      if (!disposed) versionsError.value = err?.message || '恢复历史版本失败';
      return false;
    } finally {
      if (!disposed) busy.value = false;
    }
  }

  async function resetDraftFromSavedCharacter() {
    const current = activeSession.value;
    const characterId = editor.editingCharacterId;
    if (disposed || !initialized || !editor.canEdit || !current?.id || !characterId
      || current.characterId !== characterId || busy.value || running.value || settling.value
      || editor.aiLoading || editor.saving) return false;
    const id = current.id;
    const token = selectionToken;
    busy.value = true;
    resettingDraft = true;
    resetDraftError.value = '';
    clearTimeout(autosaveTimer);
    try {
      // Finish older writes and retain the latest draft in server history
      // before the saved card replaces it. Block further autosaves until done.
      await queueSnapshotSave(id, JSON.stringify(snapshot()));
      if (disposed || token !== selectionToken || activeSession.value?.id !== id
        || editor.editingCharacterId !== characterId) return false;
      const result = await resetCharacterAssistantDraftFromSavedCharacter(id);
      if (disposed || token !== selectionToken || activeSession.value?.id !== id
        || editor.editingCharacterId !== characterId) return false;
      if (result?.session?.id !== id || result.session.characterId !== characterId
        || result.character?.id !== characterId) throw new Error('角色卡与当前会话不匹配，请重新加载');
      if (!editor.replaceAssistantDraftFromSavedCharacter(result.character, result.session)) {
        throw new Error('替换当前草稿失败，请重新加载会话');
      }
      activeSession.value = result.session;
      upsertSession(result.session);
      rememberActiveId(id);
      lastSnapshot = JSON.stringify(snapshot());
      versions.value = [];
      versionsError.value = '';
      error.value = '';
      saveStatus.value = '草稿已与已保存角色卡同步';
      await loadVersions();
      return true;
    } catch (err) {
      if (!disposed && activeSession.value?.id === id) {
        resetDraftError.value = err?.message || '覆盖草稿失败，请重试';
      }
      return false;
    } finally {
      resettingDraft = false;
      if (!disposed && token === selectionToken) busy.value = false;
    }
  }

  async function removeSession(id) {
    if (busy.value || running.value || settling.value || editor.aiLoading) return;
    if (!window.confirm('删除这段助手会话及其对话记录？角色卡不会被删除。')) return;
    busy.value = true;
    error.value = '';
    try {
      if (activeSession.value?.id !== id) await persist();
      clearTimeout(autosaveTimer);
      await saveQueue.catch(() => {});
      await deleteCharacterAssistantSession(id);
      if (disposed) return;
      sessions.value = sessions.value.filter((session) => session.id !== id);
      if (activeSession.value?.id === id) {
        activeSession.value = null;
        rememberActiveId('');
        const next = sessions.value[0];
        const session = next
          ? await fetchCharacterAssistantSession(next.id)
          : await createCharacterAssistantSession({
            title: '新会话',
            characterId: editor.editingCharacterId || undefined,
            character: editor.toPayload(),
            state: newSessionState()
          });
        if (!disposed) applySession(session, { restoreCharacter: Boolean(next) });
      }
    } catch (err) {
      if (!disposed) error.value = err?.message || '删除会话失败';
    } finally { if (!disposed) busy.value = false; }
  }

  async function run(action = editor.completeWithAi) {
    if (busy.value || running.value || settling.value || editor.aiLoading || !activeSession.value || !initialized) return;
    error.value = '';
    running.value = true;
    const id = activeSession.value.id;
    const previousMessageIds = new Set((activeSession.value.messages || []).map((message) => message.id));
    let requestStarted = false;
    let requestFailed = false;
    pendingMessage.value = editor.aiRequirement.trim();
    pendingAttachments.value = (editor.aiAttachments || []).map((image) => ({ ...image }));
    try {
      await persist({ force: true });
      requestStarted = true;
      await action();
    } catch (err) {
      requestFailed = true;
      if (!disposed) error.value = err?.message || '助手请求失败';
    } finally {
      if (!requestStarted) {
        if (!disposed) {
          pendingMessage.value = '';
          pendingAttachments.value = [];
          running.value = false;
        }
        return;
      }
      const preserveDraft = requestFailed || !['completed', 'review'].includes(editor.aiStatus);
      let draftAttachments = preserveDraft ? (editor.aiAttachments || []).map((image) => ({ ...image })) : [];
      const draftMessage = editor.aiRequirement;
      const localOutcome = {
        status: editor.aiStatus, lastError: editor.aiLastError, statusMessage: editor.aiStatusMessage,
        planPhase: editor.aiPlanPhase
      };
      // Fetch after interruption too: the server owns conversation messages.
      try {
        let session = await fetchCharacterAssistantSession(id);
        // An aborted fetch can finish before the server has saved its last
        // checkpoint. Keep the workspace locked briefly while that settles.
        for (const delay of [100, 200, 350, 500, 800, 1000]) {
          if (disposed || session.state?.status !== 'running') break;
          saveStatus.value = '正在保留阶段结果…';
          await new Promise((resolve) => setTimeout(resolve, delay));
          if (disposed) break;
          session = await fetchCharacterAssistantSession(id);
        }
        if (!disposed && activeSession.value?.id === id) {
          // A failed model request may already have persisted the user images.
          // Retry those asset URLs instead of uploading the same bytes again.
          const savedUserMessage = (session.messages || []).findLast((message) => (
            message.role === 'user' && !previousMessageIds.has(message.id) && message.attachments?.length
          ));
          const hasServerTurn = (session.messages || []).some((message) => !previousMessageIds.has(message.id));
          if (draftAttachments.length && savedUserMessage?.attachments?.length === draftAttachments.length) {
            draftAttachments = draftAttachments.map(({ dataUrl, ...image }, index) => ({
              ...image, ...savedUserMessage.attachments[index], id: image.id
            }));
          }
          // Restore the server snapshot after cancellation too; writing the
          // pre-run form here would overwrite the newest partial draft.
          applySession(session);
          if (preserveDraft) {
            editor.aiAttachments = draftAttachments;
            editor.aiRequirement = draftMessage;
            // Upload/connection failures can happen before the server starts
            // this turn. Its previous snapshot must not erase that failure.
            if (!hasServerTurn && ['failed', 'paused'].includes(localOutcome.status) && session.state?.status !== 'running') {
              editor.aiStatus = localOutcome.status;
              editor.aiLastError = localOutcome.lastError;
              editor.aiStatusMessage = localOutcome.statusMessage;
              editor.aiPlanPhase = localOutcome.planPhase;
            }
          } else {
            editor.aiRequirement = '';
          }
          if (session.state?.status === 'running') {
            error.value = '助手仍在结束任务，请稍后重新加载会话。';
          }
        }
      } catch (err) {
        if (!disposed) error.value = err?.message || '更新对话记录失败，请重试加载';
      }
      if (!disposed) {
        pendingMessage.value = '';
        pendingAttachments.value = [];
        running.value = false;
      }
    }
  }

  watch(() => [editor.toPayload(), editor.exportAiSessionState(), editor.selectedWorldBookIds, editor.saving], () => {
    clearTimeout(autosaveTimer);
    if (!initialized || busy.value || running.value || settling.value || editor.aiLoading || editor.saving) return;
    autosaveTimer = setTimeout(() => { persist().catch(() => {}); }, 600);
  }, { deep: true });

  onMounted(() => {
    watch(() => [editor.loading, editor.loadError, editor.canEdit], () => {
      if (!initialized && !editor.loading && !editor.loadError && editor.canEdit) void initialize();
      else if (editor.loadError || !editor.canEdit) loading.value = false;
    }, { immediate: true });
  });

  onBeforeUnmount(() => {
    clearTimeout(autosaveTimer);
    if (initialized && activeSession.value && !editor.aiLoading && !editor.saving && !running.value && !busy.value && !settling.value) {
      const id = activeSession.value.id;
      void queueSnapshotSave(id, JSON.stringify(snapshot())).catch(() => {});
    }
    disposed = true;
    selectionToken += 1;
  });

  return { sessions, activeSession, loading, busy, running, settling, error, saveStatus, pendingMessage, pendingAttachments,
    versions, versionsLoading, versionsError, resetDraftError, loadVersions, restoreVersion, resetDraftFromSavedCharacter,
    initialize, newSession, selectSession, removeSession, persist, run };
}
