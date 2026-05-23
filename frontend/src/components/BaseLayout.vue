<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ChevronDown, Home, KeyRound, LogOut, Moon, Plus, Sun, UserRound } from '@lucide/vue';

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

const emit = defineEmits(['navigate', 'logout', 'toggle-theme']);

const isChatRoute = computed(() => props.currentRoute === 'chat');
const userMenuOpen = ref(false);
const userMenuRef = ref(null);

onMounted(() => {
  document.addEventListener('click', handleDocumentClick);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick);
});

function handleDocumentClick(event) {
  if (!userMenuRef.value?.contains(event.target)) {
    userMenuOpen.value = false;
  }
}

function openUserSettings() {
  userMenuOpen.value = false;
  emit('navigate', 'settings');
}
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
      </nav>

      <div class="top-actions">
        <button class="icon-button" type="button" title="切换夜间模式" @click="$emit('toggle-theme')">
          <Moon v-if="theme === 'light'" :size="19" />
          <Sun v-else :size="19" />
        </button>
        <div ref="userMenuRef" class="user-menu">
          <button
            class="user-chip"
            :class="{ active: currentRoute === 'settings', open: userMenuOpen }"
            type="button"
            aria-haspopup="menu"
            :aria-expanded="String(userMenuOpen)"
            @click.stop="userMenuOpen = !userMenuOpen"
          >
            <UserRound :size="17" />
            <span>{{ user?.username }}</span>
            <ChevronDown :size="15" />
          </button>
          <div v-if="userMenuOpen" class="user-menu-panel" role="menu">
            <button class="user-menu-item" type="button" role="menuitem" @click="openUserSettings">
              <KeyRound :size="17" />
              <span>用户设置</span>
            </button>
          </div>
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
