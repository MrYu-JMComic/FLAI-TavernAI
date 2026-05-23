<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import {
  Brain,
  ChevronDown,
  ChevronRight,
  Home,
  Menu,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Send,
  Settings,
  Sparkles,
  Square,
  UserRound,
  Zap
} from '@lucide/vue';
import {
  createConversation,
  fetchCharacters,
  fetchConversationMessages,
  fetchConversations,
  sendMessage,
  streamMessage
} from '../api';

const props = defineProps({
  route: {
    type: Object,
    required: true
  },
  user: {
    type: Object,
    default: null
  },
  provider: {
    type: Object,
    default: null
  }
});
const emit = defineEmits(['navigate']);

const conversation = ref(null);
const conversations = ref([]);
const characters = ref([]);
const messages = ref([]);
const input = ref('');
const useStream = ref(readLocalBoolean('flai-chat-use-stream', true));
const thinkingEnabled = ref(readLocalBoolean('flai-chat-thinking-enabled', false));
const sidebarOpen = ref(typeof window === 'undefined' ? true : window.innerWidth > 980);
const historySearch = ref('');
const loading = ref(false);
const sending = ref(false);
const error = ref('');
const usage = ref(null);
const providerMeta = ref(null);
const controller = ref(null);
const messageScroller = ref(null);
const expandedReasoning = ref(new Set());
let stoppingByUser = false;
const streamIdleTimeoutMs = 60000;
const streamFastBacklog = 160;
const streamMediumBacklog = 64;
const streamPunctuationPauseMs = 46;
const streamAnimations = new Map();
let graphemeSegmenter = null;

const canSend = computed(() => input.value.trim() && !sending.value);
const canToggleThinking = computed(() => props.provider?.providerType === 'deepseek');
const needsProviderFix = computed(() => {
  return /API Key|SK|密钥|供应商|网关|模型/.test(error.value);
});
const filteredConversations = computed(() => {
  const query = historySearch.value.trim().toLowerCase();
  if (!query) {
    return conversations.value;
  }
  return conversations.value.filter((item) => {
    return `${item.title} ${item.character?.name || ''}`.toLowerCase().includes(query);
  });
});
const currentProviderLabel = computed(() => {
  return providerMeta.value?.provider || props.provider?.gatewayName || 'Local Mock';
});
const currentModelLabel = computed(() => {
  return providerMeta.value?.model || props.provider?.model || '未配置模型';
});

onMounted(async () => {
  await loadConversation();
  await loadSidebarData();
});

watch(useStream, (value) => {
  writeLocalBoolean('flai-chat-use-stream', value);
});

watch(thinkingEnabled, (value) => {
  writeLocalBoolean('flai-chat-thinking-enabled', value);
});

async function loadConversation() {
  loading.value = true;
  error.value = '';
  try {
    const result = await fetchConversationMessages(props.route.params.id);
    conversation.value = result.conversation;
    messages.value = result.messages;
    await nextTick();
    scrollToBottom(false);
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function loadSidebarData() {
  const currentCharacterId = conversation.value?.characterId;
  const [history, characterList] = await Promise.all([
    fetchConversations({ characterId: currentCharacterId }).catch(() => []),
    fetchCharacters().catch(() => [])
  ]);
  conversations.value = history;
  characters.value = characterList;
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
    emit('navigate', 'chat', { id: created.id });
  } catch (err) {
    error.value = err.message;
  }
}

async function submit() {
  const content = input.value.trim();
  if (!content || sending.value) {
    return;
  }

  error.value = '';
  input.value = '';
  const localUser = {
    id: `local-user-${Date.now()}`,
    role: 'user',
    content,
    reasoning: '',
    createdAt: new Date().toISOString()
  };
  const assistant = {
    id: `local-assistant-${Date.now()}`,
    role: 'assistant',
    content: '',
    reasoning: '',
    createdAt: new Date().toISOString(),
    streaming: true
  };
  messages.value.push(localUser, assistant);
  sending.value = true;
  await nextTick();
  scrollToBottom();

  const requestPayload = {
    content,
    thinkingEnabled: canToggleThinking.value ? thinkingEnabled.value : true
  };
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
        props.route.params.id,
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
            refreshStreamTimer();
            appendStreamText(assistant, 'reasoning', data.text);
            await nextTick();
            scrollToBottom();
          },
          async content(data) {
            refreshStreamTimer();
            appendStreamText(assistant, 'content', data.text);
            await nextTick();
            scrollToBottom();
          },
          async done(data) {
            streamFinished = true;
            clearStreamTimer();
            await waitForMessageAnimations(assistant);
            if (stoppingByUser || !assistant.streaming) {
              return;
            }
            Object.assign(assistant, data.assistantMessage, { streaming: false });
            usage.value = data.usage || data.assistantMessage?.usage || null;
            providerMeta.value = {
              ...(providerMeta.value || {}),
              provider: data.provider || providerMeta.value?.provider
            };
          },
          error(data) {
            streamFinished = true;
            clearStreamTimer();
            clearMessageAnimations(assistant);
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
          showError(error.value || '连接已结束，但没有收到模型回复。请检查 API Key、余额或网关状态后重试。');
        }
      }
    } else {
      const result = await sendMessage(props.route.params.id, requestPayload);
      Object.assign(localUser, result.userMessage);
      Object.assign(assistant, result.assistantMessage, { streaming: false });
      usage.value = result.usage || null;
      providerMeta.value = { provider: result.provider };
    }
    await loadSidebarData();
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
  clearMessageAnimations(message);
  message.streaming = false;
  if (!message.content && !message.reasoning) {
    messages.value = messages.value.filter((item) => item.id !== message.id);
  }
}

function showError(message) {
  error.value = message;
  nextTick(() => scrollToBottom());
}

function appendStreamText(message, field, text) {
  const value = String(text || '');
  if (!value) {
    return;
  }

  const key = streamAnimationKey(message, field);
  const state = streamAnimations.get(key) || {
    buffer: '',
    running: false,
    waiters: []
  };
  state.buffer += value;
  streamAnimations.set(key, state);

  if (!state.running) {
    void drainStreamText(message, field, key, state);
  }
}

async function drainStreamText(message, field, key, state) {
  state.running = true;

  while (state.buffer && message.streaming) {
    const chunk = takeTypingChunk(state.buffer);
    state.buffer = state.buffer.slice(chunk.length);
    message[field] += chunk;
    await nextTick();
    scrollToBottom(false);
    await waitTypingCadence(chunk, state.buffer.length);
  }

  state.running = false;
  if (!message.streaming) {
    state.buffer = '';
  }
  resolveAnimationWaiters(state);

  if (!state.buffer) {
    streamAnimations.delete(key);
  } else if (message.streaming) {
    void drainStreamText(message, field, key, state);
  }
}

function takeTypingChunk(text) {
  const segments = splitGraphemes(text);
  if (segments.length > streamFastBacklog) {
    return segments.slice(0, 5).join('');
  }
  if (segments.length > streamMediumBacklog) {
    return segments.slice(0, 3).join('');
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

async function waitTypingCadence(chunk, remainingLength) {
  await waitFrame();
  if (remainingLength > streamMediumBacklog || !/[。！？!?；;：:，,、…]$/.test(chunk.trim())) {
    return;
  }
  await waitMs(streamPunctuationPauseMs);
}

function waitFrame() {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function waitMs(duration) {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    window.setTimeout(resolve, duration);
  });
}

function streamAnimationKey(message, field) {
  return `${message.id}:${field}`;
}

function waitForMessageAnimations(message) {
  return Promise.all([
    waitForStreamAnimation(streamAnimationKey(message, 'content')),
    waitForStreamAnimation(streamAnimationKey(message, 'reasoning'))
  ]);
}

function waitForStreamAnimation(key) {
  const state = streamAnimations.get(key);
  if (!state || (!state.running && !state.buffer)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    state.waiters.push(resolve);
  });
}

function clearMessageAnimations(message) {
  for (const field of ['content', 'reasoning']) {
    const key = streamAnimationKey(message, field);
    const state = streamAnimations.get(key);
    if (!state) {
      continue;
    }
    state.buffer = '';
    resolveAnimationWaiters(state);
    streamAnimations.delete(key);
  }
}

function resolveAnimationWaiters(state) {
  const waiters = state.waiters.splice(0);
  for (const resolve of waiters) {
    resolve();
  }
}

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

function toggleReasoning(messageId) {
  const next = new Set(expandedReasoning.value);
  if (next.has(messageId)) {
    next.delete(messageId);
  } else {
    next.add(messageId);
  }
  expandedReasoning.value = next;
}

function expandReasoning(messageId) {
  if (expandedReasoning.value.has(messageId)) {
    return;
  }
  const next = new Set(expandedReasoning.value);
  next.add(messageId);
  expandedReasoning.value = next;
}

function reasoningOpen(messageId) {
  return expandedReasoning.value.has(messageId);
}

function messagePlaceholder(message) {
  if (!message.streaming) {
    return '';
  }
  if (message.reasoning && !message.content) {
    return '正在思考，答案马上开始...';
  }
  return '正在生成...';
}

function openConversation(conversationId) {
  if (conversationId === props.route.params.id) {
    return;
  }
  emit('navigate', 'chat', { id: conversationId });
}

function toggleUseStream() {
  useStream.value = !useStream.value;
}

function toggleThinking() {
  if (!canToggleThinking.value) {
    return;
  }
  thinkingEnabled.value = !thinkingEnabled.value;
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

function scrollToBottom(smooth = true) {
  requestAnimationFrame(() => {
    const el = messageScroller.value;
    if (!el) {
      return;
    }
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
  });
}
</script>

<template>
  <section class="deep-chat-shell" :class="{ 'sidebar-collapsed': !sidebarOpen }">
    <aside class="deep-sidebar" :class="{ collapsed: !sidebarOpen }" aria-label="对话历史">
      <div class="deep-sidebar-top">
        <button class="deep-brand" type="button" @click="emit('navigate', 'home')">
          <span class="deep-logo">F</span>
          <strong>FLAI Tavern</strong>
        </button>
        <button class="deep-icon-button" type="button" title="收起侧边栏" @click="sidebarOpen = !sidebarOpen">
          <PanelLeftClose v-if="sidebarOpen" :size="18" />
          <PanelLeftOpen v-else :size="18" />
        </button>
      </div>

      <button class="new-chat-button" type="button" @click="startNewConversation">
        <MessageSquarePlus :size="18" />
        <span>开启新对话</span>
      </button>

      <label class="history-search">
        <Search :size="17" />
        <input v-model.trim="historySearch" placeholder="搜索当前角色的对话" />
      </label>

      <div class="history-list">
        <p class="history-group">{{ conversation?.character?.name || '当前角色' }}</p>
        <button
          v-for="item in filteredConversations"
          :key="item.id"
          class="history-item"
          :class="{ active: item.id === route.params.id }"
          type="button"
          @click="openConversation(item.id)"
        >
          <span>{{ item.title }}</span>
          <small>{{ item.character?.name || 'AI' }}</small>
          <small class="history-usage">{{ formatConversationUsage(item) }}</small>
        </button>
        <p v-if="!filteredConversations.length" class="history-empty">暂无会话</p>
      </div>

      <div class="sidebar-footer">
        <button class="sidebar-user" type="button" @click="emit('navigate', 'settings')">
          <UserRound :size="18" />
          <span>{{ user?.username || '用户' }}</span>
        </button>
        <button class="deep-icon-button" type="button" title="返回首页" @click="emit('navigate', 'home')">
          <Home :size="18" />
        </button>
        <button class="deep-icon-button" type="button" title="设置" @click="emit('navigate', 'settings')">
          <Settings :size="18" />
        </button>
      </div>
    </aside>

    <section class="deep-chat-main">
      <header class="deep-chat-header">
        <button class="deep-icon-button mobile-menu" type="button" title="打开侧边栏" @click="sidebarOpen = true">
          <Menu :size="19" />
        </button>
        <div>
          <h1>{{ conversation?.title || '角色对话' }}</h1>
          <p>
            <Zap :size="14" />
            <span>{{ currentProviderLabel }} · {{ currentModelLabel }}</span>
          </p>
        </div>
        <button class="deep-icon-button" type="button" title="返回首页" @click="emit('navigate', 'home')">
          <Home :size="18" />
        </button>
      </header>

      <div ref="messageScroller" class="deep-message-scroll" aria-live="polite">
        <p v-if="loading" class="deep-muted">正在加载对话...</p>
        <article
          v-for="message in messages"
          :key="message.id"
          class="deep-message"
          :class="message.role"
        >
          <div class="deep-message-content">
            <div v-if="message.role === 'assistant' && message.reasoning" class="reasoning-block">
              <button class="reasoning-toggle" type="button" @click="toggleReasoning(message.id)">
                <Brain :size="16" />
                <span>{{ message.streaming ? '正在思考' : '已思考' }}</span>
                <small v-if="message.reasoning.length">约 {{ message.reasoning.length }} 字</small>
                <ChevronDown v-if="reasoningOpen(message.id)" :size="16" />
                <ChevronRight v-else :size="16" />
              </button>
              <div
                v-if="reasoningOpen(message.id)"
                class="reasoning-body"
                :class="{ 'is-typing': message.streaming }"
              >
                <span class="typing-text">{{ message.reasoning }}</span>
              </div>
            </div>

            <div
              class="deep-bubble"
              :class="{
                'is-typing': message.role === 'assistant' && message.streaming,
                'is-waiting': message.role === 'assistant' && message.streaming && !message.content
              }"
            >
              <p><span class="typing-text">{{ message.content || messagePlaceholder(message) }}</span></p>
            </div>
          </div>
        </article>
        <div v-if="error" class="deep-error" role="status">
          <span>{{ error }}</span>
          <button v-if="needsProviderFix" type="button" @click="emit('navigate', 'settings')">
            去设置
          </button>
        </div>
      </div>

      <footer class="deep-composer-wrap">
        <button class="scroll-bottom-button" type="button" title="滚动到底部" @click="scrollToBottom()">
          <ChevronDown :size="18" />
        </button>
        <form class="deep-composer" @submit.prevent="submit">
          <textarea
            v-model="input"
            placeholder="给 AI 发送消息"
            rows="2"
            @keydown.enter.exact.prevent="submit"
          />
          <div class="composer-actions">
            <button
              class="mode-pill"
              :class="{ active: useStream }"
              type="button"
              :aria-pressed="String(useStream)"
              @click="toggleUseStream"
            >
              <Sparkles :size="16" />
              <span>流式输出</span>
            </button>
            <button
              class="mode-pill"
              :class="{ active: canToggleThinking && thinkingEnabled }"
              type="button"
              :aria-pressed="String(canToggleThinking && thinkingEnabled)"
              :disabled="!canToggleThinking"
              title="DeepSeek thinking.enabled / thinking.disabled"
              @click="toggleThinking"
            >
              <Brain :size="16" />
              <span>{{ thinkingEnabled ? '深度思考' : '普通回复' }}</span>
            </button>
            <span v-if="usage" class="token-chip">tokens {{ usage.total_tokens || usage.totalTokens || '-' }}</span>
            <button v-if="sending" class="round-send stop" type="button" title="停止生成" @click="stop">
              <Square :size="18" />
            </button>
            <button v-else class="round-send" type="submit" title="发送" :disabled="!canSend">
              <Send :size="19" />
            </button>
          </div>
        </form>
      </footer>
    </section>
  </section>
</template>
