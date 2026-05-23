<script setup>
import { computed } from 'vue';
import { Home, KeyRound, LogOut, Moon, Plus, Sun, UserRound } from '@lucide/vue';

const props = defineProps({
  user: {
    type: Object,
    default: null
  },
  provider: {
    type: Object,
    default: null
  },
  currentRoute: {
    type: String,
    required: true
  },
  theme: {
    type: String,
    required: true
  }
});

defineEmits(['navigate', 'logout', 'toggle-theme']);

const isChatRoute = computed(() => props.currentRoute === 'chat');
</script>

<template>
  <div class="layout-shell" :class="{ 'chat-layout-shell': isChatRoute }">
    <header v-if="!isChatRoute" class="topbar">
      <button class="brand-button" type="button" @click="$emit('navigate', 'home')">
        <span class="brand-mark">F</span>
        <span>
          <strong>FLAI Tavern AI</strong>
          <small>{{ provider?.gatewayName || '未配置供应商' }} · {{ provider?.model || 'Local Mock' }}</small>
        </span>
      </button>

      <nav class="topnav" aria-label="主导航">
        <button :class="{ active: currentRoute === 'home' }" type="button" @click="$emit('navigate', 'home')">
          <Home :size="18" />
          <span>首页</span>
        </button>
        <button
          :class="{ active: currentRoute === 'characterNew' }"
          type="button"
          @click="$emit('navigate', 'characterNew')"
        >
          <Plus :size="18" />
          <span>创建</span>
        </button>
        <button :class="{ active: currentRoute === 'settings' }" type="button" @click="$emit('navigate', 'settings')">
          <KeyRound :size="18" />
          <span>用户</span>
        </button>
      </nav>

      <div class="top-actions">
        <button class="icon-button" type="button" title="切换夜间模式" @click="$emit('toggle-theme')">
          <Moon v-if="theme === 'light'" :size="19" />
          <Sun v-else :size="19" />
        </button>
        <div class="user-chip">
          <UserRound :size="17" />
          <span>{{ user?.username }}</span>
        </div>
        <button class="icon-button" type="button" title="退出登录" @click="$emit('logout')">
          <LogOut :size="19" />
        </button>
      </div>
    </header>

    <main class="page-shell">
      <slot />
    </main>
  </div>
</template>
