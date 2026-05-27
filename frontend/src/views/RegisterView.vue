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
    <section class="auth-panel">
      <div class="auth-brand">
        <span class="brand-mark">F</span>
        <div>
          <p>创建本地账号</p>
          <h1>注册 FLAI Tavern AI</h1>
        </div>
      </div>

      <form class="form-grid" @submit.prevent="submit">
        <label class="field">
          <span>用户名</span>
          <input v-model.trim="username" autocomplete="username" maxlength="32" required />
        </label>
        <label class="field">
          <span>密码</span>
          <input v-model="password" autocomplete="new-password" type="password" minlength="6" maxlength="128" required />
        </label>
        <label class="field">
          <span>确认密码</span>
          <input v-model="confirmPassword" autocomplete="new-password" type="password" minlength="6" maxlength="128" required />
        </label>
        <button class="primary-button" type="submit" :disabled="loading">
          <UserPlus :size="18" />
          <span>{{ loading ? '创建中...' : '注册并进入' }}</span>
        </button>
      </form>

      <button class="text-button" type="button" @click="emit('navigate', 'login')">
        已有账号？去登录
      </button>
    </section>
  </main>
</template>
