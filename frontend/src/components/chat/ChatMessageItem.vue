<script setup>
import {
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  GitBranch,
  Pencil,
  Trash2,
  X
} from '@lucide/vue';
import MarkdownContent from '../MarkdownContent.vue';

const props = defineProps({
  message: { type: Object, required: true },
  editingMessageId: { type: String, default: '' },
  editingMessageContent: { type: String, default: '' },
  reasoningOpen: { type: Boolean, default: false },
  isReasoningTyping: { type: Boolean, default: false },
  isContentTyping: { type: Boolean, default: false },
  messagePlaceholder: { type: String, default: '' },
  authorName: { type: String, default: '' },
  authorInitial: { type: String, default: '?' },
  avatarUrl: { type: String, default: '' },
  canEdit: { type: Boolean, default: false },
  canDelete: { type: Boolean, default: false },
  renderPlugins: { type: Array, default: () => [] },
  swipeDisplay: { type: String, default: '' },
  swipeCanPrev: { type: Boolean, default: false },
  swipeCanNext: { type: Boolean, default: false },
  swipeLoading: { type: Boolean, default: false },
  branchBusy: { type: Boolean, default: false }
});

const emit = defineEmits([
  'toggle-reasoning',
  'begin-edit',
  'cancel-edit',
  'save-edit',
  'delete',
  'copy',
  'update:editingMessageContent',
  'swipe-prev',
  'swipe-next',
  'branch'
]);
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
          <MarkdownContent class="typing-text" :text="message.reasoning" :render-plugins="renderPlugins" />
        </div>
      </div>

      <div
        class="deep-bubble"
        :class="{
          'is-typing': isContentTyping,
          'is-waiting': isContentTyping && !message.content,
          'is-editing': editingMessageId === message.id
        }"
      >
        <div v-if="editingMessageId === message.id" class="message-edit-box">
          <textarea
            :value="editingMessageContent"
            aria-label="编辑消息内容"
            rows="4"
            @input="emit('update:editingMessageContent', $event.target.value)"
            @keydown.esc.prevent="emit('cancel-edit', message)"
          />
          <div class="message-edit-actions">
            <button type="button" class="message-action-button primary" @click="emit('save-edit', message)">
              <Check :size="15" />
              <span>保存</span>
            </button>
            <button type="button" class="message-action-button" @click="emit('cancel-edit', message)">
              <X :size="15" />
              <span>取消</span>
            </button>
          </div>
        </div>
        <MarkdownContent
          v-else
          class="typing-text"
          :text="message.content || messagePlaceholder"
          :render-plugins="renderPlugins"
        />
      </div>
      <div class="message-actions" :class="message.role">
        <button
          type="button"
          class="message-action-button"
          title="复制消息"
          @click="emit('copy', message)"
        >
          <Copy :size="14" />
          <span>复制</span>
        </button>
        <button
          type="button"
          class="message-action-button"
          title="编辑消息"
          :disabled="!canEdit"
          @click="emit('begin-edit', message)"
        >
          <Pencil :size="14" />
          <span>编辑</span>
        </button>
        <button
          type="button"
          class="message-action-button danger"
          title="删除消息"
          :disabled="!canDelete"
          @click="emit('delete', message)"
        >
          <Trash2 :size="14" />
          <span>删除</span>
        </button>
        <button
          v-if="swipeDisplay"
          class="message-action-button swipe-nav"
          type="button"
          aria-label="上一条候选回复"
          :disabled="!swipeCanPrev"
          title="上一条候选"
          @click.stop="emit('swipe-prev', message)"
        >
          <ChevronLeft :size="14" />
        </button>
        <span v-if="swipeDisplay" class="swipe-counter">{{ swipeDisplay }}</span>
        <button
          v-if="swipeDisplay || swipeCanNext"
          class="message-action-button swipe-nav"
          type="button"
          aria-label="下一条候选或生成新候选"
          :disabled="swipeLoading"
          title="下一条候选 / 生成新候选"
          @click.stop="emit('swipe-next', message)"
        >
          <ChevronRight :size="14" />
        </button>
        <button
          class="message-action-button"
          type="button"
          aria-label="从此消息创建分支对话"
          :disabled="branchBusy"
          title="从此消息创建分支对话"
          @click.stop="emit('branch', message)"
        >
          <GitBranch :size="14" />
        </button>
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
