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
  loadSidebarData,
  loadEconomyBalance,
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
  let graphemeSegmenter = null;

  const streamIdleTimeoutMs = 60000;
  const streamFastChunkLength = 120;
  const streamMediumChunkLength = 48;
  const streamPunctuationPauseMs = 58;

  const canSend = computed(() => input.value.trim() && !sending.value);
  const canToggleThinking = computed(() => provider.value?.providerType === 'deepseek');

  function readLocalBoolean(key, fallback) {
    if (typeof window === 'undefined') {
      return fallback;
    }
    const value = window.localStorage.getItem(key);
    if (value === null) {
      return fallback;
    }
    return value === 'true';
  }

  function writeLocalBoolean(key, value) {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(key, String(Boolean(value)));
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
      }
      await loadSidebarData();
      await loadEconomyBalance();
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

  function stop() {
    stoppingByUser = true;
    controller.value?.abort();
    sending.value = false;
    const last = [...messages.value].reverse().find((message) => message.streaming);
    if (last) {
      finishAssistantDraft(last);
    }
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
    const streamedContent = message.content;
    const streamedReasoning = message.reasoning;
    Object.assign(message, serverMessage, {
      content: streamedContent || serverMessage.content || '',
      reasoning: streamedReasoning || serverMessage.reasoning || '',
      streaming: false,
      reasoningStreaming: false,
      contentStreaming: false
    });
    triggerRef(messages);
  }

  async function appendStreamText(message, field, text) {
    const value = String(text || '');
    if (!value) {
      return;
    }

    let buffer = value;
    while (buffer && message.streaming) {
      const chunk = takeTypingChunk(buffer);
      buffer = buffer.slice(chunk.length);
      message[field] += chunk;
      triggerRef(messages);
      await nextTick();
      stickToBottomIfNeeded(false);
      await waitTypingCadence(chunk, buffer.length, value.length);
    }
  }

  function takeTypingChunk(text) {
    const segments = splitGraphemes(text);
    if (segments.length > streamFastChunkLength) {
      return segments.slice(0, 3).join('');
    }
    if (segments.length > streamMediumChunkLength) {
      return segments.slice(0, 2).join('');
    }
    return segments[0] || '';
  }

  function splitGraphemes(text) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      graphemeSegmenter ||= new Intl.Segmenter('zh', { granularity: 'grapheme' });
      return Array.from(graphemeSegmenter.segment(text), (item) => item.segment);
    }
    return Array.from(text);
  }

  async function waitTypingCadence(chunk, remainingLength, originalLength) {
    let delay = 22;
    if (originalLength > streamFastChunkLength || remainingLength > streamFastChunkLength) {
      delay = 10;
    } else if (originalLength > streamMediumChunkLength || remainingLength > streamMediumChunkLength) {
      delay = 15;
    }

    if (/[\u3002\uff01\uff1f!?\uff1b;\uff1a:\uff0c,\u3001\u2026]$/.test(chunk.trim())) {
      delay += streamPunctuationPauseMs;
    }
    await waitMs(delay);
  }

  function waitMs(duration) {
    if (typeof window === 'undefined') {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      window.setTimeout(resolve, duration);
    });
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
    finishAssistantDraft
  };
}
