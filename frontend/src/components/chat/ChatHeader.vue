<script setup>
import { Coins, Home, Menu, Save, Users } from '@lucide/vue';

defineProps({
  showEconomyFeature: { type: Boolean, default: false },
  showNpcFeature: { type: Boolean, default: false }
});

const emit = defineEmits(['navigate', 'open-sidebar', 'open-economy', 'open-npc', 'open-saves']);
</script>

<template>
  <header class="deep-chat-header">
    <div class="deep-chat-header-start">
      <button class="deep-icon-button mobile-menu" type="button" title="打开侧边栏" @click="emit('open-sidebar')">
        <Menu :size="19" />
      </button>
      <button class="deep-icon-button" type="button" title="返回首页" @click="emit('navigate', 'home')">
        <Home :size="18" />
      </button>
    </div>
    <div class="deep-chat-header-spacer" aria-hidden="true"></div>
    <div class="deep-chat-header-actions">
      <button v-if="showEconomyFeature" class="deep-icon-button" type="button" title="经济系统" @click="emit('open-economy')">
        <Coins :size="18" />
      </button>
      <button v-if="showNpcFeature" class="deep-icon-button" type="button" title="NPC 管理" @click="emit('open-npc')">
        <Users :size="18" />
      </button>
      <button class="deep-icon-button" type="button" title="存档管理" @click="emit('open-saves')">
        <Save :size="18" />
      </button>
    </div>
  </header>
</template>
