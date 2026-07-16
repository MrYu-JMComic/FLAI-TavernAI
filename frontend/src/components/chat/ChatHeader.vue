<script setup>
import { ref } from 'vue';
import { Activity, Brain, Coins, Home, Map, Menu, MoreHorizontal, Moon, Save, Settings, Sun, Users } from '@lucide/vue';

defineProps({
  showEconomyFeature: { type: Boolean, default: false },
  showNpcFeature: { type: Boolean, default: false },
  showSceneFeature: { type: Boolean, default: false },
  conversationReady: { type: Boolean, default: false },
  theme: { type: String, default: 'light' },
  conversation: { type: Object, default: null },
  provider: { type: Object, default: null },
  sending: { type: Boolean, default: false },
  activeTool: { type: String, default: '' }
});

const emit = defineEmits([
  'navigate', 'toggle-theme', 'open-sidebar', 'open-status', 'open-context',
  'open-economy', 'open-npc', 'open-scene', 'open-saves', 'open-settings'
]);
const moreMenuRef = ref(null);

function runMoreAction(eventName, event) {
  moreMenuRef.value?.removeAttribute('open');
  emit(eventName, event);
}
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
    <div class="deep-chat-header-title">
      <span class="deep-chat-title-avatar" aria-hidden="true">
        <img v-if="conversation?.character?.avatarUrl" :src="conversation.character.avatarUrl" alt="" />
        <span v-else>{{ (conversation?.character?.name || 'AI').slice(0, 1) }}</span>
      </span>
      <span class="deep-chat-title-copy">
        <strong>{{ conversation?.title || conversation?.character?.name || '当前会话' }}</strong>
        <small>
          <span>{{ conversation?.character?.name || 'AI 角色' }}</span>
          <i aria-hidden="true">·</i>
          <span>{{ sending ? '正在生成' : (provider?.model || '未配置模型') }}</span>
        </small>
      </span>
    </div>
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
      <button class="deep-icon-button chat-header-primary-tool" :class="{ active: activeTool === 'status' }" type="button" aria-label="角色状态" title="角色状态" :disabled="!conversationReady" @click="emit('open-status', $event)">
        <Activity :size="18" />
      </button>
      <button v-if="showEconomyFeature" class="deep-icon-button chat-header-primary-tool" :class="{ active: activeTool === 'economy' }" type="button" aria-label="经济系统" title="经济系统" :disabled="!conversationReady" @click="emit('open-economy', $event)">
        <Coins :size="18" />
      </button>
      <button v-if="showNpcFeature" class="deep-icon-button chat-header-primary-tool" :class="{ active: activeTool === 'npc' }" type="button" aria-label="NPC 管理" title="NPC 管理" :disabled="!conversationReady" @click="emit('open-npc', $event)">
        <Users :size="18" />
      </button>
      <button v-if="showSceneFeature" class="deep-icon-button chat-header-primary-tool" :class="{ active: activeTool === 'scene' }" type="button" aria-label="场景构建助手" title="场景构建助手" :disabled="conversationReady === false" @click="emit('open-scene', $event)">
        <Map :size="18" />
      </button>
      <details ref="moreMenuRef" class="chat-header-more">
        <summary class="deep-icon-button" aria-label="更多聊天工具" title="更多聊天工具">
          <MoreHorizontal :size="19" />
        </summary>
        <div class="chat-header-more-menu" role="menu">
          <button type="button" role="menuitem" @click="runMoreAction('toggle-theme', $event)">
            <Moon v-if="theme === 'light'" :size="17" aria-hidden="true" />
            <Sun v-else :size="17" aria-hidden="true" />
            <span>{{ theme === 'light' ? '夜间模式' : '日间模式' }}</span>
          </button>
          <button class="chat-header-overflow-tool" type="button" role="menuitem" :disabled="!conversationReady" @click="runMoreAction('open-status', $event)">
            <Activity :size="17" />
            <span>角色状态</span>
          </button>
          <button class="chat-header-overflow-tool" type="button" role="menuitem" :disabled="!conversationReady" @click="runMoreAction('open-npc', $event)">
            <Users :size="17" />
            <span>NPC 管理</span>
          </button>
          <button v-if="showSceneFeature" class="chat-header-overflow-tool" type="button" role="menuitem" :disabled="conversationReady === false" @click="runMoreAction('open-scene', $event)">
            <Map :size="17" />
            <span>场景构建助手</span>
          </button>
          <button v-if="showEconomyFeature" class="chat-header-overflow-tool" type="button" role="menuitem" :disabled="!conversationReady" @click="runMoreAction('open-economy', $event)">
            <Coins :size="17" />
            <span>经济系统</span>
          </button>
          <button type="button" role="menuitem" :disabled="!conversationReady" @click="runMoreAction('open-context', $event)">
            <Brain :size="17" />
            <span>上下文检查器</span>
          </button>
          <button type="button" role="menuitem" :disabled="!conversationReady" @click="runMoreAction('open-saves', $event)">
            <Save :size="17" />
            <span>存档管理</span>
          </button>
          <button type="button" role="menuitem" @click="runMoreAction('open-settings', $event)">
            <Settings :size="17" />
            <span>会话设置</span>
          </button>
        </div>
      </details>
    </div>
  </header>
</template>
