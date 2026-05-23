<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { Bot, Clock3, Eye, MessageSquareText, Pencil, Plus, Search } from '@lucide/vue';
import { createConversation, fetchCharacters, fetchConversations } from '../api';

const props = defineProps({
  provider: {
    type: Object,
    default: null
  }
});
const emit = defineEmits(['navigate']);

const characters = ref([]);
const search = ref('');
const sort = ref('created');
const loading = ref(false);
const error = ref('');

const providerState = computed(() => {
  if (props.provider?.apiKeyNeedsReset) {
    return '密钥需重设';
  }
  if (!props.provider?.apiKeySet) {
    return '未保存 SK';
  }
  return props.provider.supportsReasoning ? '流式 + 思考' : '流式';
});

onMounted(loadCharacters);
watch([search, sort], loadCharacters);

async function loadCharacters() {
  loading.value = true;
  error.value = '';
  try {
    characters.value = await fetchCharacters({ search: search.value, sort: sort.value });
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function openChat(character) {
  error.value = '';
  try {
    const existing = await fetchConversations({ characterId: character.id });
    const conversation = existing[0] || (await createConversation(character.id));
    emit('navigate', 'chat', { id: conversation.id });
  } catch (err) {
    error.value = err.message;
  }
}

function visibilityLabel(character) {
  if (character.visibility === 'public') {
    return character.canEdit ? '公开 · 拥有者' : '公开 · 可使用';
  }
  return '私人 · 拥有者';
}
</script>

<template>
  <section class="page-stack">
    <div class="section-heading">
      <div>
        <p>角色大厅</p>
        <h1>选择一位 AI 角色开始对话</h1>
      </div>
      <button class="primary-button" type="button" @click="emit('navigate', 'characterNew')">
        <Plus :size="18" />
        <span>创建角色</span>
      </button>
    </div>

    <section class="toolbar">
      <label class="search-box">
        <Search :size="18" />
        <input v-model.trim="search" placeholder="搜索名称、标签或人设" />
      </label>
      <label class="select-field">
        <Clock3 :size="18" />
        <select v-model="sort">
          <option value="created">按创建时间</option>
          <option value="used">按最近使用</option>
          <option value="name">按名称</option>
        </select>
      </label>
      <div class="provider-pill">
        <Bot :size="18" />
        <span>{{ provider?.gatewayName || '未配置' }} · {{ providerState }}</span>
      </div>
    </section>

    <p v-if="error" class="error-text">{{ error }}</p>
    <p v-if="loading" class="muted-text">正在加载角色...</p>

    <section v-else-if="characters.length" class="character-grid">
      <article v-for="character in characters" :key="character.id" class="character-card">
        <div class="character-avatar">
          <img v-if="character.avatarUrl" :src="character.avatarUrl" :alt="character.name" />
          <span v-else>{{ character.name.slice(0, 1) }}</span>
        </div>
        <div class="character-body">
          <div class="character-title">
            <h2>{{ character.name }}</h2>
            <small>{{ character.gender || '未设置' }} · {{ character.age || '年龄未知' }}</small>
          </div>
          <div class="permission-badges">
            <span class="visibility-badge" :class="character.visibility">{{ visibilityLabel(character) }}</span>
          </div>
          <p>{{ character.persona || character.background || '还没有填写人设。' }}</p>
          <div class="tag-row">
            <span v-for="tag in character.tags" :key="tag">{{ tag }}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="ghost-button" type="button" @click="emit('navigate', 'characterEdit', { id: character.id })">
            <Pencil v-if="character.canEdit" :size="17" />
            <Eye v-else :size="17" />
            <span>{{ character.canEdit ? '编辑' : '查看' }}</span>
          </button>
          <button class="primary-button" type="button" @click="openChat(character)">
            <MessageSquareText :size="17" />
            <span>对话</span>
          </button>
        </div>
      </article>
    </section>

    <section v-else class="empty-state">
      <Bot :size="34" />
      <h2>还没有角色</h2>
      <p>创建第一个角色，设置头像、世界观、人设和开场白。</p>
      <button class="primary-button" type="button" @click="emit('navigate', 'characterNew')">
        <Plus :size="18" />
        <span>创建角色</span>
      </button>
    </section>
  </section>
</template>
