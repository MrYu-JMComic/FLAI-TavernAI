<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ArrowUp, BookOpen, ChevronDown, Home, KeyRound, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Plus, Puzzle, ShieldCheck, Sun, UserRound, X } from '@lucide/vue';
import { useViewport } from '../composables/useViewport';

const ROUTE_LABELS = {
  home: '角色库',
  characterNew: '创建角色',
  characterEdit: '编辑角色',
  characterAssistant: 'AI 完善助手',
  characterAssistantNew: 'AI 创作助手',
  chat: '角色对话',
  worldBooks: '世界书',
  worldBookDetail: '世界书详情',
  extensions: '扩展管理',
  settings: '个人中心',
  settingsProfile: '个人资料',
  settingsPresets: '对话预设',
  settingsProvider: '模型网关',
  settingsData: '数据导出',
  admin: '额度管理'
};

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

const isConversationRoute = computed(() => usesConversationLayout(props.currentRoute));
const isAssistantRoute = computed(() => ['characterAssistant', 'characterAssistantNew'].includes(props.currentRoute));
const isHomeRoute = computed(() => props.currentRoute === 'home');
const isWorldBookRoute = computed(() => props.currentRoute === 'worldBooks' || props.currentRoute === 'worldBookDetail');
const isExtensionsRoute = computed(() => props.currentRoute === 'extensions');
const isAdminRoute = computed(() => props.currentRoute === 'admin');
const isPersonalSettingsRoute = computed(() => ['settings', 'settingsProfile', 'settingsPresets', 'settingsProvider', 'settingsData'].includes(props.currentRoute));
const isAccountRoute = computed(() => isPersonalSettingsRoute.value || isAdminRoute.value);
const showMobileBottomNav = computed(() => ['home', 'characterNew', 'worldBooks', 'settings'].includes(props.currentRoute));
const isWorkspaceRoute = computed(() => (
  props.currentRoute === 'characterNew'
  || props.currentRoute === 'characterEdit'
  || props.currentRoute === 'characterAssistant'
  || props.currentRoute === 'characterAssistantNew'
  || isWorldBookRoute.value
  || isExtensionsRoute.value
  || isPersonalSettingsRoute.value
  || isAdminRoute.value
));
const userMenuOpen = ref(false);
const userMenuRef = ref(null);
const mobileNavOpen = ref(false);
const pageShellRef = ref(null);
const pageScrollTop = ref(0);
const pageScrollProgress = ref(0);
const pageScrollPositions = new Map();
const { isPhone: isMobileNavViewport } = useViewport({ breakpoint: '(max-width: 620px)' });
const { isPhone: isCompactNavViewport } = useViewport({ breakpoint: '(max-width: 900px)' });
const { isPhone: prefersCompactSidebar } = useViewport({ breakpoint: '(max-width: 1180px)' });
const desktopNavCollapsed = ref(prefersCompactSidebar.value);
const navigationWidthStyle = computed(() => ({
  '--navigation-width': desktopNavCollapsed.value ? '72px' : '224px'
}));
const currentPageLabel = computed(() => ROUTE_LABELS[props.currentRoute] || '工作台');
const showScrollTop = computed(() => !isConversationRoute.value && pageScrollTop.value > 520);
const scrollProgressStyle = computed(() => ({
  '--page-scroll-progress': pageScrollProgress.value / 100
}));
let pageScrollFrame = 0;

watch(
  () => props.currentRoute,
  async (nextRoute, previousRoute) => {
    if (previousRoute) {
      savePageScrollPosition(previousRoute);
    }
    userMenuOpen.value = false;
    mobileNavOpen.value = false;
    updateDocumentTitle();
    await nextTick();
    restorePageScrollPosition(nextRoute);
  },
  { immediate: true }
);

watch(isMobileNavViewport, (isMobile) => {
  if (!isMobile) {
    mobileNavOpen.value = false;
  }
});

watch(prefersCompactSidebar, (isCompact) => {
  desktopNavCollapsed.value = isCompact;
});

onMounted(() => {
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('keydown', handleDocumentKeydown);
  restorePageScrollPosition(props.currentRoute);
});

onBeforeUnmount(() => {
  savePageScrollPosition(props.currentRoute);
  document.removeEventListener('click', handleDocumentClick);
  document.removeEventListener('keydown', handleDocumentKeydown);
  if (pageScrollFrame) {
    window.cancelAnimationFrame(pageScrollFrame);
    pageScrollFrame = 0;
  }
  document.title = 'FLAI Tavern AI';
});

function handleDocumentClick(event) {
  const target = event?.target;
  if (!isDomEventTarget(target) || !userMenuRef.value?.contains(target)) {
    userMenuOpen.value = false;
  }
}

function isDomEventTarget(target) {
  return Boolean(target && typeof target === 'object' && typeof target.nodeType === 'number');
}

function handleDocumentKeydown(event) {
  if (event?.key !== 'Escape') {
    return;
  }
  userMenuOpen.value = false;
  mobileNavOpen.value = false;
}

function toggleUserMenu() {
  userMenuOpen.value = !userMenuOpen.value;
  if (userMenuOpen.value) {
    mobileNavOpen.value = false;
  }
}

function openUserSettings() {
  userMenuOpen.value = false;
  mobileNavOpen.value = false;
  emit('navigate', 'settings');
}

function openExtensions() {
  userMenuOpen.value = false;
  mobileNavOpen.value = false;
  emit('navigate', 'extensions');
}

function openAdmin() {
  userMenuOpen.value = false;
  mobileNavOpen.value = false;
  emit('navigate', 'admin');
}

function logoutFromMenu() {
  userMenuOpen.value = false;
  mobileNavOpen.value = false;
  emit('logout');
}

function toggleMobileNav() {
  mobileNavOpen.value = !mobileNavOpen.value;
  if (mobileNavOpen.value) {
    userMenuOpen.value = false;
  }
}

function toggleDesktopNav() {
  desktopNavCollapsed.value = !desktopNavCollapsed.value;
  userMenuOpen.value = false;
}

function navigateAndClose(name) {
  mobileNavOpen.value = false;
  emit('navigate', name);
}

function handlePageScroll() {
  if (pageScrollFrame) {
    return;
  }
  pageScrollFrame = window.requestAnimationFrame(() => {
    pageScrollFrame = 0;
    updatePageScrollState();
  });
}

function updatePageScrollState() {
  const pageShell = pageShellRef.value;
  if (!pageShell) {
    pageScrollTop.value = 0;
    pageScrollProgress.value = 0;
    return;
  }
  const maxScroll = Math.max(0, pageShell.scrollHeight - pageShell.clientHeight);
  pageScrollTop.value = Math.max(0, pageShell.scrollTop);
  pageScrollProgress.value = maxScroll > 0
    ? Math.min(100, (pageScrollTop.value / maxScroll) * 100)
    : 0;
}

function savePageScrollPosition(routeName) {
  const pageShell = pageShellRef.value;
  if (!pageShell || !routeName || usesConversationLayout(routeName)) {
    return;
  }
  pageScrollPositions.set(routeName, Math.max(0, pageShell.scrollTop));
}

function restorePageScrollPosition(routeName) {
  const pageShell = pageShellRef.value;
  if (!pageShell) {
    return;
  }
  pageShell.scrollTop = usesConversationLayout(routeName)
    ? 0
    : pageScrollPositions.get(routeName) || 0;
  updatePageScrollState();
}

function scrollToTop() {
  const pageShell = pageShellRef.value;
  if (!pageShell) {
    return;
  }
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  pageShell.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
}

function updateDocumentTitle() {
  document.title = `${currentPageLabel.value} · FLAI Tavern AI`;
}

function usesConversationLayout(routeName) {
  return routeName === 'chat';
}
</script>

<template>
  <div
    class="layout-shell"
    :class="{ 'chat-layout-shell': isConversationRoute, 'home-layout-shell': isHomeRoute, 'workspace-layout-shell': isWorkspaceRoute, 'assistant-layout-shell': isAssistantRoute }"
    :style="navigationWidthStyle"
  >
    <a href="#main-content" class="skip-link" @click.prevent="pageShellRef?.focus()">跳转到主要内容</a>

    <aside
      v-if="!isConversationRoute"
      class="app-navigation"
      :class="{ topbar: isCompactNavViewport, 'is-collapsed': desktopNavCollapsed }"
      aria-label="工作区导航"
    >
      <span class="page-scroll-progress" :style="scrollProgressStyle" aria-hidden="true"></span>

      <div class="navigation-heading">
        <button class="brand-button" type="button" aria-label="FLAI Tavern AI 首页" title="FLAI Tavern AI 首页" @click="navigateAndClose('home')">
          <span class="brand-mark" aria-hidden="true">F</span>
          <span>
            <strong>FLAI Tavern AI</strong>
          </span>
        </button>
        <button
          class="icon-button desktop-nav-toggle"
          type="button"
          :aria-label="desktopNavCollapsed ? '展开主导航' : '收起主导航'"
          :title="desktopNavCollapsed ? '展开主导航' : '收起主导航'"
          :aria-expanded="String(!desktopNavCollapsed)"
          aria-controls="main-navigation"
          @click="toggleDesktopNav"
        >
          <PanelLeftOpen v-if="desktopNavCollapsed" :size="18" aria-hidden="true" />
          <PanelLeftClose v-else :size="18" aria-hidden="true" />
        </button>
      </div>

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
        <button :class="{ active: currentRoute === 'home' }" type="button" title="首页" :aria-current="currentRoute === 'home' ? 'page' : undefined" @click="navigateAndClose('home')">
          <Home :size="18" aria-hidden="true" />
          <span>首页</span>
        </button>
        <button
          :class="{ active: currentRoute === 'characterNew' }"
          type="button"
          title="创建"
          :aria-current="currentRoute === 'characterNew' ? 'page' : undefined"
          @click="navigateAndClose('characterNew')"
        >
          <Plus :size="18" aria-hidden="true" />
          <span>创建</span>
        </button>
        <button
          :class="{ active: isWorldBookRoute }"
          type="button"
          title="世界书"
          :aria-current="isWorldBookRoute ? 'page' : undefined"
          @click="navigateAndClose('worldBooks')"
        >
          <BookOpen :size="18" aria-hidden="true" />
          <span>世界书</span>
        </button>
        <button
          :class="{ active: isPersonalSettingsRoute }"
          type="button"
          title="个人中心"
          :aria-current="isPersonalSettingsRoute ? 'page' : undefined"
          @click="navigateAndClose('settings')"
        >
          <UserRound :size="18" aria-hidden="true" />
          <span>个人</span>
        </button>
        <button
          :class="{ active: isExtensionsRoute }"
          type="button"
          title="扩展"
          :aria-current="isExtensionsRoute ? 'page' : undefined"
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
            :class="{ active: isAccountRoute, open: userMenuOpen }"
            type="button"
            aria-haspopup="menu"
            :aria-expanded="String(userMenuOpen)"
            aria-label="用户菜单"
            :title="user?.displayName || user?.accountName || user?.username || '用户菜单'"
            @click.stop="toggleUserMenu"
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
            <button class="user-menu-item" type="button" role="menuitem" @click="openExtensions">
              <Puzzle :size="17" aria-hidden="true" />
              <span>扩展管理</span>
            </button>
            <button v-if="user?.isRootAdmin" class="user-menu-item" type="button" role="menuitem" @click="openAdmin">
              <ShieldCheck :size="17" aria-hidden="true" />
              <span>额度管理</span>
            </button>
            <button class="user-menu-item danger" type="button" role="menuitem" @click="logoutFromMenu">
              <LogOut :size="17" aria-hidden="true" />
              <span>退出登录</span>
            </button>
          </div>
        </div>
      </div>
    </aside>

    <main id="main-content" ref="pageShellRef" class="page-shell" tabindex="-1" @scroll.passive="handlePageScroll">
      <slot />
    </main>

    <Transition name="scroll-top">
      <button
        v-if="showScrollTop"
        class="page-scroll-top"
        type="button"
        aria-label="回到顶部"
        title="回到顶部"
        @click="scrollToTop"
      >
        <ArrowUp :size="18" aria-hidden="true" />
        <span>回到顶部</span>
      </button>
    </Transition>

    <nav v-if="showMobileBottomNav" class="mobile-bottom-nav" aria-label="移动端主导航">
      <button :class="{ active: currentRoute === 'home' }" type="button" :aria-current="currentRoute === 'home' ? 'page' : undefined" @click="navigateAndClose('home')">
        <Home :size="20" aria-hidden="true" />
        <span>首页</span>
      </button>
      <button :class="{ active: currentRoute === 'characterNew' }" type="button" :aria-current="currentRoute === 'characterNew' ? 'page' : undefined" @click="navigateAndClose('characterNew')">
        <Plus :size="20" aria-hidden="true" />
        <span>创建</span>
      </button>
      <button :class="{ active: isWorldBookRoute }" type="button" :aria-current="isWorldBookRoute ? 'page' : undefined" @click="navigateAndClose('worldBooks')">
        <BookOpen :size="20" aria-hidden="true" />
        <span>世界书</span>
      </button>
      <button :class="{ active: currentRoute === 'settings' }" type="button" title="个人中心" :aria-current="currentRoute === 'settings' ? 'page' : undefined" @click="navigateAndClose('settings')">
        <UserRound :size="20" aria-hidden="true" />
        <span>个人</span>
      </button>
    </nav>
  </div>
</template>
