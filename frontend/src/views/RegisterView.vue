<script setup>
import { ref } from 'vue';
import { UserPlus } from '@lucide/vue';
import { register } from '../api';
import { useNotify } from '../composables/useNotify';

const emit = defineEmits(['authenticated', 'navigate']);
const notify = useNotify();
const username = ref('');
const password = ref('');
const confirmPassword = ref('');
const loading = ref(false);

async function submit() {
  if (loading.value) return;
  if (password.value !== confirmPassword.value) {
    notify.warning('两次输入的密码不一致');
    return;
  }

  loading.value = true;
  try {
    emit('authenticated', await register({ username: username.value, password: password.value }));
  } catch (err) {
    notify.error(err.message);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-panel" role="region" aria-label="注册">
      <div class="auth-brand">
        <span class="brand-mark" aria-hidden="true">F</span>
        <div>
          <p class="auth-brand-eyebrow">创建本地账号</p>
          <h1>注册 FLAI Tavern AI</h1>
          <p class="auth-brand-sub">本地部署 · 数据自持 · 安全可控</p>
        </div>
      </div>

      <form class="form-grid" :aria-busy="loading" @submit.prevent="submit" novalidate>
        <label class="field" for="register-username">
          <span>用户名</span>
          <input
            id="register-username"
            v-model.trim="username"
            autocomplete="username"
            maxlength="32"
            required
            aria-required="true"
            :disabled="loading"
          />
          <small class="field-hint">最多 32 个字符</small>
        </label>
        <label class="field" for="register-password">
          <span>密码</span>
          <input
            id="register-password"
            v-model="password"
            autocomplete="new-password"
            type="password"
            minlength="6"
            maxlength="128"
            required
            aria-required="true"
            :disabled="loading"
          />
          <small class="field-hint">至少 6 个字符</small>
        </label>
        <label class="field" for="register-confirm-password">
          <span>确认密码</span>
          <input
            id="register-confirm-password"
            v-model="confirmPassword"
            autocomplete="new-password"
            type="password"
            minlength="6"
            maxlength="128"
            required
            aria-required="true"
            :disabled="loading"
          />
          <small class="field-hint">再次输入密码</small>
        </label>
        <button class="primary-button auth-submit" type="submit" :disabled="loading" :aria-busy="loading">
          <UserPlus :size="18" aria-hidden="true" />
          <span>{{ loading ? '创建中...' : '注册并进入' }}</span>
        </button>
      </form>

      <button class="text-button" type="button" aria-label="跳转到登录页面" :disabled="loading" @click="emit('navigate', 'login')">
        已有账号？去登录
      </button>
    </section>
  </main>
</template>
