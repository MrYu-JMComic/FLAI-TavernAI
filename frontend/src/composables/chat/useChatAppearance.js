import { computed, reactive, ref } from 'vue';
import { saveConversationSettings } from '../../api';
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

  function isPhoneViewport() {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.matchMedia('(max-width: 760px)').matches;
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

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('背景图片读取失败'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
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
    handleAppearanceBackgroundUpload,
    clearAppearanceField,
    handleSettingsBackgroundUpload
  };
}
