<script setup>
import { ref } from 'vue';
import { LogIn } from '@lucide/vue';
import { login } from '../api';
import { useNotify } from '../composables/useNotify';

const emit = defineEmits(['authenticated', 'navigate']);
const notify = useNotify();
const username = ref('');
const password = ref('');
const loading = ref(false);

async function submit() {
  loading.value = true;
  try {
    emit('authenticated', await login({ username: username.value, password: password.value }));
  } catch (err) {
    notify.error(err.message);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-panel" role="region" aria-label="登录">
      <div class="auth-brand">
        <span class="brand-mark" aria-hidden="true">F</span>
        <div>
          <p class="auth-brand-eyebrow">欢迎回来</p>
          <h1>登录 FLAI Tavern AI</h1>
          <p class="auth-brand-sub">本地部署 · 数据自持 · 安全可控</p>
        </div>
      </div>

      <form class="form-grid" @submit.prevent="submit" novalidate>
        <label class="field" for="login-username">
          <span>用户名</span>
          <input
            id="login-username"
            v-model.trim="username"
            autocomplete="username"
            maxlength="32"
            required
            aria-required="true"
          />
          <small class="field-hint">最多 32 个字符</small>
        </label>
        <label class="field" for="login-password">
          <span>密码</span>
          <input
            id="login-password"
            v-model="password"
            autocomplete="current-password"
            type="password"
            minlength="6"
            maxlength="128"
            required
            aria-required="true"
          />
          <small class="field-hint">至少 6 个字符</small>
        </label>
        <button class="primary-button auth-submit" type="submit" :disabled="loading" :aria-busy="loading">
          <LogIn :size="18" aria-hidden="true" />
          <span>{{ loading ? '登录中...' : '登录' }}</span>
        </button>
      </form>

      <button class="text-button" type="button" aria-label="跳转到注册页面" @click="emit('navigate', 'register')">
        还没有账号？创建一个
      </button>
    </section>
  </main>
</template>
