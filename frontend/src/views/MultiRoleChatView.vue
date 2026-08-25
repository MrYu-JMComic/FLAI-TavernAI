<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  ArrowLeft,
  Check,
  CircleStop,
  RefreshCw,
  Send,
  Users,
} from '@lucide/vue';
import {
  fetchMultiRoleState,
  generateMultiRole,
  updateMultiRoleQueue,
} from '../api/multiRole.js';

const props = defineProps({
  route: { type: Object, required: true },
});

const emit = defineEmits(['navigate']);
const state = ref({ participants: [], queue: [], turns: [] });
const selectedIds = ref([]);
const input = ref('');
const loading = ref(true);
const savingQueue = ref(false);
const generating = ref(false);
const errorMessage = ref('');
const transcriptRef = ref(null);
const composerRef = ref(null);
let requestToken = 0;
let generationController = null;

const conversationId = computed(() => String(props.route?.params?.id || ''));
const participants = computed(() => Array.isArray(state.value.participants) ? state.value.participants : []);
const turns = computed(() => Array.isArray(state.value.turns) ? state.value.turns : []);
const queueByMember = computed(() => new Map(
  (Array.isArray(state.value.queue) ? state.value.queue : []).map((entry) => [entry.memberId, entry])
));
const canGenerate = computed(() => (
  !loading.value
  && !generating.value
  && selectedIds.value.length > 0
  && input.value.trim().length > 0
));

onMounted(() => void loadState({ restoreSelection: true }));

onBeforeUnmount(() => {
  requestToken += 1;
  generationController?.abort();
  generationController = null;
});

async function loadState(options = {}) {
  const token = ++requestToken;
  loading.value = true;
  errorMessage.value = '';
  try {
    const result = await fetchMultiRoleState(conversationId.value);
    if (token !== requestToken) return;
    state.value = normalizeState(result);
    if (options.restoreSelection) {
      const queued = state.value.queue.map((entry) => entry.memberId);
      selectedIds.value = queued.length
        ? queued
        : state.value.participants.filter(isSelectable).slice(0, 3).map((member) => member.id);
    } else {
      selectedIds.value = selectedIds.value.filter(
        (id) => state.value.participants.some((member) => member.id === id && isSelectable(member))
      );
    }
    await scrollToLatest();
  } catch (error) {
    if (token === requestToken) errorMessage.value = error?.message || '多角色状态加载失败';
  } finally {
    if (token === requestToken) loading.value = false;
  }
}

async function toggleParticipant(member) {
  if (!isSelectable(member) || generating.value || savingQueue.value) return;
  const next = selectedIds.value.includes(member.id)
    ? selectedIds.value.filter((id) => id !== member.id)
    : [...selectedIds.value, member.id].slice(0, 8);
  selectedIds.value = next;
  if (!next.length) return;
  savingQueue.value = true;
  errorMessage.value = '';
  try {
    const result = await updateMultiRoleQueue(conversationId.value, next);
    state.value = { ...state.value, queue: Array.isArray(result?.queue) ? result.queue : [] };
  } catch (error) {
    errorMessage.value = error?.message || '参与人物保存失败';
    await loadState({ restoreSelection: true });
  } finally {
    savingQueue.value = false;
  }
}

async function selectAll() {
  const ids = participants.value.filter(isSelectable).slice(0, 8).map((member) => member.id);
  if (!ids.length || generating.value || savingQueue.value) return;
  selectedIds.value = ids;
  savingQueue.value = true;
  try {
    const result = await updateMultiRoleQueue(conversationId.value, ids);
    state.value = { ...state.value, queue: Array.isArray(result?.queue) ? result.queue : [] };
  } catch (error) {
    errorMessage.value = error?.message || '参与人物保存失败';
  } finally {
    savingQueue.value = false;
  }
}

async function submitTurn() {
  const content = input.value.trim();
  if (!canGenerate.value) return;
  generationController?.abort();
  generationController = new AbortController();
  generating.value = true;
  errorMessage.value = '';
  input.value = '';
  try {
    await generateMultiRole(conversationId.value, {
      input: content,
      memberIds: selectedIds.value,
    }, { signal: generationController.signal });
    await loadState({ restoreSelection: false });
  } catch (error) {
    if (error?.name !== 'AbortError') {
      errorMessage.value = error?.message || '本轮生成失败';
    }
    await loadState({ restoreSelection: false });
  } finally {
    generating.value = false;
    generationController = null;
    await nextTick();
    composerRef.value?.focus();
  }
}

function cancelGeneration() {
  generationController?.abort();
}

function handleComposerKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    void submitTurn();
  }
}

function backToChat() {
  emit('navigate', 'chat', { id: conversationId.value });
}

function isSelectable(member) {
  return member && !['dead', 'permanently_left'].includes(member.status);
}

function queueStatus(memberId) {
  return queueByMember.value.get(memberId)?.status || '';
}

function statusLabel(status) {
  return ({
    pending: '等待',
    active: '生成中',
    completed: '完成',
    failed: '失败',
    skipped: '跳过',
  })[status] || '';
}

function turnSpeaker(turn) {
  if (turn.speakerKind === 'user') return '你';
  return turn.speakerName || '旁白';
}

function turnTime(turn) {
  const value = Date.parse(turn.createdAt || '');
  if (!Number.isFinite(value)) return '';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(value);
}

async function scrollToLatest() {
  await nextTick();
  const element = transcriptRef.value;
  if (element) element.scrollTop = element.scrollHeight;
}

function normalizeState(value) {
  return {
    participants: Array.isArray(value?.participants) ? value.participants : [],
    queue: Array.isArray(value?.queue) ? value.queue : [],
    turns: Array.isArray(value?.turns) ? value.turns : [],
  };
}
</script>

<template>
  <section class="multi-role-page" aria-labelledby="multi-role-title">
    <header class="multi-role-header">
      <button class="deep-icon-button" type="button" aria-label="返回聊天" title="返回聊天" @click="backToChat">
        <ArrowLeft :size="19" aria-hidden="true" />
      </button>
      <div>
        <h1 id="multi-role-title">多角色对话</h1>
        <p>{{ selectedIds.length }} 位参与人物</p>
      </div>
      <button class="deep-icon-button" type="button" aria-label="刷新" title="刷新" :disabled="loading || generating" @click="loadState({ restoreSelection: false })">
        <RefreshCw :size="18" aria-hidden="true" />
      </button>
    </header>

    <div class="multi-role-workspace">
      <aside class="multi-role-participants" aria-label="参与人物">
        <div class="multi-role-section-heading">
          <span><Users :size="17" aria-hidden="true" />人物</span>
          <button type="button" :disabled="savingQueue || generating" @click="selectAll">全选</button>
        </div>
        <div v-if="loading" class="multi-role-empty">正在加载...</div>
        <div v-else-if="!participants.length" class="multi-role-empty">暂无可用人物</div>
        <button
          v-for="member in participants"
          v-else
          :key="member.id"
          class="multi-role-member"
          :class="{ selected: selectedIds.includes(member.id) }"
          type="button"
          :disabled="!isSelectable(member) || generating"
          :aria-pressed="selectedIds.includes(member.id)"
          @click="toggleParticipant(member)"
        >
          <span class="multi-role-avatar" aria-hidden="true">{{ member.name.slice(0, 1) }}</span>
          <span class="multi-role-member-copy">
            <strong>{{ member.name }}</strong>
            <small>{{ member.location || member.relationship || member.status }}</small>
          </span>
          <span v-if="queueStatus(member.id)" class="multi-role-queue-status" :data-status="queueStatus(member.id)">
            {{ statusLabel(queueStatus(member.id)) }}
          </span>
          <Check v-if="selectedIds.includes(member.id)" :size="16" aria-hidden="true" />
        </button>
      </aside>

      <section class="multi-role-stage" aria-label="多角色对话记录">
        <div ref="transcriptRef" class="multi-role-transcript" aria-live="polite">
          <div v-if="!turns.length && !loading" class="multi-role-empty multi-role-transcript-empty">
            <Users :size="28" aria-hidden="true" />
            <span>尚无多角色对话</span>
          </div>
          <article
            v-for="turn in turns"
            :key="turn.id"
            class="multi-role-turn"
            :class="{ user: turn.speakerKind === 'user' }"
          >
            <header>
              <strong>{{ turnSpeaker(turn) }}</strong>
              <time>{{ turnTime(turn) }}</time>
            </header>
            <p>{{ turn.content }}</p>
          </article>
          <div v-if="generating" class="multi-role-generating" role="status">
            <span class="multi-role-pulse" aria-hidden="true"></span>
            正在生成角色回合
          </div>
        </div>

        <p v-if="errorMessage" class="multi-role-error" role="alert">{{ errorMessage }}</p>

        <form class="multi-role-composer" @submit.prevent="submitTurn">
          <textarea
            ref="composerRef"
            v-model="input"
            rows="2"
            maxlength="12000"
            aria-label="本轮行动或对话"
            placeholder="输入本轮行动或对话..."
            :disabled="generating || loading"
            @keydown="handleComposerKeydown"
          ></textarea>
          <button
            v-if="generating"
            class="deep-icon-button danger"
            type="button"
            aria-label="停止生成"
            title="停止生成"
            @click="cancelGeneration"
          >
            <CircleStop :size="19" aria-hidden="true" />
          </button>
          <button
            v-else
            class="deep-icon-button primary"
            type="submit"
            aria-label="生成本轮"
            title="生成本轮"
            :disabled="!canGenerate"
          >
            <Send :size="19" aria-hidden="true" />
          </button>
        </form>
      </section>
    </div>
  </section>
</template>
