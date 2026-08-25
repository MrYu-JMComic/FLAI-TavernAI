<script setup>
import { Clock3, History, RotateCcw } from '@lucide/vue';
import { useCastManagerContext } from './castManagerContext.js';

const emit = defineEmits(['rollback']);
const manager = useCastManagerContext();

const actionLabels = Object.freeze({
  'member.create': '创建人物',
  'member.update': '更新资料',
  'memory.create': '添加记忆',
  'memory.update': '更新记忆',
  'memory.reinforce': '强化记忆',
  'memory.delete': '删除记忆',
  'behavior.create': '添加行为',
  'behavior.update': '更新行为',
  'behavior.delete': '删除行为',
  'item.create': '添加物品',
  'item.update': '更新物品',
  'item.transfer': '转交物品',
  'item.delete': '删除物品',
  'appearance.create': '记录外貌',
  'appearance.update': '更新外貌',
  rollback: '回滚变更',
});

function labelAction(action) {
  return actionLabels[action] || action || '人物变更';
}

function labelActor(actor) {
  if (String(actor || '').startsWith('user:')) return '用户操作';
  if (actor === 'auto_sync') return '自动同步';
  if (actor === 'ai_organize') return 'AI 整理';
  if (actor === 'migration') return '数据迁移';
  return actor || '系统';
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value || '') : date.toLocaleString('zh-CN');
}

function jsonPreview(value) {
  if (value === null || value === undefined) return '无';
  const text = JSON.stringify(value, null, 2);
  return text.length > 5000 ? `${text.slice(0, 5000)}\n...` : text;
}

function canRollback(event) {
  return event.action !== 'rollback'
    && !event.rollbackOfEventId
    && event.metadata?.rollbackable !== false;
}
</script>

<template>
  <section class="cast-tab-panel" role="tabpanel" aria-labelledby="cast-tab-audit">
    <header class="cast-list-toolbar simple">
      <div>
        <h3 tabindex="-1">审计时间线</h3>
        <p>按变更时间倒序</p>
      </div>
    </header>

    <div v-if="manager.loading.audit && !manager.loaded.audit" class="cast-row-skeleton" aria-label="正在加载审计记录">
      <span v-for="index in 6" :key="index"></span>
    </div>
    <div v-else-if="manager.errors.audit" class="cast-error-state" role="alert">
      <p>{{ manager.errors.audit }}</p>
      <button type="button" class="cast-button secondary" @click="manager.loadAudit()">重试</button>
    </div>
    <div v-else-if="!manager.audit.value.items.length" class="cast-empty-state">
      <History :size="28" aria-hidden="true" />
      <h4>暂无审计记录</h4>
    </div>
    <ol v-else class="cast-audit-list">
      <li v-for="event in manager.audit.value.items" :key="event.id">
        <span class="cast-audit-marker" aria-hidden="true"></span>
        <article class="cast-audit-entry">
          <header>
            <div>
              <strong>{{ labelAction(event.action) }}</strong>
              <span>{{ labelActor(event.actor) }}</span>
            </div>
            <time :datetime="event.createdAt"><Clock3 :size="13" aria-hidden="true" />{{ formatDate(event.createdAt) }}</time>
          </header>
          <p v-if="event.metadata?.summary">{{ event.metadata.summary }}</p>
          <details>
            <summary>查看变更快照</summary>
            <div class="cast-audit-diff">
              <section>
                <h5>变更前</h5>
                <pre>{{ jsonPreview(event.before) }}</pre>
              </section>
              <section>
                <h5>变更后</h5>
                <pre>{{ jsonPreview(event.after) }}</pre>
              </section>
            </div>
          </details>
          <button v-if="canRollback(event)" type="button" class="cast-button secondary cast-rollback-button" :disabled="manager.busy.mutation" @click="emit('rollback', event)">
            <RotateCcw :size="15" aria-hidden="true" />
            回滚此变更
          </button>
        </article>
      </li>
    </ol>

    <button v-if="manager.audit.value.hasMore" type="button" class="cast-load-more" :disabled="manager.loading.audit" @click="manager.loadAudit({ append: true })">
      {{ manager.loading.audit ? '加载中' : '加载更早记录' }}
    </button>
  </section>
</template>
