<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  ChevronLeft,
  ChevronRight,
  Coins,
  History,
  RefreshCw,
  X
} from '@lucide/vue';
import { fetchConversationEconomy, fetchEconomyHistory } from '../api';
import { useNotify } from '../composables/useNotify';

const props = defineProps({
  conversationId: { type: String, required: true },
  open: { type: Boolean, default: false }
});
const emit = defineEmits(['close']);

const notify = useNotify();
const loading = ref(false);
const loadError = ref('');
const accounts = ref([]);
const transactions = ref([]);
const historyTotal = ref(0);
const historyOffset = ref(0);
const historyLimit = 20;
const historyCurrencyFilter = ref('');
const historyLoading = ref(false);
const historyError = ref('');
const detailTab = ref('balance');
let economyLoadToken = 0;
let historyLoadToken = 0;
let economyPanelDisposed = false;

const currencyMeta = {
  gold:   { icon: '💰', label: '金币', color: '#d4a017' },
  silver: { icon: '🪙', label: '银币', color: '#9ca3af' },
  copper: { icon: '🥉', label: '铜币', color: '#b87333' },
  gem:    { icon: '💎', label: '宝石', color: '#6366f1' },
  credit: { icon: '⭐', label: '积分', color: '#f59e0b' }
};

const transactionTypeLabels = {
  income:   { label: '收入', color: '#22c55e', sign: '+' },
  expense:  { label: '支出', color: '#ef4444', sign: '-' },
  transfer: { label: '转账', color: '#6366f1', sign: '' },
  reward:   { label: '奖励', color: '#f59e0b', sign: '+' },
  penalty:  { label: '惩罚', color: '#ef4444', sign: '-' },
  trade:    { label: '交易', color: '#8b5cf6', sign: '' }
};

const currencyFilterOptions = computed(() => {
  const options = [{ value: '', label: '全部货币' }];
  const sourceAccounts = Array.isArray(accounts.value) ? accounts.value : [];
  for (const account of sourceAccounts) {
    const currencyType = account?.currencyType || '';
    const meta = currencyMeta[currencyType];
    options.push({
      value: currencyType,
      label: `${meta?.icon || '🪙'} ${meta?.label || currencyType}`
    });
  }
  return options;
});

const totalPages = computed(() => Math.max(1, Math.ceil(historyTotal.value / historyLimit)));
const currentPage = computed(() => Math.floor(historyOffset.value / historyLimit) + 1);
const hasPrevPage = computed(() => historyOffset.value > 0);
const hasNextPage = computed(() => historyOffset.value + historyLimit < historyTotal.value);
const historyActionDisabled = computed(() => loading.value || historyLoading.value);

watch(() => props.open, async (isOpen) => {
  if (isOpen) await loadEconomy();
});

watch(() => props.conversationId, () => {
  resetEconomyState();
  if (props.open) {
    loadEconomy();
  }
});

onBeforeUnmount(() => {
  economyPanelDisposed = true;
  resetEconomyState();
});

function resetEconomyState() {
  economyLoadToken += 1;
  historyLoadToken += 1;
  setAccountsIfChanged([]);
  setTransactionsIfChanged([]);
  historyTotal.value = 0;
  historyOffset.value = 0;
  historyCurrencyFilter.value = '';
  loadError.value = '';
  historyError.value = '';
  loading.value = false;
  historyLoading.value = false;
}

async function loadEconomy() {
  if (economyPanelDisposed) return;
  const conversationId = props.conversationId;
  if (!conversationId) {
    resetEconomyState();
    return;
  }
  const requestToken = ++economyLoadToken;
  loading.value = true;
  loadError.value = '';
  historyError.value = '';
  try {
    const result = await fetchConversationEconomy(conversationId);
    if (economyPanelDisposed || requestToken !== economyLoadToken || conversationId !== props.conversationId) return;
    loadError.value = '';
    setAccountsIfChanged(result.accounts);
    await loadHistory(0, conversationId);
  } catch (err) {
    if (economyPanelDisposed || requestToken !== economyLoadToken || conversationId !== props.conversationId) return;
    loadError.value = err.message || '加载经济数据失败';
    notify.error(loadError.value);
    setAccountsIfChanged([]);
    setTransactionsIfChanged([]);
    historyTotal.value = 0;
    historyOffset.value = 0;
    historyError.value = '';
  } finally {
    if (!economyPanelDisposed && requestToken === economyLoadToken && conversationId === props.conversationId) {
      loading.value = false;
    }
  }
}

async function loadHistory(offset = 0, expectedConversationId = '') {
  if (economyPanelDisposed) return;
  const conversationId = expectedConversationId || props.conversationId;
  if (!conversationId) return;
  const requestToken = ++historyLoadToken;
  historyLoading.value = true;
  historyError.value = '';
  try {
    const params = {
      limit: historyLimit,
      offset
    };
    if (historyCurrencyFilter.value) {
      params.currencyType = historyCurrencyFilter.value;
    }
    const result = await fetchEconomyHistory(conversationId, params);
    if (economyPanelDisposed || requestToken !== historyLoadToken || conversationId !== props.conversationId) return;
    historyError.value = '';
    setTransactionsIfChanged(result.transactions);
    historyTotal.value = result.total || 0;
    historyOffset.value = offset;
  } catch (err) {
    if (economyPanelDisposed || requestToken !== historyLoadToken || conversationId !== props.conversationId) return;
    historyError.value = err.message || '加载交易历史失败';
    notify.error(historyError.value);
    setTransactionsIfChanged([]);
    historyTotal.value = 0;
    historyOffset.value = offset;
  } finally {
    if (!economyPanelDisposed && requestToken === historyLoadToken && conversationId === props.conversationId) {
      historyLoading.value = false;
    }
  }
}

function setAccountsIfChanged(nextAccounts) {
  const normalizedAccounts = Array.isArray(nextAccounts) ? nextAccounts : [];
  const currentAccounts = Array.isArray(accounts.value) ? accounts.value : [];
  pruneUnavailableHistoryCurrencyFilter(normalizedAccounts);
  if (sameListItems(currentAccounts, normalizedAccounts, sameAccountSummary)) {
    return false;
  }
  accounts.value = normalizedAccounts;
  return true;
}

function setTransactionsIfChanged(nextTransactions) {
  const normalizedTransactions = Array.isArray(nextTransactions) ? nextTransactions : [];
  const currentTransactions = Array.isArray(transactions.value) ? transactions.value : [];
  if (sameListItems(currentTransactions, normalizedTransactions, sameTransactionSummary)) {
    return false;
  }
  transactions.value = normalizedTransactions;
  return true;
}

function sameListItems(currentItems, nextItems, sameItem) {
  if (currentItems === nextItems) {
    return true;
  }
  if (currentItems.length !== nextItems.length) {
    return false;
  }
  for (let index = 0; index < currentItems.length; index += 1) {
    if (!sameItem(currentItems[index], nextItems[index])) {
      return false;
    }
  }
  return true;
}

function pruneUnavailableHistoryCurrencyFilter(sourceAccounts) {
  const selectedCurrency = historyCurrencyFilter.value;
  if (!selectedCurrency) {
    return false;
  }
  for (const account of sourceAccounts) {
    if (account?.currencyType === selectedCurrency) {
      return false;
    }
  }
  historyCurrencyFilter.value = '';
  return true;
}

function sameAccountSummary(current = {}, next = {}) {
  return current?.id === next?.id
    && current?.conversationId === next?.conversationId
    && current?.currencyType === next?.currencyType
    && current?.balance === next?.balance;
}

function sameTransactionSummary(current = {}, next = {}) {
  return current?.id === next?.id
    && current?.currencyType === next?.currencyType
    && current?.type === next?.type
    && current?.amount === next?.amount
    && current?.description === next?.description
    && current?.createdAt === next?.createdAt;
}

function handleCurrencyFilterChange() {
  if (historyActionDisabled.value) return;
  loadHistory(0);
}

function retryEconomyLoad() {
  if (loading.value) return;
  loadEconomy();
}

function retryHistoryLoad() {
  if (historyActionDisabled.value) return;
  loadHistory(historyOffset.value);
}

function goToPrevPage() {
  if (hasPrevPage.value && !historyActionDisabled.value) {
    loadHistory(historyOffset.value - historyLimit);
  }
}

function goToNextPage() {
  if (hasNextPage.value && !historyActionDisabled.value) {
    loadHistory(historyOffset.value + historyLimit);
  }
}

function formatBalance(value) {
  const num = Number(value || 0);
  if (Number.isInteger(num)) return num.toLocaleString('zh-CN');
  return num.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  if (diffHour < 24) return `${diffHour}小时前`;
  if (diffDay < 7) return `${diffDay}天前`;

  return date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getCurrencyMeta(type) {
  return currencyMeta[type] || { icon: '🪙', label: type, color: '#9ca3af' };
}

function getTransactionMeta(type) {
  return transactionTypeLabels[type] || { label: type, color: '#6b7280', sign: '' };
}

function formatTransactionAmount(tx) {
  const meta = getTransactionMeta(tx.type);
  const absAmount = Math.abs(tx.amount);
  return `${meta.sign}${formatBalance(absAmount)}`;
}

function getTransactionAmountClass(tx) {
  const meta = getTransactionMeta(tx.type);
  if (meta.sign === '+') return 'positive';
  if (meta.sign === '-') return 'negative';
  return '';
}
</script>

<template>
  <Transition name="economy-panel">
    <div v-if="open" class="economy-panel-overlay" @click.self="emit('close')">
      <aside class="economy-panel" aria-label="经济系统">
        <header class="economy-panel-header">
          <div class="economy-panel-title">
            <Coins :size="20" />
            <h2>经济系统</h2>
          </div>
          <button class="economy-close-btn" type="button" aria-label="关闭经济系统" title="关闭" @click="emit('close')">
            <X :size="18" />
          </button>
        </header>

        <div class="economy-tabs">
          <button
            class="economy-tab"
            :class="{ active: detailTab === 'balance' }"
            type="button"
            @click="detailTab = 'balance'"
          >
            <Coins :size="15" />
            <span>余额</span>
          </button>
          <button
            class="economy-tab"
            :class="{ active: detailTab === 'history' }"
            type="button"
            @click="detailTab = 'history'"
          >
            <History :size="15" />
            <span>交易记录</span>
          </button>
        </div>

        <div class="economy-panel-body">
          <!-- Loading -->
          <div v-if="loading" class="economy-loading">
            <div class="economy-loading-spinner"></div>
            <span>加载中...</span>
          </div>

          <div v-else-if="loadError" class="economy-empty economy-error-state">
            <Coins :size="36" />
            <p>{{ loadError }}</p>
            <button
              class="economy-retry-button"
              type="button"
              :disabled="loading"
              :aria-busy="loading"
              @click="retryEconomyLoad"
            >
              <RefreshCw :size="14" />
              <span>重试</span>
            </button>
          </div>

          <!-- Balance Tab -->
          <template v-else-if="detailTab === 'balance'">
            <div v-if="accounts.length === 0" class="economy-empty">
              <Coins :size="36" />
              <p>暂无经济数据</p>
              <small>开始对话后，AI 会自动为你创建经济账户</small>
            </div>
            <div v-else class="economy-balance-grid">
              <div
                v-for="account in accounts"
                :key="account.id"
                class="economy-balance-card"
                :style="{ '--currency-color': getCurrencyMeta(account.currencyType).color }"
              >
                <div class="balance-card-icon">
                  {{ getCurrencyMeta(account.currencyType).icon }}
                </div>
                <div class="balance-card-info">
                  <span class="balance-card-label">
                    {{ getCurrencyMeta(account.currencyType).label }}
                  </span>
                  <strong class="balance-card-amount">
                    {{ formatBalance(account.balance) }}
                  </strong>
                </div>
              </div>
            </div>
          </template>

          <!-- History Tab -->
          <template v-else-if="detailTab === 'history'">
            <div class="history-filter">
              <select
                v-model="historyCurrencyFilter"
                class="history-currency-select"
                aria-label="筛选交易货币"
                :disabled="historyActionDisabled"
                :aria-busy="historyLoading"
                @change="handleCurrencyFilterChange"
              >
                <option
                  v-for="opt in currencyFilterOptions"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </option>
              </select>
            </div>

            <div v-if="historyLoading" class="economy-loading">
              <div class="economy-loading-spinner"></div>
              <span>加载中...</span>
            </div>

            <div v-else-if="historyError" class="economy-empty economy-error-state">
              <History :size="36" />
              <p>{{ historyError }}</p>
              <button
                class="economy-retry-button"
                type="button"
                :disabled="historyActionDisabled"
                :aria-busy="historyLoading"
                @click="retryHistoryLoad"
              >
                <RefreshCw :size="14" />
                <span>重试</span>
              </button>
            </div>

            <div v-else-if="transactions.length === 0" class="economy-empty">
              <History :size="36" />
              <p>暂无交易记录</p>
              <small>与 AI 互动时产生的交易将显示在这里</small>
            </div>

            <div v-else class="history-list">
              <div
                v-for="tx in transactions"
                :key="tx.id"
                class="history-item"
              >
                <div class="history-item-icon">
                  {{ getCurrencyMeta(tx.currencyType).icon }}
                </div>
                <div class="history-item-info">
                  <div class="history-item-top">
                    <span
                      class="history-item-type"
                      :style="{ color: getTransactionMeta(tx.type).color }"
                    >
                      {{ getTransactionMeta(tx.type).label }}
                    </span>
                    <span class="history-item-currency">
                      {{ getCurrencyMeta(tx.currencyType).label }}
                    </span>
                  </div>
                  <p v-if="tx.description" class="history-item-desc">
                    {{ tx.description }}
                  </p>
                  <span class="history-item-time">{{ formatTime(tx.createdAt) }}</span>
                </div>
                <span
                  class="history-item-amount"
                  :class="getTransactionAmountClass(tx)"
                >
                  {{ formatTransactionAmount(tx) }}
                </span>
              </div>
            </div>

            <!-- Pagination -->
            <div v-if="transactions.length > 0" class="history-pagination">
              <button
                class="pagination-btn"
                type="button"
                aria-label="上一页交易记录"
                :disabled="!hasPrevPage || historyActionDisabled"
                :aria-busy="historyLoading"
                @click="goToPrevPage"
              >
                <ChevronLeft :size="16" />
              </button>
              <span class="pagination-info">
                {{ currentPage }} / {{ totalPages }}
              </span>
              <button
                class="pagination-btn"
                type="button"
                aria-label="下一页交易记录"
                :disabled="!hasNextPage || historyActionDisabled"
                :aria-busy="historyLoading"
                @click="goToNextPage"
              >
                <ChevronRight :size="16" />
              </button>
            </div>
          </template>
        </div>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
.economy-panel-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(4px);
  display: flex;
  justify-content: flex-end;
}

.economy-panel {
  width: min(400px, 92vw);
  height: 100vh;
  height: 100dvh;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  background: var(--surface);
  border-left: 1px solid var(--line);
  box-shadow: -12px 0 40px rgba(0, 0, 0, 0.12);
  overflow: hidden;
}

.economy-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--line);
}

.economy-panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--primary);
}

.economy-panel-title h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 800;
}

.economy-close-btn {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  color: var(--muted);
  background: transparent;
  cursor: pointer;
}

.economy-close-btn:hover {
  background: var(--primary-soft);
  color: var(--primary);
}

.economy-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface-strong) 40%, transparent);
}

.economy-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  color: var(--muted);
  background: transparent;
  font-size: 0.84rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
}

.economy-tab:hover {
  background: var(--primary-soft);
  color: var(--text);
}

.economy-tab.active {
  color: var(--primary);
  background: var(--primary-soft);
  font-weight: 800;
}

.economy-panel-body {
  overflow: auto;
  padding: 16px;
}

/* Loading */
.economy-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 16px;
  color: var(--muted);
}

.economy-loading-spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--line);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Empty state */
.economy-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 42px 16px;
  text-align: center;
  color: var(--muted);
}

.economy-empty p {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 700;
}

.economy-empty small {
  font-size: 0.78rem;
  line-height: 1.5;
}

.economy-error-state {
  color: #ef4444;
}

.economy-error-state p {
  color: var(--text);
}

.economy-retry-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--primary) 28%, var(--line));
  border-radius: 8px;
  color: var(--primary);
  background: var(--primary-soft);
  font-size: 0.78rem;
  font-weight: 800;
  cursor: pointer;
}

.economy-retry-button:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--primary) 46%, var(--line));
  background: color-mix(in srgb, var(--primary) 13%, var(--surface));
}

.economy-retry-button:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}

/* Balance grid */
.economy-balance-grid {
  display: grid;
  gap: 10px;
}

.economy-balance-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.economy-balance-card:hover {
  border-color: color-mix(in srgb, var(--currency-color) 40%, var(--line));
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
}

.balance-card-icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  font-size: 1.5rem;
  background: color-mix(in srgb, var(--currency-color) 12%, transparent);
  flex-shrink: 0;
}

.balance-card-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.balance-card-label {
  font-size: 0.78rem;
  color: var(--muted);
  font-weight: 600;
}

.balance-card-amount {
  font-size: 1.35rem;
  font-weight: 900;
  color: var(--text);
  line-height: 1.2;
}

/* History filter */
.history-filter {
  margin-bottom: 12px;
}

.history-currency-select {
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  outline: none;
}

.history-currency-select:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 14%, transparent);
}

.history-currency-select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* History list */
.history-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.history-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface) 86%, transparent);
  transition: background 0.12s ease;
}

.history-item:hover {
  background: color-mix(in srgb, var(--surface-strong) 50%, transparent);
}

.history-item-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  font-size: 1.1rem;
  background: color-mix(in srgb, var(--surface-strong) 60%, transparent);
  flex-shrink: 0;
}

.history-item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.history-item-top {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.history-item-type {
  font-size: 0.78rem;
  font-weight: 800;
}

.history-item-currency {
  font-size: 0.72rem;
  color: var(--muted);
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--surface-strong) 60%, transparent);
}

.history-item-desc {
  margin: 2px 0 0;
  font-size: 0.78rem;
  color: var(--muted);
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.history-item-time {
  font-size: 0.7rem;
  color: color-mix(in srgb, var(--muted) 70%, transparent);
  font-weight: 500;
}

.history-item-amount {
  font-size: 0.92rem;
  font-weight: 800;
  color: var(--text);
  white-space: nowrap;
  flex-shrink: 0;
  padding-top: 2px;
}

.history-item-amount.positive {
  color: #22c55e;
}

.history-item-amount.negative {
  color: #ef4444;
}

/* Pagination */
.history-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 14px 0 4px;
  border-top: 1px solid var(--line);
  margin-top: 12px;
}

.pagination-btn {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--text);
  background: var(--surface);
  cursor: pointer;
  transition: all 0.12s ease;
}

.pagination-btn:hover:not(:disabled) {
  background: var(--primary-soft);
  border-color: color-mix(in srgb, var(--primary) 30%, var(--line));
  color: var(--primary);
}

.pagination-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.pagination-info {
  font-size: 0.78rem;
  color: var(--muted);
  font-weight: 700;
  min-width: 48px;
  text-align: center;
}

/* Transition */
.economy-panel-enter-active,
.economy-panel-leave-active {
  transition: opacity 0.2s ease;
}

.economy-panel-enter-active .economy-panel,
.economy-panel-leave-active .economy-panel {
  transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}

.economy-panel-enter-from,
.economy-panel-leave-to {
  opacity: 0;
}

.economy-panel-enter-from .economy-panel {
  transform: translateX(100%);
}

.economy-panel-leave-to .economy-panel {
  transform: translateX(100%);
}

/* Mobile */
@media (max-width: 520px) {
  .economy-panel {
    width: 100vw;
    max-width: none;
  }

  .economy-balance-card {
    padding: 12px;
  }

  .balance-card-icon {
    width: 38px;
    height: 38px;
    font-size: 1.25rem;
  }

  .balance-card-amount {
    font-size: 1.15rem;
  }

  .history-item {
    padding: 8px 10px;
  }
}
</style>
