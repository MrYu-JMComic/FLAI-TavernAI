<script setup>
import { Coins, Home, Menu, Moon, Save, Sun, Users } from '@lucide/vue';

defineProps({
  showEconomyFeature: { type: Boolean, default: false },
  showNpcFeature: { type: Boolean, default: false },
  conversationReady: { type: Boolean, default: false },
  theme: { type: String, default: 'light' }
});

const emit = defineEmits(['navigate', 'toggle-theme', 'open-sidebar', 'open-economy', 'open-npc', 'open-saves']);
</script>

<template>
  <header class="deep-chat-header">
    <div class="deep-chat-header-start">
      <button class="deep-icon-button mobile-menu" type="button" aria-label="打开侧边栏" title="打开侧边栏" @click="emit('open-sidebar')">
        <Menu :size="19" />
      </button>
      <button class="deep-icon-button" type="button" aria-label="返回首页" title="返回首页" @click="emit('navigate', 'home')">
        <Home :size="18" />
      </button>
    </div>
    <div class="deep-chat-header-spacer" aria-hidden="true"></div>
    <div class="deep-chat-header-actions">
      <button
        class="deep-icon-button"
        type="button"
        :aria-label="theme === 'light' ? '切换到夜间模式' : '切换到日间模式'"
        :title="theme === 'light' ? '切换到夜间模式' : '切换到日间模式'"
        @click="emit('toggle-theme')"
      >
        <Moon v-if="theme === 'light'" :size="18" aria-hidden="true" />
        <Sun v-else :size="18" aria-hidden="true" />
      </button>
      <button v-if="showEconomyFeature" class="deep-icon-button" type="button" aria-label="经济系统" title="经济系统" :disabled="!conversationReady" :aria-busy="!conversationReady" @click="emit('open-economy')">
        <Coins :size="18" />
      </button>
      <button v-if="showNpcFeature" class="deep-icon-button" type="button" aria-label="NPC 管理" title="NPC 管理" :disabled="!conversationReady" :aria-busy="!conversationReady" @click="emit('open-npc')">
        <Users :size="18" />
      </button>
      <button class="deep-icon-button" type="button" aria-label="存档管理" title="存档管理" :disabled="!conversationReady" :aria-busy="!conversationReady" @click="emit('open-saves')">
        <Save :size="18" />
      </button>
    </div>
  </header>
</template>
