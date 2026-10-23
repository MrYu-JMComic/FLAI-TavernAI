<script setup>
import { computed } from 'vue';
import { ChevronRight, Database, KeyRound, SlidersHorizontal, UserRound } from '@lucide/vue';

const props = defineProps({
  profile: { type: Object, required: true },
  stats: { type: Object, required: true }
});

const emit = defineEmits(['navigate']);

const statistics = computed(() => [
  { label: 'AI 角色', value: props.stats.ownedAiCount },
  { label: '获赞', value: props.stats.likeCount },
  { label: '使用次数', value: props.stats.totalUseCount }
]);

const destinations = [
  { route: 'settingsProfile', label: '个人资料', icon: UserRound },
  { route: 'settingsPresets', label: '对话预设', icon: SlidersHorizontal },
  { route: 'settingsProvider', label: '模型网关', icon: KeyRound },
  { route: 'settingsData', label: '数据导出', icon: Database }
];

function formatCount(value) {
  const count = Number(value);
  return Number.isFinite(count) ? count.toLocaleString('zh-CN') : '0';
}
</script>

<template>
  <div class="personal-center-overview">
    <section class="form-panel personal-center-summary" aria-label="个人信息">
      <div class="personal-center-identity">
        <div class="large-avatar personal-center-avatar">
          <img v-if="profile.avatarUrl" :src="profile.avatarUrl" :alt="profile.accountName || '用户头像'" />
          <span v-else>{{ (profile.displayName || profile.accountName || 'U').slice(0, 1) }}</span>
        </div>
        <div class="personal-center-name">
          <strong>{{ profile.displayName || profile.accountName || '用户' }}</strong>
          <span>@{{ profile.accountName || '未设置账户名' }}</span>
          <span class="permission-chip personal-center-permission">{{ profile.permissionLabel || '用户组' }}</span>
        </div>
      </div>

      <div class="personal-center-statistics" aria-label="账户统计">
        <div v-for="stat in statistics" :key="stat.label" class="personal-center-stat">
          <span>{{ stat.label }}</span>
          <strong>{{ formatCount(stat.value) }}</strong>
        </div>
      </div>
    </section>

    <nav class="personal-center-destinations" aria-label="个人设置">
      <button
        v-for="destination in destinations"
        :key="destination.route"
        class="personal-center-destination"
        type="button"
        :aria-label="destination.label"
        @click="emit('navigate', destination.route)"
      >
        <component :is="destination.icon" :size="19" aria-hidden="true" />
        <span>{{ destination.label }}</span>
        <ChevronRight :size="18" aria-hidden="true" />
      </button>
    </nav>
  </div>
</template>
