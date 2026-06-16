import { computed, nextTick, ref, triggerRef } from 'vue';
import { fetchConversationMessages, sendMessage, streamMessage } from '../../api.js';
import { samePlainValue } from '../../utils/plainValues.js';

export function useChatSubmit({
  route,
  messages,
  provider,
  selectedPresetId,
  statusBar,
  syncStatusBarForm,
  applyStatusBarUpdate = null,
  handleSkillResult,
  loadStatusBar,
  loadSidebarData,
  loadEconomyBalance,
  onAccessoryRefreshStart,
  onAccessoryRefresh,
  isPinnedToBottom = () => false,
  hasUserPausedAutoScroll = () => false,
  stickToBottomIfNeeded,
  scrollToMessage,
  prepareExpandedStatusBarForSubmit = () => false,
  expandReasoning,
  showError
}) {
  const input = ref('');
  const useStream = ref(readLocalBoolean('flai-chat-use-stream', true));
  const thinkingEnabled = ref(readLocalBoolean('flai-chat-thinking-enabled', false));
  const sending = ref(false);
  const controller = ref(null);
  const usage = ref(null);
  const providerMeta = ref(null);
  const lastFailure = ref(null);
  const latestWorldBookMatches = ref([]);

  let stoppingByUser = false;
  let accessoryRefreshRun = 0;
  let submitRunId = 0;
  let submitDisposed = false;
  const accessoryRefreshTimers = [];

  const updateStatusBar = typeof applyStatusBarUpdate === 'function'
    ? applyStatusBarUpdate
    : applyStatusBarDirectly;

  const streamIdleTimeoutMs = 60000;
  const accessoryRefreshDelays = [1200, 4000, 9000, 16000, 25000, 38000, 55000];

  const canSend = computed(() => input.value.trim() && !sending.value);
  const canToggleThinking = computed(() => Boolean(provider.value?.supportsReasoning));

  function readLocalBoolean(key, fallback) {
    if (typeof window === 'undefined') {
      return fallback;
    }
    try {
      const value = window.localStorage.getItem(key);
      if (value === null) {
        return fallback;
      }
      return value === 'true';
    } catch {
      // Private mode or storage quota exceeded
      return fallback;
    }
  }

  function writeLocalBoolean(key, value) {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(key, String(Boolean(value)));
    } catch {
      // Private mode or storage quota exceeded
    }
  }

  function toggleUseStream() {
    if (sending.value) {
      return;
    }
    useStream.value = !useStream.value;
    writeLocalBoolean('flai-chat-use-stream', useStream.value);
  }

  function toggleThinking() {
    if (sending.value || !canToggleThinking.value) {
      return;
    }
    thinkingEnabled.value = !thinkingEnabled.value;
    writeLocalBoolean('flai-chat-thinking-enabled', thinkingEnabled.value);
  }

  function setSelectedPresetId(value) {
    if (sending.value || submitDisposed) {
      return;
    }
    selectedPresetId.value = value || '';
  }

  async function submit() {
    const content = input.value.trim();
    const conversationId = normalizeConversationId(route.params.id);
    if (!content || sending.value || submitDisposed || !conversationId) {
      return;
    }
    clearLastFailure();
    setLatestWorldBookMatches([]);
    const submitId = ++submitRunId;
    const anchorAssistantReply = isPinnedToBottom() && prepareExpandedStatusBarForSubmit();

    input.value = '';
    await nextTick();
    if (!isCurrentSubmit(submitId, conversationId)) {
      return;
    }

    const localUserDraft = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      content,
      reasoning: '',
      createdAt: new Date().toISOString()
    };
    const assistantDraft = {
      id: `local-assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      reasoning: '',
      createdAt: new Date().toISOString(),
      streaming: true,
      reasoningStreaming: false,
      contentStreaming: false
    };
    appendMessageItems(localUserDraft, assistantDraft);
    const localUser = localUserDraft;
    const assistant = assistantDraft;
    sending.value = true;
    await nextTick();
    if (!isCurrentSubmit(submitId, conversationId)) {
      removeMessageItemsByReferenceIfPresent(localUser, assistant);
      sending.value = false;
      return;
    }
    const assistantReplyAnchored = shouldAnchorAssistantReply(anchorAssistantReply) && scrollToAssistantReply(assistant, true);
    if (!assistantReplyAnchored) {
      stickToBottomIfNeeded(true);
    }

    const requestPayload = {
      content,
      thinkingEnabled: canToggleThinking.value ? thinkingEnabled.value : true
    };
    if (selectedPresetId.value) {
      requestPayload.presetId = selectedPresetId.value;
    }
    cancelAccessoryRefresh();
    let streamFinished = false;
    let streamTimedOut = false;
    let streamTimer = null;
    let streamController = null;

    const clearStreamTimer = () => {
      if (streamTimer) {
        window.clearTimeout(streamTimer);
        streamTimer = null;
      }
    };
    const refreshStreamTimer = () => {
      clearStreamTimer();
      streamTimer = window.setTimeout(() => {
        streamTimedOut = true;
        streamController?.abort();
      }, streamIdleTimeoutMs);
    };

    try {
      if (useStream.value) {
        streamController = new AbortController();
        controller.value = streamController;
        refreshStreamTimer();
        const streamResult = await streamMessage(
          conversationId,
          requestPayload,
          {
            meta(data) {
              if (!isCurrentSubmit(submitId, conversationId)) return;
              setProviderMetaIfChanged(data);
              setLatestWorldBookMatches(data?.worldBookMatches);
              refreshStreamTimer();
            },
            user_message(data) {
              if (!isCurrentSubmit(submitId, conversationId)) return;
              finalizeUserDraft(localUser, data.userMessage);
            },
            async reasoning(data) {
              if (!isCurrentSubmit(submitId, conversationId)) return;
              const currentAssistant = getMessageListItemOrDraft(assistant);
              if (!currentAssistant.reasoning) {
                expandReasoning(currentAssistant.id);
              }
              setMessageStreamingState(assistant, { reasoningStreaming: true });
              refreshStreamTimer();
              await appendStreamText(
                assistant,
                'reasoning',
                data.text,
                anchorAssistantReply,
                () => isCurrentSubmit(submitId, conversationId)
              );
              if (!isCurrentSubmit(submitId, conversationId)) return;
              await nextTick();
              if (isCurrentSubmit(submitId, conversationId)) {
                followSubmitScroll(getMessageListItemOrDraft(assistant), anchorAssistantReply);
              }
            },
            async content(data) {
              if (!isCurrentSubmit(submitId, conversationId)) return;
              setMessageStreamingState(assistant, {
                reasoningStreaming: false,
                contentStreaming: true
              });
              refreshStreamTimer();
              await appendStreamText(
                assistant,
                'content',
                data.text,
                anchorAssistantReply,
                () => isCurrentSubmit(submitId, conversationId)
              );
              if (!isCurrentSubmit(submitId, conversationId)) return;
              await nextTick();
              if (isCurrentSubmit(submitId, conversationId)) {
                followSubmitScroll(getMessageListItemOrDraft(assistant), anchorAssistantReply);
              }
            },
            tool(data) {
              if (!isCurrentSubmit(submitId, conversationId)) return;
              if (data?.result?.statusBar) {
                updateStatusBar(data.result.statusBar);
              }
            },
            skill_result(data) {
              if (!isCurrentSubmit(submitId, conversationId)) return;
              handleSkillResult(withConversationContext(data, conversationId));
            },
            skills_done(data) {
              if (Array.isArray(data?.results)) {
                // Skill results are tracked individually via skill_result events.
              }
            },
            async done(data) {
              if (!isCurrentSubmit(submitId, conversationId)) return;
              streamFinished = true;
              clearStreamTimer();
              const currentAssistant = getMessageListItemOrDraft(assistant);
              if (stoppingByUser || !currentAssistant.streaming) {
                return;
              }
              if (!data.assistantMessage && !hasMessagePayload(currentAssistant)) {
                finishAssistantDraft(assistant);
                handleSubmitFailure(
                  '模型没有返回正文，请重试或检查当前模型/网关是否支持该对话格式。',
                  content,
                  conversationId
                );
                return;
              }
              finalizeUserDraft(localUser, data.userMessage);
              const finalizedAssistant = finalizeStreamedAssistant(assistant, data.assistantMessage);
              await reconcilePersistedStreamDrafts(conversationId, localUser, assistant);
              setUsageIfChanged(data.usage || data.assistantMessage?.usage || null);
              setProviderMetaIfChanged({
                ...(providerMeta.value || {}),
                provider: data.provider || providerMeta.value?.provider
              });
              setLatestWorldBookMatches(data?.worldBookMatches);
              if (data.statusBar) {
                updateStatusBar(data.statusBar);
              }
              if (data.accessoryBackground) {
                scheduleAccessoryRefresh(conversationId);
              }
              if (shouldAnchorAssistantReply(anchorAssistantReply)) {
                await nextTick();
                if (isCurrentSubmit(submitId, conversationId)) {
                  scrollToAssistantReply(finalizedAssistant || getMessageListItemOrDraft(assistant), false);
                }
              }
            },
            error(data) {
              if (!isCurrentSubmit(submitId, conversationId)) return;
              streamFinished = true;
              clearStreamTimer();
              finishAssistantDraft(assistant);
              if (!stoppingByUser) {
                handleSubmitFailure(data.error || '生成失败', content, conversationId, {
                  diagnosticId: data?.diagnosticId
                });
              }
            }
          },
          streamController.signal
        );
        clearStreamTimer();
        if (!isCurrentSubmit(submitId, conversationId)) {
          return;
        }
        if (streamResult?.aborted || !streamFinished) {
          const shouldReconcileInterruptedDraft = stoppingByUser && hasCurrentMessagePayload(assistant);
          finishAssistantDraft(assistant);
          if (shouldReconcileInterruptedDraft) {
            await reconcileInterruptedStreamDrafts(conversationId, localUser, assistant);
          }
          if (streamTimedOut && !stoppingByUser) {
            handleSubmitFailure('模型响应超时，请检查网络、余额或模型状态后重试。', content, conversationId);
          } else if (!stoppingByUser && !streamFinished && !hasCurrentMessagePayload(assistant)) {
            handleSubmitFailure('连接已结束，但没有收到模型回复。请检查 API Key、余额或网关状态后重试。', content, conversationId);
          }
        }
        if (!streamResult?.aborted) {
          if (stoppingByUser && hasCurrentMessagePayload(assistant)) {
            await reconcileInterruptedStreamDrafts(conversationId, localUser, assistant);
          } else if (!stoppingByUser) {
            await reconcilePersistedStreamDrafts(conversationId, localUser, assistant);
          }
        }
      } else {
        const result = await sendMessage(conversationId, requestPayload);
        if (!isCurrentSubmit(submitId, conversationId)) {
          return;
        }
        finalizeUserDraft(localUser, result.userMessage);
        const finalizedAssistant = finalizeStreamedAssistant(assistant, result.assistantMessage);
        setUsageIfChanged(result.usage || null);
        setProviderMetaIfChanged({ provider: result.provider });
        setLatestWorldBookMatches(result.worldBookMatches);
        if (Array.isArray(result.skillResults)) {
          result.skillResults.forEach((item) => handleSkillResult(withConversationContext(item, conversationId)));
        }
        if (result.statusBar) {
          updateStatusBar(result.statusBar);
        }
        if (result.accessoryBackground) {
          scheduleAccessoryRefresh(conversationId);
        }
        if (shouldAnchorAssistantReply(anchorAssistantReply)) {
          await nextTick();
          if (isCurrentSubmit(submitId, conversationId)) {
            scrollToAssistantReply(finalizedAssistant || getMessageListItemOrDraft(assistant), false);
          }
        }
      }
      if (isCurrentSubmit(submitId, conversationId)) {
        refreshConversationChrome();
      }
    } catch (err) {
      clearStreamTimer();
      if (!isCurrentSubmit(submitId, conversationId)) {
        return;
      }
      if (streamTimedOut && !stoppingByUser) {
        handleSubmitFailure('模型响应超时，请检查网络、余额或模型状态后重试。', content, conversationId);
      } else if (err.name !== 'AbortError' && !stoppingByUser) {
        handleSubmitFailure(err.message, content, conversationId, {
          canRetry: err?.data?.accepted === false,
          diagnosticId: err?.data?.diagnosticId
        });
      }
      if (err?.data?.accepted === false) {
        removeMessageItemsByIdIfPresent(localUser.id);
      }
      finishAssistantDraft(assistant);
    } finally {
      clearStreamTimer();
      if (isActiveSubmit(submitId)) {
        sending.value = false;
        if (!streamController || controller.value === streamController) {
          controller.value = null;
        }
        stoppingByUser = false;
      }
    }
  }

  function clearAccessoryRefreshTimers() {
    if (typeof window === 'undefined') {
      accessoryRefreshTimers.length = 0;
      return;
    }
    while (accessoryRefreshTimers.length) {
      window.clearTimeout(accessoryRefreshTimers.pop());
    }
  }

  function cancelAccessoryRefresh() {
    accessoryRefreshRun += 1;
    clearAccessoryRefreshTimers();
  }

  function isActiveSubmit(submitId) {
    return !submitDisposed && submitId === submitRunId;
  }

  function isCurrentSubmit(submitId, conversationId = '') {
    const targetConversationId = normalizeConversationId(conversationId);
    return isActiveSubmit(submitId) &&
      (!targetConversationId || normalizeConversationId(route.params.id) === targetConversationId);
  }

  function withConversationContext(data, conversationId) {
    if (!data || typeof data !== 'object') {
      return { conversationId };
    }
    if (data.conversationId === conversationId) {
      return data;
    }
    return { ...data, conversationId };
  }

  function refreshConversationChrome() {
    if (submitDisposed) {
      return;
    }
    const tasks = [];
    const sidebarTask = createRefreshTask(loadSidebarData);
    if (sidebarTask) {
      tasks.push(sidebarTask);
    }
    const economyTask = createRefreshTask(loadEconomyBalance);
    if (economyTask) {
      tasks.push(economyTask);
    }
    if (tasks.length) {
      void Promise.allSettled(tasks);
    }
  }

  function createRefreshTask(task) {
    if (typeof task !== 'function') {
      return null;
    }
    try {
      return task();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function applyStatusBarDirectly(nextStatusBar) {
    statusBar.value = nextStatusBar;
    syncStatusBarForm(nextStatusBar);
    return true;
  }

  function setUsageIfChanged(nextUsage) {
    return setPlainRefIfChanged(usage, nextUsage || null);
  }

  function setProviderMetaIfChanged(nextMeta) {
    return setPlainRefIfChanged(providerMeta, nextMeta || null);
  }

  function setPlainRefIfChanged(valueRef, nextValue) {
    if (samePlainValue(valueRef.value, nextValue)) {
      return false;
    }
    valueRef.value = nextValue;
    return true;
  }

  function followSubmitScroll(message, anchorAssistantReply, smooth = false) {
    if (shouldAnchorAssistantReply(anchorAssistantReply) && scrollToAssistantReply(message, smooth)) {
      return;
    }
    stickToBottomIfNeeded(smooth);
  }

  function shouldAnchorAssistantReply(anchorAssistantReply) {
    return Boolean(anchorAssistantReply && !hasUserPausedAutoScroll());
  }

  function scrollToAssistantReply(message, smooth = false) {
    if (!message?.id || typeof scrollToMessage !== 'function') {
      return false;
    }
    return scrollToMessage(message.id, {
      smooth,
      block: 'end'
    });
  }

  function scheduleAccessoryRefresh(conversationId) {
    const targetConversationId = normalizeConversationId(conversationId);
    if (submitDisposed || typeof window === 'undefined' || !targetConversationId) {
      return;
    }
    const runId = ++accessoryRefreshRun;
    clearAccessoryRefreshTimers();
    if (typeof onAccessoryRefreshStart === 'function') {
      const shouldContinue = onAccessoryRefreshStart({ runId, conversationId: targetConversationId });
      if (shouldContinue === false || !isCurrentAccessoryRefresh(runId, targetConversationId)) {
        return;
      }
    }
    for (const delay of accessoryRefreshDelays) {
      const isFinal = delay === accessoryRefreshDelays[accessoryRefreshDelays.length - 1];
      const timer = window.setTimeout(async () => {
        if (!isCurrentAccessoryRefresh(runId, targetConversationId)) {
          return;
        }
        const results = await Promise.allSettled([
          createRefreshTask(loadStatusBar),
          createRefreshTask(loadEconomyBalance)
        ]);
        if (!isCurrentAccessoryRefresh(runId, targetConversationId)) {
          return;
        }
        if (typeof onAccessoryRefresh === 'function') {
          const shouldContinue = await onAccessoryRefresh({
            runId,
            conversationId: targetConversationId,
            delay,
            isFinal,
            results
          });
          if (shouldContinue === false && isCurrentAccessoryRefresh(runId, targetConversationId)) {
            cancelAccessoryRefresh();
          }
        }
      }, delay);
      accessoryRefreshTimers.push(timer);
    }
  }

  function isCurrentAccessoryRefresh(runId, conversationId) {
    return !submitDisposed &&
      runId === accessoryRefreshRun &&
      normalizeConversationId(route.params.id) === normalizeConversationId(conversationId);
  }

  function stop() {
    stoppingByUser = true;
    controller.value?.abort();
    sending.value = false;
    cancelAccessoryRefresh();
    const last = findLastStreamingMessage();
    if (last) {
      finishAssistantDraft(last);
    }
  }

  function handleSubmitFailure(message, content, conversationId, options = {}) {
    rememberLastFailure(message, content, conversationId, options);
    restoreFailedContentToInput(content, conversationId);
    showError(message);
  }

  function restoreFailedContentToInput(content, conversationId) {
    const normalizedContent = normalizeMessageText(content);
    const normalizedConversationId = normalizeConversationId(conversationId);
    if (!normalizedContent || !normalizedConversationId || stoppingByUser || submitDisposed) {
      return false;
    }
    if (normalizeConversationId(route.params.id) !== normalizedConversationId) {
      return false;
    }
    if (normalizeMessageText(input.value)) {
      return false;
    }
    input.value = normalizedContent;
    return true;
  }

  function rememberLastFailure(message, content, conversationId, options = {}) {
    const normalizedContent = normalizeMessageText(content);
    const normalizedConversationId = normalizeConversationId(conversationId);
    if (!normalizedContent || !normalizedConversationId || stoppingByUser || submitDisposed) {
      return;
    }
    lastFailure.value = {
      message: String(message || '生成失败').trim() || '生成失败',
      content: normalizedContent,
      conversationId: normalizedConversationId,
      diagnosticId: normalizeMessageText(options.diagnosticId),
      canRetry: Boolean(options.canRetry),
      createdAt: new Date().toISOString()
    };
  }

  function clearLastFailure() {
    if (lastFailure.value) {
      lastFailure.value = null;
    }
  }

  function restoreLastFailureInput() {
    const failure = lastFailure.value;
    if (!isRestorableFailure(failure)) {
      return false;
    }
    input.value = failure.content;
    clearLastFailure();
    return true;
  }

  async function retryLastFailure() {
    const failure = lastFailure.value;
    if (!isRestorableFailure(failure) || !failure.canRetry || sending.value) {
      return false;
    }
    input.value = failure.content;
    clearLastFailure();
    await nextTick();
    await submit();
    return true;
  }

  function dismissLastFailure() {
    clearLastFailure();
  }

  function isRestorableFailure(failure) {
    return Boolean(
      failure?.content &&
      failure.conversationId &&
      normalizeConversationId(route.params.id) === normalizeConversationId(failure.conversationId)
    );
  }

  function setLatestWorldBookMatches(matches) {
    const normalizedMatches = normalizeWorldBookMatches(matches);
    if (samePlainValue(latestWorldBookMatches.value, normalizedMatches)) {
      return false;
    }
    latestWorldBookMatches.value = normalizedMatches;
    return true;
  }

  function normalizeWorldBookMatches(matches) {
    const sourceMatches = Array.isArray(matches) ? matches : [];
    const normalizedMatches = [];
    for (const match of sourceMatches) {
      if (!match?.id) {
        continue;
      }
      normalizedMatches.push({
        id: String(match.id),
        name: String(match.name || '未命名条目'),
        worldBookId: String(match.worldBookId || ''),
        worldBookName: String(match.worldBookName || '未命名世界书'),
        position: String(match.position || 'before_char'),
        depth: Number.isFinite(Number(match.depth)) ? Number(match.depth) : 0,
        role: Number.isFinite(Number(match.role)) ? Number(match.role) : 0
      });
      if (normalizedMatches.length >= 12) {
        break;
      }
    }
    return normalizedMatches;
  }

  function findLastStreamingMessage() {
    const messageList = Array.isArray(messages.value) ? messages.value : [];
    for (let index = messageList.length - 1; index >= 0; index -= 1) {
      const message = messageList[index];
      if (message?.streaming) {
        return message;
      }
    }
    return null;
  }

  function appendMessageItems(...items) {
    const messageList = Array.isArray(messages.value) ? messages.value : [];
    const nextMessages = [];
    for (const item of messageList) {
      nextMessages.push(item);
    }
    let appended = false;
    for (const item of items) {
      if (!item) {
        continue;
      }
      nextMessages.push(item);
      appended = true;
    }
    if (!appended) {
      return false;
    }
    messages.value = nextMessages;
    return true;
  }

  function cleanup() {
    submitDisposed = true;
    submitRunId += 1;
    stoppingByUser = true;
    controller.value?.abort();
    controller.value = null;
    sending.value = false;
    cancelAccessoryRefresh();
  }

  function finishAssistantDraft(message) {
    if (submitDisposed || !message) return;
    const currentMessage = findMessageListItem(message.id);
    if (!currentMessage) return;
    const stateChanged = Boolean(
      currentMessage.streaming ||
      currentMessage.reasoningStreaming ||
      currentMessage.contentStreaming
    );
    if (stateChanged) {
      currentMessage.streaming = false;
      currentMessage.reasoningStreaming = false;
      currentMessage.contentStreaming = false;
    }
    if (!currentMessage.content && !currentMessage.reasoning) {
      removeMessageItemsByIdIfPresent(currentMessage.id);
      return;
    }
    if (stateChanged) {
      triggerRef(messages);
    }
  }

  function removeMessageItemsByReferenceIfPresent(...targets) {
    const messageList = Array.isArray(messages.value) ? messages.value : [];
    if (!messageList.length || !targets.length) {
      return false;
    }
    const nextMessages = [];
    let removed = false;
    for (const item of messageList) {
      let shouldRemove = false;
      for (const target of targets) {
        if (item === target) {
          shouldRemove = true;
          break;
        }
      }
      if (shouldRemove) {
        removed = true;
      } else {
        nextMessages.push(item);
      }
    }
    if (!removed) {
      return false;
    }
    messages.value = nextMessages;
    return true;
  }

  function removeMessageItemsByIdIfPresent(messageId) {
    const targetId = normalizeMessageId(messageId);
    const messageList = Array.isArray(messages.value) ? messages.value : [];
    if (!targetId || !messageList.length) {
      return false;
    }
    const nextMessages = [];
    let removed = false;
    for (const item of messageList) {
      if (normalizeMessageId(item?.id) === targetId) {
        removed = true;
      } else {
        nextMessages.push(item);
      }
    }
    if (!removed) {
      return false;
    }
    messages.value = nextMessages;
    return true;
  }

  function reconcileInterruptedStreamDrafts(conversationId, localUser, assistant) {
    return reconcilePersistedStreamDrafts(conversationId, localUser, assistant, {
      attempts: 4,
      delayMs: 120
    });
  }

  async function reconcilePersistedStreamDrafts(conversationId, localUser, assistant, options = {}) {
    if (!isActiveConversation(conversationId)) {
      return;
    }
    if (!needsPersistedDraftReconcile(localUser, assistant)) {
      return;
    }

    const attempts = Math.max(1, Number(options.attempts) || 1);
    const delayMs = Math.max(0, Number(options.delayMs) || 0);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (!isActiveConversation(conversationId) || !needsPersistedDraftReconcile(localUser, assistant)) {
        return;
      }
      const reconciled = await tryReconcilePersistedStreamDrafts(conversationId, localUser, assistant);
      if (reconciled || !isActiveConversation(conversationId) || !needsPersistedDraftReconcile(localUser, assistant)) {
        return;
      }
      if (attempt < attempts && delayMs) {
        await sleep(delayMs * attempt);
      }
    }
  }

  async function tryReconcilePersistedStreamDrafts(conversationId, localUser, assistant) {
    try {
      if (!isActiveConversation(conversationId)) {
        return false;
      }
      const result = await fetchConversationMessages(conversationId);
      if (!isActiveConversation(conversationId) || !Array.isArray(result?.messages)) {
        return false;
      }

      const persistedMessages = result.messages;
      const currentLocalUser = findMessageListItem(localUser?.id);
      const currentAssistant = findMessageListItem(assistant?.id);
      const userDraft = currentLocalUser || localUser;
      const assistantDraft = currentAssistant || assistant;
      const userNeedsReplacement = isLocalDraft(userDraft);
      const assistantNeedsReplacement = isLocalDraft(assistantDraft);
      const userReplacement = userNeedsReplacement
        ? findPersistedUserMessage(persistedMessages, userDraft)
        : userDraft;
      const assistantReplacement = assistantNeedsReplacement
        ? findPersistedAssistantMessage(persistedMessages, assistantDraft, userReplacement)
        : null;
      let updatedMessages = false;

      if (userReplacement && userNeedsReplacement && currentLocalUser) {
        const localContent = currentLocalUser.content;
        Object.assign(currentLocalUser, userReplacement, {
          content: userReplacement.content || localContent || ''
        });
        updatedMessages = true;
      }
      if (assistantReplacement && currentAssistant) {
        const streamedContent = currentAssistant.content;
        const streamedReasoning = currentAssistant.reasoning;
        Object.assign(currentAssistant, assistantReplacement, {
          content: streamedContent || assistantReplacement.content || '',
          reasoning: streamedReasoning || assistantReplacement.reasoning || '',
          streaming: false,
          reasoningStreaming: false,
          contentStreaming: false
        });
        updatedMessages = true;
      }
      if (updatedMessages) {
        triggerRef(messages);
      }
      return Boolean(
        (!userNeedsReplacement || userReplacement) &&
        (!assistantNeedsReplacement || assistantReplacement)
      );
    } catch {
      // Keep the visible streamed draft if the follow-up refresh is unavailable.
      return false;
    }
  }

  async function sleep(delayMs) {
    if (!delayMs) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  function needsPersistedDraftReconcile() {
    for (let index = 0; index < arguments.length; index += 1) {
      const item = arguments[index];
      const currentItem = findMessageListItem(item?.id);
      if (isLocalDraft(currentItem) && !currentItem.streaming) {
        return true;
      }
    }
    return false;
  }

  function isLocalDraft(message) {
    return Boolean(message?.id) && String(message.id).startsWith('local-');
  }

  function isActiveConversation(conversationId) {
    const targetConversationId = normalizeConversationId(conversationId);
    return !submitDisposed &&
      targetConversationId &&
      normalizeConversationId(route.params.id) === targetConversationId;
  }

  function findPersistedUserMessage(messages, draft) {
    const messageList = Array.isArray(messages) ? messages : [];
    const draftContent = normalizeMessageText(draft?.content);
    for (let index = messageList.length - 1; index >= 0; index -= 1) {
      const message = messageList[index];
      if (
        message?.role === 'user' &&
        !isLocalDraft(message) &&
        (!draftContent || normalizeMessageText(message.content) === draftContent)
      ) {
        return message;
      }
    }
    return null;
  }

  function findPersistedAssistantMessage(messages, draft, userMessage = null) {
    const messageList = Array.isArray(messages) ? messages : [];
    let lastPersistedAssistant = null;
    for (const message of messageList) {
      if (isPersistedAssistantMessage(message)) {
        lastPersistedAssistant = message;
      }
    }
    if (!lastPersistedAssistant) {
      return null;
    }

    const userId = normalizeMessageId(userMessage?.id);
    if (userId) {
      let sawUser = false;
      let afterUser = null;
      for (const message of messageList) {
        if (!sawUser) {
          if (normalizeMessageId(message?.id) === userId) {
            sawUser = true;
          }
          continue;
        }
        if (isPersistedAssistantMessage(message)) {
          afterUser = message;
        }
      }
      if (sawUser) {
        return afterUser;
      }
    }

    const userTime = messageTimeValue(userMessage);
    if (userTime) {
      let afterUser = null;
      for (const message of messageList) {
        if (!isPersistedAssistantMessage(message)) {
          continue;
        }
        const messageTime = messageTimeValue(message);
        if (!messageTime || messageTime >= userTime) {
          afterUser = message;
        }
      }
      return afterUser;
    }

    const draftContent = normalizeMessageText(draft?.content);
    const draftReasoning = normalizeMessageText(draft?.reasoning);
    if (draftContent || draftReasoning) {
      for (let index = messageList.length - 1; index >= 0; index -= 1) {
        const message = messageList[index];
        if (
          isPersistedAssistantMessage(message) &&
          (!draftContent || normalizeMessageText(message.content) === draftContent) &&
          (!draftReasoning || normalizeMessageText(message.reasoning) === draftReasoning)
        ) {
          return message;
        }
      }
    }

    return lastPersistedAssistant;
  }

  function isPersistedAssistantMessage(message) {
    return message?.role === 'assistant' && !isLocalDraft(message);
  }

  function normalizeMessageText(value) {
    return String(value || '').trim();
  }

  function messageTimeValue(message = {}) {
    const time = Date.parse(message?.createdAt || '');
    return Number.isFinite(time) ? time : 0;
  }

  function finalizeUserDraft(message, serverMessage = {}) {
    if (submitDisposed) return;
    const currentMessage = findMessageListItem(message?.id);
    if (!currentMessage || !serverMessage?.id) {
      return null;
    }
    const localContent = currentMessage.content;
    Object.assign(currentMessage, serverMessage, {
      content: serverMessage.content || localContent || ''
    });
    triggerRef(messages);
    return currentMessage;
  }

  function finalizeStreamedAssistant(message, serverMessage = {}) {
    if (submitDisposed) return;
    const currentMessage = findMessageListItem(message?.id);
    if (!currentMessage) return null;
    const finalServerMessage = serverMessage && typeof serverMessage === 'object' ? serverMessage : {};
    const streamedContent = currentMessage.content;
    const streamedReasoning = currentMessage.reasoning;
    Object.assign(currentMessage, finalServerMessage, {
      content: streamedContent || finalServerMessage.content || '',
      reasoning: streamedReasoning || finalServerMessage.reasoning || '',
      streaming: false,
      reasoningStreaming: false,
      contentStreaming: false
    });
    if (!hasMessagePayload(currentMessage)) {
      finishAssistantDraft(currentMessage);
      return null;
    }
    triggerRef(messages);
    return currentMessage;
  }

  function hasMessagePayload(message = {}) {
    return Boolean(String(message.content || '').trim() || String(message.reasoning || '').trim());
  }

  function hasCurrentMessagePayload(message = {}) {
    return hasMessagePayload(getMessageListItemOrDraft(message));
  }

  async function appendStreamText(message, field, text, anchorAssistantReply = false, isStillCurrent = () => true) {
    if (submitDisposed) return;
    const currentMessage = findMessageListItem(message?.id);
    if (!currentMessage) return;
    const value = String(text || '');
    if (!value || !currentMessage.streaming) {
      return;
    }

    currentMessage[field] += value;
    triggerRef(messages);
    await nextTick();
    if (submitDisposed || !currentMessage.streaming || !isStillCurrent()) {
      return;
    }
    followSubmitScroll(currentMessage, anchorAssistantReply, false);
  }

  function setMessageStreamingState(message, nextState = {}) {
    if (submitDisposed) return null;
    const currentMessage = findMessageListItem(message?.id);
    if (!currentMessage) return null;
    let changed = false;
    for (const key in nextState) {
      if (!Object.prototype.hasOwnProperty.call(nextState, key)) {
        continue;
      }
      const value = nextState[key];
      if (currentMessage[key] !== value) {
        currentMessage[key] = value;
        changed = true;
      }
    }
    if (changed) {
      triggerRef(messages);
    }
    return currentMessage;
  }

  function getMessageListItemOrDraft(message) {
    return findMessageListItem(message?.id) || message || {};
  }

  function findMessageListItem(messageId) {
    const targetId = normalizeMessageId(messageId);
    const messageList = Array.isArray(messages.value) ? messages.value : [];
    if (!targetId) {
      return null;
    }
    for (const item of messageList) {
      if (normalizeMessageId(item?.id) === targetId) {
        return item;
      }
    }
    return null;
  }

  function normalizeConversationId(conversationId) {
    return String(conversationId ?? '').trim();
  }

  function normalizeMessageId(messageId) {
    return String(messageId ?? '').trim();
  }

  return {
    input,
    useStream,
    thinkingEnabled,
    sending,
    controller,
    usage,
    providerMeta,
    lastFailure,
    latestWorldBookMatches,
    canSend,
    canToggleThinking,
    submit,
    stop,
    restoreLastFailureInput,
    retryLastFailure,
    dismissLastFailure,
    setSelectedPresetId,
    toggleUseStream,
    toggleThinking,
    finishAssistantDraft,
    cleanup
  };
}
