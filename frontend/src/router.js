import { createRouter, createWebHashHistory } from 'vue-router';

export const routeDefinitions = [
  {
    path: '/',
    name: 'home',
    component: () => import('./views/HomeView.vue')
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('./views/LoginView.vue')
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('./views/RegisterView.vue')
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('./views/SettingsView.vue')
  },
  {
    path: '/settings/profile',
    name: 'settingsProfile',
    component: () => import('./views/SettingsView.vue')
  },
  {
    path: '/settings/presets',
    name: 'settingsPresets',
    component: () => import('./views/SettingsView.vue')
  },
  {
    path: '/settings/provider',
    name: 'settingsProvider',
    component: () => import('./views/SettingsView.vue')
  },
  {
    path: '/settings/data',
    name: 'settingsData',
    component: () => import('./views/SettingsView.vue')
  },
  {
    path: '/admin',
    name: 'admin',
    component: () => import('./views/AdminView.vue')
  },
  {
    path: '/extensions',
    name: 'extensions',
    component: () => import('./views/SettingsView.vue')
  },
  {
    path: '/characters/new',
    name: 'characterNew',
    component: () => import('./views/CharacterFormView.vue')
  },
  {
    path: '/characters/new/assistant',
    name: 'characterAssistantNew',
    component: () => import('./views/CharacterAssistantView.vue')
  },
  {
    path: '/characters/:id/assistant',
    name: 'characterAssistant',
    component: () => import('./views/CharacterAssistantView.vue')
  },
  {
    path: '/characters/:id/edit',
    name: 'characterEdit',
    component: () => import('./views/CharacterFormView.vue')
  },
  {
    path: '/chat/:id',
    name: 'chat',
    component: () => import('./views/ChatView.vue')
  },
  {
    path: '/world-books',
    name: 'worldBooks',
    component: () => import('./views/WorldBookView.vue')
  },
  {
    path: '/world-books/:id',
    name: 'worldBookDetail',
    component: () => import('./views/WorldBookView.vue')
  },
  {
    path: '/presets',
    name: 'presets',
    redirect: { name: 'settingsPresets' }
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: { name: 'home' }
  }
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes: routeDefinitions
});

export function normalizeAppRoute(route) {
  return {
    name: typeof route?.name === 'string' ? route.name : 'home',
    params: normalizeRouteParams(route?.params)
  };
}

function normalizeRouteParams(params = {}) {
  const normalized = {};
  if (!params || typeof params !== 'object') {
    return normalized;
  }
  for (const key in params) {
    if (!Object.prototype.hasOwnProperty.call(params, key)) {
      continue;
    }
    const value = params[key];
    normalized[key] = Array.isArray(value) ? String(value[0] || '') : String(value ?? '');
  }
  return normalized;
}
