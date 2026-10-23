<script setup>
import { computed } from 'vue';
import { AlertCircle, BookOpen, CheckCircle2, ChevronDown, ClipboardList, LoaderCircle, PauseCircle, Send, SlidersHorizontal } from '@lucide/vue';
import AiPlanReview from '../AiPlanReview.vue';
import MarkdownContent from '../MarkdownContent.vue';
import WorldBookChanges from './WorldBookChanges.vue';
import WorldBookTargetPicker from './WorldBookTargetPicker.vue';
import { WORLD_BOOK_AI_SECTION_LABELS } from '../../utils/aiSectionLabels.js';

const props = defineProps({
  context: { type: Object, required: true },
  books: { type: Array, default: () => [] },
  selectedIds: { type: Array, default: () => [] },
  automatic: { type: Boolean, default: true },
  changes: { type: Array, default: () => [] },
  history: { type: Array, default: () => [] },
  targets: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  saving: { type: Boolean, default: false },
  modelOptions: { type: Array, default: () => [] },
  plan: { type: Object, default: null },
  planExtraRequirement: { type: String, default: '' },
  planMode: { type: Boolean, default: false },
  planPhase: { type: String, default: 'idle' },
  planStepStatus: { type: Function, default: () => '' },
  process: { type: Array, default: () => [] },
  reasoning: { type: String, default: '' },
  requirement: { type: String, default: '' },
  assistantModel: { type: String, default: '' },
  status: { type: String, default: 'idle' },
  statusMessage: { type: String, default: '' },
  streamingEnabled: { type: Boolean, default: false },
  thinkingLevel: { type: String, default: 'off' },
  thinkingOptions: { type: Array, default: () => [] },
  thinkingSupported: { type: Boolean, default: false },
  toolCalls: { type: Array, default: () => [] }
});
const emit = defineEmits(['complete','apply','reload','discard','new-book','discard-plan','execute-plan','replan','set-context','stop','toggle-plan-step','update-plan-step','update:assistantModel','update:planExtraRequirement','update:planMode','update:requirement','update:streamingEnabled','update:thinkingLevel','update:selectedIds','update:automatic']);
const busy = computed(() => props.loading || props.saving);
const hasPlan = computed(() => Boolean(props.plan?.steps?.length));
const planFirst = computed(() => props.planMode && props.planPhase !== 'review');
const statusText = computed(() => ({running:'运行中',review:'待审批',paused:'已暂停',failed:'需处理',completed:'已完成'})[props.status] || '待开始');
const selectedByAssistant = computed(() => props.targets.filter(target => target.bookId && !props.selectedIds.includes(target.bookId)));
function format(value) { return typeof value === 'string' ? value : JSON.stringify(value, null, 2); }
</script>

<template>
  <section class="form-panel worldbook-ai-panel" :aria-busy="loading">
    <header class="worldbook-assistant-header">
      <div><h2><BookOpen :size="19" />世界书助手</h2><p>通过对话查阅、更新设定，也可随时创建新书。</p></div>
      <span class="ai-workbench-status" :class="status" aria-live="polite">
        <LoaderCircle v-if="status === 'running'" :size="14" />
        <CheckCircle2 v-else-if="status === 'completed'" :size="14" />
        <PauseCircle v-else-if="status === 'paused'" :size="14" />
        <AlertCircle v-else-if="status === 'failed'" :size="14" />
        <ClipboardList v-else :size="14" />
        {{ statusText }}
      </span>
    </header>
    <WorldBookTargetPicker :books="books" :selected-ids="selectedIds" :automatic="automatic" :busy="busy" @update:selected-ids="emit('update:selectedIds', $event)" @update:automatic="emit('update:automatic', $event)" @new-book="emit('new-book')" />
    <p v-if="selectedByAssistant.length" class="worldbook-discovered" aria-live="polite">助手已读取：{{ selectedByAssistant.map(target => target.profile?.name).join('、') }}</p>
    <div class="worldbook-assistant-grid" :class="{ 'has-results': changes.length || hasPlan }">
      <section class="worldbook-conversation" aria-label="世界书助手对话">
        <div v-if="history.length" class="worldbook-messages" role="log" aria-label="本次助手对话">
          <article v-for="(message, index) in history" :key="index" class="worldbook-message" :class="message.role">
            <small>{{ message.role === 'user' ? '你' : '助手' }}</small>
            <p v-if="message.role === 'user'">{{ message.content }}</p>
            <MarkdownContent v-else :text="message.content" />
          </article>
        </div>
        <p v-else class="worldbook-assistant-empty">选择已有书后描述要调整的内容，或让助手按对话查找。例如：“补充雾港的夜间规则，另外创建一本远航手册。”</p>
        <p v-if="statusMessage && (loading || status === 'failed' || status === 'paused' || !history.length)" class="worldbook-ai-status" aria-live="polite">{{ statusMessage }}</p>
        <label class="field"><span>{{ history.length ? '继续补充要求' : '世界书需求' }}</span><textarea :value="requirement" rows="4" placeholder="描述要查阅、更新或新建的内容..." :disabled="busy" @input="emit('update:requirement', $event.target.value)" /></label>
        <div class="worldbook-send-row">
          <small>未应用的修改会继续保留</small>
          <button v-if="loading" class="ghost-button" type="button" @click="emit('stop')">暂停</button>
          <button v-else class="primary-button" type="button" :disabled="busy || !requirement.trim()" @click="emit('complete')">
            <ClipboardList v-if="planFirst" :size="17" />
            <Send v-else :size="17" />
            {{ planFirst ? '生成计划' : '发送' }}
          </button>
        </div>
        <details class="ai-scope-disclosure worldbook-assistant-settings">
          <summary><span class="ai-scope-summary-title"><SlidersHorizontal :size="15" />模型与运行设置</span><ChevronDown :size="15" /></summary>
          <div class="ai-config-row">
            <label class="field"><span>助手模型</span><select :value="assistantModel" :disabled="busy" @change="emit('update:assistantModel', $event.target.value)"><option v-for="model in modelOptions" :key="model.id || '__global'" :value="model.id">{{ model.label || model.id }}</option></select></label>
            <label class="field"><span>思考强度</span><select :value="thinkingLevel" :disabled="busy || !thinkingSupported" @change="emit('update:thinkingLevel', $event.target.value)"><option v-if="!thinkingOptions.length" value="off">当前模型不支持</option><option v-for="option in thinkingOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
          </div>
          <div class="worldbook-runtime-options"><label><input type="checkbox" :checked="streamingEnabled" :disabled="busy" @change="emit('update:streamingEnabled', $event.target.checked)">流式显示</label><label><input type="checkbox" :checked="planMode" :disabled="busy" @change="emit('update:planMode', $event.target.checked)">先生成计划</label></div>
          <div class="ai-config-row"><label class="field"><span>最大工具轮数</span><input type="number" min="1" max="100" :value="context.maxRounds" :disabled="busy" @change="emit('set-context', 'maxRounds', $event.target.value)"></label><label class="field"><span>单次生成条目上限</span><input type="number" min="1" max="30" :value="context.entryLimit" :disabled="busy" @change="emit('set-context', 'entryLimit', $event.target.value)"></label></div>
        </details>
      </section>
      <aside v-if="changes.length || hasPlan" class="worldbook-assistant-results" aria-label="助手结果">
        <AiPlanReview v-if="hasPlan" :busy="busy" :extra-requirement="planExtraRequirement" :phase="planPhase" :plan="plan" :section-labels="WORLD_BOOK_AI_SECTION_LABELS" :step-status="planStepStatus" @discard="emit('discard-plan')" @execute="emit('execute-plan')" @replan="emit('replan')" @toggle-step="(id, selected) => emit('toggle-plan-step', id, selected)" @update-step="(id, patch) => emit('update-plan-step', id, patch)" @update:extra-requirement="emit('update:planExtraRequirement', $event)" />
        <WorldBookChanges :changes="changes" :busy="busy" @apply="emit('apply', $event)" @reload="emit('reload', $event)" @discard="emit('discard', $event)" />
      </aside>
    </div>
    <details v-if="process.length || toolCalls.length" class="worldbook-process-disclosure">
      <summary>运行详情 · {{ process.length }} 轮 · {{ toolCalls.length }} 次工具调用</summary>
      <p v-if="reasoning" class="ai-process-text">{{ reasoning }}</p>
      <details v-for="(step, index) in process" :key="step.round || index" class="ai-process-step"><summary>第 {{ step.round || index + 1 }} 轮 · {{ step.tools?.length || 0 }} 个工具</summary><p v-if="step.content" class="ai-process-text">{{ step.content }}</p><p v-if="step.reasoning" class="ai-process-text">{{ step.reasoning }}</p><details v-for="(call, callIndex) in step.tools || []" :key="callIndex" class="ai-tool-detail"><summary>{{ call.name }} · {{ call.result?.ok === false ? '需处理' : '完成' }}</summary><pre>{{ format(call.arguments) }}</pre><pre>{{ format(call.result) }}</pre></details></details>
    </details>
  </section>
</template>

<style scoped>
.worldbook-ai-panel { display: grid; gap: 16px; min-width: 0; }
.worldbook-assistant-header, .worldbook-assistant-header h2 { display: flex; align-items: center; gap: 9px; }
.worldbook-assistant-header { justify-content: space-between; align-items: flex-start; }
.worldbook-assistant-header h2 { margin: 0; font-size: 1.12rem; }
.worldbook-assistant-header p { margin: 5px 0 0; font-size: .8rem; color: var(--muted); }
.worldbook-assistant-grid { display: grid; gap: 20px; min-width: 0; }
.worldbook-assistant-grid.has-results { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.worldbook-conversation, .worldbook-assistant-results { min-width: 0; display: flex; flex-direction: column; gap: 13px; }
.worldbook-assistant-results { padding-left: 18px; border-left: 1px solid var(--line); }
.worldbook-messages { display: grid; gap: 12px; max-height: 380px; overflow-y: auto; }
.worldbook-message { padding: 10px 12px; border-radius: 10px; background: var(--surface-strong); overflow-wrap: anywhere; font-size: .84rem; }
.worldbook-message.assistant { background: transparent; padding-left: 0; }
.worldbook-message small { color: var(--muted); font-size: .72rem; }
.worldbook-message > p { margin: 4px 0 0; white-space: pre-wrap; }
.worldbook-message > .markdown-content { margin-top: 4px; white-space: normal; }
.worldbook-assistant-empty, .worldbook-discovered { margin: 0; font-size: .81rem; line-height: 1.75; color: var(--muted); }
.worldbook-send-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.worldbook-send-row small { color: var(--muted); font-size: .74rem; }
.worldbook-runtime-options { display: flex; gap: 16px; flex-wrap: wrap; margin: 12px 0; font-size: .8rem; }
.worldbook-runtime-options label { display: flex; align-items: center; gap: 6px; }
.worldbook-runtime-options input[type="checkbox"] { width: 16px; height: 16px; min-height: 16px; flex: 0 0 16px; padding: 0; accent-color: var(--primary); }
.worldbook-assistant-settings > summary { display: flex; align-items: center; justify-content: space-between; cursor: pointer; font-size: .8rem; }
.worldbook-process-disclosure { border-top: 1px solid var(--line); padding-top: 12px; min-width: 0; }
.worldbook-process-disclosure > summary { cursor: pointer; font-size: .78rem; color: var(--muted); }
.worldbook-process-disclosure pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 260px; overflow-y: auto; }
@media (max-width: 900px) { .worldbook-assistant-grid.has-results { grid-template-columns: minmax(0, 1fr); } .worldbook-assistant-results { padding: 16px 0 0; border-left: 0; border-top: 1px solid var(--line); } }
</style>
