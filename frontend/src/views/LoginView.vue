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
    <section class="auth-panel">
      <div class="auth-brand">
        <span class="brand-mark">F</span>
        <div>
          <p>欢迎回来</p>
          <h1>登录 FLAI Tavern AI</h1>
        </div>
      </div>

      <form class="form-grid" @submit.prevent="submit">
        <label class="field">
          <span>用户名</span>
          <input v-model.trim="username" autocomplete="username" maxlength="32" required />
        </label>
        <label class="field">
          <span>密码</span>
          <input v-model="password" autocomplete="current-password" type="password" minlength="6" maxlength="128" required />
        </label>
        <button class="primary-button" type="submit" :disabled="loading">
          <LogIn :size="18" />
          <span>{{ loading ? '登录中...' : '登录' }}</span>
        </button>
      </form>

      <button class="text-button" type="button" @click="emit('navigate', 'register')">
        还没有账号？创建一个
      </button>
    </section>
  </main>
</template>
