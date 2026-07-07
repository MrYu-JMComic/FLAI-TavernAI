<script setup>
import { Bot, Heart, MessageSquareText, Save, ShieldCheck, Upload } from '@lucide/vue';

defineProps({
  avatarSaving: { type: Boolean, default: false },
  ownedCharacters: { type: Array, default: () => [] },
  profile: { type: Object, required: true },
  profileSaving: { type: Boolean, default: false },
  stats: { type: Object, required: true }
});

const emit = defineEmits(['avatar-change', 'submit', 'update-display-name']);

function readInputValue(event) {
  const target = event?.target;
  return target && target.value !== undefined ? target.value : '';
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function visibilityText(value) {
  return value === 'public' ? '公开' : '私有';
}
</script>

<template>
  <section id="personal-section-profile" class="form-panel profile-panel">
    <div class="inline-heading">
      <div>
        <h2>个人资料</h2>
      </div>
    </div>

    <div class="profile-layout">
      <div class="avatar-editor compact-avatar-editor">
        <div class="large-avatar">
          <img v-if="profile.avatarUrl" :src="profile.avatarUrl" :alt="profile.accountName || '用户头像'" />
          <span v-else>{{ (profile.displayName || profile.accountName || 'U').slice(0, 1) }}</span>
        </div>
        <label class="file-button" :class="{ disabled: avatarSaving }">
          <Upload :size="18" />
          <span>{{ avatarSaving ? '保存中...' : '上传头像' }}</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            :disabled="avatarSaving"
            @change="emit('avatar-change', $event)"
          />
        </label>
      </div>

      <form class="profile-form" :aria-busy="profileSaving" @submit.prevent="emit('submit')">
        <label class="field">
          <span>账户名</span>
          <strong class="readonly-value">{{ profile.accountName }}</strong>
        </label>
        <label class="field">
          <span>对话用户名</span>
          <input
            :value="profile.displayName"
            maxlength="8"
            :disabled="profileSaving"
            placeholder="可选，最多 8 个字符"
            @input="emit('update-display-name', readInputValue($event).trim())"
          />
        </label>
        <div class="profile-meta-row">
          <span class="permission-chip strong">
            <ShieldCheck :size="16" />
            {{ profile.permissionLabel }}
          </span>
          <small>支持真管理员、管理员组、用户组、游客组。</small>
        </div>
        <div class="form-actions">
          <button class="primary-button" type="submit" :disabled="profileSaving">
            <Save :size="18" />
            <span>{{ profileSaving ? '保存中...' : '保存个人资料' }}</span>
          </button>
        </div>
      </form>
    </div>

    <div class="profile-stats-grid">
      <div class="profile-stat-card">
        <Bot :size="18" />
        <span>拥有 AI</span>
        <strong>{{ formatNumber(stats.ownedAiCount) }}</strong>
      </div>
      <div class="profile-stat-card">
        <Heart :size="18" />
        <span>获得点赞</span>
        <strong>{{ formatNumber(stats.likeCount) }}</strong>
      </div>
      <div class="profile-stat-card">
        <MessageSquareText :size="18" />
        <span>使用次数</span>
        <strong>{{ formatNumber(stats.totalUseCount) }}</strong>
      </div>
    </div>

    <div class="owned-ai-list">
      <div class="inline-heading">
        <div>
          <h2>我的 AI</h2>
          <p>公开 {{ formatNumber(stats.publicAiCount) }} · 私有 {{ formatNumber(stats.privateAiCount) }}</p>
        </div>
      </div>
      <div v-if="ownedCharacters.length" class="owned-ai-rows">
        <div v-for="character in ownedCharacters" :key="character.id" class="owned-ai-row">
          <div class="character-avatar small">
            <img v-if="character.avatarUrl" :src="character.avatarUrl" :alt="character.name" />
            <span v-else>{{ character.name.slice(0, 1) }}</span>
          </div>
          <div>
            <strong>{{ character.name }}</strong>
            <small>{{ visibilityText(character.visibility) }} · 使用 {{ formatNumber(character.useCount) }} · 点赞 {{ formatNumber(character.likeCount) }}</small>
          </div>
        </div>
      </div>
      <p v-else class="muted-text">还没有拥有的 AI。</p>
    </div>
  </section>
</template>
