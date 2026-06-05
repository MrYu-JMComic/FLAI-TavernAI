<script setup>
import { ref, computed, onMounted } from 'vue';
import {
  getAllExtensions,
  enableExtension,
  disableExtension,
  unregisterExtension,
} from '../services/extensions.js';
import { HOOK_TYPES } from '../services/extensionHooks.js';

const emit = defineEmits(['close']);

const extensions = ref([]);
const refreshing = ref(false);

const hookTypeList = computed(() =>
  Object.entries(HOOK_TYPES).map(([key, value]) => ({ key, value }))
);

const hasExtensions = computed(() => extensions.value.length > 0);

function refreshList() {
  refreshing.value = true;
  extensions.value = getAllExtensions().map((entry) => ({
    name: entry.manifest.name,
    version: entry.manifest.version || '0.0.0',
    description: entry.manifest.description || '',
    hooks: entry.manifest.hooks || [],
    enabled: entry.enabled,
    loaded: entry.loaded,
  }));
  refreshing.value = false;
}

function toggleExtension(name, currentlyEnabled) {
  if (currentlyEnabled) {
    disableExtension(name);
  } else {
    enableExtension(name);
  }
  refreshList();
}

function uninstallExtension(name) {
  if (!window.confirm(`确定卸载扩展「${name}」？此操作不可撤销。`)) return;
  unregisterExtension(name);
  refreshList();
}

onMounted(refreshList);
</script>

<template>
  <div class="ext-manager-backdrop" @click.self="emit('close')">
    <div class="ext-manager" role="dialog" aria-label="扩展管理">
      <header class="ext-header">
        <div>
          <h2>扩展管理</h2>
          <p>管理已安装的扩展和可用钩子</p>
        </div>
        <div class="ext-header-actions">
          <button
            class="ext-btn ext-btn-secondary"
            type="button"
            title="刷新列表"
            :disabled="refreshing"
            @click="refreshList"
          >
            {{ refreshing ? '刷新中...' : '刷新' }}
          </button>
          <button
            class="ext-btn ext-btn-icon"
            type="button"
            title="关闭"
            @click="emit('close')"
          >
            &times;
          </button>
        </div>
      </header>

      <section class="ext-section">
        <h3>已安装扩展</h3>
        <p v-if="!hasExtensions" class="ext-empty">暂无已安装的扩展</p>
        <div v-for="ext in extensions" :key="ext.name" class="ext-card">
          <div class="ext-card-body">
            <div class="ext-card-title">
              <strong>{{ ext.name }}</strong>
              <span class="ext-version">v{{ ext.version }}</span>
              <span v-if="ext.loaded" class="ext-badge ext-badge-loaded">已加载</span>
            </div>
            <p class="ext-card-desc">{{ ext.description || '无描述' }}</p>
            <div v-if="ext.hooks.length" class="ext-hooks">
              <span v-for="h in ext.hooks" :key="h" class="ext-hook-tag">{{ h }}</span>
            </div>
          </div>
          <div class="ext-card-actions">
            <label class="ext-toggle" :title="ext.enabled ? '点击禁用' : '点击启用'">
              <input
                type="checkbox"
                :checked="ext.enabled"
                @change="toggleExtension(ext.name, ext.enabled)"
              />
              <span class="ext-toggle-track">
                <span class="ext-toggle-thumb"></span>
              </span>
              <span class="ext-toggle-label">{{ ext.enabled ? '启用' : '禁用' }}</span>
            </label>
            <button
              class="ext-btn ext-btn-danger"
              type="button"
              title="卸载"
              @click="uninstallExtension(ext.name)"
            >
              卸载
            </button>
          </div>
        </div>
      </section>

      <section class="ext-section">
        <h3>可用钩子类型</h3>
        <div class="ext-hook-list">
          <div v-for="ht in hookTypeList" :key="ht.key" class="ext-hook-item">
            <code>{{ ht.value }}</code>
            <span class="ext-hook-key">{{ ht.key }}</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.ext-manager-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}

.ext-manager {
  width: min(600px, 94vw);
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  background: #1a1a2e;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  color: #e0e0e0;
}

.ext-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20px 20px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.ext-header h2 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  color: #ffffff;
}

.ext-header p {
  margin: 4px 0 0;
  font-size: 0.82rem;
  color: #8892a4;
}

.ext-header-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}

/* Buttons */
.ext-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 14px;
  border: none;
  border-radius: 6px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}

.ext-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ext-btn-secondary {
  background: #16213e;
  color: #c0c8d8;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.ext-btn-secondary:hover:not(:disabled) {
  background: #1c2a4a;
}

.ext-btn-icon {
  width: 32px;
  height: 32px;
  padding: 0;
  background: transparent;
  color: #8892a4;
  font-size: 1.3rem;
  line-height: 1;
  border-radius: 8px;
}

.ext-btn-icon:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #ffffff;
}

.ext-btn-danger {
  background: rgba(233, 69, 96, 0.15);
  color: #e94560;
}

.ext-btn-danger:hover:not(:disabled) {
  background: rgba(233, 69, 96, 0.25);
}

/* Sections */
.ext-section {
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  overflow-y: auto;
}

.ext-section:last-child {
  border-bottom: none;
}

.ext-section h3 {
  margin: 0 0 12px;
  font-size: 0.92rem;
  font-weight: 600;
  color: #c0c8d8;
}

.ext-empty {
  text-align: center;
  padding: 24px 0;
  color: #5a6478;
  font-size: 0.85rem;
}

/* Extension Card */
.ext-card {
  display: flex;
  gap: 12px;
  padding: 12px;
  margin-bottom: 8px;
  background: #16213e;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  transition: border-color 0.15s;
}

.ext-card:hover {
  border-color: rgba(15, 52, 96, 0.5);
}

.ext-card-body {
  flex: 1;
  min-width: 0;
}

.ext-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ext-card-title strong {
  font-size: 0.9rem;
  color: #ffffff;
}

.ext-version {
  font-size: 0.72rem;
  color: #5a6478;
  background: rgba(255, 255, 255, 0.05);
  padding: 1px 6px;
  border-radius: 4px;
}

.ext-badge {
  font-size: 0.68rem;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
}

.ext-badge-loaded {
  background: rgba(15, 52, 96, 0.4);
  color: #4da6ff;
}

.ext-card-desc {
  margin: 6px 0 0;
  font-size: 0.8rem;
  color: #8892a4;
  line-height: 1.4;
}

.ext-hooks {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

.ext-hook-tag {
  font-size: 0.7rem;
  padding: 2px 7px;
  border-radius: 4px;
  background: rgba(15, 52, 96, 0.3);
  color: #7ab0ff;
  font-family: monospace;
}

.ext-card-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

/* Toggle switch */
.ext-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.ext-toggle input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.ext-toggle-track {
  position: relative;
  width: 36px;
  height: 20px;
  background: #2a2a40;
  border-radius: 10px;
  transition: background 0.2s;
}

.ext-toggle input:checked + .ext-toggle-track {
  background: #0f3460;
}

.ext-toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: #5a6478;
  border-radius: 50%;
  transition: transform 0.2s, background 0.2s;
}

.ext-toggle input:checked + .ext-toggle-track .ext-toggle-thumb {
  transform: translateX(16px);
  background: #4da6ff;
}

.ext-toggle-label {
  font-size: 0.78rem;
  color: #8892a4;
}

/* Hook list */
.ext-hook-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ext-hook-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: #16213e;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.ext-hook-item code {
  font-size: 0.82rem;
  color: #7ab0ff;
  background: rgba(15, 52, 96, 0.3);
  padding: 2px 6px;
  border-radius: 4px;
}

.ext-hook-key {
  font-size: 0.75rem;
  color: #5a6478;
}

/* Mobile */
@media (max-width: 480px) {
  .ext-manager {
    width: 100vw;
    max-height: 100vh;
    border-radius: 0;
  }

  .ext-header {
    padding: 14px;
  }

  .ext-section {
    padding: 12px 14px;
  }

  .ext-card {
    flex-direction: column;
  }

  .ext-card-actions {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}
</style>
