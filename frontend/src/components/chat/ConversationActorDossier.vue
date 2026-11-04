<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Search, Users } from '@lucide/vue';
import { fetchConversationActorDossier, fetchConversationMemoryActors } from '../../api/memories.js';

const props = defineProps({ conversationId: { type: String, required: true }, refreshKey: { type: [String, Number], default: 0 } });
const actors = ref([]);
const actorId = ref('');
const query = ref('');
const tab = ref('memories');
const dossier = ref(null);
const loading = ref(false);
const detailLoading = ref(false);
const error = ref('');
const detailError = ref('');
let listToken = 0;
let detailToken = 0;
let searchTimer;
let disposed = false;
const tabs = [{ id: 'memories', label: '记忆' }, { id: 'events', label: '事件' }, { id: 'relations', label: '关系' }, { id: 'items', label: '物品' }];
const actor = computed(() => dossier.value?.actor || actors.value.find(item => item.id === actorId.value));
const rows = computed(() => dossier.value?.[tab.value] || []);
const truthLabels = { established: '已确认', unverified: '待核实', disputed: '有争议', false: '不成立', unknown: '未知' };
const knowledgeLabels = { experienced: '亲历', told: '听说', knows: '知晓', believes: '相信', suspects: '怀疑', false_belief: '错误信念', unknown: '未知' };

/** Load author-visible actors; request tokens keep old conversations and searches out of the current list. */
async function loadActors() {
  const conversationId = props.conversationId;
  const current = ++listToken;
  loading.value = true;
  error.value = '';
  try {
    const result = await fetchConversationMemoryActors(conversationId, { query: query.value.trim() });
    if (disposed || current !== listToken || conversationId !== props.conversationId) return;
    actors.value = result?.actors || [];
    if (!actors.value.some(item => item.id === actorId.value)) actorId.value = actors.value[0]?.id || '';
  } catch (failure) {
    if (!disposed && current === listToken) error.value = failure?.message || '角色列表加载失败';
  } finally { if (!disposed && current === listToken) loading.value = false; }
}

/** Load or append an author dossier; appends require the same canonical revision to avoid mixing history. */
async function loadDossier({ append = false } = {}) {
  const conversationId = props.conversationId;
  const selectedId = actorId.value;
  const current = ++detailToken;
  const previous = dossier.value;
  const offset = append ? (previous?.pagination?.offset || 0) + (previous?.pagination?.limit || 200) : 0;
  if (!append) dossier.value = null;
  detailError.value = '';
  detailLoading.value = Boolean(selectedId);
  if (!selectedId) return;
  try {
    const result = await fetchConversationActorDossier(conversationId, selectedId, offset ? { offset } : {});
    if (disposed || current !== detailToken || conversationId !== props.conversationId || selectedId !== actorId.value) return;
    if (append && previous?.revision !== result.revision) throw new Error('角色档案已更新，请刷新后继续查看。');
    dossier.value = append ? {
      ...result,
      ...Object.fromEntries(tabs.map(({ id }) => [id, [...new Map([...(previous?.[id] || []), ...(result[id] || [])].map(row => [row.id, row])).values()]]))
    } : result;
  } catch (failure) {
    if (!disposed && current === detailToken) detailError.value = failure?.message || '角色档案加载失败';
  } finally { if (!disposed && current === detailToken) detailLoading.value = false; }
}

watch(() => props.conversationId, () => {
  clearTimeout(searchTimer);
  listToken += 1; detailToken += 1;
  actors.value = []; actorId.value = ''; query.value = ''; dossier.value = null; error.value = ''; detailError.value = '';
});
watch(() => [props.conversationId, props.refreshKey], () => { void loadActors(); void loadDossier(); }, { immediate: true });
watch(actorId, () => void loadDossier());
watch(query, () => {
  clearTimeout(searchTimer);
  listToken += 1;
  searchTimer = setTimeout(loadActors, 200);
});
onBeforeUnmount(() => { disposed = true; listToken += 1; detailToken += 1; clearTimeout(searchTimer); });
</script>

<template>
  <section class="actor-workspace" aria-label="角色记忆档案">
    <aside class="actor-sidebar" aria-label="剧情角色">
      <label class="actor-search"><Search :size="16" aria-hidden="true" /><input v-model="query" type="search" maxlength="160" aria-label="搜索剧情角色" placeholder="搜索姓名或别名"></label>
      <p v-if="error" class="dossier-error" role="alert">{{ error }} <button type="button" @click="loadActors">重试</button></p>
      <p v-if="loading" class="actor-hint" role="status">加载角色中…</p>
      <template v-else-if="actors.length">
        <label class="mobile-actor-picker"><span>查看角色</span><select v-model="actorId"><option v-for="item in actors" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
        <nav class="actor-list" aria-label="角色列表">
          <button v-for="item in actors" :key="item.id" type="button" :aria-pressed="actorId === item.id" @click="actorId = item.id">
            <span class="actor-avatar" aria-hidden="true">{{ item.name?.slice(0, 1) || '角' }}</span>
            <span class="actor-list-copy"><strong>{{ item.name }}</strong><small>{{ item.origin === 'card' ? '角色设定' : '剧情角色' }} · {{ item.counts?.memories || 0 }} 条记忆</small></span>
          </button>
        </nav>
      </template>
      <div v-else-if="!error" class="actor-empty"><Users :size="24" /><span>{{ query ? '没有匹配的角色' : '剧情中建立角色后会显示在这里' }}</span></div>
    </aside>
    <div class="actor-detail" :aria-busy="detailLoading">
      <template v-if="actor">
        <header class="actor-heading"><span class="actor-avatar large" aria-hidden="true">{{ actor.name?.slice(0, 1) }}</span><div><h4>{{ actor.name }}</h4><p>{{ actor.origin === 'card' ? '来自角色设定' : '在剧情中相识' }}<template v-if="actor.aliases?.length"> · {{ actor.aliases.join('、') }}</template></p></div></header>
        <p class="actor-hint">作者档案汇总相关记录；角色在故事中的知情范围独立控制。</p>
        <nav class="dossier-tabs" aria-label="角色档案分类"><button v-for="item in tabs" :key="item.id" type="button" :aria-pressed="tab === item.id" @click="tab = item.id">{{ item.label }}<span>{{ dossier?.counts?.[item.id] ?? dossier?.[item.id]?.length ?? 0 }}</span></button></nav>
        <p v-if="detailError" class="dossier-error" role="alert">{{ detailError }} <button type="button" @click="loadDossier()">刷新档案</button></p>
        <p v-if="detailLoading && !dossier" class="actor-empty" role="status">加载档案中…</p>
        <div v-else-if="!rows.length" class="actor-empty">暂无{{ tabs.find(item => item.id === tab)?.label }}记录</div>
        <ul v-else class="dossier-records" :aria-label="`${actor.name}的${tabs.find(item => item.id === tab)?.label}`">
          <li v-for="row in rows" :key="row.id">
            <template v-if="tab === 'relations'"><div class="record-meta"><span>{{ row.direction === 'incoming' ? '与该角色有关' : '该角色的关系' }}</span><span>{{ truthLabels[row.truthStatus] || row.truthStatus }}</span></div><p>{{ row.subjectName || actor.name }} <strong>{{ row.predicate }}</strong> {{ row.objectName || (typeof row.value === 'object' ? JSON.stringify(row.value) : row.value) }}</p><small v-if="row.validFrom != null">第 {{ row.validFrom }} 轮起<template v-if="row.validTo != null">，至第 {{ row.validTo }} 轮</template></small></template>
            <template v-else-if="tab === 'items'"><div class="record-meta"><strong>{{ row.name }}</strong><span>{{ truthLabels[row.status] || row.status }}</span></div><p v-if="row.description">{{ row.description }}</p><small>{{ row.authoritative ? '当前场景记录' : '剧情来源记录' }} · {{ row.quantity == null ? '数量未明确' : `数量 ${row.quantity}` }}</small></template>
            <template v-else><div class="record-meta"><span>{{ tab === 'events' ? '剧情事件' : '保留记忆' }}</span><span>{{ knowledgeLabels[row.epistemicState] || truthLabels[row.truthStatus] || (row.pinned ? '已置顶' : '') }}</span></div><p>{{ row.content }}</p><small v-if="row.subject">{{ row.subject }}</small><details v-if="row.evidenceRefs?.length"><summary>查看来源</summary><p v-for="(source, index) in row.evidenceRefs" :key="source.id || index">{{ source.quote || source.excerpt || source.messageId || source.message_id }}</p></details></template>
          </li>
        </ul>
        <button v-if="dossier?.pagination?.hasMore" class="load-more" type="button" :disabled="detailLoading" @click="loadDossier({ append: true })">{{ detailLoading ? '加载中…' : '加载更多记录' }}</button>
      </template>
      <div v-else class="actor-empty">选择角色，查看他的记忆与经历</div>
    </div>
  </section>
</template>

<style scoped>
.actor-workspace { display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 22px; min-width: 0; }
.actor-sidebar, .actor-detail { min-width: 0; }
.actor-sidebar { display: flex; flex-direction: column; gap: 12px; }
.actor-search { display: flex; align-items: center; gap: 8px; padding: 0 11px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); color: var(--muted); }
.actor-search input { width: 100%; min-width: 0; min-height: 42px; border: 0; outline: 0; background: transparent; color: var(--text); font: inherit; font-size: 12px; }
.actor-search:focus-within { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.actor-list { display: grid; gap: 6px; }
button, select { min-height: 42px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text); font: inherit; cursor: pointer; }
.actor-list button { display: flex; gap: 10px; align-items: center; padding: 11px; text-align: left; border-color: transparent; }
.actor-list button[aria-pressed='true'] { border-color: color-mix(in srgb, var(--primary) 35%, var(--line)); background: var(--primary-soft); }
.actor-list-copy { display: grid; min-width: 0; gap: 5px; overflow-wrap: anywhere; }
strong { font-weight: 650; }
.actor-list-copy strong { font-size: 13px; }
small, .actor-hint, .actor-heading p { color: var(--muted); font-size: 12px; line-height: 1.7; }
.actor-avatar { display: grid; place-items: center; flex: 0 0 34px; width: 34px; height: 34px; border-radius: 10px; background: var(--surface-strong); color: var(--primary); font-weight: 650; }
.actor-avatar.large { flex-basis: 46px; width: 46px; height: 46px; font-size: 20px; }
.actor-heading { display: flex; align-items: center; gap: 12px; }
.actor-heading h4 { margin: 0; font-size: 18px; }
.actor-heading p { margin: 4px 0 0; overflow-wrap: anywhere; }
.actor-hint { margin: 12px 0; }
.dossier-tabs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; padding: 4px; background: var(--surface-strong); border-radius: 10px; margin-bottom: 16px; }
.dossier-tabs button { border-color: transparent; background: transparent; font-size: 12px; white-space: nowrap; padding: 7px 4px; }
.dossier-tabs button[aria-pressed='true'] { background: var(--surface); color: var(--primary); box-shadow: var(--shadow-xs); }
.dossier-tabs span { margin-left: 5px; color: var(--muted); font-size: 11px; }
.dossier-records { display: grid; gap: 12px; list-style: none; padding: 0; margin: 0; }
.dossier-records li { display: grid; gap: 9px; padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); min-width: 0; overflow-wrap: anywhere; }
.record-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--muted); font-size: 11px; }
.record-meta strong { color: var(--text); font-size: 14px; }
.dossier-records p { margin: 0; white-space: pre-wrap; font-size: 13px; line-height: 1.85; }
details { color: var(--muted); font-size: 12px; }
summary { cursor: pointer; min-height: 28px; }
.actor-empty { display: grid; justify-items: center; align-content: center; gap: 12px; min-height: 140px; padding: 24px 12px; text-align: center; color: var(--muted); font-size: 13px; line-height: 1.8; }
.dossier-error { color: var(--danger); background: var(--danger-soft); border-radius: 8px; padding: 10px; font-size: 12px; overflow-wrap: anywhere; }
.dossier-error button { margin-left: 8px; padding: 4px 10px; }
.mobile-actor-picker { display: none; }
.load-more { margin-top: 14px; width: 100%; padding: 9px 12px; font-size: 12px; }
button:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
@media (max-width: 760px) {
  .actor-workspace { grid-template-columns: minmax(0, 1fr); gap: 18px; }
  .actor-list { display: none; }
  .actor-sidebar { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, .8fr); gap: 8px; align-items: start; }
  .actor-sidebar > .actor-empty, .actor-sidebar > .dossier-error { grid-column: 1 / -1; }
  .mobile-actor-picker { display: grid; min-width: 0; }
  .mobile-actor-picker > span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .mobile-actor-picker select { min-width: 0; width: 100%; padding: 9px; }
  button, select, .actor-search input { min-height: 44px; }
  .actor-heading h4 { font-size: 17px; }
  .dossier-records li { padding: 14px; }
}
</style>
