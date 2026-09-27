<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  Check,
  ChevronDown,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldAlert,
  Trash2,
  UsersRound,
  X
} from '@lucide/vue';
import {
  deleteAdminUser,
  fetchAdminUsers,
  resetAdminDailyRequestUsage,
  updateAdminUserQuota
} from '../api/admin.js';
import { useNotify } from '../composables/useNotify';

const props = defineProps({
  user: {
    type: Object,
    default: null
  }
});

const notify = useNotify();
const users = ref([]);
const nextCursor = ref('');
const loading = ref(false);
const loadingMore = ref(false);
const loadError = ref('');
const searchDraft = ref('');
const activeSearch = ref('');
const confirmingUserId = ref('');
const resettingUserId = ref('');
const confirmingDeleteUserId = ref('');
const deletingUserId = ref('');
const editingUserId = ref('');
const savingQuotaUserId = ref('');
const quotaDraft = ref({ unlimited: false, value: '' });
const isRootAdmin = computed(() => Boolean(props.user?.isRootAdmin));
const controlsBusy = computed(() => loading.value
  || loadingMore.value
  || Boolean(resettingUserId.value)
  || Boolean(deletingUserId.value)
  || Boolean(savingQuotaUserId.value));
let requestVersion = 0;

watch(isRootAdmin, (allowed) => {
  resetAdminScope();
  if (allowed) {
    void loadUsers();
  }
}, { immediate: true });

onBeforeUnmount(resetAdminScope);

async function loadUsers(options = {}) {
  const append = Boolean(options.append);
  if (!isRootAdmin.value || loading.value || loadingMore.value) return;
  if (append && !nextCursor.value) return;

  const version = ++requestVersion;
  if (append) {
    loadingMore.value = true;
  } else {
    loading.value = true;
    confirmingUserId.value = '';
  }
  loadError.value = '';

  try {
    const result = await fetchAdminUsers({
      cursor: append ? nextCursor.value : '',
      limit: 50,
      ...(activeSearch.value ? { search: activeSearch.value } : {})
    });
    if (!isCurrentRequest(version)) return;
    const nextUsers = Array.isArray(result?.users) ? result.users : [];
    users.value = append ? appendUniqueUsers(users.value, nextUsers) : nextUsers;
    nextCursor.value = String(result?.nextCursor || '');
  } catch (error) {
    if (!isCurrentRequest(version)) return;
    loadError.value = error?.message || '用户额度加载失败';
    notify.error(loadError.value);
  } finally {
    if (isCurrentRequest(version)) {
      loading.value = false;
      loadingMore.value = false;
    }
  }
}

function submitSearch() {
  if (controlsBusy.value) return;
  const nextSearch = String(searchDraft.value || '').trim();
  if (nextSearch === activeSearch.value) return;
  activeSearch.value = nextSearch;
  void loadUsers();
}

function clearSearch() {
  if (controlsBusy.value || !activeSearch.value) return;
  searchDraft.value = '';
  activeSearch.value = '';
  void loadUsers();
}

function requestReset(user) {
  if (controlsBusy.value || dailyRequestCount(user) <= 0) return;
  confirmingUserId.value = String(user?.id || '');
}

function cancelReset() {
  if (resettingUserId.value) return;
  confirmingUserId.value = '';
}

async function confirmReset(user) {
  const userId = String(user?.id || '');
  if (!userId || controlsBusy.value || confirmingUserId.value !== userId) return;
  const version = requestVersion;
  resettingUserId.value = userId;
  try {
    const usage = await resetAdminDailyRequestUsage(userId);
    if (!isCurrentRequest(version)) return;
    replaceUserUsage(userId, usage);
    confirmingUserId.value = '';
    notify.success(`已重置 ${userLabel(user)} 的今日请求数`);
  } catch (error) {
    if (!isCurrentRequest(version)) return;
    notify.error(error?.message || '请求额度重置失败');
  } finally {
    if (isCurrentRequest(version)) {
      resettingUserId.value = '';
    }
  }
}

function startQuotaEdit(user) {
  if (controlsBusy.value) return;
  const userId = String(user?.id || '');
  if (!userId) return;
  const limit = dailyRequestLimit(user);
  confirmingUserId.value = '';
  confirmingDeleteUserId.value = '';
  editingUserId.value = userId;
  quotaDraft.value = {
    unlimited: limit === null,
    value: limit === null ? '' : String(limit)
  };
}

function cancelQuotaEdit() {
  editingUserId.value = '';
  quotaDraft.value = { unlimited: false, value: '' };
}

async function saveQuota(user) {
  const userId = String(user?.id || '');
  if (!userId || controlsBusy.value || editingUserId.value !== userId) return;
  const value = Math.floor(Number(quotaDraft.value.value));
  if (!quotaDraft.value.unlimited && (!Number.isSafeInteger(value) || value < 1 || value > 10_000_000)) {
    notify.error('最大请求数必须是 1 到 10000000 的整数');
    return;
  }
  const version = requestVersion;
  savingQuotaUserId.value = userId;
  try {
    const quota = await updateAdminUserQuota(userId, {
      maxDailyRequests: quotaDraft.value.unlimited ? null : value
    });
    if (!isCurrentRequest(version)) return;
    replaceUserQuota(userId, quota);
    cancelQuotaEdit();
    notify.success(`已更新 ${userLabel(user)} 的每日请求上限`);
  } catch (error) {
    if (isCurrentRequest(version)) notify.error(error?.message || '请求上限更新失败');
  } finally {
    if (isCurrentRequest(version)) savingQuotaUserId.value = '';
  }
}

function requestDelete(user) {
  const userId = String(user?.id || '');
  if (controlsBusy.value || !userId || userId === String(props.user?.id || '')) return;
  editingUserId.value = '';
  confirmingUserId.value = '';
  confirmingDeleteUserId.value = userId;
}

function cancelDelete() {
  if (deletingUserId.value) return;
  confirmingDeleteUserId.value = '';
}

async function confirmDelete(user) {
  const userId = String(user?.id || '');
  if (!userId || controlsBusy.value || confirmingDeleteUserId.value !== userId) return;
  const version = requestVersion;
  deletingUserId.value = userId;
  try {
    await deleteAdminUser(userId);
    if (!isCurrentRequest(version)) return;
    users.value = users.value.filter((item) => String(item?.id || '') !== userId);
    confirmingDeleteUserId.value = '';
    notify.success(`已删除用户 ${userLabel(user)}`);
  } catch (error) {
    if (isCurrentRequest(version)) notify.error(error?.message || '用户删除失败');
  } finally {
    if (isCurrentRequest(version)) deletingUserId.value = '';
  }
}

function resetAdminScope() {
  requestVersion += 1;
  users.value = [];
  nextCursor.value = '';
  loadError.value = '';
  loading.value = false;
  loadingMore.value = false;
  confirmingUserId.value = '';
  resettingUserId.value = '';
  confirmingDeleteUserId.value = '';
  deletingUserId.value = '';
  editingUserId.value = '';
  savingQuotaUserId.value = '';
  quotaDraft.value = { unlimited: false, value: '' };
  searchDraft.value = '';
  activeSearch.value = '';
}

function isCurrentRequest(version) {
  return isRootAdmin.value && version === requestVersion;
}

function appendUniqueUsers(currentUsers, incomingUsers) {
  const result = Array.isArray(currentUsers) ? currentUsers.slice() : [];
  const knownIds = new Set();
  for (const user of result) {
    knownIds.add(String(user?.id || ''));
  }
  for (const user of Array.isArray(incomingUsers) ? incomingUsers : []) {
    const userId = String(user?.id || '');
    if (userId && !knownIds.has(userId)) {
      knownIds.add(userId);
      result.push(user);
    }
  }
  return result;
}

function replaceUserUsage(userId, usage) {
  const currentUsers = users.value;
  for (let index = 0; index < currentUsers.length; index += 1) {
    if (String(currentUsers[index]?.id || '') !== userId) continue;
    const nextUsers = currentUsers.slice();
    nextUsers[index] = {
      ...currentUsers[index],
      usageToday: {
        ...(currentUsers[index]?.usageToday || {}),
        ...(usage || {})
      }
    };
    users.value = nextUsers;
    return;
  }
}

function replaceUserQuota(userId, quota) {
  users.value = users.value.map((user) => String(user?.id || '') === userId
    ? { ...user, quota: { ...(user.quota || {}), ...(quota || {}) } }
    : user);
}

function userLabel(user) {
  return String(user?.displayName || user?.accountName || user?.username || user?.id || '用户');
}

function userInitial(user) {
  return userLabel(user).slice(0, 1).toUpperCase();
}

function dailyRequestCount(user) {
  return Math.max(0, Number(user?.usageToday?.requestCount || 0));
}

function dailyRequestLimit(user) {
  const raw = user?.quota?.maxDailyRequests;
  if (raw === null || Number(raw) === 0) return null;
  const limit = Number(raw);
  return Number.isSafeInteger(limit) && limit > 0 ? limit : 1;
}

function dailyRequestsRemaining(user) {
  const limit = dailyRequestLimit(user);
  return limit === null ? null : Math.max(0, limit - dailyRequestCount(user));
}

function isUnlimited(user) {
  return dailyRequestLimit(user) === null;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}
</script>

<template>
  <section class="page-stack admin-page">
    <div class="section-heading admin-heading">
      <div>
        <p>系统管理</p>
        <h1>请求额度</h1>
      </div>
      <button
        v-if="isRootAdmin"
        class="icon-button"
        type="button"
        title="刷新用户额度"
        aria-label="刷新用户额度"
        :disabled="controlsBusy"
        :aria-busy="loading"
        @click="loadUsers()"
      >
        <RefreshCw :size="19" aria-hidden="true" />
      </button>
    </div>

    <section v-if="!isRootAdmin" class="admin-access-state" role="alert">
      <ShieldAlert :size="28" aria-hidden="true" />
      <div>
        <h2>需要根管理员权限</h2>
        <p>当前账户不能访问系统额度。</p>
      </div>
    </section>

    <template v-else>
      <p v-if="loadError" class="error-text" role="alert">{{ loadError }}</p>

      <div v-if="loading && !users.length" class="loading-state" role="status" aria-live="polite">
        <LoaderCircle class="spin-icon" :size="28" aria-hidden="true" />
        <span>正在加载用户额度...</span>
      </div>

      <section v-else class="quota-tool" aria-labelledby="quota-tool-title">
        <header class="quota-tool-header">
          <div class="quota-tool-header-main">
            <h2 id="quota-tool-title">用户额度</h2>
            <p>{{ activeSearch ? `搜索“${activeSearch}” · ` : '' }}{{ users.length }} 个已加载用户</p>
          </div>
          <form class="quota-search-form" role="search" @submit.prevent="submitSearch">
            <label class="quota-search-field">
              <Search :size="17" aria-hidden="true" />
              <span class="visually-hidden">搜索用户</span>
              <input v-model="searchDraft" type="search" maxlength="200" placeholder="用户名、显示名或 ID" :disabled="controlsBusy" />
            </label>
            <button class="ghost-button" type="submit" :disabled="controlsBusy || !searchDraft.trim()" aria-label="搜索用户">
              <Search :size="17" aria-hidden="true" />
              <span>搜索</span>
            </button>
            <button
              v-if="activeSearch"
              class="icon-button"
              type="button"
              title="清除搜索"
              aria-label="清除搜索"
              :disabled="controlsBusy"
              @click="clearSearch"
            >
              <X :size="18" aria-hidden="true" />
            </button>
          </form>
          <UsersRound class="quota-tool-icon" :size="21" aria-hidden="true" />
        </header>

        <div v-if="users.length" class="quota-table-wrap">
          <table class="quota-table">
            <thead>
              <tr>
                <th scope="col">用户</th>
                <th scope="col">权限</th>
                <th scope="col">今日请求</th>
                <th scope="col"><span class="visually-hidden">操作</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="managedUser in users" :key="managedUser.id">
                <td class="quota-user-cell" data-label="用户">
                  <span class="quota-avatar" aria-hidden="true">
                    <img v-if="managedUser.avatarUrl" :src="managedUser.avatarUrl" alt="" />
                    <span v-else>{{ userInitial(managedUser) }}</span>
                  </span>
                  <span class="quota-user-copy">
                    <strong>{{ userLabel(managedUser) }}</strong>
                    <small>@{{ managedUser.accountName || managedUser.username }}</small>
                  </span>
                </td>
                <td data-label="权限">
                  <span class="permission-chip" :class="{ strong: managedUser.isRootAdmin }">
                    {{ managedUser.permissionLabel || '用户组' }}
                  </span>
                </td>
                <td class="quota-usage-cell" data-label="今日请求">
                  <span class="quota-usage-numbers">
                    <strong>{{ formatNumber(dailyRequestCount(managedUser)) }}</strong>
                    <span>/ {{ isUnlimited(managedUser) ? '无限' : formatNumber(dailyRequestLimit(managedUser)) }}</span>
                  </span>
                  <progress
                    v-if="!isUnlimited(managedUser)"
                    :value="Math.min(dailyRequestCount(managedUser), dailyRequestLimit(managedUser))"
                    :max="dailyRequestLimit(managedUser)"
                    :aria-label="`${userLabel(managedUser)} 今日请求额度使用情况`"
                  ></progress>
                  <small v-if="!isUnlimited(managedUser)">剩余 {{ formatNumber(dailyRequestsRemaining(managedUser)) }}</small>
                  <small v-else>不受每日请求数限制</small>
                </td>
                <td class="quota-action-cell" data-label="操作">
                  <form v-if="editingUserId === managedUser.id" class="quota-editor" @submit.prevent="saveQuota(managedUser)">
                    <label class="quota-editor-field">
                      <span>每日最大请求数</span>
                      <input v-model="quotaDraft.value" type="number" min="1" max="10000000" step="1" :disabled="controlsBusy || quotaDraft.unlimited" />
                    </label>
                    <label class="quota-unlimited-toggle">
                      <input v-model="quotaDraft.unlimited" type="checkbox" :disabled="controlsBusy" />
                      <span>无限</span>
                    </label>
                    <div class="quota-inline-actions">
                      <button class="primary-button" type="submit" :disabled="controlsBusy" :aria-busy="savingQuotaUserId === managedUser.id">
                        <LoaderCircle v-if="savingQuotaUserId === managedUser.id" class="spin-icon" :size="17" aria-hidden="true" />
                        <Check v-else :size="17" aria-hidden="true" />
                        <span>{{ savingQuotaUserId === managedUser.id ? '保存中...' : '保存' }}</span>
                      </button>
                      <button class="icon-button" type="button" title="取消修改" aria-label="取消修改请求上限" :disabled="controlsBusy" @click="cancelQuotaEdit">
                        <X :size="18" aria-hidden="true" />
                      </button>
                    </div>
                  </form>
                  <div v-else-if="confirmingDeleteUserId === managedUser.id" class="quota-confirm-actions">
                    <button class="danger-button" type="button" :disabled="controlsBusy" :aria-busy="deletingUserId === managedUser.id" @click="confirmDelete(managedUser)">
                      <LoaderCircle v-if="deletingUserId === managedUser.id" class="spin-icon" :size="17" aria-hidden="true" />
                      <Trash2 v-else :size="17" aria-hidden="true" />
                      <span>{{ deletingUserId === managedUser.id ? '删除中...' : '确认删除' }}</span>
                    </button>
                    <button class="icon-button" type="button" title="取消删除" :aria-label="`取消删除 ${userLabel(managedUser)}`" :disabled="controlsBusy" @click="cancelDelete">
                      <X :size="18" aria-hidden="true" />
                    </button>
                  </div>
                  <div v-else-if="confirmingUserId === managedUser.id" class="quota-confirm-actions">
                    <button
                      class="danger-button"
                      type="button"
                      :disabled="controlsBusy"
                      :aria-busy="resettingUserId === managedUser.id"
                      @click="confirmReset(managedUser)"
                    >
                      <LoaderCircle v-if="resettingUserId === managedUser.id" class="spin-icon" :size="17" aria-hidden="true" />
                      <Check v-else :size="17" aria-hidden="true" />
                      <span>{{ resettingUserId === managedUser.id ? '重置中...' : '确认重置' }}</span>
                    </button>
                    <button
                      class="icon-button"
                      type="button"
                      title="取消重置"
                      :aria-label="`取消重置 ${userLabel(managedUser)} 的请求额度`"
                      :disabled="controlsBusy"
                      @click="cancelReset"
                    >
                      <X :size="18" aria-hidden="true" />
                    </button>
                  </div>
                  <div v-else class="quota-action-stack">
                    <button class="ghost-button" type="button" :disabled="controlsBusy" :aria-label="`修改 ${userLabel(managedUser)} 的每日请求上限`" @click="startQuotaEdit(managedUser)">
                      <Settings2 :size="17" aria-hidden="true" />
                      <span>上限</span>
                    </button>
                    <button class="ghost-button" type="button" :disabled="controlsBusy || dailyRequestCount(managedUser) === 0" :aria-label="`重置 ${userLabel(managedUser)} 的今日请求数`" @click="requestReset(managedUser)">
                      <RotateCcw :size="17" aria-hidden="true" />
                      <span>重置</span>
                    </button>
                    <button v-if="String(managedUser.id) !== String(props.user?.id || '')" class="danger-icon-button" type="button" title="删除用户" :aria-label="`删除用户 ${userLabel(managedUser)}`" :disabled="controlsBusy" @click="requestDelete(managedUser)">
                      <Trash2 :size="17" aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-else class="quota-empty-state">
          <UsersRound :size="25" aria-hidden="true" />
          <p>{{ loadError ? '暂时无法读取用户额度。' : '暂无用户。' }}</p>
          <button v-if="loadError" class="ghost-button" type="button" :disabled="controlsBusy" @click="loadUsers()">
            <RefreshCw :size="17" aria-hidden="true" />
            <span>重试</span>
          </button>
        </div>

        <footer v-if="nextCursor" class="quota-tool-footer">
          <button class="ghost-button" type="button" :disabled="controlsBusy" :aria-busy="loadingMore" @click="loadUsers({ append: true })">
            <LoaderCircle v-if="loadingMore" class="spin-icon" :size="17" aria-hidden="true" />
            <ChevronDown v-else :size="17" aria-hidden="true" />
            <span>{{ loadingMore ? '加载中...' : '加载更多' }}</span>
          </button>
        </footer>
      </section>
    </template>
  </section>
</template>

<style scoped>
.admin-page {
  width: min(1120px, 100%);
  margin: 0 auto;
  padding-bottom: 24px;
}

.admin-heading {
  align-items: center;
  flex-direction: row;
}

.admin-heading .icon-button {
  flex: 0 0 auto;
  border: 1px solid var(--line);
  background: var(--surface);
}

.admin-access-state {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 112px;
  padding: 20px;
  border: 1px solid color-mix(in srgb, var(--danger) 34%, var(--line));
  border-radius: 8px;
  color: var(--danger);
  background: var(--danger-soft);
}

.admin-access-state h2,
.admin-access-state p,
.quota-tool-header h2,
.quota-tool-header p,
.quota-empty-state p {
  margin: 0;
}

.admin-access-state p,
.quota-tool-header p {
  margin-top: 4px;
  color: var(--muted);
  font-size: 0.84rem;
}

.quota-tool {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
}

.quota-tool-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--line);
}

.quota-tool-header-main {
  min-width: 180px;
  flex: 1 1 180px;
}

.quota-tool-header h2 {
  font-size: 1rem;
}

.quota-tool-icon {
  flex: 0 0 auto;
  color: var(--green);
}

.quota-search-form {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: min(100%, 420px);
  flex: 1 1 360px;
}

.quota-search-field {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 44px;
  flex: 1 1 220px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--muted);
  background: var(--surface-strong);
}

.quota-search-field:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 16%, transparent);
}

.quota-search-field input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  color: var(--text);
  background: transparent;
}

.quota-table-wrap {
  min-width: 0;
}

.quota-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.quota-table th,
.quota-table td {
  min-width: 0;
  padding: 13px 16px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: middle;
}

.quota-table th {
  color: var(--muted);
  background: color-mix(in srgb, var(--surface-strong) 64%, transparent);
  font-size: 0.75rem;
  font-weight: 800;
}

.quota-table th:first-child {
  width: 31%;
}

.quota-table th:nth-child(2) {
  width: 17%;
}

.quota-table th:nth-child(3) {
  width: 32%;
}

.quota-table th:last-child {
  width: 20%;
}

.quota-table tbody tr:last-child td {
  border-bottom: 0;
}

.quota-user-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.quota-avatar {
  display: grid;
  place-items: center;
  flex: 0 0 38px;
  width: 38px;
  height: 38px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--primary-strong);
  background: var(--primary-soft);
  font-weight: 900;
}

.quota-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.quota-user-copy {
  min-width: 0;
}

.quota-user-copy strong,
.quota-user-copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quota-user-copy small,
.quota-usage-cell small {
  margin-top: 3px;
  color: var(--muted);
  font-size: 0.76rem;
}

.quota-usage-cell {
  display: grid;
  gap: 5px;
}

.quota-usage-numbers {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.quota-usage-numbers strong {
  font-size: 1rem;
}

.quota-usage-numbers span {
  color: var(--muted);
  font-size: 0.8rem;
}

.quota-usage-cell progress {
  width: 100%;
  height: 6px;
  overflow: hidden;
  border: 0;
  border-radius: 999px;
  background: var(--surface-strong);
}

.quota-usage-cell progress::-webkit-progress-bar {
  border-radius: 999px;
  background: var(--surface-strong);
}

.quota-usage-cell progress::-webkit-progress-value {
  border-radius: 999px;
  background: var(--green);
}

.quota-usage-cell progress::-moz-progress-bar {
  border-radius: 999px;
  background: var(--green);
}

.quota-action-cell {
  min-width: 0;
  text-align: right;
}

.quota-action-stack {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 7px;
}

.quota-action-cell > button,
.quota-confirm-actions {
  margin-left: auto;
}

.quota-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.quota-confirm-actions .danger-button,
.quota-action-cell > .ghost-button,
.quota-action-stack .ghost-button {
  min-height: 44px;
  padding-inline: 12px;
}

.quota-editor {
  display: grid;
  gap: 8px;
  width: 100%;
  max-width: 280px;
  min-width: 0;
  margin-left: auto;
}

.quota-editor-field {
  display: grid;
  gap: 4px;
  color: var(--muted);
  font-size: 0.74rem;
  font-weight: 800;
  text-align: left;
}

.quota-editor-field input {
  width: 100%;
  min-height: 40px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 7px;
  color: var(--text);
  background: var(--surface-strong);
}

.quota-unlimited-toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 30px;
  width: fit-content;
  color: var(--text);
  font-size: 0.82rem;
  text-align: left;
}

.quota-unlimited-toggle input {
  flex: 0 0 17px;
  width: 17px;
  height: 17px;
  margin: 0;
}

.quota-inline-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.quota-inline-actions .primary-button {
  min-height: 40px;
  padding-inline: 11px;
}

.danger-icon-button {
  display: inline-grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 1px solid color-mix(in srgb, var(--danger) 42%, var(--line));
  border-radius: 8px;
  color: var(--danger);
  background: transparent;
  cursor: pointer;
}

.danger-icon-button:hover:not(:disabled) {
  background: var(--danger-soft);
}

.danger-icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.quota-tool-footer {
  display: flex;
  justify-content: center;
  padding: 14px 16px;
  border-top: 1px solid var(--line);
}

.quota-empty-state {
  display: grid;
  place-items: center;
  gap: 10px;
  min-height: 180px;
  padding: 24px;
  color: var(--muted);
  text-align: center;
}

.spin-icon {
  animation: admin-spin 0.8s linear infinite;
}

@keyframes admin-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spin-icon {
    animation: none;
  }
}

@media (max-width: 860px) {
  .quota-table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    clip-path: inset(50%);
  }

  .quota-table,
  .quota-table tbody,
  .quota-table tr,
  .quota-table td {
    display: block;
    width: 100%;
  }

  .quota-table tr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px 18px;
    padding: 16px;
    border-bottom: 1px solid var(--line);
  }

  .quota-table tbody tr:last-child {
    border-bottom: 0;
  }

  .quota-table td {
    padding: 0;
    border: 0;
  }

  .quota-table td::before {
    display: block;
    margin-bottom: 5px;
    color: var(--muted);
    content: attr(data-label);
    font-size: 0.72rem;
    font-weight: 800;
  }

  .quota-user-cell {
    grid-column: 1;
  }

  .quota-table td[data-label="权限"] {
    grid-column: 2;
    align-self: end;
  }

  .quota-user-cell::before {
    content: none !important;
  }

  .quota-usage-cell {
    grid-column: 1 / -1;
  }

  .quota-action-cell {
    grid-column: 1 / -1;
    padding-top: 4px !important;
    text-align: left;
  }

  .quota-action-cell > button,
  .quota-confirm-actions,
  .quota-action-stack,
  .quota-editor {
    width: 100%;
    margin-left: 0;
  }

  .quota-action-stack {
    justify-content: stretch;
  }

  .quota-action-stack > button {
    flex: 1 1 0;
  }

  .quota-editor {
    max-width: none;
    margin-left: 0;
  }

  .quota-editor-field input {
    min-height: 44px;
  }

  .quota-inline-actions {
    justify-content: flex-start;
  }

  .quota-search-form {
    min-width: 100%;
    justify-content: stretch;
  }

  .quota-search-form .ghost-button {
    flex: 0 0 auto;
  }

  .quota-tool-icon {
    display: none;
  }

  .quota-confirm-actions .danger-button {
    flex: 1 1 auto;
  }
}
</style>
