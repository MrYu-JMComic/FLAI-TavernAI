import { computed, reactive, ref } from 'vue';
import { fetchWorldBooks, saveConversationSettings } from '../../api';
import { isPhoneViewport } from '../useViewport';
import {
  buildScopedChatCss,
  createDefaultChatAppearance,
  mergeChatAppearance,
  normalizeChatAppearance,
  resolveChatBackgroundUrl,
  runChatCustomScript
} from '../../utils/chatAppearance';

export function useChatAppearance({
  conversation,
  characters,
  chatShellRef,
  messageScroller,
  composerWrap,
  composerTextarea,
  user,
  provider,
  messages,
  notify,
  openSidebar,
  closeSidebar,
  openSettings,
  closeSettings,
  scrollToBottom,
  showActionNotice,
  showError
}) {
  const chatAppearanceForm = reactive(createDefaultChatAppearance());
  const authorChatAppearance = ref(createDefaultChatAppearance());
  const customAppearanceStyleEl = ref(null);
  const customAppearanceCleanup = ref(null);
  const customAppearanceState = ref({});
  const appearanceSaving = ref(false);
  const chatViewportIsPhone = ref(isPhoneViewport());
  const chatLorebookId = ref(null);
  const worldBooks = ref([]);
  const worldBooksLoading = ref(false);
  const backgroundUploadTokens = {};
  let appearanceSaveToken = 0;
  let appearanceApplyToken = 0;
  let worldBooksLoadToken = 0;
  let appearanceDisposed = false;

  const effectiveChatAppearance = computed(() => mergeChatAppearance(authorChatAppearance.value, chatAppearanceForm));

  const activeChatBackgroundUrl = computed(() => {
    return resolveChatBackgroundUrl(effectiveChatAppearance.value, chatViewportIsPhone.value);
  });

  const chatMainStyle = computed(() => buildChatMainStyle(activeChatBackgroundUrl.value));

  const chatScopeSelector = computed(() => {
    const id = conversation.value?.id || 'active';
    return `:where([data-chat-scope="${cssEscapeAttribute(id)}"])`;
  });

  function activeCharacter() {
    return conversation.value?.character
      || characters.value.find((item) => item.id === conversation.value?.characterId)
      || null;
  }

  function activeRenderPlugins() {
    return activeCharacter()?.renderPlugins || [];
  }

  // isPhoneViewport is now imported from composables/useViewport.js

  function syncConversationAppearance(settings = {}) {
    const authorSettings = normalizeChatAppearance(settings?.authorSettings || conversation.value?.authorSettings || {});
    const userSettings = normalizeChatAppearance(settings?.userSettings || conversation.value?.userSettings || settings);
    authorChatAppearance.value = authorSettings;
    Object.assign(chatAppearanceForm, createDefaultChatAppearance(), userSettings);
    customAppearanceState.value = {};
    chatLorebookId.value = settings?.chatLorebookId ?? conversation.value?.chatLorebookId ?? null;
  }

  async function saveConversationAppearanceChanges() {
    const conversationId = conversation.value?.id;
    if (appearanceDisposed || !conversationId || appearanceSaving.value) {
      return;
    }

    appearanceSaving.value = true;
    const requestToken = ++appearanceSaveToken;
    try {
      const saved = await saveConversationSettings(conversationId, {
        desktopBackgroundUrl: chatAppearanceForm.desktopBackgroundUrl,
        mobileBackgroundUrl: chatAppearanceForm.mobileBackgroundUrl,
        customCss: chatAppearanceForm.customCss,
        customJs: chatAppearanceForm.customJs,
        statusBarPrompt: chatAppearanceForm.statusBarPrompt,
        chatLorebookId: chatLorebookId.value
      });
      if (!isCurrentAppearanceSave(requestToken, conversationId)) {
        return;
      }
      syncConversationAppearance(saved);
      conversation.value = {
        ...conversation.value,
        chatLorebookId: saved.chatLorebookId ?? chatLorebookId.value,
        settings: {
          ...(conversation.value?.settings || {}),
          ...saved,
          chatLorebookId: saved.chatLorebookId ?? chatLorebookId.value
        },
        authorSettings: saved.authorSettings || authorChatAppearance.value,
        userSettings: saved.userSettings || normalizeChatAppearance(chatAppearanceForm)
      };
      await applyConversationAppearance();
      if (!isCurrentAppearanceSave(requestToken, conversationId)) {
        return;
      }
      showActionNotice('会话自定义已保存');
    } catch (err) {
      if (!isCurrentAppearanceSave(requestToken, conversationId)) {
        return;
      }
      showError(err.message);
    } finally {
      if (isActiveAppearanceSave(requestToken)) {
        appearanceSaving.value = false;
      }
    }
  }

  async function applyConversationAppearance() {
    if (appearanceDisposed) {
      return;
    }
    cleanupConversationAppearance();
    const applyToken = ++appearanceApplyToken;

    const conversationId = conversation.value?.id;
    if (!conversationId) {
      return;
    }

    const activeAppearance = effectiveChatAppearance.value;
    const style = buildScopedChatCss(activeAppearance.customCss, chatScopeSelector.value);
    syncCustomAppearanceStyle(style);

    try {
      const cleanup = await runChatCustomScript(activeAppearance.customJs, {
        conversation: conversation.value,
        character: activeCharacter(),
        user: user.value,
        provider: provider.value,
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
      if (!isCurrentAppearanceApply(applyToken, conversationId)) {
        if (typeof cleanup === 'function') {
          cleanup();
        }
        return;
      }
      customAppearanceCleanup.value = cleanup;
    } catch (err) {
      if (!isCurrentAppearanceApply(applyToken, conversationId)) {
        return;
      }
      notify.warning(formatCustomScriptErrorMessage(err));
    }
  }

  function isCurrentAppearanceSave(requestToken, conversationId) {
    return !appearanceDisposed && requestToken === appearanceSaveToken && conversation.value?.id === conversationId;
  }

  function isActiveAppearanceSave(requestToken) {
    return !appearanceDisposed && requestToken === appearanceSaveToken;
  }

  function isCurrentAppearanceApply(applyToken, conversationId) {
    return !appearanceDisposed && applyToken === appearanceApplyToken && conversation.value?.id === conversationId;
  }

  function formatCustomScriptErrorMessage(err) {
    const detail = String(err?.message || '').replace(/\s+/g, ' ').trim();
    if (!detail) {
      return '自定义 JS 执行失败，已保留设置';
    }

    const shortDetail = detail.length > 160 ? `${detail.slice(0, 160)}...` : detail;
    return `自定义 JS 执行失败：${shortDetail}`;
  }

  function cleanupConversationAppearance() {
    appearanceApplyToken += 1;
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

  function disposeConversationAppearance() {
    appearanceDisposed = true;
    appearanceSaveToken += 1;
    worldBooksLoadToken += 1;
    invalidateBackgroundUploads();
    appearanceSaving.value = false;
    worldBooksLoading.value = false;
    cleanupConversationAppearance();
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

  async function handleAppearanceBackgroundUpload(event, field) {
    const input = event?.target;
    const file = input?.files?.[0];
    if (input) {
      input.value = '';
    }
    const uploadToken = nextBackgroundUploadToken(field);
    if (appearanceDisposed || !file) {
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
      const result = await readFileAsDataUrl(file);
      if (!isCurrentBackgroundUpload(field, uploadToken)) {
        return;
      }
      chatAppearanceForm[field] = result;
    } catch (err) {
      if (!isCurrentBackgroundUpload(field, uploadToken)) {
        return;
      }
      notify.warning(err.message || '背景图片读取失败');
    }
  }

  function clearAppearanceField(field) {
    if (appearanceDisposed) {
      return;
    }
    nextBackgroundUploadToken(field);
    chatAppearanceForm[field] = '';
  }

  function handleSettingsBackgroundUpload({ event, field } = {}) {
    handleAppearanceBackgroundUpload(event, field);
  }

  async function loadWorldBooks() {
    if (appearanceDisposed || worldBooksLoading.value) {
      return;
    }

    const requestToken = ++worldBooksLoadToken;
    worldBooksLoading.value = true;
    try {
      const books = await fetchWorldBooks();
      if (!isCurrentWorldBooksLoad(requestToken)) {
        return;
      }
      worldBooks.value = books;
    } catch (err) {
      if (!isCurrentWorldBooksLoad(requestToken)) {
        return;
      }
      showError(err.message || '加载世界书失败');
    } finally {
      if (isCurrentWorldBooksLoad(requestToken)) {
        worldBooksLoading.value = false;
      }
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('背景图片读取失败'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });
  }

  function nextBackgroundUploadToken(field) {
    const key = String(field || '');
    const nextToken = (backgroundUploadTokens[key] || 0) + 1;
    backgroundUploadTokens[key] = nextToken;
    return nextToken;
  }

  function isCurrentBackgroundUpload(field, uploadToken) {
    return !appearanceDisposed && backgroundUploadTokens[String(field || '')] === uploadToken;
  }

  function isCurrentWorldBooksLoad(requestToken) {
    return !appearanceDisposed && requestToken === worldBooksLoadToken;
  }

  function invalidateBackgroundUploads() {
    Object.keys(backgroundUploadTokens).forEach((key) => {
      backgroundUploadTokens[key] += 1;
    });
  }

  async function waitForFrame() {
    if (typeof window === 'undefined') {
      return;
    }
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
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
    chatAppearanceForm,
    authorChatAppearance,
    customAppearanceStyleEl,
    customAppearanceCleanup,
    customAppearanceState,
    appearanceSaving,
    chatViewportIsPhone,
    chatLorebookId,
    worldBooks,
    worldBooksLoading,
    effectiveChatAppearance,
    activeChatBackgroundUrl,
    chatMainStyle,
    chatScopeSelector,
    activeCharacter,
    activeRenderPlugins,
    syncConversationAppearance,
    saveConversationAppearanceChanges,
    applyConversationAppearance,
    cleanupConversationAppearance,
    disposeConversationAppearance,
    handleAppearanceBackgroundUpload,
    clearAppearanceField,
    handleSettingsBackgroundUpload,
    loadWorldBooks
  };
}
