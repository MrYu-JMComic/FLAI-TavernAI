<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { X } from '@lucide/vue';

const props = defineProps({
  character: { type: Object, required: true },
  worldBooks: { type: Array, default: () => [] }
});
const emit = defineEmits(['close']);
const dialog = ref(null);
let previousFocus = null;
const sections = [
  { key: 'background', label: '角色背景' },
  { key: 'worldview', label: '世界观' },
  { key: 'persona', label: '角色人设' },
  { key: 'openingMessage', label: '开场白' }
];
const tags = computed(() => props.character.tags || props.character.selectedTags || []);
const advanced = computed(() => props.character.authorAdvancedSettings || {});
const enabledSkills = computed(() => Object.entries(advanced.value.accessorySkills || {}).filter(([, value]) => value?.enabled));
const skillLabels = { sceneAgent: '场景构建', worldDirector: '世界导演', gameHud: '游戏面板', rewardMode: '奖励模式', statusBarAgent: '状态栏', economyAgent: '经济识别', talentPrompt: '天赋提示', cgScene: 'CG 场景', memoryAgent: '记忆助手' };

onMounted(() => {
  previousFocus = document.activeElement;
  dialog.value?.showModal();
});
onBeforeUnmount(() => {
  if (previousFocus?.isConnected) previousFocus.focus();
});
</script>

<template>
  <dialog ref="dialog" class="character-card-preview" aria-labelledby="character-card-preview-title" @close="emit('close')" @click="($event.target === dialog) && emit('close')">
    <div class="character-card-preview-shell">
      <header class="character-card-preview-heading">
        <div><h2 id="character-card-preview-title">角色卡预览</h2><p>当前草稿 · 保存前可随时检查</p></div>
        <button class="icon-button" type="button" aria-label="关闭角色卡预览" autofocus @click="emit('close')"><X :size="20" /></button>
      </header>
      <div class="character-card-preview-body">
        <div class="character-card-preview-identity">
          <img v-if="character.avatarUrl" :src="character.avatarUrl" alt="角色头像" />
          <div><h3>{{ character.name || '未命名角色' }}</h3><p>{{ [character.gender, character.age].filter(Boolean).join(' · ') || '性别与年龄尚未填写' }}</p><small>{{ character.visibility === 'public' ? '公开角色' : '私有角色' }}</small></div>
        </div>
        <div v-if="tags.length" class="character-card-preview-tags"><span v-for="tag in tags" :key="typeof tag === 'string' ? tag : tag.id">{{ typeof tag === 'string' ? tag : tag.name }}</span></div>
        <section v-for="section in sections" :key="section.key" class="character-card-preview-section"><h3>{{ section.label }}</h3><p>{{ character[section.key] || '尚未填写' }}</p></section>
        <section class="character-card-preview-section"><h3>关联世界书</h3><ul v-if="worldBooks.length"><li v-for="book in worldBooks" :key="book.id">{{ book.name || book.title || book.id }}</li></ul><p v-else>尚未关联世界书</p></section>
        <details class="character-card-preview-section"><summary>高级配置与规则</summary>
          <p>正则规则：{{ character.regexRules?.length || 0 }} 条 · 渲染规则：{{ character.renderPlugins?.length || 0 }} 条</p>
          <div v-for="(rule, index) in character.regexRules || []" :key="index"><strong>{{ rule.label || `规则 ${index + 1}` }}</strong><pre>{{ rule.pattern }} → {{ rule.replacement }}</pre></div>
          <h4>状态栏提示词</h4><p>{{ advanced.statusBarPrompt || '尚未配置' }}</p>
          <h4>状态栏初始数据</h4><pre>{{ JSON.stringify(advanced.statusBarBlueprint || {}, null, 2) }}</pre>
          <h4>附属能力</h4><p>{{ enabledSkills.map(([key, value]) => `${skillLabels[key] || key}${value.enabled === 'auto' ? '（自动）' : ''}`).join('、') || '尚未启用' }}</p>
          <h4>自定义 CSS{{ advanced.customCssEnabled ? '（已启用）' : '' }}</h4><pre>{{ advanced.customCss || '尚未配置' }}</pre>
          <h4>自定义 JavaScript{{ advanced.customJsEnabled ? '（已启用）' : '' }}</h4><pre>{{ advanced.customJs || '尚未配置' }}</pre>
        </details>
      </div>
      <footer><button class="ghost-button" type="button" @click="emit('close')">关闭预览</button></footer>
    </div>
  </dialog>
</template>

<style scoped>
.character-card-preview { width: min(780px, calc(100vw - 24px)); max-height: calc(100dvh - 32px); padding: 0; color: var(--text); background: var(--surface); border: 1px solid var(--line); border-radius: 20px; overflow: hidden; }
.character-card-preview::backdrop { background: rgb(0 0 0 / 55%); }
.character-card-preview-shell { display: flex; flex-direction: column; max-height: calc(100dvh - 34px); }
.character-card-preview-heading, footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 24px; border-bottom: 1px solid var(--line); }
.character-card-preview-heading h2, .character-card-preview-identity h3 { margin: 0; }
.character-card-preview-heading p { margin: 5px 0 0; opacity: .65; font-size: 13px; }
.character-card-preview-body { overflow-y: auto; padding: 24px; }
.character-card-preview-identity { display: flex; align-items: center; gap: 20px; }
.character-card-preview-identity img { width: 80px; height: 96px; object-fit: cover; border-radius: 12px; }
.character-card-preview-identity p { margin: 8px 0; }
.character-card-preview-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 18px; }
.character-card-preview-tags span { padding: 4px 10px; background: var(--surface-strong); border-radius: 99px; font-size: 12px; }
.character-card-preview-section { margin-top: 24px; overflow-wrap: anywhere; }
.character-card-preview-section h3, .character-card-preview-section summary { font-weight: 650; font-size: 15px; }
.character-card-preview-section p, pre { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.75; font-family: inherit; font-size: 14px; }
.character-card-preview-section summary { cursor: pointer; }
footer { justify-content: flex-end; border-bottom: 0; border-top: 1px solid var(--line); padding-block: 12px; }
@media (max-width: 600px) { .character-card-preview-body, .character-card-preview-heading { padding: 16px; } }
</style>
