<script setup>
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import BaseLayout from './components/BaseLayout.vue';
import MessageToasts from './components/MessageToasts.vue';
import { getMe, logout as logoutRequest } from './api/auth.js';
import { getProviderSettings } from './api/providers.js';
import { recordFrontendDiagnostic } from './diagnostics.js';
import { normalizeAppRoute } from './router.js';
import { samePlainValue } from './utils/plainValues';

const router = useRouter();
const vueRoute = useRoute();
const user = ref(null);
const provider = ref(null);
const booting = ref(true);
const theme = ref(readStoredTheme());
const notifications = ref([]);
const notificationTimers = new Map();
const rippleTimers = new Map();
let authScopeVersion = 0;
let providerRequestId = 0;
const rippleSelector = [
  'button',
  'a[href]',
  'label',
  '[role="button"]',
  '[role="tab"]',
  '[data-ripple]'
].join(',');
const route = computed(() => normalizeAppRoute(vueRoute));
const isAuthRoute = computed(() => ['login', 'register'].includes(route.value.name));
const routeKey = computed(() => getRouteKey(route.value));
const notificationFallbackMessages = {
  error: '操作失败，请稍后重试。',
  warning: '操作未完成，请检查后重试。'
};
const notify = {
  show: pushNotification,
  success: (message, options = {}) => pushNotification({ ...options, type: 'success', message }),
  error: (message, options = {}) => pushNotification({ ...options, type: 'error', message }),
  warning: (message, options = {}) => pushNotification({ ...options, type: 'warning', message }),
  info: (message, options = {}) => pushNotification({ ...options, type: 'info', message })
};

provide('notify', notify);

watch(
  theme,
  (value) => {
    const nextTheme = normalizeTheme(value);
    document.documentElement.dataset.theme = nextTheme;
    writeStoredTheme(nextTheme);
  },
  { immediate: true }
);

onMounted(async () => {
  window.addEventListener('pointerdown', handleInteractionRipple, { passive: true });
  await router.isReady();
  await refreshSession();
});

onBeforeUnmount(() => {
  resetAuthScope();
  window.removeEventListener('pointerdown', handleInteractionRipple);
  clearNotifications();
  rippleTimers.forEach((timer) => window.clearTimeout(timer));
  rippleTimers.clear();
});

async function refreshSession() {
  const authScope = resetAuthScope();
  booting.value = true;
  try {
    const result = await getMe();
    if (!isCurrentAuthScope(authScope)) {
      return;
    }
    setUserIfChanged(result.user);
    if (user.value) {
      await refreshProvider(authScope);
      if (!isCurrentAuthScope(authScope)) {
        return;
      }
      if (isAuthRoute.value) {
        navigate('home');
      }
    } else if (!isAuthRoute.value) {
      clearNotifications();
      navigate('login');
    }
  } catch (error) {
    if (!isCurrentAuthScope(authScope)) {
      return;
    }
    setUserIfChanged(null);
    setProviderIfChanged(null);
    clearNotifications();
    if (!isAuthRoute.value) {
      navigate('login');
    }
    notify.warning(error?.message || '会话检查失败，请重新登录。', { duration: 4200 });
  } finally {
    if (isCurrentAuthScope(authScope)) {
      booting.value = false;
    }
  }
}

async function refreshProvider(authScope = authScopeVersion) {
  const requestId = ++providerRequestId;
  let nextProvider = null;
  try {
    nextProvider = await getProviderSettings();
  } catch (error) {
    recordFrontendDiagnostic('app.provider.refresh', error, { requestId });
  }
  if (requestId !== providerRequestId || !isCurrentAuthScope(authScope) || !user.value) {
    return false;
  }
  setProviderIfChanged(nextProvider);
  return true;
}

async function handleAuthenticated(result) {
  const authScope = resetAuthScope();
  clearNotifications();
  setUserIfChanged(result.user);
  setProviderIfChanged(null);
  await refreshProvider(authScope);
  if (!isCurrentAuthScope(authScope)) {
    return;
  }
  navigate('home');
}

function handleProfileSaved(nextUser) {
  if (nextUser?.id && user.value?.id === nextUser.id) {
    setUserIfChanged(nextUser);
  }
}

async function handleLogout() {
  const authScope = resetAuthScope();
  clearNotifications();
  setUserIfChanged(null);
  setProviderIfChanged(null);
  navigate('login');
  try {
    await logoutRequest();
  } catch (error) {
    recordFrontendDiagnostic('app.auth.logout', error, { authScope });
  }
  if (!isCurrentAuthScope(authScope)) {
    return;
  }
}

function resetAuthScope() {
  authScopeVersion += 1;
  providerRequestId += 1;
  return authScopeVersion;
}

function isCurrentAuthScope(authScope) {
  return authScope === authScopeVersion;
}

function setUserIfChanged(nextUser) {
  return setRefIfPlainValueChanged(user, nextUser || null);
}

function setProviderIfChanged(nextProvider) {
  return setRefIfPlainValueChanged(provider, nextProvider || null);
}

function setRefIfPlainValueChanged(valueRef, nextValue) {
  if (samePlainValue(valueRef.value, nextValue)) {
    return false;
  }
  valueRef.value = nextValue;
  return true;
}

function getRouteKey(value) {
  return `${value?.name || 'home'}:${value?.params?.id || ''}`;
}

function navigate(name, params = {}) {
  router.push({ name, params }).catch((error) => {
    recordFrontendDiagnostic('app.router.navigate', error, { name });
  });
}

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
}

function handleInteractionRipple(event) {
  if (event?.button !== undefined && event.button !== 0) {
    return;
  }

  const source = event?.target;
  pruneStaleRippleTimers();
  if (isFormControlRippleSource(source)) {
    return;
  }

  const target = source?.closest?.(rippleSelector);
  if (!isRippleTargetConnected(target)) {
    return;
  }
  if (target.disabled || target.getAttribute?.('aria-disabled') === 'true') {
    return;
  }

  const rect = target.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return;
  }

  const clientX = Number.isFinite(event?.clientX) ? event.clientX : rect.left + rect.width / 2;
  const clientY = Number.isFinite(event?.clientY) ? event.clientY : rect.top + rect.height / 2;
  const size = Math.ceil(Math.max(rect.width, rect.height) * 2.1);
  target.style.setProperty('--ripple-x', `${Math.round(clientX - rect.left)}px`);
  target.style.setProperty('--ripple-y', `${Math.round(clientY - rect.top)}px`);
  target.style.setProperty('--ripple-size', `${size}px`);
  target.removeAttribute('data-ripple-active');
  void target.offsetWidth;
  target.setAttribute('data-ripple-active', '');

  clearRippleTimer(target);
  rippleTimers.set(target, window.setTimeout(() => {
    if (isRippleTargetConnected(target)) {
      target.removeAttribute('data-ripple-active');
    }
    rippleTimers.delete(target);
  }, 560));
}

function isRippleTargetConnected(target) {
  return Boolean(target?.isConnected && document.documentElement.contains(target));
}

function isFormControlRippleSource(source) {
  return Boolean(source?.closest?.('input, textarea, select, option'));
}

function clearRippleTimer(target) {
  const timer = rippleTimers.get(target);
  if (!timer) {
    return;
  }
  window.clearTimeout(timer);
  rippleTimers.delete(target);
}

function pruneStaleRippleTimers() {
  for (const [target] of rippleTimers.entries()) {
    if (!isRippleTargetConnected(target)) {
      clearRippleTimer(target);
    }
  }
}

function normalizeTheme(value) {
  return value === 'dark' ? 'dark' : 'light';
}

function readStoredTheme() {
  try {
    return normalizeTheme(window.localStorage.getItem('flai-theme'));
  } catch {
    return 'light';
  }
}

function writeStoredTheme(value) {
  try {
    window.localStorage.setItem('flai-theme', normalizeTheme(value));
  } catch {
    // Theme switching should not break app boot when storage is unavailable.
  }
}

function pushNotification(input = {}) {
  const type = ['success', 'error', 'warning', 'info'].includes(input.type) ? input.type : 'info';
  const message = normalizeNotificationMessage(input.message, type);
  if (!message) {
    return null;
  }

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const item = {
    id,
    type,
    title: input.title || '',
    message,
    actionLabel: input.actionLabel || '',
    action: typeof input.action === 'function' ? input.action : null
  };
  const visibleNotifications = prependNotificationWithLimit(item);
  for (const [timerId, timer] of notificationTimers.entries()) {
    if (!isNotificationVisible(visibleNotifications, timerId)) {
      window.clearTimeout(timer);
      notificationTimers.delete(timerId);
    }
  }

  const duration = Number.isFinite(input.duration)
    ? input.duration
    : type === 'error'
      ? 5200
      : 3200;
  if (duration > 0) {
    const timer = window.setTimeout(() => dismissNotification(id), duration);
    notificationTimers.set(id, timer);
  }
  return id;
}

function prependNotificationWithLimit(item) {
  const currentNotifications = Array.isArray(notifications.value) ? notifications.value : [];
  const nextNotifications = [item];
  for (const notification of currentNotifications) {
    if (nextNotifications.length >= 4) {
      break;
    }
    nextNotifications.push(notification);
  }
  notifications.value = nextNotifications;
  return nextNotifications;
}

function isNotificationVisible(currentNotifications, notificationId) {
  for (const notification of currentNotifications) {
    if (notification?.id === notificationId) {
      return true;
    }
  }
  return false;
}

function normalizeNotificationMessage(value, type) {
  if (value instanceof Error) {
    return value.message.trim() || notificationFallbackMessages[type] || '';
  }
  if (value && typeof value === 'object' && typeof value.message === 'string') {
    return value.message.trim() || notificationFallbackMessages[type] || '';
  }
  if (typeof value === 'string') {
    return value.trim() || notificationFallbackMessages[type] || '';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return notificationFallbackMessages[type] || '';
}

function dismissNotification(id) {
  const timer = notificationTimers.get(id);
  if (timer) {
    window.clearTimeout(timer);
    notificationTimers.delete(id);
  }
  removeNotificationByIdIfPresent(id);
}

function removeNotificationByIdIfPresent(id) {
  const currentNotifications = Array.isArray(notifications.value) ? notifications.value : [];
  const nextNotifications = [];
  let changed = false;
  for (const notification of currentNotifications) {
    if (notification?.id === id) {
      changed = true;
    } else {
      nextNotifications.push(notification);
    }
  }
  if (changed) {
    notifications.value = nextNotifications;
  }
  return changed;
}

function clearNotifications() {
  if (!notificationTimers.size && notifications.value.length === 0) {
    return;
  }
  if (notificationTimers.size) {
    notificationTimers.forEach((timer) => window.clearTimeout(timer));
    notificationTimers.clear();
  }
  if (notifications.value.length > 0) {
    notifications.value = [];
  }
}

</script>

<template>
  <div class="app-root">
    <div v-if="booting" class="boot-screen">
      <div class="brand-mark">F</div>
      <p>正在进入 FLAI Tavern AI...</p>
    </div>

    <RouterView v-else v-slot="{ Component }">
      <component
        v-if="isAuthRoute"
        :is="Component"
        :key="routeKey"
        @authenticated="handleAuthenticated"
        @navigate="navigate"
      />

      <BaseLayout
        v-else
        :user="user"
        :provider="provider"
        :current-route="route.name"
        :theme="theme"
        @navigate="navigate"
        @logout="handleLogout"
        @toggle-theme="toggleTheme"
      >
        <component
          :is="Component"
          :key="routeKey"
          :route="route"
          :user="user"
          :provider="provider"
          :theme="theme"
          @navigate="navigate"
          @toggle-theme="toggleTheme"
          @provider-saved="refreshProvider"
          @profile-saved="handleProfileSaved"
        />
      </BaseLayout>
    </RouterView>

    <MessageToasts :items="notifications" @dismiss="dismissNotification" />
  </div>
</template>
