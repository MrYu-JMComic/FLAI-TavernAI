import { computed, nextTick, ref, triggerRef } from 'vue';
import { fetchConversationMessages, sendMessage, streamMessage } from '../../api.js';

export function useChatSubmit({
  route,
  messages,
  provider,
  selectedPresetId,
  statusBar,
  syncStatusBarForm,
  handleSkillResult,
  loadStatusBar,
  loadSidebarData,
  loadEconomyBalance,
  onAccessoryRefreshStart,
  onAccessoryRefresh,
  isPinnedToBottom = () => false,
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

  let stoppingByUser = false;
  let accessoryRefreshRun = 0;
  let submitRunId = 0;
  let submitDisposed = false;
  const accessoryRefreshTimers = [];

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
    if (!content || sending.value || submitDisposed) {
      return;
    }
    const submitId = ++submitRunId;
    const anchorAssistantReply = isPinnedToBottom() && prepareExpandedStatusBarForSubmit();

    input.value = '';
    await nextTick();
    if (!isCurrentSubmit(submitId)) {
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
    messages.value.push(localUserDraft, assistantDraft);
    const localUser = messages.value[messages.value.length - 2];
    const assistant = messages.value[messages.value.length - 1];
    sending.value = true;
    await nextTick();
    if (!isCurrentSubmit(submitId)) {
      messages.value = messages.value.filter((message) => message !== localUser && message !== assistant);
      sending.value = false;
      return;
    }
    const assistantReplyAnchored = anchorAssistantReply && scrollToAssistantReply(assistant, true);
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
        controller.value?.abort();
      }, streamIdleTimeoutMs);
    };

    try {
      if (useStream.value) {
        controller.value = new AbortController();
        refreshStreamTimer();
        const streamResult = await streamMessage(
          route.params.id,
          requestPayload,
          {
            meta(data) {
              if (!isCurrentSubmit(submitId)) return;
              providerMeta.value = data;
              refreshStreamTimer();
            },
            user_message(data) {
              if (!isCurrentSubmit(submitId)) return;
              finalizeUserDraft(localUser, data.userMessage);
            },
            async reasoning(data) {
              if (!isCurrentSubmit(submitId)) return;
              if (!assistant.reasoning) {
                expandReasoning(assistant.id);
              }
              assistant.reasoningStreaming = true;
              refreshStreamTimer();
              await appendStreamText(assistant, 'reasoning', data.text, anchorAssistantReply);
              if (!isCurrentSubmit(submitId)) return;
              await nextTick();
              if (isCurrentSubmit(submitId)) {
                followSubmitScroll(assistant, anchorAssistantReply);
              }
            },
            async content(data) {
              if (!isCurrentSubmit(submitId)) return;
              assistant.reasoningStreaming = false;
              assistant.contentStreaming = true;
              refreshStreamTimer();
              await appendStreamText(assistant, 'content', data.text, anchorAssistantReply);
              if (!isCurrentSubmit(submitId)) return;
              await nextTick();
              if (isCurrentSubmit(submitId)) {
                followSubmitScroll(assistant, anchorAssistantReply);
              }
            },
            tool(data) {
              if (!isCurrentSubmit(submitId)) return;
              if (data?.result?.statusBar) {
                statusBar.value = data.result.statusBar;
                syncStatusBarForm(data.result.statusBar);
              }
            },
            skill_result(data) {
              if (!isCurrentSubmit(submitId)) return;
              handleSkillResult(data);
            },
            skills_done(data) {
              if (Array.isArray(data?.results)) {
                // Skill results are tracked individually via skill_result events.
              }
            },
            async done(data) {
              if (!isCurrentSubmit(submitId)) return;
              streamFinished = true;
              clearStreamTimer();
              if (stoppingByUser || !assistant.streaming) {
                return;
              }
              if (!data.assistantMessage && !hasMessagePayload(assistant)) {
                finishAssistantDraft(assistant);
                showError('模型没有返回正文，请重试或检查当前模型/网关是否支持该对话格式。');
                return;
              }
              finalizeUserDraft(localUser, data.userMessage);
              finalizeStreamedAssistant(assistant, data.assistantMessage);
              await reconcilePersistedStreamDrafts(route.params.id, localUser, assistant);
              usage.value = data.usage || data.assistantMessage?.usage || null;
              providerMeta.value = {
                ...(providerMeta.value || {}),
                provider: data.provider || providerMeta.value?.provider
              };
              if (data.statusBar) {
                statusBar.value = data.statusBar;
                syncStatusBarForm(data.statusBar);
              }
              if (data.accessoryBackground) {
                scheduleAccessoryRefresh();
              }
              if (anchorAssistantReply) {
                await nextTick();
                if (isCurrentSubmit(submitId)) {
                  scrollToAssistantReply(assistant, false);
                }
              }
            },
            error(data) {
              if (!isCurrentSubmit(submitId)) return;
              streamFinished = true;
              clearStreamTimer();
              finishAssistantDraft(assistant);
              if (!stoppingByUser) {
                showError(data.error || '生成失败');
              }
            }
          },
          controller.value.signal
        );
        clearStreamTimer();
        if (!isCurrentSubmit(submitId)) {
          return;
        }
        if (streamResult?.aborted || !streamFinished) {
          const shouldReconcileInterruptedDraft = stoppingByUser && hasMessagePayload(assistant);
          finishAssistantDraft(assistant);
          if (shouldReconcileInterruptedDraft) {
            await reconcileInterruptedStreamDrafts(route.params.id, localUser, assistant);
          }
          if (streamTimedOut && !stoppingByUser) {
            showError('模型响应超时，请检查网络、余额或模型状态后重试。');
          } else if (!stoppingByUser && !streamFinished && !assistant.content && !assistant.reasoning) {
            showError('连接已结束，但没有收到模型回复。请检查 API Key、余额或网关状态后重试。');
          }
        }
        if (!streamResult?.aborted) {
          if (stoppingByUser && hasMessagePayload(assistant)) {
            await reconcileInterruptedStreamDrafts(route.params.id, localUser, assistant);
          } else if (!stoppingByUser) {
            await reconcilePersistedStreamDrafts(route.params.id, localUser, assistant);
          }
        }
      } else {
        const result = await sendMessage(route.params.id, requestPayload);
        if (!isCurrentSubmit(submitId)) {
          return;
        }
        Object.assign(localUser, result.userMessage);
        Object.assign(assistant, result.assistantMessage, { streaming: false });
        usage.value = result.usage || null;
        providerMeta.value = { provider: result.provider };
        if (Array.isArray(result.skillResults)) {
          result.skillResults.forEach((item) => handleSkillResult(item));
        }
        if (result.statusBar) {
          statusBar.value = result.statusBar;
          syncStatusBarForm(result.statusBar);
        }
        if (result.accessoryBackground) {
          scheduleAccessoryRefresh();
        }
        if (anchorAssistantReply) {
          await nextTick();
          if (isCurrentSubmit(submitId)) {
            scrollToAssistantReply(assistant, false);
          }
        }
      }
      if (isCurrentSubmit(submitId)) {
        refreshConversationChrome();
      }
    } catch (err) {
      clearStreamTimer();
      if (!isCurrentSubmit(submitId)) {
        return;
      }
      if (streamTimedOut && !stoppingByUser) {
        showError('模型响应超时，请检查网络、余额或模型状态后重试。');
      } else if (err.name !== 'AbortError' && !stoppingByUser) {
        showError(err.message);
      }
      if (err.data?.accepted === false) {
        messages.value = messages.value.filter((message) => message.id !== localUser.id);
      }
      finishAssistantDraft(assistant);
    } finally {
      clearStreamTimer();
      if (isCurrentSubmit(submitId)) {
        sending.value = false;
        controller.value = null;
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

  function isCurrentSubmit(submitId) {
    return !submitDisposed && submitId === submitRunId;
  }

  function refreshConversationChrome() {
    if (submitDisposed) {
      return;
    }
    const tasks = [
      createRefreshTask(loadSidebarData),
      createRefreshTask(loadEconomyBalance)
    ].filter(Boolean);
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

  function followSubmitScroll(message, anchorAssistantReply, smooth = false) {
    if (anchorAssistantReply && scrollToAssistantReply(message, smooth)) {
      return;
    }
    stickToBottomIfNeeded(smooth);
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

  function scheduleAccessoryRefresh() {
    if (submitDisposed || typeof window === 'undefined') {
      return;
    }
    const runId = ++accessoryRefreshRun;
    clearAccessoryRefreshTimers();
    if (typeof onAccessoryRefreshStart === 'function') {
      onAccessoryRefreshStart({ runId });
    }
    for (const delay of accessoryRefreshDelays) {
      const isFinal = delay === accessoryRefreshDelays[accessoryRefreshDelays.length - 1];
      const timer = window.setTimeout(async () => {
        if (submitDisposed || runId !== accessoryRefreshRun) {
          return;
        }
        const results = await Promise.allSettled([
          createRefreshTask(loadStatusBar),
          createRefreshTask(loadEconomyBalance)
        ]);
        if (submitDisposed || runId !== accessoryRefreshRun) {
          return;
        }
        if (typeof onAccessoryRefresh === 'function') {
          await onAccessoryRefresh({ runId, delay, isFinal, results });
        }
      }, delay);
      accessoryRefreshTimers.push(timer);
    }
  }

  function stop() {
    stoppingByUser = true;
    controller.value?.abort();
    sending.value = false;
    cancelAccessoryRefresh();
    const last = [...messages.value].reverse().find((message) => message.streaming);
    if (last) {
      finishAssistantDraft(last);
    }
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
    if (submitDisposed) return;
    message.streaming = false;
    message.reasoningStreaming = false;
    message.contentStreaming = false;
    if (!message.content && !message.reasoning) {
      messages.value = messages.value.filter((item) => item.id !== message.id);
    }
    triggerRef(messages);
  }

  function reconcileInterruptedStreamDrafts(conversationId, localUser, assistant) {
    return reconcilePersistedStreamDrafts(conversationId, localUser, assistant, {
      attempts: 4,
      delayMs: 120
    });
  }

  async function reconcilePersistedStreamDrafts(conversationId, localUser, assistant, options = {}) {
    if (submitDisposed) {
      return;
    }
    if (!needsPersistedDraftReconcile(localUser, assistant)) {
      return;
    }

    const attempts = Math.max(1, Number(options.attempts) || 1);
    const delayMs = Math.max(0, Number(options.delayMs) || 0);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const reconciled = await tryReconcilePersistedStreamDrafts(conversationId, localUser, assistant);
      if (reconciled || submitDisposed || !needsPersistedDraftReconcile(localUser, assistant)) {
        return;
      }
      if (attempt < attempts && delayMs) {
        await sleep(delayMs * attempt);
      }
    }
  }

  async function tryReconcilePersistedStreamDrafts(conversationId, localUser, assistant) {
    try {
      const result = await fetchConversationMessages(conversationId);
      if (submitDisposed || route.params.id !== conversationId || !Array.isArray(result?.messages)) {
        return false;
      }

      const persistedMessages = result.messages;
      const userReplacement = isLocalDraft(localUser)
        ? findPersistedUserMessage(persistedMessages, localUser)
        : localUser;
      const assistantReplacement = isLocalDraft(assistant)
        ? findPersistedAssistantMessage(persistedMessages, assistant, userReplacement)
        : null;

      if (userReplacement && isLocalDraft(localUser)) {
        const localContent = localUser.content;
        Object.assign(localUser, userReplacement, {
          content: userReplacement.content || localContent || ''
        });
      }
      if (assistantReplacement) {
        const streamedContent = assistant.content;
        const streamedReasoning = assistant.reasoning;
        Object.assign(assistant, assistantReplacement, {
          content: streamedContent || assistantReplacement.content || '',
          reasoning: streamedReasoning || assistantReplacement.reasoning || '',
          streaming: false,
          reasoningStreaming: false,
          contentStreaming: false
        });
      }
      triggerRef(messages);
      return Boolean(
        (!isLocalDraft(localUser) || userReplacement) &&
        (!isLocalDraft(assistant) || assistantReplacement)
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

  function needsPersistedDraftReconcile(...items) {
    return items.some((item) => isLocalDraft(item) && !item.streaming);
  }

  function isLocalDraft(message) {
    return Boolean(message?.id) && String(message.id).startsWith('local-');
  }

  function findPersistedUserMessage(messages, draft) {
    const draftContent = normalizeMessageText(draft?.content);
    return [...messages].reverse().find((message) => (
      message.role === 'user' &&
      !isLocalDraft(message) &&
      (!draftContent || normalizeMessageText(message.content) === draftContent)
    )) || null;
  }

  function findPersistedAssistantMessage(messages, draft, userMessage = null) {
    const candidates = messages.filter((message) => message.role === 'assistant' && !isLocalDraft(message));
    if (!candidates.length) {
      return null;
    }

    const userIndex = userMessage?.id
      ? messages.findIndex((message) => message.id === userMessage.id)
      : -1;
    if (userIndex >= 0) {
      const afterUser = messages
        .slice(userIndex + 1)
        .filter((message) => message.role === 'assistant' && !isLocalDraft(message));
      return afterUser.length ? afterUser[afterUser.length - 1] : null;
    }

    const userTime = messageTimeValue(userMessage);
    if (userTime) {
      const afterUser = candidates.filter((message) => {
        const messageTime = messageTimeValue(message);
        return !messageTime || messageTime >= userTime;
      });
      if (afterUser.length) {
        return afterUser[afterUser.length - 1];
      }
      return null;
    }

    const draftContent = normalizeMessageText(draft?.content);
    const draftReasoning = normalizeMessageText(draft?.reasoning);
    if (draftContent || draftReasoning) {
      const exact = [...candidates].reverse().find((message) => (
        (!draftContent || normalizeMessageText(message.content) === draftContent) &&
        (!draftReasoning || normalizeMessageText(message.reasoning) === draftReasoning)
      ));
      if (exact) {
        return exact;
      }
    }

    return candidates[candidates.length - 1];
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
    if (!message || !serverMessage?.id) {
      return;
    }
    const localContent = message.content;
    Object.assign(message, serverMessage, {
      content: serverMessage.content || localContent || ''
    });
    triggerRef(messages);
  }

  function finalizeStreamedAssistant(message, serverMessage = {}) {
    if (submitDisposed) return;
    const finalServerMessage = serverMessage && typeof serverMessage === 'object' ? serverMessage : {};
    const streamedContent = message.content;
    const streamedReasoning = message.reasoning;
    Object.assign(message, finalServerMessage, {
      content: streamedContent || finalServerMessage.content || '',
      reasoning: streamedReasoning || finalServerMessage.reasoning || '',
      streaming: false,
      reasoningStreaming: false,
      contentStreaming: false
    });
    if (!hasMessagePayload(message)) {
      finishAssistantDraft(message);
      return;
    }
    triggerRef(messages);
  }

  function hasMessagePayload(message = {}) {
    return Boolean(String(message.content || '').trim() || String(message.reasoning || '').trim());
  }

  async function appendStreamText(message, field, text, anchorAssistantReply = false) {
    if (submitDisposed) return;
    const value = String(text || '');
    if (!value || !message.streaming) {
      return;
    }

    message[field] += value;
    triggerRef(messages);
    await nextTick();
    followSubmitScroll(message, anchorAssistantReply, false);
  }

  return {
    input,
    useStream,
    thinkingEnabled,
    sending,
    controller,
    usage,
    providerMeta,
    canSend,
    canToggleThinking,
    submit,
    stop,
    setSelectedPresetId,
    toggleUseStream,
    toggleThinking,
    finishAssistantDraft,
    cleanup
  };
}
