import { computed, nextTick, ref, triggerRef } from 'vue';
import { sendMessage, streamMessage } from '../../api';

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
  onAccessoryRefresh,
  stickToBottomIfNeeded,
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
    useStream.value = !useStream.value;
    writeLocalBoolean('flai-chat-use-stream', useStream.value);
  }

  function toggleThinking() {
    if (!canToggleThinking.value) {
      return;
    }
    thinkingEnabled.value = !thinkingEnabled.value;
    writeLocalBoolean('flai-chat-thinking-enabled', thinkingEnabled.value);
  }

  async function submit() {
    const content = input.value.trim();
    if (!content || sending.value) {
      return;
    }

    input.value = '';
    await nextTick();

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
    stickToBottomIfNeeded(true);

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
              providerMeta.value = data;
              refreshStreamTimer();
            },
            async reasoning(data) {
              if (!assistant.reasoning) {
                expandReasoning(assistant.id);
              }
              assistant.reasoningStreaming = true;
              refreshStreamTimer();
              await appendStreamText(assistant, 'reasoning', data.text);
              await nextTick();
              stickToBottomIfNeeded();
            },
            async content(data) {
              assistant.reasoningStreaming = false;
              assistant.contentStreaming = true;
              refreshStreamTimer();
              await appendStreamText(assistant, 'content', data.text);
              await nextTick();
              stickToBottomIfNeeded();
            },
            tool(data) {
              if (data?.result?.statusBar) {
                statusBar.value = data.result.statusBar;
                syncStatusBarForm(data.result.statusBar);
              }
            },
            skill_result(data) {
              handleSkillResult(data);
            },
            skills_done(data) {
              if (Array.isArray(data?.results)) {
                // Skill results are tracked individually via skill_result events.
              }
            },
            async done(data) {
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
              finalizeStreamedAssistant(assistant, data.assistantMessage);
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
            },
            error(data) {
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
        if (streamResult?.aborted || !streamFinished) {
          finishAssistantDraft(assistant);
          if (streamTimedOut && !stoppingByUser) {
            showError('模型响应超时，请检查网络、余额或模型状态后重试。');
          } else if (!stoppingByUser && !streamFinished && !assistant.content && !assistant.reasoning) {
            showError('连接已结束，但没有收到模型回复。请检查 API Key、余额或网关状态后重试。');
          }
        }
      } else {
        const result = await sendMessage(route.params.id, requestPayload);
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
      }
      refreshConversationChrome();
    } catch (err) {
      clearStreamTimer();
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
      sending.value = false;
      controller.value = null;
      stoppingByUser = false;
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

  function refreshConversationChrome() {
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

  function scheduleAccessoryRefresh() {
    if (typeof window === 'undefined') {
      return;
    }
    const runId = ++accessoryRefreshRun;
    clearAccessoryRefreshTimers();
    for (const delay of accessoryRefreshDelays) {
      const timer = window.setTimeout(async () => {
        if (runId !== accessoryRefreshRun) {
          return;
        }
        const results = await Promise.allSettled([
          createRefreshTask(loadStatusBar),
          createRefreshTask(loadEconomyBalance)
        ]);
        if (runId !== accessoryRefreshRun) {
          return;
        }
        if (typeof onAccessoryRefresh === 'function') {
          onAccessoryRefresh(results);
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
    cancelAccessoryRefresh();
  }

  function finishAssistantDraft(message) {
    message.streaming = false;
    message.reasoningStreaming = false;
    message.contentStreaming = false;
    if (!message.content && !message.reasoning) {
      messages.value = messages.value.filter((item) => item.id !== message.id);
    }
    triggerRef(messages);
  }

  function finalizeStreamedAssistant(message, serverMessage = {}) {
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

  async function appendStreamText(message, field, text) {
    const value = String(text || '');
    if (!value || !message.streaming) {
      return;
    }

    message[field] += value;
    triggerRef(messages);
    await nextTick();
    stickToBottomIfNeeded(false);
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
    toggleUseStream,
    toggleThinking,
    finishAssistantDraft,
    cleanup
  };
}
