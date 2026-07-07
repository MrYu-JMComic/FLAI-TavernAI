<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { AlertCircle, BookOpen, RotateCcw, Search } from '@lucide/vue';
import { previewWorldBookMatches } from '../../api/worldBooks.js';
import { useNotify } from '../../composables/useNotify';

const props = defineProps({
  worldBookId: { type: String, default: '' },
  disabled: { type: Boolean, default: false }
});

const notify = useNotify();
const matchText = ref('');
const matchPreview = ref(null);
const matchError = ref('');
const matchLoading = ref(false);
let matchPreviewToken = 0;
let matchLabDisposed = false;

const controlsDisabled = computed(() => props.disabled || matchLoading.value || !props.worldBookId);
const matchItems = computed(() => {
  const source = Array.isArray(matchPreview.value?.matches) ? matchPreview.value.matches : [];
  const items = [];
  for (const match of source) {
    items.push({
      id: String(match?.id || match?.name || items.length),
      name: String(match?.name || '未命名条目'),
      matchedKeys: normalizeMatchedKeys(match?.matchedKeys),
      matchedSecondaryKeys: normalizeMatchedKeys(match?.matchedSecondaryKeys),
      alwaysActive: Boolean(match?.alwaysActive),
      positionLabel: positionLabel(match?.position),
      depth: Number(match?.depth || 0),
      statusLabel: statusLabel(match?.status),
      statusDetail: String(match?.statusDetail || ''),
      selectiveLabel: selectiveLabel(match),
      probabilityLabel: probabilityLabel(match),
      groupLabel: groupLabel(match),
      statefulLabels: statefulLabels(match),
      effective: match?.effective !== false,
      groupPreviewWinner: Boolean(match?.groupPreviewWinner)
    });
  }
  return items;
});
const matchCount = computed(() => Number(matchPreview.value?.matchCount ?? matchItems.value.length) || 0);
const effectiveMatchCount = computed(() => Number(matchPreview.value?.effectiveMatchCount ?? matchItems.value.filter((item) => item.effective).length) || 0);
const scannedTextLength = computed(() => Number(matchPreview.value?.scannedTextLength ?? matchText.value.trim().length) || 0);
const groupItems = computed(() => {
  const source = Array.isArray(matchPreview.value?.groups) ? matchPreview.value.groups : [];
  const groups = [];
  for (const group of source) {
    const entries = [];
    const sourceEntries = Array.isArray(group?.entries) ? group.entries : [];
    for (const entry of sourceEntries) {
      entries.push({
        id: String(entry?.id || entry?.name || entries.length),
        name: String(entry?.name || '未命名条目'),
        weight: Number(entry?.weight || 0),
        shareLabel: percentLabel(entry?.share),
        previewWinner: Boolean(entry?.previewWinner)
      });
    }
    groups.push({
      name: String(group?.name || '未命名分组'),
      conflict: Boolean(group?.conflict),
      totalWeight: Number(group?.totalWeight || 0),
      previewWinnerName: String(group?.previewWinnerName || ''),
      entries
    });
  }
  return groups;
});
const blockedItems = computed(() => {
  const source = Array.isArray(matchPreview.value?.explanations) ? matchPreview.value.explanations : [];
  const items = [];
  for (const entry of source) {
    if (entry?.matched) {
      continue;
    }
    items.push({
      id: String(entry?.id || entry?.name || items.length),
      name: String(entry?.name || '未命名条目'),
      statusLabel: statusLabel(entry?.status),
      statusDetail: String(entry?.statusDetail || ''),
      primaryKeys: normalizeMatchedKeys(entry?.primaryKeys),
      secondaryKeys: normalizeMatchedKeys(entry?.secondaryKeys),
      invalidRegexKeys: normalizeMatchedKeys(entry?.invalidRegexKeys)
    });
  }
  return items;
});

watch(() => props.worldBookId, () => {
  matchPreviewToken += 1;
  matchPreview.value = null;
  matchError.value = '';
});

onBeforeUnmount(() => {
  matchLabDisposed = true;
  matchPreviewToken += 1;
});

async function runMatchPreview() {
  if (controlsDisabled.value) {
    return;
  }
  const text = matchText.value.trim();
  if (!text) {
    notify.warning('请输入测试文本');
    return;
  }
  const worldBookId = String(props.worldBookId || '').trim();
  const requestToken = ++matchPreviewToken;
  matchLoading.value = true;
  matchError.value = '';
  try {
    const result = await previewWorldBookMatches(worldBookId, { text });
    if (!isCurrentMatchPreview(requestToken, worldBookId)) {
      return;
    }
    matchPreview.value = result || null;
    if (!Number(result?.matchCount || 0)) {
      notify.info('没有命中世界书条目');
    }
  } catch (error) {
    if (!isCurrentMatchPreview(requestToken, worldBookId)) {
      return;
    }
    const message = error?.message || '世界书匹配测试失败';
    matchError.value = message;
    notify.error(message);
  } finally {
    if (isCurrentMatchPreview(requestToken, worldBookId)) {
      matchLoading.value = false;
    }
  }
}

function isCurrentMatchPreview(requestToken, worldBookId) {
  return !matchLabDisposed
    && requestToken === matchPreviewToken
    && String(props.worldBookId || '').trim() === worldBookId;
}

function clearMatchPreview() {
  if (matchLoading.value) {
    return;
  }
  matchPreviewToken += 1;
  matchText.value = '';
  matchPreview.value = null;
  matchError.value = '';
}

function normalizeMatchedKeys(value) {
  const source = Array.isArray(value) ? value : [];
  const keys = [];
  for (const key of source) {
    const text = String(key || '').trim();
    if (text) {
      keys.push(text);
    }
  }
  return keys;
}

function positionLabel(position) {
  if (position === 'at_start') return '开头';
  if (position === 'after_char') return '角色后';
  if (position === 'at_depth') return '按深度';
  return '角色前';
}

function statusLabel(status) {
  if (status === 'always_active') return '常驻激活';
  if (status === 'regex_match') return '正则命中';
  if (status === 'selective_match') return '选择命中';
  if (status === 'probability_preview') return '概率候选';
  if (status === 'selective_blocked') return '副关键词阻止';
  if (status === 'probability_blocked') return '概率为零';
  if (status === 'invalid_regex') return '正则无效';
  if (status === 'disabled') return '已禁用';
  if (status === 'no_primary_keys') return '无主关键词';
  if (status === 'primary_miss') return '未触发';
  return '关键词命中';
}

function selectiveLabel(match) {
  if (!match?.selective) {
    return '';
  }
  const logic = match?.selectiveLogicLabel || '';
  const prefix = logic === 'not_any' ? '副词排除任一' : logic === 'not_all' ? '副词排除全部' : '副词需要任一';
  return `${prefix} · ${match?.selectivePassed ? '通过' : '阻止'}`;
}

function probabilityLabel(match) {
  if (!match?.useProbability) {
    return '';
  }
  const probability = Number(match?.probability ?? 100);
  return `概率 ${probability}%`;
}

function groupLabel(match) {
  const group = String(match?.group || '').trim();
  if (!group) {
    return '';
  }
  const share = match?.groupShare == null ? '' : ` · 权重占比 ${percentLabel(match.groupShare)}`;
  const winner = match?.groupPreviewWinner ? ' · 预览胜出' : match?.effective === false ? ' · 预览排除' : '';
  return `分组 ${group}${share}${winner}`;
}

function statefulLabels(match) {
  const labels = [];
  const source = Array.isArray(match?.statefulRules) ? match.statefulRules : [];
  for (const rule of source) {
    if (rule?.kind === 'sticky') labels.push(`sticky ${rule.value}`);
    if (rule?.kind === 'cooldown') labels.push(`cooldown ${rule.value}`);
    if (rule?.kind === 'delay') labels.push(`delay ${rule.value}`);
  }
  return labels;
}

function percentLabel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '0%';
  }
  return `${Math.round(numeric * 100)}%`;
}
</script>

<template>
  <section class="form-panel worldbook-match-lab">
    <div class="inline-heading">
      <div>
        <h2>匹配实验室</h2>
        <p>当前结果：{{ matchPreview ? `${matchCount} 条命中` : '未测试' }}</p>
      </div>
      <BookOpen :size="20" />
    </div>

    <label class="field">
      <span>测试文本</span>
      <textarea
        v-model="matchText"
        rows="4"
        placeholder="输入一段对话或剧情文本"
        :disabled="controlsDisabled"
      />
    </label>

    <div class="form-actions">
      <button
        class="primary-button"
        type="button"
        :disabled="controlsDisabled || !matchText.trim()"
        :aria-busy="matchLoading"
        @click="runMatchPreview"
      >
        <Search :size="17" />
        <span>{{ matchLoading ? '测试中...' : '测试触发' }}</span>
      </button>
      <button
        class="ghost-button"
        type="button"
        :disabled="matchLoading || (!matchText && !matchPreview)"
        @click="clearMatchPreview"
      >
        <RotateCcw :size="16" />
        <span>清空</span>
      </button>
    </div>

    <p v-if="matchError" class="worldbook-match-error" role="alert">
      <AlertCircle :size="15" />
      <span>{{ matchError }}</span>
    </p>

    <div v-if="matchPreview" class="worldbook-match-result">
      <div class="worldbook-match-result-head">
        <strong>{{ matchCount }}</strong>
        <span>命中条目 · 有效 {{ effectiveMatchCount }} · 扫描 {{ scannedTextLength }} 字</span>
      </div>
      <ul v-if="matchItems.length" class="worldbook-match-list">
        <li v-for="match in matchItems" :key="match.id">
          <div class="worldbook-match-title">
            <strong>{{ match.name }}</strong>
            <span :class="{ muted: !match.effective }">{{ match.statusLabel }}</span>
          </div>
          <span>{{ match.alwaysActive && !match.matchedKeys.length ? '常驻激活' : `关键词：${match.matchedKeys.join('、')}` }}</span>
          <span v-if="match.matchedSecondaryKeys.length">副关键词：{{ match.matchedSecondaryKeys.join('、') }}</span>
          <small>{{ match.positionLabel }}{{ match.depth ? ` · depth ${match.depth}` : '' }}</small>
          <div v-if="match.selectiveLabel || match.probabilityLabel || match.groupLabel || match.statefulLabels.length" class="worldbook-match-chips">
            <span v-if="match.selectiveLabel">{{ match.selectiveLabel }}</span>
            <span v-if="match.probabilityLabel">{{ match.probabilityLabel }}</span>
            <span v-if="match.groupLabel">{{ match.groupLabel }}</span>
            <span v-for="label in match.statefulLabels" :key="`${match.id}-${label}`">{{ label }}</span>
          </div>
        </li>
      </ul>
      <p v-else class="worldbook-match-empty">没有命中条目</p>

      <div v-if="groupItems.length" class="worldbook-match-groups">
        <h3>分组权重</h3>
        <article v-for="group in groupItems" :key="group.name">
          <div class="worldbook-match-group-head">
            <strong>{{ group.name }}</strong>
            <span>{{ group.conflict ? `冲突预览：${group.previewWinnerName || '未定'}` : '单条命中' }}</span>
          </div>
          <ul>
            <li v-for="entry in group.entries" :key="entry.id">
              <span>{{ entry.name }}</span>
              <small>权重 {{ entry.weight }} · {{ entry.shareLabel }}{{ entry.previewWinner ? ' · 预览胜出' : '' }}</small>
            </li>
          </ul>
        </article>
      </div>

      <div v-if="blockedItems.length" class="worldbook-match-blocked">
        <h3>未命中诊断</h3>
        <ul>
          <li v-for="entry in blockedItems" :key="entry.id">
            <strong>{{ entry.name }}</strong>
            <span>{{ entry.statusLabel }}</span>
            <small v-if="entry.invalidRegexKeys.length">无效正则：{{ entry.invalidRegexKeys.join('、') }}</small>
            <small v-else-if="entry.primaryKeys.length">主关键词：{{ entry.primaryKeys.join('、') }}</small>
            <small v-if="entry.secondaryKeys.length">副关键词：{{ entry.secondaryKeys.join('、') }}</small>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.worldbook-match-lab {
  display: grid;
  gap: 14px;
  margin-bottom: 16px;
}

.worldbook-match-error,
.worldbook-match-result-head,
.worldbook-match-title,
.worldbook-match-group-head,
.worldbook-match-chips {
  display: flex;
  align-items: center;
}

.worldbook-match-error {
  gap: 7px;
  margin: 0;
  padding: 9px 10px;
  border: 1px solid color-mix(in srgb, #ef4444 28%, var(--line));
  border-radius: 8px;
  color: #991b1b;
  background: color-mix(in srgb, #fee2e2 78%, var(--surface));
  font-size: 0.82rem;
}

.worldbook-match-result {
  display: grid;
  gap: 10px;
}

.worldbook-match-result-head {
  gap: 8px;
  color: var(--muted);
  font-size: 0.82rem;
}

.worldbook-match-result-head strong {
  color: var(--primary);
  font-size: 1.18rem;
}

.worldbook-match-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.worldbook-match-list li {
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 10px 11px;
  border: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-strong) 74%, transparent);
}

.worldbook-match-title,
.worldbook-match-group-head {
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.worldbook-match-title span,
.worldbook-match-group-head span {
  flex: 0 0 auto;
  max-width: 52%;
  overflow-wrap: anywhere;
  color: var(--primary);
  font-size: 0.74rem;
  font-weight: 800;
}

.worldbook-match-title span.muted {
  color: var(--muted);
}

.worldbook-match-list strong,
.worldbook-match-list span,
.worldbook-match-list small,
.worldbook-match-groups strong,
.worldbook-match-groups span,
.worldbook-match-groups small,
.worldbook-match-blocked strong,
.worldbook-match-blocked span,
.worldbook-match-blocked small {
  overflow-wrap: anywhere;
}

.worldbook-match-list strong {
  color: var(--text);
  font-size: 0.84rem;
}

.worldbook-match-list span,
.worldbook-match-list small,
.worldbook-match-empty,
.worldbook-match-groups,
.worldbook-match-blocked {
  color: var(--muted);
  font-size: 0.78rem;
  line-height: 1.45;
}

.worldbook-match-chips {
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}

.worldbook-match-chips span {
  min-height: 22px;
  padding: 2px 7px;
  border: 1px solid color-mix(in srgb, var(--line) 72%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 80%, transparent);
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 700;
}

.worldbook-match-groups,
.worldbook-match-blocked {
  display: grid;
  gap: 8px;
  padding-top: 2px;
}

.worldbook-match-groups h3,
.worldbook-match-blocked h3 {
  margin: 0;
  color: var(--text);
  font-size: 0.82rem;
}

.worldbook-match-groups article,
.worldbook-match-blocked li {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid color-mix(in srgb, var(--line) 62%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 70%, transparent);
}

.worldbook-match-groups ul,
.worldbook-match-blocked ul {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.worldbook-match-groups li {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.worldbook-match-groups li span,
.worldbook-match-groups li small {
  min-width: 0;
}

.worldbook-match-empty {
  margin: 0;
}
</style>
