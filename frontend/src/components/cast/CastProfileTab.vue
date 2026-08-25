<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { Eye, EyeOff, Lock, MapPin, Save, Shirt, UserRound } from '@lucide/vue';
import { useCastManagerContext } from './castManagerContext.js';

const manager = useCastManagerContext();
const profile = reactive(emptyProfile());
const appearance = reactive(emptyAppearance());
const profileBaseline = ref('');
const appearanceBaseline = ref('');

const profileDirty = computed(() => profileBaseline.value && serialize(profile) !== profileBaseline.value);
const appearanceDirty = computed(() => appearanceBaseline.value && serialize(appearance) !== appearanceBaseline.value);

watch(() => manager.detail.value?.member, (member) => {
  if (!member) {
    Object.assign(profile, emptyProfile());
    profileBaseline.value = '';
    manager.setDirty('profile', false);
    return;
  }
  Object.assign(profile, {
    canonicalName: member.canonicalName || '',
    aliases: (member.aliases || []).join(', '),
    status: member.status || 'active',
    customStatus: member.customStatus || '',
    relationship: member.relationship || '',
    currentLocationLabel: member.currentLocationLabel || '',
    visibility: member.visibility || 'visible',
    memorySealed: Boolean(member.memorySealed),
  });
  profileBaseline.value = serialize(profile);
  manager.setDirty('profile', false);
}, { immediate: true });

watch(
  () => [manager.detail.value?.member?.id || '', manager.detail.value?.appearance || null],
  ([memberId, value]) => {
  if (!memberId) {
    Object.assign(appearance, emptyAppearance());
    appearanceBaseline.value = '';
    manager.setDirty('appearance', false);
    return;
  }
  const currentAppearance = value || {};
  Object.assign(appearance, {
    summary: currentAppearance.summary || '',
    outfit: currentAppearance.outfit || '',
    injuries: joinLines(currentAppearance.injuries),
    transformations: joinLines(currentAppearance.transformations),
  });
  appearanceBaseline.value = serialize(appearance);
  manager.setDirty('appearance', false);
  },
  { immediate: true }
);

watch(profileDirty, (dirty) => manager.setDirty('profile', dirty), { immediate: true });
watch(appearanceDirty, (dirty) => manager.setDirty('appearance', dirty), { immediate: true });

async function submitProfile() {
  const member = manager.detail.value?.member;
  if (!member || !profileDirty.value) return;
  await manager.saveProfile({
    canonicalName: profile.canonicalName.trim(),
    aliases: splitList(profile.aliases),
    status: profile.status.trim(),
    customStatus: profile.customStatus.trim(),
    relationship: profile.relationship.trim(),
    currentLocationLabel: profile.currentLocationLabel.trim(),
    visibility: profile.visibility,
    memorySealed: profile.memorySealed,
    revision: member.revision,
  });
}

async function submitAppearance() {
  if (!appearanceDirty.value) return;
  const current = manager.detail.value?.appearance;
  await manager.saveAppearance({
    summary: appearance.summary.trim(),
    outfit: appearance.outfit.trim(),
    injuries: splitLines(appearance.injuries),
    transformations: splitLines(appearance.transformations),
    ...(current?.revision ? { revision: current.revision } : {}),
  });
}

onBeforeUnmount(() => {
  manager.setDirty('profile', false);
  manager.setDirty('appearance', false);
});

function emptyProfile() {
  return {
    canonicalName: '', aliases: '', status: 'active', customStatus: '', relationship: '',
    currentLocationLabel: '', visibility: 'visible', memorySealed: false,
  };
}

function emptyAppearance() {
  return { summary: '', outfit: '', injuries: '', transformations: '' };
}

function splitList(value) {
  return [...new Set(String(value || '').split(/[,，\n]/).map((entry) => entry.trim()).filter(Boolean))];
}

function splitLines(value) {
  return String(value || '').split(/\n/).map((entry) => entry.trim()).filter(Boolean);
}

function joinLines(value) {
  return Array.isArray(value) ? value.map((entry) => String(entry || '')).filter(Boolean).join('\n') : '';
}

function serialize(value) {
  return JSON.stringify(value);
}
</script>

<template>
  <section class="cast-tab-panel" role="tabpanel" aria-labelledby="cast-tab-profile">
    <form class="cast-form-section" @submit.prevent="submitProfile">
      <header class="cast-section-heading">
        <span aria-hidden="true"><UserRound :size="18" /></span>
        <div>
          <h3 tabindex="-1">身份与状态</h3>
          <p>资料版本 {{ manager.detail.value?.member?.revision || 1 }}</p>
        </div>
        <button type="submit" class="cast-button primary" :disabled="!profileDirty || manager.busy.mutation || !profile.canonicalName.trim()">
          <Save :size="16" aria-hidden="true" />
          {{ manager.busy.kind === 'member.update' ? '保存中' : '保存资料' }}
        </button>
      </header>

      <div class="cast-form-grid two-column">
        <label>
          <span>正式名</span>
          <input v-model="profile.canonicalName" maxlength="120" required autocomplete="off" />
        </label>
        <label>
          <span>别名</span>
          <input v-model="profile.aliases" maxlength="1000" placeholder="用逗号分隔" autocomplete="off" />
        </label>
        <label>
          <span>状态</span>
          <input v-model="profile.status" maxlength="80" autocomplete="off" />
        </label>
        <label>
          <span>可见性</span>
          <select v-model="profile.visibility" :disabled="manager.detail.value?.member?.memberType === 'protagonist'">
            <option value="visible">在册</option>
            <option value="hidden">隐藏</option>
          </select>
        </label>
        <label class="full-width">
          <span>关系</span>
          <textarea v-model="profile.relationship" maxlength="1000" rows="2"></textarea>
        </label>
        <label class="full-width">
          <span><MapPin :size="15" aria-hidden="true" />当前位置</span>
          <input v-model="profile.currentLocationLabel" maxlength="500" autocomplete="off" />
        </label>
        <label class="full-width">
          <span>自定义状态</span>
          <textarea v-model="profile.customStatus" maxlength="500" rows="2"></textarea>
        </label>
      </div>

      <label class="cast-check-row">
        <input v-model="profile.memorySealed" type="checkbox" />
        <span aria-hidden="true"><Lock :size="17" /></span>
        <span>
          <b>封存自动记忆</b>
          <small>自动同步与 AI 整理不会改写该人物的记忆</small>
        </span>
      </label>

      <p class="cast-visibility-note">
        <Eye v-if="profile.visibility === 'visible'" :size="15" aria-hidden="true" />
        <EyeOff v-else :size="15" aria-hidden="true" />
        {{ profile.visibility === 'visible' ? '人物显示在当前名册中' : '人物仅在“已隐藏”筛选中显示' }}
      </p>
    </form>

    <form class="cast-form-section" @submit.prevent="submitAppearance">
      <header class="cast-section-heading">
        <span aria-hidden="true"><Shirt :size="18" /></span>
        <div>
          <h3>外貌与装束</h3>
          <p>独立记录当前外观</p>
        </div>
        <button type="submit" class="cast-button secondary" :disabled="!appearanceDirty || manager.busy.mutation">
          <Save :size="16" aria-hidden="true" />
          {{ manager.busy.kind === 'appearance.update' ? '保存中' : '保存外貌' }}
        </button>
      </header>
      <div class="cast-form-grid two-column">
        <label class="full-width">
          <span>外貌摘要</span>
          <textarea v-model="appearance.summary" maxlength="8000" rows="3"></textarea>
        </label>
        <label class="full-width">
          <span>当前装束</span>
          <textarea v-model="appearance.outfit" maxlength="4000" rows="3"></textarea>
        </label>
        <label>
          <span>伤势</span>
          <textarea v-model="appearance.injuries" rows="3" placeholder="每行一项"></textarea>
        </label>
        <label>
          <span>变化</span>
          <textarea v-model="appearance.transformations" rows="3" placeholder="每行一项"></textarea>
        </label>
      </div>
    </form>
  </section>
</template>
