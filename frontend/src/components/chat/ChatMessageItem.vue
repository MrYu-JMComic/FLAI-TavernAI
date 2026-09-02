<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import {
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  GitBranch,
  Pencil,
  RotateCcw,
  StepForward,
  Trash2,
  X
} from '@lucide/vue';
import MarkdownContent from '../MarkdownContent.vue';
import { extractHtmlDocument } from '../../utils/htmlDocument.js';
import { useTypewriterText } from '../../composables/useTypewriterText.js';
import HtmlDocumentPreview from './HtmlDocumentPreview.vue';
import { normalizeSafeAttachmentUrl } from '../../utils/attachmentUrls.js';

const props = defineProps({
  message: { type: Object, required: true },
  editingMessageId: { type: String, default: '' },
  editingMessageContent: { type: String, default: '' },
  reasoningOpen: { type: Boolean, default: false },
  authorName: { type: String, default: '' },
  authorInitial: { type: String, default: '?' },
  avatarUrl: { type: String, default: '' },
  canEdit: { type: Boolean, default: false },
  canDelete: { type: Boolean, default: false },
  canRerunEdit: { type: Boolean, default: false },
  canContinue: { type: Boolean, default: false },
  branchCan: { type: Boolean, default: true },
  messageActionBusy: { type: Boolean, default: false },
  copyBusy: { type: Boolean, default: false },
  renderPlugins: { type: Array, default: () => [] },
  swipeDisplay: { type: String, default: '' },
  swipeCanPrev: { type: Boolean, default: false },
  swipeCanNext: { type: Boolean, default: false },
  swipeLoading: { type: Boolean, default: false },
  branchBusy: { type: Boolean, default: false },
  worldBookMatchCount: { type: Number, default: 0 }
});

const emit = defineEmits([
  'toggle-reasoning',
  'begin-edit',
  'cancel-edit',
  'save-edit',
  'save-edit-rerun',
  'continue-generation',
  'delete',
  'copy',
  'update:editingMessageContent',
  'swipe-prev',
  'swipe-next',
  'branch',
  'open-worldbook-matches',
  'typing-progress'
]);

const editTextareaRef = ref(null);
const isEditingCurrentMessage = computed(() => props.editingMessageId === props.message.id);
const messageAttachments = computed(() => normalizeMessageAttachments(props.message?.attachments));
const reasoningStreaming = computed(() => (
  props.message?.role === 'assistant' && props.message?.reasoningStreaming === true
));
const contentStreaming = computed(() => (
  props.message?.role === 'assistant' && props.message?.contentStreaming === true
));
const reasoningSource = computed(() => String(props.message?.reasoning || ''));
const contentSource = computed(() => String(props.message?.content || ''));
const { displayedText: displayedReasoning, isTyping: isReasoningTyping } = useTypewriterText(
  reasoningSource,
  reasoningStreaming
);
const { displayedText: displayedContent, isTyping: isContentTyping } = useTypewriterText(
  contentSource,
  contentStreaming
);
const messagePlaceholder = computed(() => {
  if (!props.message?.streaming) return '';
  return props.message?.reasoning && !props.message?.content
    ? '正在思考，答案马上开始...'
    : '正在生成...';
});
const htmlDocumentContent = computed(() => {
  if (props.message?.role !== 'assistant' || isContentTyping.value) return '';
  return extractHtmlDocument(props.message?.content);
});

function emitMessageAction(eventName) {
  emit(eventName, props.message);
}

function emitReasoningRendered() {
  if (isReasoningTyping.value) emit('typing-progress', props.message);
}

function emitContentRendered() {
  if (isContentTyping.value) emit('typing-progress', props.message);
}

function normalizeMessageAttachments(attachments = []) {
  const normalized = [];
  const source = Array.isArray(attachments) ? attachments : [];
  for (const attachment of source) {
    const url = String(attachment?.url || attachment?.dataUrl || '').trim();
    const safeUrl = normalizeSafeAttachmentUrl(url);
    if (!safeUrl) {
      continue;
    }
    normalized.push({
      id: String(attachment.id || url.slice(0, 48)),
      url: safeUrl,
      alt: String(attachment.alt || attachment.name || '聊天图片').trim() || '聊天图片'
    });
  }
  return normalized;
}

function onEditingMessageInput(event) {
  const target = event?.target;
  if (!target || target.value === undefined) {
    return;
  }
  emit('update:editingMessageContent', target.value);
}

watch(isEditingCurrentMessage, async (active) => {
  if (!active) {
    return;
  }
  await nextTick();
  editTextareaRef.value?.focus?.();
});
</script>

<template>
  <article
    class="deep-message"
    :class="message.role"
    :data-message-id="message.id"
  >
    <div v-if="message.role === 'assistant'" class="deep-message-author" aria-hidden="true">
      <span class="deep-message-avatar">
        <img v-if="avatarUrl" :src="avatarUrl" alt="" />
        <span v-else>{{ authorInitial }}</span>
      </span>
      <small>{{ authorName }}</small>
    </div>
    <div class="deep-message-content">
      <div class="deep-message-name">{{ authorName }}</div>
      <div v-if="message.role === 'assistant' && message.reasoning" class="reasoning-block">
        <button class="reasoning-toggle" type="button" @click="emit('toggle-reasoning', message.id)">
          <Brain :size="16" />
          <span>{{ isReasoningTyping ? '正在思考' : '已思考' }}</span>
          <small v-if="message.reasoning.length">约 {{ message.reasoning.length }} 字</small>
          <ChevronDown v-if="reasoningOpen" :size="16" />
          <ChevronRight v-else :size="16" />
        </button>
        <div
          v-if="reasoningOpen"
          class="reasoning-body"
          :class="{ 'is-typing': isReasoningTyping }"
        >
          <MarkdownContent
            class="typing-text"
            :text="displayedReasoning"
            :render-plugins="renderPlugins"
            :defer-updates="isReasoningTyping"
            @rendered="emitReasoningRendered"
          />
        </div>
      </div>

      <div
        class="deep-bubble"
        :class="{
          'is-typing': isContentTyping,
          'is-waiting': isContentTyping && !displayedContent && !messageAttachments.length,
          'is-editing': editingMessageId === message.id,
          'has-html-document': Boolean(htmlDocumentContent) && !isContentTyping && editingMessageId !== message.id
        }"
      >
        <div v-if="editingMessageId === message.id" class="message-edit-box" :aria-busy="messageActionBusy">
          <textarea
            ref="editTextareaRef"
            :value="editingMessageContent"
            aria-label="编辑消息内容"
            rows="4"
            :disabled="messageActionBusy"
            @input="onEditingMessageInput"
            @keydown.esc.prevent="emit('cancel-edit', message)"
          />
          <div class="message-edit-actions">
            <button type="button" class="message-action-button primary" :disabled="messageActionBusy" :aria-busy="messageActionBusy" @click="emit('save-edit', message)">
              <Check :size="15" />
              <span>保存</span>
            </button>
            <button
              v-if="canRerunEdit"
              type="button"
              class="message-action-button primary"
              :disabled="messageActionBusy"
              :aria-busy="messageActionBusy"
              @click="emit('save-edit-rerun', message)"
            >
              <RotateCcw :size="15" />
              <span>保存并重跑</span>
            </button>
            <button type="button" class="message-action-button" :disabled="messageActionBusy" @click="emit('cancel-edit', message)">
              <X :size="15" />
              <span>取消</span>
            </button>
          </div>
        </div>
        <template v-else>
          <div v-if="messageAttachments.length" class="message-attachments">
            <a
              v-for="attachment in messageAttachments"
              :key="attachment.id"
              :href="attachment.url"
              target="_blank"
              rel="noopener noreferrer"
              class="message-attachment"
            >
              <img :src="attachment.url" :alt="attachment.alt" />
            </a>
          </div>
          <HtmlDocumentPreview
            v-if="htmlDocumentContent && !isContentTyping"
            :source="htmlDocumentContent"
          />
          <MarkdownContent
            v-else-if="displayedContent || messagePlaceholder"
            class="typing-text"
            :text="displayedContent || messagePlaceholder"
            :render-plugins="renderPlugins"
            :defer-updates="isContentTyping"
            @rendered="emitContentRendered"
          />
        </template>
      </div>
      <div class="message-actions" :class="message.role">
        <div class="message-action-list" role="group" aria-label="消息操作">
          <button
            type="button"
            class="message-action-button"
            title="复制消息"
            :disabled="copyBusy"
            :aria-busy="copyBusy"
            @click="emitMessageAction('copy')"
          >
            <Copy :size="14" />
            <span>复制</span>
          </button>
          <button
            type="button"
            class="message-action-button"
            title="编辑消息"
            :disabled="!canEdit"
            @click="emitMessageAction('begin-edit')"
          >
            <Pencil :size="14" />
            <span>编辑</span>
          </button>
          <button
            type="button"
            class="message-action-button danger"
            title="删除消息"
            :disabled="!canDelete"
            @click="emitMessageAction('delete')"
          >
            <Trash2 :size="14" />
            <span>删除</span>
          </button>
          <button
            v-if="canContinue"
            type="button"
            class="message-action-button primary continue-message-button"
            aria-label="继续生成"
            title="继续生成"
            @click="emitMessageAction('continue-generation')"
          >
            <StepForward :size="14" />
            <span>继续</span>
          </button>
          <button
            v-if="worldBookMatchCount > 0"
            type="button"
            class="message-action-button"
            data-worldbook-match-button
            :title="`世界书命中来源（${worldBookMatchCount} 条）`"
            :aria-label="`查看世界书命中来源，共 ${worldBookMatchCount} 条`"
            @click.stop="emitMessageAction('open-worldbook-matches')"
          >
            <BookOpen :size="14" />
            <span>世界书</span>
          </button>
          <button
            v-if="swipeDisplay"
            class="message-action-button swipe-nav"
            type="button"
            aria-label="上一条候选回复"
            :disabled="!swipeCanPrev || swipeLoading"
            :aria-busy="swipeLoading"
            title="上一条候选"
            @click.stop="emitMessageAction('swipe-prev')"
          >
            <ChevronLeft :size="14" />
          </button>
          <span v-if="swipeDisplay" class="swipe-counter" :title="`候选回复 ${swipeDisplay}`">候选 {{ swipeDisplay }}</span>
          <button
            v-if="swipeDisplay"
            class="message-action-button swipe-nav"
            type="button"
            aria-label="下一条候选回复"
            :disabled="!swipeCanNext || swipeLoading"
            :aria-busy="swipeLoading"
            title="下一条候选"
            @click.stop="emitMessageAction('swipe-next')"
          >
            <ChevronRight :size="14" />
          </button>
          <button
            class="message-action-button"
            type="button"
            aria-label="从此消息创建分支对话"
            :disabled="!branchCan || branchBusy"
            title="从此消息创建分支对话"
            @click.stop="emitMessageAction('branch')"
          >
            <GitBranch :size="14" />
          </button>
        </div>
      </div>
    </div>
    <div v-if="message.role === 'user'" class="deep-message-author user" aria-hidden="true">
      <span class="deep-message-avatar">
        <img v-if="avatarUrl" :src="avatarUrl" alt="" />
        <span v-else>{{ authorInitial }}</span>
      </span>
      <small>{{ authorName }}</small>
    </div>
  </article>
</template>
