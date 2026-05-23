<script setup>
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue';
import BaseLayout from './components/BaseLayout.vue';
import { getMe, getProviderSettings, logout as logoutRequest } from './api';

const views = {
  home: defineAsyncComponent(() => import('./views/HomeView.vue')),
  login: defineAsyncComponent(() => import('./views/LoginView.vue')),
  register: defineAsyncComponent(() => import('./views/RegisterView.vue')),
  settings: defineAsyncComponent(() => import('./views/SettingsView.vue')),
  characterNew: defineAsyncComponent(() => import('./views/CharacterFormView.vue')),
  characterEdit: defineAsyncComponent(() => import('./views/CharacterFormView.vue')),
  chat: defineAsyncComponent(() => import('./views/ChatView.vue'))
};

const route = ref(parseRoute());
const user = ref(null);
const provider = ref(null);
const booting = ref(true);
const theme = ref(localStorage.getItem('flai-theme') || 'light');
const isAuthRoute = computed(() => ['login', 'register'].includes(route.value.name));
const currentView = computed(() => views[route.value.name] || views.home);
const routeKey = computed(() => `${route.value.name}:${route.value.params.id || ''}`);

watch(
  theme,
  (value) => {
    document.documentElement.dataset.theme = value;
    localStorage.setItem('flai-theme', value);
  },
  { immediate: true }
);

onMounted(async () => {
  window.addEventListener('hashchange', () => {
    route.value = parseRoute();
  });
  await refreshSession();
});

async function refreshSession() {
  booting.value = true;
  try {
    const result = await getMe();
    user.value = result.user;
    if (user.value) {
      await refreshProvider();
      if (isAuthRoute.value) {
        navigate('home');
      }
    } else if (!isAuthRoute.value) {
      navigate('login');
    }
  } finally {
    booting.value = false;
  }
}

async function refreshProvider() {
  provider.value = await getProviderSettings().catch(() => null);
}

async function handleAuthenticated(result) {
  user.value = result.user;
  await refreshProvider();
  navigate('home');
}

async function handleLogout() {
  await logoutRequest().catch(() => null);
  user.value = null;
  provider.value = null;
  navigate('login');
}

function navigate(name, params = {}) {
  window.location.hash = routeToHash(name, params);
}

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
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
  if (parts[0] === 'characters' && parts[1] === 'new') {
    return { name: 'characterNew', params: {} };
  }
  if (parts[0] === 'characters' && parts[2] === 'edit') {
    return { name: 'characterEdit', params: { id: parts[1] } };
  }
  if (parts[0] === 'chat' && parts[1]) {
    return { name: 'chat', params: { id: parts[1] } };
  }

  return { name: 'home', params: {} };
}

function routeToHash(name, params = {}) {
  const routes = {
    home: '#/',
    login: '#/login',
    register: '#/register',
    settings: '#/settings',
    characterNew: '#/characters/new',
    characterEdit: `#/characters/${params.id}/edit`,
    chat: `#/chat/${params.id}`
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
        @provider-saved="refreshProvider"
      />
    </BaseLayout>
  </div>
</template>
