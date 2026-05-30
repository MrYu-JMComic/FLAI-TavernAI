<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, triggerRef, watch } from 'vue';
import {
  Coins,
  Save,
  Users
} from '@lucide/vue';
import {
  createConversation,
  deleteConversation,
  deleteConversations,
  deleteMessage,
  deleteStatusBar,
  fetchCharacters,
  fetchConversationAccessorySkills,
  fetchConversationEconomy,
  fetchConversationMessages,
  fetchConversations,
  fetchPresets,
  fetchStatusBar,
  saveConversationAccessorySkills,
  saveConversationSettings,
  saveStatusBar,
  sendMessage,
  streamMessage,
  updateMessage
} from '../api';
import EconomyPanel from '../components/EconomyPanel.vue';
import NpcPanel from '../components/NpcPanel.vue';
import SaveLoadPanel from '../components/SaveLoadPanel.vue';
import StatusBar from '../components/StatusBar.vue';
import ChatSidebar from '../components/chat/ChatSidebar.vue';
import ChatSettingsDrawer from '../components/chat/ChatSettingsDrawer.vue';
import ChatHeader from '../components/chat/ChatHeader.vue';
import ChatMessageItem from '../components/chat/ChatMessageItem.vue';
import ChatComposer from '../components/chat/ChatComposer.vue';
import { useNotify } from '../composables/useNotify';
import {
  buildScopedChatCss,
  createDefaultChatAppearance,
  mergeChatAppearance,
  normalizeChatAppearance,
  resolveChatBackgroundUrl,
  runChatCustomScript
} from '../utils/chatAppearance';

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
const notify = useNotify();

const conversation = ref(null);
const conversations = ref([]);
const characters = ref([]);
const messages = ref([]);
const input = ref('');
const useStream = ref(readLocalBoolean('flai-chat-use-stream', true));
const thinkingEnabled = ref(readLocalBoolean('flai-chat-thinking-enabled', false));
const sidebarOpen = ref(false);
const historySearch = ref('');
const loading = ref(false);
const sending = ref(false);
const error = ref('');
const usage = ref(null);
const providerMeta = ref(null);
const controller = ref(null);
const messageScroller = ref(null);
const composerWrap = ref(null);
const composerTextarea = ref(null);
const isScrollPinned = ref(true);
const distanceToBottom = ref(0);
const expandedReasoning = ref(new Set());
const editingMessageId = ref('');
const editingMessageContent = ref('');
const messageActionBusy = ref('');
const conversationActionBusy = ref(false);
const selectedConversationIds = ref(new Set());
const chatShellRef = ref(null);
const settingsDrawerOpen = ref(false);
const appearanceSaving = ref(false);
const chatViewportIsPhone = ref(isPhoneViewport());
const customAppearanceStyleEl = ref(null);
const customAppearanceCleanup = ref(null);
const customAppearanceState = ref({});
const savePanelOpen = ref(false);
const npcPanelOpen = ref(false);
const economyPanelOpen = ref(false);
const economyAccounts = ref([]);
const presetList = ref([]);
const selectedPresetId = ref('');
const statusBar = ref(null);
const statusBarEditorOpen = ref(false);
const statusBarSaving = ref(false);
const accessorySettingsOpen = ref(false);
const accessorySaving = ref(false);
const accessorySkills = reactive(createDefaultAccessorySkills());
const accessorySkillResults = ref([]);
const virtualMessageListRef = ref(null);
const statusBarForm = reactive({
  name: '',
  variables: [],
  template: ''
});
const accessorySkillItems = [
  { key: 'npcAgent', label: 'NPC Agent', auto: false },
  { key: 'statusBarAgent', label: '状态栏 Agent', auto: true },
  { key: 'economyAgent', label: '经济识别', auto: false },
  { key: 'talentPrompt', label: '天赋提示', auto: false },
  { key: 'cgScene', label: 'CG 场景', auto: false }
];
let stoppingByUser = false;
let scrollSaveTimer = null;
let lastManualScrollIntentAt = 0;
let touchStartY = 0;
let lastTouchY = 0;
let userPausedAutoScroll = false;
const streamIdleTimeoutMs = 60000;
const streamFastChunkLength = 120;
const streamMediumChunkLength = 48;
const streamPunctuationPauseMs = 58;
const scrollStickThreshold = 120;
const scrollButtonDistanceThreshold = 360;
const manualScrollIntentCooldownMs = 1400;
let graphemeSegmenter = null;
const chatAppearanceForm = reactive(createDefaultChatAppearance());
const authorChatAppearance = ref(createDefaultChatAppearance());

const canSend = computed(() => input.value.trim() && !sending.value);
const showScrollBottomButton = computed(() => {
  return !isScrollPinned.value && distanceToBottom.value > scrollButtonDistanceThreshold;
});
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
const visibleConversationIds = computed(() => filteredConversations.value.map((item) => item.id));
const selectedConversationCount = computed(() => selectedConversationIds.value.size);
const allVisibleConversationsSelected = computed(() => {
  return visibleConversationIds.value.length > 0
    && visibleConversationIds.value.every((id) => selectedConversationIds.value.has(id));
});
const hasStatusBarContent = computed(() => {
  return Boolean(statusBar.value && Array.isArray(statusBar.value.variables) && statusBar.value.variables.length);
});
const showEconomyFeature = computed(() => {
  return isAccessorySkillActiveLocal('economyAgent') || economyAccounts.value.length > 0;
});
const showNpcFeature = computed(() => isAccessorySkillActiveLocal('npcAgent'));
const latestAssistantMessage = computed(() => {
  return [...messages.value].reverse().find((message) => message.role === 'assistant') || null;
});
const currentProviderLabel = computed(() => {
  return providerMeta.value?.provider || props.provider?.gatewayName || 'Local Mock';
});
const currentModelLabel = computed(() => {
  return providerMeta.value?.model || props.provider?.model || '未配置模型';
});

const activeChatBackgroundUrl = computed(() => {
  return resolveChatBackgroundUrl(effectiveChatAppearance.value, chatViewportIsPhone.value);
});
const effectiveChatAppearance = computed(() => mergeChatAppearance(authorChatAppearance.value, chatAppearanceForm));
const chatMainStyle = computed(() => buildChatMainStyle(activeChatBackgroundUrl.value));
const chatScopeSelector = computed(() => {
  const id = conversation.value?.id || 'active';
  return `:where([data-chat-scope="${cssEscapeAttribute(id)}"])`;
});

onMounted(async () => {
  await loadConversation();
  await loadSidebarData();
  await loadEconomyBalance();
  resizeComposerTextarea();
  updateComposerDock();
  window.addEventListener('resize', handleViewportResize);
  window.addEventListener('keydown', handleGlobalKeydown);
  window.addEventListener('focusin', handleViewportResize);
  window.addEventListener('focusout', handleViewportResize);
  window.visualViewport?.addEventListener('resize', handleViewportResize);
  window.visualViewport?.addEventListener('scroll', handleViewportResize);
});

onBeforeUnmount(() => {
  saveMessageScrollPosition();
  cleanupConversationAppearance();
  if (scrollSaveTimer) {
    window.clearTimeout(scrollSaveTimer);
  }
  window.removeEventListener('resize', handleViewportResize);
  window.removeEventListener('keydown', handleGlobalKeydown);
  window.removeEventListener('focusin', handleViewportResize);
  window.removeEventListener('focusout', handleViewportResize);
  window.visualViewport?.removeEventListener('resize', handleViewportResize);
  window.visualViewport?.removeEventListener('scroll', handleViewportResize);
});

watch(useStream, (value) => {
  writeLocalBoolean('flai-chat-use-stream', value);
});

watch(thinkingEnabled, (value) => {
  writeLocalBoolean('flai-chat-thinking-enabled', value);
});

watch(input, () => {
  nextTick(() => {
    resizeComposerTextarea();
    updateComposerDock();
  });
});

async function loadConversation() {
  loading.value = true;
  error.value = '';
  try {
    const result = await fetchConversationMessages(props.route.params.id);
    conversation.value = result.conversation;
    messages.value = result.messages;
    await nextTick();
    syncConversationAppearance(result.conversation?.settings);
    syncAccessorySkills(result.conversation?.settings?.accessorySkills);
    await applyConversationAppearance();
    await loadStatusBar();
    await loadAccessorySkills();
    restoreMessageScrollPosition();
  } catch (err) {
    showError(err.message);
  } finally {
    loading.value = false;
  }
}

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

async function loadStatusBar() {
  if (!conversation.value?.id) {
    statusBar.value = null;
    return;
  }
  try {
    const result = await fetchStatusBar(conversation.value.id);
    statusBar.value = result;
    if (result) {
      syncStatusBarForm(result);
    }
  } catch {
    statusBar.value = null;
  }
}

async function loadEconomyBalance() {
  if (!conversation.value?.id) {
    economyAccounts.value = [];
    return;
  }
  try {
    const result = await fetchConversationEconomy(conversation.value.id, { ensure: false });
    economyAccounts.value = result.accounts || [];
  } catch {
    economyAccounts.value = [];
  }
}

async function loadAccessorySkills() {
  if (!conversation.value?.id) {
    syncAccessorySkills();
    return;
  }
  try {
    const payload = await fetchConversationAccessorySkills(conversation.value.id);
    syncAccessorySkills(payload.skills);
  } catch {
    syncAccessorySkills(conversation.value?.settings?.accessorySkills);
  }
}

function createDefaultAccessorySkills() {
  return {
    npcAgent: { enabled: false, modelOverride: '' },
    statusBarAgent: { enabled: 'auto', modelOverride: '' },
    economyAgent: { enabled: false, modelOverride: '' },
    talentPrompt: { enabled: false, modelOverride: '' },
    cgScene: { enabled: false, modelOverride: '' }
  };
}

function syncAccessorySkills(next = {}) {
  const defaults = createDefaultAccessorySkills();
  for (const key of Object.keys(defaults)) {
    const source = next?.[key] || {};
    accessorySkills[key] = {
      enabled: normalizeSkillEnabled(source.enabled, defaults[key].enabled),
      modelOverride: String(source.modelOverride || source.model_override || '').trim()
    };
  }
}

function normalizeSkillEnabled(value, fallback = false) {
  if (value === 'auto') return 'auto';
  if (value === true || value === 'true' || value === 'on') return true;
  if (value === false || value === 'false' || value === 'off') return false;
  return fallback;
}

function isAccessorySkillActiveLocal(key) {
  const skill = accessorySkills[key] || {};
  if (skill.enabled === true) return true;
  if (skill.enabled !== 'auto') return false;
  return key === 'statusBarAgent' && hasStatusBarContent.value;
}

async function saveAccessorySkillChanges() {
  if (!conversation.value?.id || accessorySaving.value) return;
  accessorySaving.value = true;
  try {
    const payload = await saveConversationAccessorySkills(conversation.value.id, { accessorySkills });
    syncAccessorySkills(payload.skills);
    conversation.value = {
      ...conversation.value,
      settings: {
        ...(conversation.value?.settings || {}),
        accessorySkills: payload.skills
      },
      userSettings: {
        ...(conversation.value?.userSettings || {}),
        accessorySkills: payload.skills
      }
    };
    await loadEconomyBalance();
    showActionNotice('附属技能已保存');
  } catch (err) {
    showError(err.message);
  } finally {
    accessorySaving.value = false;
  }
}

function handleSkillResult(data = {}) {
  accessorySkillResults.value = [data, ...accessorySkillResults.value].slice(0, 8);
  if (!data.ok) {
    return;
  }
  const result = data.result || {};
  if (data.skill === 'statusBarAgent' && result.statusBar) {
    statusBar.value = result.statusBar;
    syncStatusBarForm(result.statusBar);
  }
  if (data.skill === 'economyAgent' && Array.isArray(result.transactions) && result.transactions.length) {
    loadEconomyBalance();
  }
}

function syncStatusBarForm(data = {}) {
  statusBarForm.name = data.name || '状态栏';
  statusBarForm.variables = Array.isArray(data.variables)
    ? data.variables.map((v) => ({ ...v }))
    : [];
  statusBarForm.template = data.template || '';
}

function addStatusBarVariable() {
  statusBarForm.variables.push({
    name: '新变量',
    value: 100,
    max: 100,
    color: '#6c757d'
  });
}

function removeStatusBarVariable(index) {
  statusBarForm.variables.splice(index, 1);
}

async function saveStatusBarChanges() {
  if (!conversation.value?.id || statusBarSaving.value) return;
  statusBarSaving.value = true;
  try {
    const result = await saveStatusBar(conversation.value.id, {
      name: statusBarForm.name,
      variables: statusBarForm.variables,
      template: statusBarForm.template
    });
    statusBar.value = result;
    showActionNotice('状态栏已保存');
  } catch (err) {
    showError(err.message);
  } finally {
    statusBarSaving.value = false;
  }
}

async function deleteStatusBarAction() {
  if (!conversation.value?.id) return;
  if (!window.confirm('确定删除当前状态栏？')) return;
  try {
    await deleteStatusBar(conversation.value.id);
    statusBar.value = null;
    statusBarForm.name = '';
    statusBarForm.variables = [];
    statusBarForm.template = '';
    showActionNotice('状态栏已删除');
  } catch (err) {
    showError(err.message);
  }
}

function openStatusBarEditor() {
  if (statusBar.value) {
    syncStatusBarForm(statusBar.value);
  } else {
    statusBarForm.name = '状态栏';
    statusBarForm.variables = [
      { name: 'HP', value: 100, max: 100, color: '#e74c3c' },
      { name: 'MP', value: 50, max: 50, color: '#3498db' }
    ];
    statusBarForm.template = '';
  }
  statusBarEditorOpen.value = true;
}

function closeStatusBarEditor() {
  statusBarEditorOpen.value = false;
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

async function submit() {
  const content = input.value.trim();
  if (!content || sending.value) {
    return;
  }

  error.value = '';
  input.value = '';
  await nextTick();
  resizeComposerTextarea();
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
              accessorySkillResults.value = data.results;
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
          showError(error.value || '连接已结束，但没有收到模型回复。请检查 API Key、余额或网关状态后重试。');
        }
      }
    } else {
      const result = await sendMessage(props.route.params.id, requestPayload);
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

function showError(message) {
  error.value = message;
  notify.error(message, {
    actionLabel: needsProviderFix.value ? '去设置' : '',
    action: needsProviderFix.value ? () => emit('navigate', 'settings') : null,
    duration: needsProviderFix.value ? 8000 : undefined
  });
}

function syncConversationAppearance(settings = {}) {
  const authorSettings = normalizeChatAppearance(settings?.authorSettings || conversation.value?.authorSettings || {});
  const userSettings = normalizeChatAppearance(settings?.userSettings || conversation.value?.userSettings || settings);
  authorChatAppearance.value = authorSettings;
  Object.assign(chatAppearanceForm, createDefaultChatAppearance(), userSettings);
  customAppearanceState.value = {};
}

async function saveConversationAppearanceChanges() {
  if (!conversation.value?.id || appearanceSaving.value) {
    return;
  }

  appearanceSaving.value = true;
  try {
    const saved = await saveConversationSettings(conversation.value.id, {
      desktopBackgroundUrl: chatAppearanceForm.desktopBackgroundUrl,
      mobileBackgroundUrl: chatAppearanceForm.mobileBackgroundUrl,
      customCss: chatAppearanceForm.customCss,
      customJs: chatAppearanceForm.customJs,
      statusBarPrompt: chatAppearanceForm.statusBarPrompt
    });
    syncConversationAppearance(saved);
    conversation.value = {
      ...conversation.value,
      settings: {
        desktopBackgroundUrl: saved.desktopBackgroundUrl,
        mobileBackgroundUrl: saved.mobileBackgroundUrl,
        customCss: saved.customCss,
        customJs: saved.customJs,
        statusBarPrompt: saved.statusBarPrompt
      },
      authorSettings: saved.authorSettings || authorChatAppearance.value,
      userSettings: saved.userSettings || normalizeChatAppearance(chatAppearanceForm)
    };
    await applyConversationAppearance();
    showActionNotice('会话自定义已保存');
  } catch (err) {
    showError(err.message);
  } finally {
    appearanceSaving.value = false;
  }
}

async function applyConversationAppearance() {
  cleanupConversationAppearance();

  if (!conversation.value?.id) {
    return;
  }

  const activeAppearance = effectiveChatAppearance.value;
  const style = buildScopedChatCss(activeAppearance.customCss, chatScopeSelector.value);
  syncCustomAppearanceStyle(style);

  try {
    customAppearanceCleanup.value = await runChatCustomScript(activeAppearance.customJs, {
      conversation: conversation.value,
      character: activeCharacter(),
      user: props.user,
      provider: props.provider,
      settings: activeAppearance,
      state: customAppearanceState.value,
      root: chatShellRef.value,
      main: chatShellRef.value?.querySelector('.deep-chat-main') || null,
      sidebar: chatShellRef.value?.querySelector('.deep-sidebar') || null,
      messageScroller: messageScroller.value,
      composer: composerWrap.value?.textareaRef || composerTextarea.value,
      messages: messages.value,
      query: (selector, root = chatShellRef.value) => root?.querySelector?.(selector) || null,
      queryAll: (selector, root = chatShellRef.value) => root ? Array.from(root.querySelectorAll(selector)) : [],
      notify,
      openSidebar,
      closeSidebar,
      openSettings,
      closeSettings,
      scrollToBottom: () => scrollToBottom(true, true),
      setCssVar: (name, value) => {
        chatShellRef.value?.style.setProperty(String(name || '').trim(), String(value || ''));
      },
      requestPaint: waitForFrame,
      wait: waitMs
    });
  } catch (err) {
    console.error(err);
    notify.warning('自定义 JS 执行失败，已保留设置');
  }
}

function cleanupConversationAppearance() {
  if (customAppearanceCleanup.value) {
    try {
      customAppearanceCleanup.value();
    } catch {
      // Ignore cleanup failures from custom scripts.
    }
    customAppearanceCleanup.value = null;
  }

  if (customAppearanceStyleEl.value) {
    customAppearanceStyleEl.value.remove();
    customAppearanceStyleEl.value = null;
  }
}

function syncCustomAppearanceStyle(cssText) {
  if (!cssText) {
    return;
  }

  if (!customAppearanceStyleEl.value) {
    customAppearanceStyleEl.value = document.createElement('style');
    customAppearanceStyleEl.value.type = 'text/css';
    customAppearanceStyleEl.value.dataset.chatAppearance = conversation.value?.id || 'active';
    document.head.appendChild(customAppearanceStyleEl.value);
  }

  customAppearanceStyleEl.value.textContent = cssText;
}

function buildChatMainStyle(backgroundUrl) {
  const safeBackgroundUrl = String(backgroundUrl || '').trim();
  if (!safeBackgroundUrl) {
    return {};
  }

  return {
    backgroundImage: `linear-gradient(180deg, color-mix(in srgb, var(--surface) 48%, transparent), transparent 18%), url(${JSON.stringify(safeBackgroundUrl)})`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center',
    backgroundSize: 'cover'
  };
}

function cssEscapeAttribute(value) {
  return String(value || '').replace(/["\\]/g, '\\$&');
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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('背景图片读取失败'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
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

function isReasoningTyping(message) {
  return message.role === 'assistant' && message.reasoningStreaming === true;
}

function isContentTyping(message) {
  return message.role === 'assistant' && message.contentStreaming === true;
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

function activeCharacter() {
  return conversation.value?.character
    || characters.value.find((item) => item.id === conversation.value?.characterId)
    || null;
}

function activeRenderPlugins() {
  return activeCharacter()?.renderPlugins || [];
}

function messageAuthorName(message) {
  if (message.role === 'assistant') {
    return activeCharacter()?.name || 'AI';
  }
  if (message.role === 'user') {
    return props.user?.displayName || props.user?.accountName || props.user?.username || 'User';
  }
  return message.role || 'Message';
}

function messageAuthorInitial(message) {
  const name = messageAuthorName(message).trim();
  return [...name][0]?.toUpperCase() || '?';
}

function messageAvatarUrl(message) {
  if (message.role === 'assistant') {
    return activeCharacter()?.avatarUrl || '';
  }
  return props.user?.avatarUrl || '';
}

function openConversation(conversationId) {
  if (conversationId === props.route.params.id) {
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
  if (!showNpcFeature.value) {
    return;
  }
  npcPanelOpen.value = true;
}

function closeNpcPanel() {
  npcPanelOpen.value = false;
}

function openEconomyPanel() {
  if (!showEconomyFeature.value) {
    return;
  }
  economyPanelOpen.value = true;
}

function closeEconomyPanel() {
  economyPanelOpen.value = false;
}

async function onSavesLoaded() {
  await loadConversation();
  await loadSidebarData();
}

function handleGlobalKeydown(event) {
  if (event.key === 'Escape' && settingsDrawerOpen.value) {
    closeSettings();
    return;
  }
  if (event.key === 'Escape' && sidebarOpen.value) {
    closeSidebar();
  }
}

function handleComposerEnter(event) {
  if (isPhoneViewport()) {
    return;
  }

  if (event?.preventDefault) {
    event.preventDefault();
  }
  submit();
}

function isPhoneViewport() {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.matchMedia('(max-width: 760px)').matches;
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
    showActionNotice('会话已删除');
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
    showActionNotice(`已删除 ${result.deletedIds?.length || ids.length} 个会话`);
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

  if (deleted.has(props.route.params.id)) {
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

function canEditMessage(message) {
  return canPersistMessage(message) && !messageActionBusy.value;
}

function canDeleteMessage(message) {
  return canPersistMessage(message) && !messageActionBusy.value;
}

function canPersistMessage(message) {
  return Boolean(message?.id) && !message.streaming && !String(message.id).startsWith('local-');
}

async function beginEditMessage(message) {
  if (!canEditMessage(message)) {
    return;
  }
  await withMessageScrollAnchor(message.id, async () => {
    editingMessageId.value = message.id;
    editingMessageContent.value = message.content || '';
  });
  focusMessageEditor(message.id);
}

async function cancelEditMessage(message = null) {
  const messageId = message?.id || editingMessageId.value;
  await withMessageScrollAnchor(messageId, async () => {
    clearMessageEdit();
  });
}

function clearMessageEdit() {
  editingMessageId.value = '';
  editingMessageContent.value = '';
}

async function saveMessageEdit(message) {
  const content = editingMessageContent.value.trim();
  if (!content) {
    showActionNotice('消息内容不能为空', 'warning');
    return;
  }
  if (!canEditMessage(message)) {
    return;
  }

  messageActionBusy.value = message.id;
  try {
    const updated = await updateMessage(props.route.params.id, message.id, { content });
    await withMessageScrollAnchor(message.id, async () => {
      Object.assign(message, updated);
      clearMessageEdit();
      triggerRef(messages);
    });
    showActionNotice('消息已更新');
    await loadSidebarData();
  } catch (err) {
    showError(err.message);
  } finally {
    messageActionBusy.value = '';
  }
}

async function removeMessage(message) {
  if (!canDeleteMessage(message)) {
    return;
  }
  if (!window.confirm('删除这条消息？不会删除前后关联的其他消息。')) {
    return;
  }

  messageActionBusy.value = message.id;
  try {
    const deletion = await deleteMessage(props.route.params.id, message.id);
    await withMessageScrollAnchor(message.id, async () => {
      messages.value = messages.value.filter((item) => item.id !== message.id);
      if (editingMessageId.value === message.id) {
        clearMessageEdit();
      }
    });
    showActionNotice(deletion?.deletedReasoning ? '消息和思考已删除' : '消息已删除');
    await loadSidebarData();
  } catch (err) {
    showError(err.message);
  } finally {
    messageActionBusy.value = '';
  }
}

async function copyMessage(message) {
  const text = messageTextForCopy(message);
  if (!text) {
    showActionNotice('没有可复制的内容', 'warning');
    return;
  }

  try {
    await requestClipboardPermission();
    await writeClipboardText(text);
    showActionNotice('已复制到剪贴板');
  } catch (err) {
    showActionNotice(err.message || '复制失败，请检查浏览器权限', 'warning');
  }
}

function messageTextForCopy(message) {
  return String(message?.content || message?.reasoning || '').trim();
}

async function requestClipboardPermission() {
  const permissions = window.navigator?.permissions;
  if (!permissions?.query) {
    return;
  }

  try {
    const status = await permissions.query({ name: 'clipboard-write' });
    if (status.state === 'denied') {
      throw new Error('剪贴板权限被拒绝');
    }
  } catch (err) {
    if (/denied|鎷掔粷/.test(err.message || '')) {
      throw err;
    }
  }
}

async function writeClipboardText(text) {
  if (window.navigator?.clipboard?.writeText) {
    await window.navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error('复制失败，请手动复制');
  }
}

async function withMessageScrollAnchor(messageId, callback) {
  const anchor = captureMessageScrollAnchor(messageId);
  const result = await callback();
  await nextTick();
  await waitForFrame();
  restoreMessageScrollAnchor(anchor);
  return result;
}

function captureMessageScrollAnchor(messageId) {
  const scroller = messageScroller.value;
  if (!scroller) {
    return null;
  }

  const element = findMessageElement(messageId);
  return {
    messageId,
    top: element ? element.getBoundingClientRect().top : null,
    scrollTop: scroller.scrollTop
  };
}

function restoreMessageScrollAnchor(anchor) {
  const scroller = messageScroller.value;
  if (!scroller || !anchor) {
    return;
  }

  const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const element = findMessageElement(anchor.messageId);
  if (element && anchor.top !== null) {
    const delta = element.getBoundingClientRect().top - anchor.top;
    scroller.scrollTop = Math.min(maxScrollTop, Math.max(0, scroller.scrollTop + delta));
  } else {
    scroller.scrollTop = Math.min(maxScrollTop, Math.max(0, anchor.scrollTop));
  }
  updateScrollState();
  scheduleSaveMessageScrollPosition();
}

function findMessageElement(messageId) {
  if (!messageId || !messageScroller.value) {
    return null;
  }
  return [...messageScroller.value.querySelectorAll('.deep-message')]
    .find((element) => element.dataset.messageId === String(messageId)) || null;
}

async function waitForFrame() {
  if (typeof window === 'undefined') {
    return;
  }
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
}

function focusMessageEditor(messageId) {
  requestAnimationFrame(() => {
    const textarea = findMessageElement(messageId)?.querySelector('.message-edit-box textarea');
    textarea?.focus?.({ preventScroll: true });
  });
}

function showActionNotice(message, type = 'success') {
  const method = notify[type] || notify.info;
  method(message);
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

async function handleAppearanceBackgroundUpload(event, field) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) {
    return;
  }

  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
    notify.warning('背景图片仅支持 PNG、JPG、WebP、GIF');
    return;
  }

  if (file.size > 4 * 1024 * 1024) {
    notify.warning('背景图片不能超过 4MB');
    return;
  }

  try {
    chatAppearanceForm[field] = await readFileAsDataUrl(file);
  } catch (err) {
    notify.warning(err.message || '背景图片读取失败');
  }
}

function clearAppearanceField(field) {
  chatAppearanceForm[field] = '';
}

function handleSettingsBackgroundUpload({ event, field }) {
  handleAppearanceBackgroundUpload(event, field);
}

function handleComposerEnterFromComposer(event) {
  handleComposerEnter(event);
}

function resizeComposerTextarea() {
  const el = composerWrap.value?.textareaRef || composerTextarea.value;
  if (!el) {
    return;
  }
  const maxHeight = readComposerTextareaMaxHeight(el);
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  updateComposerDock();
}

function readComposerTextareaMaxHeight(el) {
  const customValue = window.getComputedStyle(el).getPropertyValue('--composer-textarea-max-height');
  const parsed = Number.parseFloat(customValue);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return isPhoneViewport() ? 112 : 180;
}

function handleViewportResize() {
  chatViewportIsPhone.value = isPhoneViewport();
  resizeComposerTextarea();
  updateComposerDock();
}

let composerDockRafId = null;

function updateComposerDock() {
  if (composerDockRafId) {
    cancelAnimationFrame(composerDockRafId);
  }
  composerDockRafId = requestAnimationFrame(() => {
    const shell = chatShellRef.value;
    const wrap = composerWrap.value?.wrapRef || composerWrap.value;
    if (!shell || !wrap) {
      return;
    }

    shell.style.setProperty('--chat-composer-height', `${Math.ceil(wrap.getBoundingClientRect().height)}px`);

    if (!isPhoneViewport() || !window.visualViewport) {
      shell.style.setProperty('--chat-keyboard-inset', '0px');
      return;
    }

    const viewport = window.visualViewport;
    const keyboardInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    shell.style.setProperty('--chat-keyboard-inset', `${Math.round(keyboardInset)}px`);
  });
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
  return `楼${cost.toFixed(digits)}`;
}

function handleMessageScroll() {
  updateScrollState();
  scheduleSaveMessageScrollPosition();
}

function handleWheelScrollIntent(event) {
  if (event.deltaY < -1) {
    pauseAutoScrollForUser();
  }
}

function handleTouchStart(event) {
  const touch = event.touches?.[0];
  touchStartY = touch?.clientY || 0;
  lastTouchY = touchStartY;
}

function handleTouchMove(event) {
  const touch = event.touches?.[0];
  if (!touch) {
    return;
  }
  const currentY = touch.clientY;
  const moved = Math.abs(currentY - lastTouchY) > 4 || Math.abs(currentY - touchStartY) > 10;
  if (moved) {
    pauseAutoScrollForUser();
  }
  lastTouchY = currentY;
}

function pauseAutoScrollForUser() {
  lastManualScrollIntentAt = Date.now();
  userPausedAutoScroll = true;
  isScrollPinned.value = false;
  updateScrollState();
}

function hasRecentManualScrollIntent() {
  return Date.now() - lastManualScrollIntentAt < manualScrollIntentCooldownMs;
}

function updateScrollState() {
  const el = messageScroller.value;
  if (!el) {
    return;
  }
  distanceToBottom.value = getDistanceToBottom(el);
  if (distanceToBottom.value <= 2 && !hasRecentManualScrollIntent()) {
    userPausedAutoScroll = false;
  }
  if (userPausedAutoScroll) {
    isScrollPinned.value = false;
  } else if (distanceToBottom.value <= scrollStickThreshold) {
    isScrollPinned.value = true;
  } else if (distanceToBottom.value > scrollStickThreshold) {
    isScrollPinned.value = false;
  }
}

function getDistanceToBottom(el) {
  return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
}

function stickToBottomIfNeeded(smooth = false) {
  if (hasRecentManualScrollIntent()) {
    updateScrollState();
    scheduleSaveMessageScrollPosition();
    return;
  }
  updateScrollState();
  if (userPausedAutoScroll || !isScrollPinned.value) {
    scheduleSaveMessageScrollPosition();
    return;
  }
  scrollToBottom(smooth, true);
}

function scrollToBottom(smooth = true, keepPinned = true) {
  if (keepPinned) {
    lastManualScrollIntentAt = 0;
    userPausedAutoScroll = false;
    isScrollPinned.value = true;
  }
  requestAnimationFrame(() => {
    const el = messageScroller.value;
    if (!el) {
      return;
    }
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
    if (!smooth) {
      updateScrollState();
    } else if (typeof window !== 'undefined') {
      window.setTimeout(() => updateScrollState(), 360);
    }
    scheduleSaveMessageScrollPosition();
  });
}

function restoreMessageScrollPosition() {
  requestAnimationFrame(() => {
    const el = messageScroller.value;
    if (!el) {
      return;
    }

    const saved = readScrollSnapshot();
    if (!saved) {
      if (shouldStartAtConversationBeginning()) {
        el.scrollTop = 0;
        updateScrollState();
        scheduleSaveMessageScrollPosition();
        return;
      }
      scrollToBottom(false, true);
      return;
    }

    if (saved.pinned) {
      scrollToBottom(false, true);
      return;
    }

    el.scrollTop = Math.min(saved.top || 0, Math.max(0, el.scrollHeight - el.clientHeight));
    updateScrollState();
    scheduleSaveMessageScrollPosition();
  });
}

function shouldStartAtConversationBeginning() {
  return messages.value.length === 1 && messages.value[0]?.role === 'assistant';
}

function readScrollSnapshot() {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return JSON.parse(window.localStorage.getItem(scrollStorageKey()) || 'null');
  } catch {
    return null;
  }
}

function scheduleSaveMessageScrollPosition() {
  if (typeof window === 'undefined') {
    return;
  }
  if (scrollSaveTimer) {
    window.clearTimeout(scrollSaveTimer);
  }
  scrollSaveTimer = window.setTimeout(() => {
    saveMessageScrollPosition();
  }, 120);
}

function saveMessageScrollPosition() {
  if (typeof window === 'undefined') {
    return;
  }
  const el = messageScroller.value;
  if (!el) {
    return;
  }
  const snapshot = {
    top: Math.round(el.scrollTop),
    pinned: !userPausedAutoScroll && getDistanceToBottom(el) <= scrollStickThreshold,
    savedAt: Date.now()
  };
  window.localStorage.setItem(scrollStorageKey(), JSON.stringify(snapshot));
}

function scrollStorageKey() {
  return `flai-chat-scroll:${props.route.params.id || 'active'}`;
}
</script>

<template>
  <section
    ref="chatShellRef"
    class="deep-chat-shell"
    :class="{ 'sidebar-collapsed': !sidebarOpen }"
    :data-chat-scope="conversation?.id || 'active'"
  >
    <ChatSidebar
      :open="sidebarOpen"
      :user="user"
      :conversation="conversation"
      :filtered-conversations="filteredConversations"
      :selected-conversation-ids="selectedConversationIds"
      :all-visible-conversations-selected="allVisibleConversationsSelected"
      :selected-conversation-count="selectedConversationCount"
      :conversation-action-busy="conversationActionBusy"
      :route="route"
      :format-conversation-usage="formatConversationUsage"
      @close="closeSidebar"
      @navigate="(page, params) => emit('navigate', page, params)"
      @start-new="startNewConversation"
      @open-conversation="openConversation"
      @update:history-search="(val) => historySearch = val"
      @toggle-all="toggleAllVisibleConversations"
      @toggle-selection="toggleConversationSelection"
      @delete-one="deleteOneConversation"
      @delete-selected="deleteSelectedConversations"
      @open-settings="openSettings"
    />

    <ChatSettingsDrawer
      :open="settingsDrawerOpen"
      :conversation="conversation"
      :author-chat-appearance="authorChatAppearance"
      :chat-appearance-form="chatAppearanceForm"
      :appearance-saving="appearanceSaving"
      :accessory-settings-open="accessorySettingsOpen"
      :accessory-saving="accessorySaving"
      :accessory-skills="accessorySkills"
      :accessory-skill-items="accessorySkillItems"
      :status-bar="statusBar"
      :status-bar-editor-open="statusBarEditorOpen"
      :status-bar-saving="statusBarSaving"
      :status-bar-form="statusBarForm"
      @close="closeSettings"
      @save-appearance="saveConversationAppearanceChanges"
      @reset-appearance="syncConversationAppearance(conversation?.settings)"
      @background-upload="handleSettingsBackgroundUpload"
      @clear-field="clearAppearanceField"
      @update:accessory-settings-open="(val) => accessorySettingsOpen = val"
      @save-accessory="saveAccessorySkillChanges"
      @open-status-bar-editor="openStatusBarEditor"
      @close-status-bar-editor="closeStatusBarEditor"
      @add-status-bar-variable="addStatusBarVariable"
      @remove-status-bar-variable="removeStatusBarVariable"
      @save-status-bar="saveStatusBarChanges"
      @delete-status-bar="deleteStatusBarAction"
    />

    <section class="deep-chat-main" :style="chatMainStyle">
      <ChatHeader
        :conversation="conversation"
        :current-provider-label="currentProviderLabel"
        :current-model-label="currentModelLabel"
        :economy-accounts="economyAccounts"
        :show-economy-feature="showEconomyFeature"
        :show-npc-feature="showNpcFeature"
        @navigate="(page) => emit('navigate', page)"
        @open-sidebar="openSidebar"
        @open-economy="openEconomyPanel"
        @open-npc="openNpcPanel"
        @open-saves="openSavePanel"
      />

      <div
        ref="messageScroller"
        class="deep-message-scroll"
        aria-live="polite"
        @scroll.passive="handleMessageScroll"
        @wheel.passive="handleWheelScrollIntent"
        @touchstart.passive="handleTouchStart"
        @touchmove.passive="handleTouchMove"
      >
        <p v-if="loading" class="deep-muted">正在加载对话...</p>
        <template
          v-for="message in messages"
          :key="message.id"
        >
          <ChatMessageItem
            :message="message"
            :editing-message-id="editingMessageId"
            :editing-message-content="editingMessageContent"
            :reasoning-open="reasoningOpen(message.id)"
            :is-reasoning-typing="isReasoningTyping(message)"
            :is-content-typing="isContentTyping(message)"
            :message-placeholder="messagePlaceholder(message)"
            :author-name="messageAuthorName(message)"
            :author-initial="messageAuthorInitial(message)"
            :avatar-url="messageAvatarUrl(message)"
            :can-edit="canEditMessage(message)"
            :can-delete="canDeleteMessage(message)"
            :render-plugins="activeRenderPlugins()"
            @toggle-reasoning="toggleReasoning"
            @begin-edit="beginEditMessage"
            @cancel-edit="cancelEditMessage"
            @save-edit="saveMessageEdit"
            @delete="removeMessage"
            @copy="copyMessage"
            @update:editing-message-content="(val) => editingMessageContent = val"
          />
          <div v-if="hasStatusBarContent && message === latestAssistantMessage" class="status-bar-wrapper">
            <StatusBar :status-bar="statusBar" />
          </div>
        </template>
      </div>

      <ChatComposer
        ref="composerWrap"
        :input="input"
        :sending="sending"
        :can-send="canSend"
        :use-stream="useStream"
        :thinking-enabled="thinkingEnabled"
        :can-toggle-thinking="canToggleThinking"
        :chat-viewport-is-phone="chatViewportIsPhone"
        :show-scroll-bottom-button="showScrollBottomButton"
        :usage="usage"
        :preset-list="presetList"
        :selected-preset-id="selectedPresetId"
        @update:input="(val) => input = val"
        @submit="handleComposerEnterFromComposer"
        @stop="stop"
        @toggle-stream="toggleUseStream"
        @toggle-thinking="toggleThinking"
        @scroll-to-bottom="scrollToBottom()"
        @update:selected-preset-id="(val) => selectedPresetId = val"
      />
    </section>

    <EconomyPanel
      v-if="conversation?.id && showEconomyFeature"
      :conversation-id="conversation.id"
      :open="economyPanelOpen"
      @close="closeEconomyPanel"
    />
    <NpcPanel
      v-if="conversation?.id && showNpcFeature"
      :conversation-id="conversation.id"
      :open="npcPanelOpen"
      @close="closeNpcPanel"
    />
    <SaveLoadPanel
      v-if="conversation?.id"
      :conversation-id="conversation.id"
      :open="savePanelOpen"
      @close="closeSavePanel"
      @loaded="onSavesLoaded"
    />
  </section>
</template>
