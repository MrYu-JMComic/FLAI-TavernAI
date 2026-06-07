<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import BaseLayout from './components/BaseLayout.vue';
import MessageToasts from './components/MessageToasts.vue';
import { getMe, getProviderSettings, logout as logoutRequest } from './api';

const views = {
  home: defineAsyncComponent(() => import('./views/HomeView.vue')),
  login: defineAsyncComponent(() => import('./views/LoginView.vue')),
  register: defineAsyncComponent(() => import('./views/RegisterView.vue')),
  settings: defineAsyncComponent(() => import('./views/SettingsView.vue')),
  extensions: defineAsyncComponent(() => import('./views/SettingsView.vue')),
  characterNew: defineAsyncComponent(() => import('./views/CharacterFormView.vue')),
  characterEdit: defineAsyncComponent(() => import('./views/CharacterFormView.vue')),
  chat: defineAsyncComponent(() => import('./views/ChatView.vue')),
  worldBooks: defineAsyncComponent(() => import('./views/WorldBookView.vue')),
  worldBookDetail: defineAsyncComponent(() => import('./views/WorldBookView.vue')),
  presets: defineAsyncComponent(() => import('./views/PresetView.vue'))
};

const route = ref(parseRoute());
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
const isAuthRoute = computed(() => ['login', 'register'].includes(route.value.name));
const currentView = computed(() => views[route.value.name] || views.home);
const routeKey = computed(() => `${route.value.name}:${route.value.params.id || ''}`);
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
  window.addEventListener('hashchange', syncRouteFromHash);
  window.addEventListener('pointerdown', handleInteractionRipple, { passive: true });
  await refreshSession();
});

onBeforeUnmount(() => {
  resetAuthScope();
  window.removeEventListener('hashchange', syncRouteFromHash);
  window.removeEventListener('pointerdown', handleInteractionRipple);
  clearNotifications();
  rippleTimers.forEach((timer) => window.clearTimeout(timer));
  rippleTimers.clear();
});

function syncRouteFromHash() {
  route.value = parseRoute();
}

async function refreshSession() {
  const authScope = resetAuthScope();
  booting.value = true;
  try {
    const result = await getMe();
    if (!isCurrentAuthScope(authScope)) {
      return;
    }
    user.value = result.user;
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
    user.value = null;
    provider.value = null;
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
  const nextProvider = await getProviderSettings().catch(() => null);
  if (requestId !== providerRequestId || !isCurrentAuthScope(authScope) || !user.value) {
    return false;
  }
  provider.value = nextProvider;
  return true;
}

async function handleAuthenticated(result) {
  const authScope = resetAuthScope();
  clearNotifications();
  user.value = result.user;
  provider.value = null;
  await refreshProvider(authScope);
  if (!isCurrentAuthScope(authScope)) {
    return;
  }
  navigate('home');
}

function handleProfileSaved(nextUser) {
  if (nextUser?.id && user.value?.id === nextUser.id) {
    user.value = nextUser;
  }
}

async function handleLogout() {
  const authScope = resetAuthScope();
  clearNotifications();
  user.value = null;
  provider.value = null;
  navigate('login');
  await logoutRequest().catch(() => null);
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

function navigate(name, params = {}) {
  const nextHash = routeToHash(name, params);
  if (window.location.hash === nextHash) {
    syncRouteFromHash();
    return;
  }
  window.location.hash = nextHash;
}

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
}

function handleInteractionRipple(event) {
  if (event.button !== undefined && event.button !== 0) {
    return;
  }

  pruneStaleRippleTimers();
  const target = event.target?.closest?.(rippleSelector);
  if (!isRippleTargetConnected(target)) {
    return;
  }
  if (target.matches?.('input, textarea, select, option')) {
    return;
  }
  if (target.disabled || target.getAttribute?.('aria-disabled') === 'true') {
    return;
  }

  const rect = target.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return;
  }

  const size = Math.ceil(Math.max(rect.width, rect.height) * 2.1);
  target.style.setProperty('--ripple-x', `${Math.round(event.clientX - rect.left)}px`);
  target.style.setProperty('--ripple-y', `${Math.round(event.clientY - rect.top)}px`);
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
  notifications.value = [item, ...notifications.value].slice(0, 4);
  const visibleIds = new Set(notifications.value.map((notification) => notification.id));
  for (const [timerId, timer] of notificationTimers.entries()) {
    if (!visibleIds.has(timerId)) {
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
  notifications.value = notifications.value.filter((item) => item.id !== id);
}

function clearNotifications() {
  notificationTimers.forEach((timer) => window.clearTimeout(timer));
  notificationTimers.clear();
  notifications.value = [];
}

function parseRoute() {
  const path = window.location.hash.replace(/^#\/?/, '').replace(/\/$/, '');
  const parts = path.split('/').filter(Boolean);

  if (!parts.length) {
    return { name: 'home', params: {} };
  }
  if (parts[0] === 'login') {
    return { name: 'login', params: {} };
  }
  if (parts[0] === 'register') {
    return { name: 'register', params: {} };
  }
  if (parts[0] === 'settings') {
    return { name: 'settings', params: {} };
  }
  if (parts[0] === 'extensions') {
    return { name: 'extensions', params: {} };
  }
  if (parts[0] === 'characters' && parts[1] === 'new') {
    return { name: 'characterNew', params: {} };
  }
  if (parts[0] === 'characters' && parts[2] === 'edit') {
    return { name: 'characterEdit', params: { id: parts[1] } };
  }
  if (parts[0] === 'chat' && parts[1]) {
    return { name: 'chat', params: { id: parts[1] } };
  }
  if (parts[0] === 'world-books' && parts[1]) {
    return { name: 'worldBookDetail', params: { id: parts[1] } };
  }
  if (parts[0] === 'world-books') {
    return { name: 'worldBooks', params: {} };
  }
  if (parts[0] === 'presets') {
    return { name: 'presets', params: {} };
  }

  return { name: 'home', params: {} };
}

function routeToHash(name, params = {}) {
  const routes = {
    home: '#/',
    login: '#/login',
    register: '#/register',
    settings: '#/settings',
    extensions: '#/extensions',
    characterNew: '#/characters/new',
    characterEdit: `#/characters/${params.id}/edit`,
    chat: `#/chat/${params.id}`,
    worldBooks: '#/world-books',
    worldBookDetail: `#/world-books/${params.id}`,
    presets: '#/presets'
  };
  return routes[name] || '#/';
}
</script>

<template>
  <div class="app-root">
    <div v-if="booting" class="boot-screen">
      <div class="brand-mark">F</div>
      <p>正在进入 FLAI Tavern AI...</p>
    </div>

    <component
      v-else-if="isAuthRoute"
      :is="currentView"
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
        :is="currentView"
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

    <MessageToasts :items="notifications" @dismiss="dismissNotification" />
  </div>
</template>
