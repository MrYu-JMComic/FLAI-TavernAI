<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Eye, EyeOff, LogIn, UserPlus } from '@lucide/vue';
import { login, register } from '../api/auth.js';
import { useNotify } from '../composables/useNotify';

const props = defineProps({
  initialMode: {
    type: String,
    default: 'login',
    validator: (value) => value === 'login' || value === 'register'
  }
});
const emit = defineEmits(['authenticated']);
const notify = useNotify();

const mode = ref(normalizeAuthMode(props.initialMode));
const username = ref('');
const password = ref('');
const confirmPassword = ref('');
const passwordVisible = ref(false);
const confirmPasswordVisible = ref(false);
const loading = ref(false);
const formError = ref('');
let submitToken = 0;
let disposed = false;

const isRegisterMode = computed(() => mode.value === 'register');
const authTitle = computed(() => (isRegisterMode.value ? '注册 FLAI Tavern AI' : '登录 FLAI Tavern AI'));
const authEyebrow = computed(() => (isRegisterMode.value ? '创建本地账号' : '欢迎回来'));
const submitText = computed(() => {
  if (loading.value) {
    return isRegisterMode.value ? '创建中...' : '登录中...';
  }
  return isRegisterMode.value ? '注册并进入' : '登录';
});
const passwordInputType = computed(() => (passwordVisible.value ? 'text' : 'password'));
const confirmPasswordInputType = computed(() => (confirmPasswordVisible.value ? 'text' : 'password'));
const passwordAutocomplete = computed(() => (isRegisterMode.value ? 'new-password' : 'current-password'));

watch(
  () => props.initialMode,
  (value) => {
    mode.value = normalizeAuthMode(value);
    clearAuthFeedback();
  }
);

watch([username, password, confirmPassword], clearAuthFeedback);

onBeforeUnmount(() => {
  disposed = true;
  submitToken += 1;
});

function normalizeAuthMode(value) {
  return value === 'register' ? 'register' : 'login';
}

function setMode(nextMode) {
  if (loading.value) {
    return;
  }
  const normalizedMode = normalizeAuthMode(nextMode);
  if (mode.value === normalizedMode) {
    return;
  }
  mode.value = normalizedMode;
  confirmPassword.value = '';
  confirmPasswordVisible.value = false;
  clearAuthFeedback();
}

function clearAuthFeedback() {
  formError.value = '';
}

function isCurrentSubmit(token) {
  return !disposed && token === submitToken;
}

function validateAuthForm() {
  const trimmedUsername = username.value.trim();
  if (!trimmedUsername) {
    formError.value = '请输入用户名';
    return false;
  }
  if (trimmedUsername.length > 32) {
    formError.value = '用户名不能超过 32 个字符';
    return false;
  }
  if (password.value.length < 6) {
    formError.value = '密码至少需要 6 个字符';
    return false;
  }
  if (password.value.length > 128) {
    formError.value = '密码不能超过 128 个字符';
    return false;
  }
  if (isRegisterMode.value && password.value !== confirmPassword.value) {
    formError.value = '两次输入的密码不一致';
    return false;
  }
  return true;
}

async function submit() {
  if (loading.value) return;
  clearAuthFeedback();
  if (!validateAuthForm()) {
    notify.warning(formError.value);
    return;
  }

  const requestToken = ++submitToken;
  const authRequest = isRegisterMode.value ? register : login;
  loading.value = true;
  try {
    const result = await authRequest({ username: username.value.trim(), password: password.value });
    if (!isCurrentSubmit(requestToken)) return;
    emit('authenticated', result);
  } catch (err) {
    if (!isCurrentSubmit(requestToken)) return;
    formError.value = err?.message || '认证失败，请稍后重试';
    notify.error(formError.value);
  } finally {
    if (isCurrentSubmit(requestToken)) {
      loading.value = false;
    }
  }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-panel" role="region" aria-label="账号登录与注册">
      <div class="auth-brand">
        <span class="brand-mark" aria-hidden="true">F</span>
        <div>
          <p class="auth-brand-eyebrow">{{ authEyebrow }}</p>
          <h1>{{ authTitle }}</h1>
          <p class="auth-brand-sub">本地部署 · 数据自持 · 安全可控</p>
        </div>
      </div>

      <div class="auth-mode-tabs" role="tablist" aria-label="账号操作">
        <button
          class="auth-mode-tab"
          :class="{ active: !isRegisterMode }"
          type="button"
          role="tab"
          :aria-selected="!isRegisterMode"
          :tabindex="!isRegisterMode ? 0 : -1"
          :disabled="loading"
          @click="setMode('login')"
        >
          <LogIn :size="17" aria-hidden="true" />
          <span>登录</span>
        </button>
        <button
          class="auth-mode-tab"
          :class="{ active: isRegisterMode }"
          type="button"
          role="tab"
          :aria-selected="isRegisterMode"
          :tabindex="isRegisterMode ? 0 : -1"
          :disabled="loading"
          @click="setMode('register')"
        >
          <UserPlus :size="17" aria-hidden="true" />
          <span>注册</span>
        </button>
      </div>

      <form class="form-grid auth-form" :aria-busy="loading" @submit.prevent="submit" novalidate>
        <label class="field" for="auth-username">
          <span>用户名</span>
          <input
            id="auth-username"
            v-model.trim="username"
            autocomplete="username"
            maxlength="32"
            required
            aria-required="true"
            :disabled="loading"
          />
          <small class="field-hint">最多 32 个字符</small>
        </label>

        <div class="field">
          <span id="auth-password-label">密码</span>
          <div class="auth-password-field">
            <input
              id="auth-password"
              v-model="password"
              :autocomplete="passwordAutocomplete"
              :type="passwordInputType"
              minlength="6"
              maxlength="128"
              required
              aria-required="true"
              aria-labelledby="auth-password-label"
              :disabled="loading"
            />
            <button
              class="icon-button auth-password-toggle"
              type="button"
              :title="passwordVisible ? '隐藏密码' : '显示密码'"
              :aria-label="passwordVisible ? '隐藏密码' : '显示密码'"
              :disabled="loading"
              @click="passwordVisible = !passwordVisible"
            >
              <EyeOff v-if="passwordVisible" :size="17" aria-hidden="true" />
              <Eye v-else :size="17" aria-hidden="true" />
            </button>
          </div>
          <small class="field-hint">至少 6 个字符</small>
        </div>

        <div v-if="isRegisterMode" class="field">
          <span id="auth-confirm-password-label">确认密码</span>
          <div class="auth-password-field">
            <input
              id="auth-confirm-password"
              v-model="confirmPassword"
              autocomplete="new-password"
              :type="confirmPasswordInputType"
              minlength="6"
              maxlength="128"
              required
              aria-required="true"
              aria-labelledby="auth-confirm-password-label"
              :disabled="loading"
            />
            <button
              class="icon-button auth-password-toggle"
              type="button"
              :title="confirmPasswordVisible ? '隐藏确认密码' : '显示确认密码'"
              :aria-label="confirmPasswordVisible ? '隐藏确认密码' : '显示确认密码'"
              :disabled="loading"
              @click="confirmPasswordVisible = !confirmPasswordVisible"
            >
              <EyeOff v-if="confirmPasswordVisible" :size="17" aria-hidden="true" />
              <Eye v-else :size="17" aria-hidden="true" />
            </button>
          </div>
          <small class="field-hint">再次输入密码</small>
        </div>

        <p v-if="formError" class="error-text auth-inline-error" role="alert">{{ formError }}</p>

        <button class="primary-button auth-submit" type="submit" :disabled="loading" :aria-busy="loading">
          <UserPlus v-if="isRegisterMode" :size="18" aria-hidden="true" />
          <LogIn v-else :size="18" aria-hidden="true" />
          <span>{{ submitText }}</span>
        </button>
      </form>
    </section>
  </main>
</template>
