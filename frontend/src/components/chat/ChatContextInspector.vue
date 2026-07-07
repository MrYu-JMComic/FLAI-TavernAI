<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  Ban,
  Brain,
  Check,
  Cpu,
  Database,
  FileText,
  Image,
  ListTree,
  RefreshCw,
  RotateCcw,
  Scissors,
  X
} from '@lucide/vue';
import {
  confirmConversationMemory,
  disableConversationMemory,
  fetchConversationBranchTree,
  fetchConversationMemories,
  previewConversationContext,
  rollbackConversationMemory
} from '../../api/chat.js';
import { useNotify } from '../../composables/useNotify';

const props = defineProps({
  open: { type: Boolean, default: false },
  conversationId: { type: String, default: '' },
  draftContent: { type: String, default: '' },
  draftAttachments: { type: Array, default: () => [] },
  presetId: { type: String, default: '' }
});

const emit = defineEmits(['close', 'memory-updated']);
const notify = useNotify();

const loading = ref(false);
const loadError = ref('');
const preview = ref(null);
const memories = ref([]);
const branchTree = ref(null);
const memoryActionBusyId = ref('');
let inspectorLoadToken = 0;
let inspectorDisposed = false;

const previewMessages = computed(() => {
  const source = Array.isArray(preview.value?.messages) ? preview.value.messages : [];
  const rows = [];
  for (let index = 0; index < source.length; index += 1) {
    const message = source[index];
    rows.push({
      key: `${index}:${message?.role || ''}`,
      role: message?.role || 'system',
      text: previewMessageText(message)
    });
  }
  return rows;
});

const worldBookHits = computed(() => {
  const entries = preview.value?.sections?.worldBook?.entries;
  const source = Array.isArray(entries) ? entries : [];
  const hits = [];
  for (const match of source) {
    hits.push({
      id: String(match?.id || match?.name || hits.length),
      name: String(match?.name || '未命名条目'),
      meta: worldBookMatchMeta(match),
      statusLabel: worldBookStatusLabel(match?.status),
      matchedKeys: normalizeWorldBookKeys(match?.matchedKeys),
      groupLabel: worldBookGroupLabel(match),
      statefulLabels: worldBookStatefulLabels(match)
    });
  }
  return hits;
});

const worldBookDiagnosticGroups = computed(() => {
  const groups = preview.value?.sections?.worldBook?.diagnostics?.groups;
  const source = Array.isArray(groups) ? groups : [];
  const rows = [];
  for (const group of source) {
    if (!group?.conflict) {
      continue;
    }
    rows.push({
      key: `${group?.worldBookId || ''}:${group?.name || rows.length}`,
      name: String(group?.name || '未命名分组'),
      worldBookName: String(group?.worldBookName || '世界书'),
      totalWeight: formatNumber(group?.totalWeight),
      previewWinnerName: String(group?.previewWinnerName || '未定'),
      entries: worldBookGroupEntries(group?.entries)
    });
  }
  return rows;
});

const worldBookDiagnosticMisses = computed(() => {
  const explanations = preview.value?.sections?.worldBook?.diagnostics?.explanations;
  const source = Array.isArray(explanations) ? explanations : [];
  const rows = [];
  for (const item of source) {
    if (item?.matched || rows.length >= 8) {
      continue;
    }
    rows.push({
      key: String(item?.id || item?.name || rows.length),
      name: String(item?.name || '未命名条目'),
      worldBookName: String(item?.worldBookName || '世界书'),
      statusLabel: worldBookStatusLabel(item?.status),
      keys: worldBookMissKeyLabel(item)
    });
  }
  return rows;
});

const activePriorityLabels = computed(() => {
  const activeContext = preview.value?.priority?.activeContext;
  const source = Array.isArray(activeContext) ? activeContext : [];
  const labels = [];
  for (const item of source) {
    labels.push(priorityContextLabel(item));
  }
  return labels;
});

const priorityOrderLabels = computed(() => {
  const order = preview.value?.priority?.order;
  const source = Array.isArray(order) ? order : [];
  const labels = [];
  for (const item of source) {
    labels.push(priorityContextLabel(item));
  }
  return labels;
});

const budgetStats = computed(() => {
  const budget = preview.value?.budget || {};
  const diagnostics = preview.value?.diagnostics || {};
  return [
    { key: 'tokens', label: '估算 Token', value: formatNumber(budget.estimatedTokens) },
    { key: 'chars', label: '上下文字符', value: formatNumber(budget.characters) },
    { key: 'limit', label: '预算上限', value: formatNumber(budget.limitCharacters) },
    { key: 'cuts', label: '裁剪项', value: formatNumber(budget.truncation?.length || 0) },
    { key: 'messages', label: '消息数', value: formatNumber(diagnostics.messageCount) },
    { key: 'history', label: '历史轮数', value: formatNumber(diagnostics.historyCount) },
    { key: 'worldbook', label: '世界书命中', value: formatNumber(diagnostics.worldBookMatchCount) },
    { key: 'images', label: '图片片段', value: formatNumber(budget.imageParts ?? diagnostics.imagePartCount) }
  ];
});

const providerSummaryRows = computed(() => {
  const providerDiagnostics = preview.value?.providerDiagnostics || {};
  const diagnostics = preview.value?.diagnostics || {};
  const provider = providerDiagnostics.provider || {};
  const capability = providerDiagnostics.capability || {};
  const modelCapabilities = capability.modelCapabilities || {};
  return [
    {
      key: 'diagnostic',
      label: '诊断 ID',
      value: String(providerDiagnostics.diagnosticId || diagnostics.providerDiagnosticId || '-')
    },
    {
      key: 'provider',
      label: 'Provider',
      value: String(provider.gatewayName || provider.providerType || '未配置')
    },
    {
      key: 'model',
      label: '模型',
      value: String(modelCapabilities.model || provider.model || '-')
    },
    {
      key: 'host',
      label: 'Host',
      value: String(provider.baseUrlHost || '-')
    }
  ];
});

const providerCapabilityRows = computed(() => {
  const modelCapabilities = preview.value?.providerDiagnostics?.capability?.modelCapabilities || {};
  const definitions = [
    { key: 'streaming', label: '流式' },
    { key: 'reasoning', label: '思考' },
    { key: 'tools', label: '工具' },
    { key: 'vision', label: '视觉' },
    { key: 'imageGeneration', label: '生图' },
    { key: 'usage', label: '用量' }
  ];
  const rows = [];
  for (const definition of definitions) {
    rows.push({
      key: definition.key,
      label: definition.label,
      enabled: Boolean(modelCapabilities[definition.key])
    });
  }
  return rows;
});

const truncationRows = computed(() => {
  const source = Array.isArray(preview.value?.budget?.truncation) ? preview.value.budget.truncation : [];
  const rows = [];
  for (const item of source) {
    rows.push({
      key: `${item?.index ?? rows.length}:${item?.reason || ''}:${item?.role || ''}`,
      role: item?.role || 'unknown',
      reason: truncationReasonLabel(item?.reason),
      originalCharacters: formatNumber(item?.originalCharacters),
      keptCharacters: formatNumber(item?.keptCharacters),
      excerpt: String(item?.excerpt || '').trim()
    });
  }
  return rows;
});

const memoryStats = computed(() => {
  const stats = { pending: 0, enabled: 0, disabled: 0 };
  for (const memory of memories.value) {
    if (memory?.pending) {
      stats.pending += 1;
    } else if (memory?.enabled) {
      stats.enabled += 1;
    } else {
      stats.disabled += 1;
    }
  }
  return stats;
});

const branchSummaryTags = computed(() => {
  const comparison = branchTree.value?.comparison || {};
  return [
    `总数 ${formatNumber(comparison.totalConversations)}`,
    `最大层级 ${formatNumber(comparison.maxDepth)}`,
    `当前层级 ${formatNumber(comparison.activeDepth)}`,
    `上游 ${formatNumber(comparison.ancestorCount)}`,
    `下游 ${formatNumber(comparison.descendantCount)}`
  ];
});

const branchTreeRows = computed(() => {
  const source = Array.isArray(branchTree.value?.nodes) ? branchTree.value.nodes : [];
  const activeId = String(branchTree.value?.activeConversationId || '').trim();
  const rows = [];
  for (const node of source) {
    rows.push({
      id: String(node?.id || '').trim(),
      title: String(node?.title || '未命名分支').trim(),
      depth: Number(node?.depth) || 0,
      active: String(node?.id || '').trim() === activeId,
      characterName: String(node?.characterName || '').trim(),
      messageCount: formatNumber(node?.messageCount),
      branchPoint: branchPointLabel(node?.branchPoint),
      comparison: branchComparisonLabel(node?.comparison)
    });
  }
  return rows;
});

const contextSections = computed(() => {
  const sections = preview.value?.sections || {};
  return [
    {
      key: 'memory',
      label: '长期记忆',
      active: Boolean(sections.memory?.context),
      text: sections.memory?.context || ''
    },
    {
      key: 'npc',
      label: 'NPC',
      active: Boolean(sections.npc?.active),
      text: sections.npc?.context || ''
    },
    {
      key: 'economy',
      label: '经济',
      active: Boolean(sections.economy?.active),
      text: sections.economy?.context || ''
    },
    {
      key: 'talent',
      label: '天赋',
      active: Boolean(sections.talent?.active),
      text: sections.talent?.context || ''
    },
    {
      key: 'mods',
      label: 'Mod',
      active: Boolean(sections.mods?.context),
      text: sections.mods?.context || ''
    }
  ];
});

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    loadInspector();
  } else {
    inspectorLoadToken += 1;
    loadError.value = '';
    branchTree.value = null;
  }
}, { immediate: true });

watch(() => props.conversationId, () => {
  inspectorLoadToken += 1;
  preview.value = null;
  memories.value = [];
  branchTree.value = null;
  loadError.value = '';
  if (props.open) {
    loadInspector();
  }
});

onBeforeUnmount(() => {
  inspectorDisposed = true;
  inspectorLoadToken += 1;
});

function requestClose() {
  emit('close');
}

async function loadInspector(options = {}) {
  const conversationId = String(props.conversationId || '').trim();
  if (!props.open || !conversationId) {
    return;
  }

  const loadToken = ++inspectorLoadToken;
  const quiet = Boolean(options.quiet);
  if (!quiet) {
    loading.value = true;
  }
  loadError.value = '';
  try {
    const [nextPreview, memoryResult, branchTreeResult] = await Promise.all([
      previewConversationContext(conversationId, buildPreviewPayload()),
      fetchConversationMemories(conversationId),
      fetchConversationBranchTree(conversationId)
    ]);
    if (!isCurrentLoad(loadToken, conversationId)) {
      return;
    }
    preview.value = nextPreview || null;
    memories.value = Array.isArray(memoryResult?.memories) ? memoryResult.memories : [];
    branchTree.value = branchTreeResult || null;
  } catch (error) {
    if (!isCurrentLoad(loadToken, conversationId)) {
      return;
    }
    const message = error?.message || '上下文检查器加载失败';
    loadError.value = message;
    if (quiet) {
      notify.error(message);
    }
  } finally {
    if (isCurrentLoad(loadToken, conversationId)) {
      loading.value = false;
    }
  }
}

function isCurrentLoad(loadToken, conversationId) {
  return !inspectorDisposed
    && props.open
    && loadToken === inspectorLoadToken
    && String(props.conversationId || '').trim() === conversationId;
}

function buildPreviewPayload() {
  const payload = {
    content: props.draftContent || '',
    attachments: normalizePreviewAttachments(props.draftAttachments)
  };
  const presetId = String(props.presetId || '').trim();
  if (presetId) {
    payload.presetId = presetId;
  }
  return payload;
}

function normalizePreviewAttachments(attachments = []) {
  const source = Array.isArray(attachments) ? attachments : [];
  const normalized = [];
  for (const attachment of source) {
    if (!attachment || typeof attachment !== 'object') {
      continue;
    }
    normalized.push({
      id: String(attachment.id || '').trim(),
      type: String(attachment.type || 'image').trim(),
      dataUrl: String(attachment.dataUrl || '').trim(),
      url: String(attachment.url || '').trim(),
      assetId: String(attachment.assetId || '').trim(),
      mimeType: String(attachment.mimeType || '').trim(),
      name: String(attachment.name || '').trim(),
      alt: String(attachment.alt || '').trim(),
      size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : 0
    });
  }
  return normalized;
}

async function mutateMemory(memory, action) {
  const conversationId = String(props.conversationId || '').trim();
  const memoryId = String(memory?.id || '').trim();
  if (!conversationId || !memoryId || memoryActionBusyId.value) {
    return;
  }
  memoryActionBusyId.value = `${action}:${memoryId}`;
  try {
    let updated = null;
    if (action === 'confirm') {
      updated = await confirmConversationMemory(conversationId, memoryId);
      notify.success('记忆已确认');
    } else if (action === 'disable') {
      updated = await disableConversationMemory(conversationId, memoryId);
      notify.success('记忆已禁用');
    } else if (action === 'rollback') {
      updated = await rollbackConversationMemory(conversationId, memoryId);
      notify.success('记忆已回滚');
    }
    emit('memory-updated', updated);
    await loadInspector({ quiet: true });
  } catch (error) {
    notify.error(error?.message || '记忆操作失败');
  } finally {
    memoryActionBusyId.value = '';
  }
}

function isMemoryBusy(memory, action) {
  return memoryActionBusyId.value === `${action}:${memory?.id || ''}`;
}

function canConfirmMemory(memory) {
  return Boolean(memory && !memory.archived && !memory.enabled);
}

function canDisableMemory(memory) {
  return Boolean(memory && !memory.archived && memory.enabled);
}

function canRollbackMemory(memory) {
  return Boolean(memory && !memory.archived);
}

function previewMessageText(message) {
  const content = message?.content;
  if (Array.isArray(content)) {
    return previewContentParts(content);
  }
  return String(content || '').trim() || '[空消息]';
}

function previewContentParts(parts) {
  let text = '';
  for (const part of parts) {
    if (!part || typeof part !== 'object') {
      continue;
    }
    const partText = String(part.text ?? part.input_text ?? '').trim();
    if (partText) {
      text = appendPreviewLine(text, partText);
      continue;
    }
    if (part.type === 'image_url' || part.type === 'input_image') {
      text = appendPreviewLine(text, '[图片]');
    }
  }
  return text || '[结构化内容]';
}

function appendPreviewLine(text, line) {
  return text ? `${text}\n${line}` : line;
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number).toLocaleString('zh-CN') : '-';
}

function memoryTypeLabel(type) {
  if (type === 'relationship') return '关系';
  if (type === 'location') return '地点';
  if (type === 'preference') return '偏好';
  if (type === 'fact') return '事实';
  if (type === 'summary') return '摘要';
  return '事件';
}

function memoryStateLabel(memory) {
  if (memory?.pending) return '待确认';
  if (memory?.enabled) return '已启用';
  return '已禁用';
}

function memoryAuditLabel(memory) {
  const parts = [];
  const sourceKind = String(memory?.sourceKind || '').trim();
  if (sourceKind) {
    parts.push(sourceKind === 'auto' ? '自动提取' : sourceKind === 'import' ? '导入' : '手动');
  }
  const confidence = Number(memory?.confidence);
  if (Number.isFinite(confidence)) {
    parts.push(`置信度 ${Math.round(confidence * 100)}%`);
  }
  const sourceMessageId = String(memory?.sourceMessageId || '').trim();
  if (sourceMessageId) {
    parts.push(`来源 ${sourceMessageId}`);
  }
  return parts.join(' · ');
}

function branchPointLabel(branchPoint) {
  const previewText = String(branchPoint?.preview || '').trim();
  if (previewText) {
    return previewText;
  }
  const messageId = String(branchPoint?.messageId || '').trim();
  return messageId ? `消息 ${messageId}` : '根对话';
}

function branchComparisonLabel(comparison) {
  const depthDelta = Number(comparison?.depthDeltaFromActive) || 0;
  const messageDelta = Number(comparison?.messageCountDeltaFromActive) || 0;
  const depthText = depthDelta === 0 ? '同层' : depthDelta > 0 ? `下 ${depthDelta}` : `上 ${Math.abs(depthDelta)}`;
  const messageText = messageDelta === 0 ? '消息相同' : messageDelta > 0 ? `多 ${messageDelta}` : `少 ${Math.abs(messageDelta)}`;
  return `${depthText} · ${messageText}`;
}

function priorityContextLabel(key) {
  if (key === 'explicit_user_instruction') return '用户输入';
  if (key === 'character_card') return '角色卡';
  if (key === 'world_book') return '世界书';
  if (key === 'long_term_memory') return '长期记忆';
  if (key === 'npc_status_economy_talent') return 'NPC/状态/经济/天赋';
  if (key === 'recent_conversation') return '近期对话';
  if (key === 'mods') return 'Mod';
  if (key === 'npc') return 'NPC';
  if (key === 'economy') return '经济';
  if (key === 'talent') return '天赋';
  return String(key || '上下文');
}

function truncationReasonLabel(reason) {
  if (reason === 'history_omitted') return '历史省略';
  if (reason === 'content_truncated') return '内容缩短';
  return '预算裁剪';
}

function worldBookMatchMeta(match) {
  let text = String(match?.worldBookName || '世界书');
  if (match?.position) {
    text += ` · ${worldBookPositionLabel(match.position)}`;
  }
  if (match?.role !== undefined) {
    text += ` · ${worldBookRoleLabel(match.role)}`;
  }
  if (match?.status) {
    text += ` · ${worldBookStatusLabel(match.status)}`;
  }
  return text;
}

function worldBookStatusLabel(status) {
  if (status === 'always_active') return '常驻';
  if (status === 'regex_match') return '正则';
  if (status === 'selective_match') return '选择';
  if (status === 'probability_preview') return '概率';
  if (status === 'selective_blocked') return '副词阻止';
  if (status === 'probability_blocked') return '概率阻止';
  if (status === 'invalid_regex') return '正则无效';
  if (status === 'disabled') return '禁用';
  if (status === 'primary_miss') return '未触发';
  return '命中';
}

function normalizeWorldBookKeys(value) {
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

function worldBookGroupLabel(match) {
  const group = String(match?.group || '').trim();
  if (!group) {
    return '';
  }
  const share = match?.groupShare == null ? '' : ` · ${formatPercent(match.groupShare)}`;
  return `分组 ${group}${share}`;
}

function worldBookStatefulLabels(match) {
  const source = Array.isArray(match?.statefulRules) ? match.statefulRules : [];
  const labels = [];
  for (const rule of source) {
    if (rule?.kind === 'sticky') labels.push(`sticky ${rule.value}`);
    if (rule?.kind === 'cooldown') labels.push(`cooldown ${rule.value}`);
    if (rule?.kind === 'delay') labels.push(`delay ${rule.value}`);
  }
  return labels;
}

function worldBookMissKeyLabel(item) {
  const invalidRegexKeys = normalizeWorldBookKeys(item?.invalidRegexKeys);
  if (invalidRegexKeys.length) {
    return `无效正则：${invalidRegexKeys.join('、')}`;
  }
  const primaryKeys = normalizeWorldBookKeys(item?.primaryKeys);
  const secondaryKeys = normalizeWorldBookKeys(item?.secondaryKeys);
  if (secondaryKeys.length) {
    return `主关键词：${primaryKeys.join('、') || '无'} · 副关键词：${secondaryKeys.join('、')}`;
  }
  return `主关键词：${primaryKeys.join('、') || '无'}`;
}

function worldBookGroupEntries(entries) {
  const source = Array.isArray(entries) ? entries : [];
  const rows = [];
  for (const entry of source) {
    rows.push({
      id: String(entry?.id || entry?.name || rows.length),
      name: String(entry?.name || '未命名条目'),
      weight: formatNumber(entry?.weight),
      share: formatPercent(entry?.share),
      previewWinner: Boolean(entry?.previewWinner)
    });
  }
  return rows;
}

function formatPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number * 100)}%` : '0%';
}

function worldBookPositionLabel(position) {
  if (position === 'at_start') return '开头';
  if (position === 'after_char') return '角色后';
  if (position === 'at_depth') return '按深度';
  return '角色前';
}

function worldBookRoleLabel(role) {
  if (Number(role) === 1) return 'user';
  if (Number(role) === 2) return 'assistant';
  return 'system';
}
</script>

<template>
  <div
    v-if="open"
    class="chat-context-inspector-overlay"
    @click.self="requestClose"
  >
    <aside
      class="chat-context-inspector"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chat-context-inspector-title"
    >
      <header class="chat-context-inspector-head">
        <div>
          <span class="chat-context-inspector-kicker">
            <Brain :size="15" />
            上下文检查器
          </span>
          <h2 id="chat-context-inspector-title">Prompt Pipeline V2</h2>
        </div>
        <div class="chat-context-inspector-actions">
          <button
            class="chat-context-inspector-icon"
            type="button"
            aria-label="刷新上下文检查器"
            title="刷新"
            :disabled="loading || Boolean(memoryActionBusyId)"
            :aria-busy="loading"
            @click="loadInspector()"
          >
            <RefreshCw :size="17" />
          </button>
          <button
            class="chat-context-inspector-icon"
            type="button"
            aria-label="关闭上下文检查器"
            title="关闭"
            @click="requestClose"
          >
            <X :size="18" />
          </button>
        </div>
      </header>

      <div class="chat-context-inspector-body" :aria-busy="loading">
        <p v-if="loadError" class="chat-context-inspector-error" role="alert">{{ loadError }}</p>

        <section class="chat-context-section">
          <h3>
            <Database :size="15" />
            预算
          </h3>
          <dl class="chat-context-stat-grid">
            <div v-for="item in budgetStats" :key="item.key">
              <dt>{{ item.label }}</dt>
              <dd>{{ item.value }}</dd>
            </div>
          </dl>
        </section>

        <section class="chat-context-section">
          <h3>
            <Cpu :size="15" />
            Provider 诊断
          </h3>
          <dl class="chat-context-stat-grid">
            <div v-for="item in providerSummaryRows" :key="item.key">
              <dt>{{ item.label }}</dt>
              <dd>{{ item.value }}</dd>
            </div>
          </dl>
          <div class="chat-context-tags">
            <span
              v-for="item in providerCapabilityRows"
              :key="item.key"
              :class="{ disabled: !item.enabled }"
            >
              {{ item.label }} {{ item.enabled ? '开' : '关' }}
            </span>
          </div>
        </section>

        <section v-if="truncationRows.length" class="chat-context-section">
          <h3>
            <Scissors :size="15" />
            裁剪记录
          </h3>
          <ul class="chat-context-truncation-list">
            <li v-for="row in truncationRows" :key="row.key">
              <strong>{{ row.reason }} · {{ row.role }}</strong>
              <span>{{ row.keptCharacters }} / {{ row.originalCharacters }}</span>
              <p>{{ row.excerpt }}</p>
            </li>
          </ul>
        </section>

        <section class="chat-context-section">
          <h3>
            <ListTree :size="15" />
            优先级
          </h3>
          <ol v-if="priorityOrderLabels.length" class="chat-context-priority-list">
            <li v-for="label in priorityOrderLabels" :key="label">{{ label }}</li>
          </ol>
          <div v-if="activePriorityLabels.length" class="chat-context-tags">
            <span v-for="label in activePriorityLabels" :key="label">{{ label }}</span>
          </div>
        </section>

        <section class="chat-context-section">
          <h3>
            <ListTree :size="15" />
            分支树
          </h3>
          <div class="chat-context-tags">
            <span v-for="tag in branchSummaryTags" :key="tag">{{ tag }}</span>
          </div>
          <ul v-if="branchTreeRows.length" class="chat-context-branch-list">
            <li
              v-for="branch in branchTreeRows"
              :key="branch.id"
              :class="{ active: branch.active }"
            >
              <div class="chat-context-branch-main">
                <strong>{{ branch.title }}</strong>
                <span>{{ branch.characterName || 'AI' }} · 层级 {{ branch.depth }} · {{ branch.messageCount }} 条消息</span>
              </div>
              <p>{{ branch.branchPoint }}</p>
              <small>{{ branch.comparison }}</small>
            </li>
          </ul>
          <p v-else class="chat-context-empty">暂无分支数据</p>
        </section>

        <section class="chat-context-section">
          <h3>
            <FileText :size="15" />
            Prompt 消息
          </h3>
          <ol v-if="previewMessages.length" class="chat-context-message-list">
            <li v-for="message in previewMessages" :key="message.key">
              <strong>{{ message.role }}</strong>
              <p>{{ message.text }}</p>
            </li>
          </ol>
          <p v-else class="chat-context-empty">暂无预览消息</p>
        </section>

        <section class="chat-context-section">
          <h3>
            <Image :size="15" />
            世界书命中
          </h3>
          <ul v-if="worldBookHits.length" class="chat-context-hit-list">
            <li v-for="match in worldBookHits" :key="match.id || match.name">
              <div class="chat-context-hit-head">
                <strong>{{ match.name || match.id }}</strong>
                <em>{{ match.statusLabel }}</em>
              </div>
              <span>{{ match.meta }}</span>
              <span v-if="match.matchedKeys.length">关键词：{{ match.matchedKeys.join('、') }}</span>
              <span v-if="match.groupLabel">{{ match.groupLabel }}</span>
              <div v-if="match.statefulLabels.length" class="chat-context-tags">
                <span v-for="label in match.statefulLabels" :key="`${match.id}-${label}`">{{ label }}</span>
              </div>
            </li>
          </ul>
          <p v-else class="chat-context-empty">暂无世界书命中</p>
          <div v-if="worldBookDiagnosticGroups.length" class="chat-context-worldbook-diagnostics">
            <strong>分组冲突</strong>
            <article v-for="group in worldBookDiagnosticGroups" :key="group.key">
              <span>{{ group.worldBookName }} · {{ group.name }} · 胜出 {{ group.previewWinnerName }} · 总权重 {{ group.totalWeight }}</span>
              <small v-for="entry in group.entries" :key="entry.id">
                {{ entry.name }} · 权重 {{ entry.weight }} · {{ entry.share }}{{ entry.previewWinner ? ' · 预览胜出' : '' }}
              </small>
            </article>
          </div>
          <div v-if="worldBookDiagnosticMisses.length" class="chat-context-worldbook-diagnostics">
            <strong>未命中诊断</strong>
            <article v-for="item in worldBookDiagnosticMisses" :key="item.key">
              <span>{{ item.worldBookName }} · {{ item.name }} · {{ item.statusLabel }}</span>
              <small>{{ item.keys }}</small>
            </article>
          </div>
        </section>

        <section class="chat-context-section">
          <h3>
            <Brain :size="15" />
            长期记忆
          </h3>
          <div class="chat-context-tags">
            <span>待确认 {{ memoryStats.pending }}</span>
            <span>已启用 {{ memoryStats.enabled }}</span>
            <span>已禁用 {{ memoryStats.disabled }}</span>
          </div>
          <ul v-if="memories.length" class="chat-context-memory-list">
            <li v-for="memory in memories" :key="memory.id">
              <div class="chat-context-memory-copy">
                <span>{{ memoryTypeLabel(memory.memoryType) }} · {{ memoryStateLabel(memory) }}</span>
                <strong v-if="memory.subject">{{ memory.subject }}</strong>
                <p>{{ memory.content }}</p>
                <small v-if="memoryAuditLabel(memory)">{{ memoryAuditLabel(memory) }}</small>
                <small v-if="memory.sourceExcerpt">{{ memory.sourceExcerpt }}</small>
              </div>
              <div class="chat-context-memory-actions">
                <button
                  v-if="canConfirmMemory(memory)"
                  type="button"
                  :disabled="Boolean(memoryActionBusyId)"
                  :aria-busy="isMemoryBusy(memory, 'confirm')"
                  @click="mutateMemory(memory, 'confirm')"
                >
                  <Check :size="14" />
                  确认
                </button>
                <button
                  v-if="canDisableMemory(memory)"
                  type="button"
                  :disabled="Boolean(memoryActionBusyId)"
                  :aria-busy="isMemoryBusy(memory, 'disable')"
                  @click="mutateMemory(memory, 'disable')"
                >
                  <Ban :size="14" />
                  禁用
                </button>
                <button
                  v-if="canRollbackMemory(memory)"
                  type="button"
                  :disabled="Boolean(memoryActionBusyId)"
                  :aria-busy="isMemoryBusy(memory, 'rollback')"
                  @click="mutateMemory(memory, 'rollback')"
                >
                  <RotateCcw :size="14" />
                  回滚
                </button>
              </div>
            </li>
          </ul>
          <p v-else class="chat-context-empty">暂无长期记忆</p>
        </section>

        <section class="chat-context-section">
          <h3>
            <ListTree :size="15" />
            附加上下文
          </h3>
          <ul class="chat-context-extra-list">
            <li v-for="section in contextSections" :key="section.key" :class="{ active: section.active }">
              <strong>{{ section.label }}</strong>
              <p>{{ section.text || '未激活' }}</p>
            </li>
          </ul>
        </section>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.chat-context-inspector-overlay {
  position: fixed;
  inset: 0;
  z-index: 126;
  display: flex;
  justify-content: flex-end;
  background: rgba(15, 23, 42, 0.3);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.chat-context-inspector {
  display: grid;
  width: min(480px, calc(100vw - 20px));
  height: 100%;
  grid-template-rows: auto minmax(0, 1fr);
  border-left: 1px solid color-mix(in srgb, var(--primary) 20%, var(--line));
  color: var(--text);
  background: color-mix(in srgb, var(--surface) 96%, #ffffff 4%);
  box-shadow: -18px 0 54px rgba(15, 23, 42, 0.18);
}

.chat-context-inspector-head,
.chat-context-inspector-actions,
.chat-context-inspector-kicker,
.chat-context-section h3,
.chat-context-hit-head,
.chat-context-memory-actions button {
  display: flex;
  align-items: center;
}

.chat-context-inspector-head {
  justify-content: space-between;
  gap: 14px;
  padding: 18px 18px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--line) 72%, transparent);
}

.chat-context-inspector-kicker {
  gap: 7px;
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 800;
}

.chat-context-inspector-head h2 {
  margin: 5px 0 0;
  font-size: 1.08rem;
  line-height: 1.25;
}

.chat-context-inspector-actions {
  gap: 8px;
}

.chat-context-inspector-icon {
  display: inline-grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--line) 82%, transparent);
  border-radius: 999px;
  color: var(--muted);
  background: color-mix(in srgb, var(--surface-strong) 86%, transparent);
}

.chat-context-inspector-icon:hover:not(:disabled) {
  color: var(--primary);
  border-color: color-mix(in srgb, var(--primary) 30%, var(--line));
  background: var(--primary-soft);
}

.chat-context-inspector-body {
  display: grid;
  gap: 14px;
  align-content: start;
  min-height: 0;
  padding: 16px 18px 20px;
  overflow: auto;
}

.chat-context-inspector-error,
.chat-context-empty {
  margin: 0;
  color: var(--muted);
  font-size: 0.82rem;
  line-height: 1.5;
}

.chat-context-inspector-error {
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, #ef4444 28%, var(--line));
  border-radius: 8px;
  color: #991b1b;
  background: color-mix(in srgb, #fee2e2 80%, var(--surface));
}

.chat-context-section {
  display: grid;
  gap: 10px;
  padding-bottom: 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--line) 60%, transparent);
}

.chat-context-section:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.chat-context-section h3 {
  gap: 7px;
  margin: 0;
  color: var(--text);
  font-size: 0.9rem;
  line-height: 1.35;
}

.chat-context-stat-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.chat-context-stat-grid div,
.chat-context-hit-list li,
.chat-context-message-list li,
.chat-context-truncation-list li,
.chat-context-memory-list li,
.chat-context-extra-list li {
  min-width: 0;
  border: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-strong) 74%, transparent);
}

.chat-context-stat-grid div {
  display: grid;
  gap: 3px;
  padding: 9px 10px;
}

.chat-context-stat-grid dt {
  color: var(--muted);
  font-size: 0.72rem;
}

.chat-context-stat-grid dd {
  margin: 0;
  color: var(--text);
  font-size: 0.94rem;
  font-weight: 850;
  overflow-wrap: anywhere;
}

.chat-context-priority-list,
.chat-context-message-list,
.chat-context-hit-list,
.chat-context-truncation-list,
.chat-context-memory-list,
.chat-context-branch-list,
.chat-context-extra-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.chat-context-priority-list {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  counter-reset: priority;
}

.chat-context-priority-list li {
  min-width: 0;
  color: var(--muted);
  font-size: 0.78rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.chat-context-priority-list li::before {
  counter-increment: priority;
  content: counter(priority) ". ";
  color: var(--primary);
  font-weight: 850;
}

.chat-context-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chat-context-tags span {
  min-height: 24px;
  padding: 4px 8px;
  border: 1px solid color-mix(in srgb, var(--primary) 18%, var(--line));
  border-radius: 999px;
  color: var(--primary);
  background: var(--primary-soft);
  font-size: 0.72rem;
  font-weight: 750;
}

.chat-context-tags span.disabled {
  color: var(--muted);
  border-color: color-mix(in srgb, var(--line) 84%, transparent);
  background: color-mix(in srgb, var(--surface-strong) 70%, transparent);
}

.chat-context-message-list li,
.chat-context-hit-list li,
.chat-context-truncation-list li,
.chat-context-branch-list li,
.chat-context-extra-list li {
  display: grid;
  gap: 4px;
  padding: 10px 11px;
}

.chat-context-message-list strong,
.chat-context-hit-list strong,
.chat-context-truncation-list strong,
.chat-context-branch-main strong,
.chat-context-extra-list strong,
.chat-context-memory-copy strong {
  color: var(--text);
  font-size: 0.82rem;
  overflow-wrap: anywhere;
}

.chat-context-message-list p,
.chat-context-truncation-list p,
.chat-context-branch-list p,
.chat-context-extra-list p,
.chat-context-memory-copy p {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 0.78rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
}

.chat-context-hit-list span,
.chat-context-truncation-list span,
.chat-context-branch-main span,
.chat-context-branch-list small,
.chat-context-memory-copy span,
.chat-context-memory-copy small,
.chat-context-worldbook-diagnostics span,
.chat-context-worldbook-diagnostics small {
  color: var(--muted);
  font-size: 0.72rem;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.chat-context-hit-head {
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.chat-context-hit-head em {
  flex: 0 0 auto;
  max-width: 42%;
  color: var(--primary);
  font-size: 0.72rem;
  font-style: normal;
  font-weight: 850;
  overflow-wrap: anywhere;
}

.chat-context-worldbook-diagnostics {
  display: grid;
  gap: 7px;
}

.chat-context-worldbook-diagnostics > strong {
  color: var(--text);
  font-size: 0.8rem;
}

.chat-context-worldbook-diagnostics article {
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid color-mix(in srgb, var(--line) 68%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 76%, transparent);
}

.chat-context-branch-list li.active {
  border-color: color-mix(in srgb, var(--primary) 36%, var(--line));
  background: color-mix(in srgb, var(--primary-soft) 72%, var(--surface));
}

.chat-context-branch-main {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.chat-context-memory-list li {
  display: grid;
  gap: 10px;
  padding: 11px;
}

.chat-context-memory-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.chat-context-memory-copy small {
  display: block;
  padding-top: 2px;
}

.chat-context-memory-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.chat-context-memory-actions button {
  gap: 5px;
  min-height: 30px;
  padding: 0 9px;
  border: 1px solid color-mix(in srgb, var(--line) 78%, transparent);
  border-radius: 8px;
  color: var(--text);
  background: color-mix(in srgb, var(--surface) 86%, transparent);
  font-size: 0.76rem;
  font-weight: 750;
}

.chat-context-memory-actions button:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--primary) 32%, var(--line));
  background: var(--primary-soft);
}

.chat-context-extra-list li.active {
  border-color: color-mix(in srgb, var(--primary) 28%, var(--line));
}

@media (max-width: 640px) {
  .chat-context-inspector-overlay {
    justify-content: stretch;
  }

  .chat-context-inspector {
    width: 100%;
  }

  .chat-context-stat-grid,
  .chat-context-priority-list {
    grid-template-columns: 1fr;
  }
}
</style>
