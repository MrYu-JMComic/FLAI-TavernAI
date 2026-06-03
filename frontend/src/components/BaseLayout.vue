<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { BookOpen, ChevronDown, Home, KeyRound, LogOut, Menu, Moon, Plus, Puzzle, Sun, UserRound, X } from '@lucide/vue';

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
const isWorldBookRoute = computed(() => props.currentRoute === 'worldBooks' || props.currentRoute === 'worldBookDetail');
const isExtensionsRoute = computed(() => props.currentRoute === 'extensions');
const userMenuOpen = ref(false);
const userMenuRef = ref(null);
const mobileNavOpen = ref(false);

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
  mobileNavOpen.value = false;
  emit('navigate', 'settings');
}

function toggleMobileNav() {
  mobileNavOpen.value = !mobileNavOpen.value;
}

function navigateAndClose(name) {
  mobileNavOpen.value = false;
  emit('navigate', name);
}
</script>

<template>
  <div class="layout-shell" :class="{ 'chat-layout-shell': isChatRoute }">
    <a href="#main-content" class="skip-link">跳转到主要内容</a>

    <header v-if="!isChatRoute" class="topbar">
      <button class="brand-button" type="button" aria-label="FLAI Tavern AI 首页" @click="navigateAndClose('home')">
        <span class="brand-mark" aria-hidden="true">F</span>
        <span>
          <strong>FLAI Tavern AI</strong>
        </span>
      </button>

      <button
        class="icon-button mobile-nav-toggle"
        type="button"
        :aria-label="mobileNavOpen ? '关闭导航菜单' : '打开导航菜单'"
        :aria-expanded="String(mobileNavOpen)"
        aria-controls="main-navigation"
        @click.stop="toggleMobileNav"
      >
        <X v-if="mobileNavOpen" :size="20" />
        <Menu v-else :size="20" />
      </button>

      <nav
        id="main-navigation"
        class="topnav"
        :class="{ 'mobile-open': mobileNavOpen }"
        aria-label="主导航"
      >
        <button :class="{ active: currentRoute === 'home' }" type="button" @click="navigateAndClose('home')">
          <Home :size="18" aria-hidden="true" />
          <span>首页</span>
        </button>
        <button
          :class="{ active: currentRoute === 'characterNew' }"
          type="button"
          @click="navigateAndClose('characterNew')"
        >
          <Plus :size="18" aria-hidden="true" />
          <span>创建</span>
        </button>
        <button
          :class="{ active: isWorldBookRoute }"
          type="button"
          @click="navigateAndClose('worldBooks')"
        >
          <BookOpen :size="18" aria-hidden="true" />
          <span>世界书</span>
        </button>
        <button
          :class="{ active: isExtensionsRoute }"
          type="button"
          @click="navigateAndClose('extensions')"
        >
          <Puzzle :size="18" aria-hidden="true" />
          <span>扩展</span>
        </button>
      </nav>

      <div class="top-actions">
        <button
          class="icon-button"
          type="button"
          :aria-label="theme === 'light' ? '切换到夜间模式' : '切换到日间模式'"
          :title="theme === 'light' ? '切换到夜间模式' : '切换到日间模式'"
          @click="$emit('toggle-theme')"
        >
          <Moon v-if="theme === 'light'" :size="19" aria-hidden="true" />
          <Sun v-else :size="19" aria-hidden="true" />
        </button>
        <div ref="userMenuRef" class="user-menu">
          <button
            class="user-chip"
            :class="{ active: currentRoute === 'settings', open: userMenuOpen }"
            type="button"
            aria-haspopup="menu"
            :aria-expanded="String(userMenuOpen)"
            aria-label="用户菜单"
            @click.stop="userMenuOpen = !userMenuOpen"
          >
            <span v-if="user?.avatarUrl" class="user-chip-avatar">
              <img :src="user.avatarUrl" :alt="user?.username || '用户头像'" />
            </span>
            <UserRound v-else :size="17" aria-hidden="true" />
            <span>{{ user?.displayName || user?.accountName || user?.username }}</span>
            <ChevronDown :size="15" aria-hidden="true" />
          </button>
          <div v-if="userMenuOpen" class="user-menu-panel" role="menu">
            <button class="user-menu-item" type="button" role="menuitem" @click="openUserSettings">
              <KeyRound :size="17" aria-hidden="true" />
              <span>个人中心</span>
            </button>
          </div>
        </div>
        <button
          class="icon-button"
          type="button"
          aria-label="退出登录"
          title="退出登录"
          @click="$emit('logout')"
        >
          <LogOut :size="19" aria-hidden="true" />
        </button>
      </div>
    </header>

    <main id="main-content" class="page-shell" tabindex="-1">
      <slot />
    </main>
  </div>
</template>
