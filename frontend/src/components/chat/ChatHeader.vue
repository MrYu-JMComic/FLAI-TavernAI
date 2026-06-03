<script setup>
import { Coins, Home, Menu, Save, Users, Zap } from '@lucide/vue';

defineProps({
  conversation: { type: Object, default: null },
  currentProviderLabel: { type: String, default: '' },
  currentModelLabel: { type: String, default: '' },
  economyAccounts: { type: Array, default: () => [] },
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
    <div class="deep-chat-header-title">
      <h1>{{ conversation?.title || '角色对话' }}</h1>
      <p>
        <Zap :size="14" />
        <span>{{ currentProviderLabel }} · {{ currentModelLabel }}</span>
      </p>
      <p v-if="showEconomyFeature && economyAccounts.length" class="economy-summary-header" @click="emit('open-economy')">
        <span v-for="acc in economyAccounts" :key="acc.id" class="economy-chip">
          {{ { gold: '金币', silver: '银币', copper: '铜币', gem: '宝石', credit: '点数' }[acc.currencyType] || '银币' }}{{ acc.balance.toLocaleString('zh-CN') }}
        </span>
      </p>
    </div>
    <button v-if="showEconomyFeature" class="deep-icon-button" type="button" title="经济系统" @click="emit('open-economy')">
      <Coins :size="18" />
    </button>
    <button v-if="showNpcFeature" class="deep-icon-button" type="button" title="NPC 管理" @click="emit('open-npc')">
      <Users :size="18" />
    </button>
    <button class="deep-icon-button" type="button" title="存档管理" @click="emit('open-saves')">
      <Save :size="18" />
    </button>
  </header>
</template>
