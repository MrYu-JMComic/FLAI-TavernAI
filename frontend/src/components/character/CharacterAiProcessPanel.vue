<script setup>
import { computed } from 'vue';
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  Circle,
  ListChecks,
  LoaderCircle,
  TriangleAlert,
  Wrench
} from '@lucide/vue';
import { countOwnObjectKeys } from '../../utils/objectKeys';

const props = defineProps({
  loading: { type: Boolean, default: false },
  process: { type: Array, default: () => [] },
  reasoning: { type: String, default: '' },
  status: { type: String, default: 'idle' },
  statusMessage: { type: String, default: '' },
  toolCalls: { type: Array, default: () => [] }
});

const TOOL_LABELS = Object.freeze({
  update_character_profile: '更新基础资料',
  update_character_story: '完善角色叙事',
  replace_character_regex_rules: '验收正则规则',
  replace_character_render_plugins: '验收渲染插件',
  update_character_status_bar: '配置状态栏',
  update_character_agents: '配置附属 Agent',
  update_character_presentation: '更新角色外观',
  set_character_recommendations: '整理扩展建议',
  report_character_progress: '汇报阶段进度',
  finish_character_draft: '完成结构验收',
  set_character_profile: '更新角色设定',
  add_regex_rule: '添加正则规则',
  replace_regex_rules: '替换正则规则',
  set_character_extensions: '更新扩展设置'
});
const STAGE_LABELS = Object.freeze({
  analyzing: '分析任务',
  drafting: '分轮完善',
  reviewing: '检查结果',
  resuming: '衔接进度'
});
const TOOL_ERROR_LABELS = Object.freeze({
  ROUND_ACTION_LIMIT: '已排入下一轮',
  PENDING_ACTION_REQUIRED: '等待前序动作',
  PENDING_ACTIONS_REMAIN: '仍需继续完善',
  SECTION_NOT_ENABLED: '未写入',
  TOOL_ARGUMENTS_INVALID: '参数需修正'
});

function formatAiValue(value) {
  if (value === null || value === undefined || value === '') return '空';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toolResultLabel(result = {}) {
  if (result?.ok === false) return TOOL_ERROR_LABELS[result.error] || '执行失败';
  if (result?.skipped) return '已跳过重复调用';
  if (result?.stage) return '进度已更新';
  if (typeof result?.count === 'number') return `写入 ${result.count} 项`;
  if (result?.applied && typeof result.applied === 'object') return `更新 ${countOwnObjectKeys(result.applied)} 项`;
  if (result?.rule?.label) return `规则：${result.rule.label}`;
  return result?.ok === true ? '成功' : '已返回';
}

function toolLabel(name) {
  return TOOL_LABELS[name] || name || '未知工具';
}

function stepState(step = {}) {
  if (step.tools?.some((call) => call?.result?.ok === false)) return 'warning';
  if (step.state) return step.state;
  return props.loading ? 'running' : 'complete';
}

function isLatestStep(index) {
  return index === props.process.length - 1;
}

function progressForStep(step = {}) {
  const tools = Array.isArray(step.tools) ? step.tools : [];
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    const call = tools[index];
    if (call?.name !== 'report_character_progress') continue;
    return {
      stage: String(call.result?.stage || call.arguments?.stage || ''),
      summary: String(call.result?.summary || call.arguments?.summary || '').trim(),
      nextAction: String(call.result?.nextAction || call.arguments?.nextAction || '').trim()
    };
  }
  return null;
}

function primaryToolForStep(step = {}) {
  const tools = Array.isArray(step.tools) ? step.tools : [];
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    const call = tools[index];
    if (call?.name === 'report_character_progress') continue;
    if (call?.result?.skipped === true) continue;
    return call;
  }
  return null;
}

function stepTitle(step = {}, index = 0) {
  const primaryTool = primaryToolForStep(step);
  if (primaryTool?.result?.error === 'ROUND_ACTION_LIMIT') return '已排入下一轮';
  if (primaryTool?.result?.error === 'PENDING_ACTIONS_REMAIN') return '等待补全前序动作';
  if (primaryTool) return toolLabel(primaryTool.name);
  const progress = progressForStep(step);
  if (progress?.stage) return STAGE_LABELS[progress.stage] || '更新阶段进度';
  return stepState(step) === 'running' ? '模型处理中' : `第 ${step.round || index + 1} 轮`;
}

function stepSummary(step = {}) {
  const progress = progressForStep(step);
  if (progress?.summary) return progress.summary;
  const primaryTool = primaryToolForStep(step);
  if (primaryTool?.result?.message) return String(primaryTool.result.message);
  if (Array.isArray(primaryTool?.result?.sections) && primaryTool.result.sections.length) {
    return `已处理：${primaryTool.result.sections.join('、')}`;
  }
  return '';
}

function stepNextAction(step = {}) {
  return progressForStep(step)?.nextAction || '';
}

function compactReasoning(value) {
  const text = String(value || '').replace(/\r\n/g, '\n').trim();
  if (text.length <= 1200) return text;
  return `…${text.slice(-1200)}`;
}

const latestSummary = computed(() => {
  if (props.statusMessage) return props.statusMessage;
  for (let index = props.process.length - 1; index >= 0; index -= 1) {
    const step = props.process[index];
    const summary = String(step?.content || step?.reasoning || '').trim();
    if (summary) return summary;
  }
  if (String(props.reasoning || '').trim()) return String(props.reasoning).trim();
  if (props.toolCalls.length) return '工具调用已完成，可展开查看参数和返回结果。';
  return '等待模型返回运行过程...';
});

const liveReasoning = computed(() => {
  for (let index = props.process.length - 1; index >= 0; index -= 1) {
    const value = String(props.process[index]?.reasoning || '').trim();
    if (value) return value;
  }
  return String(props.reasoning || '').trim();
});

const latestProgress = computed(() => {
  for (let index = props.process.length - 1; index >= 0; index -= 1) {
    const progress = progressForStep(props.process[index]);
    if (progress) return progress;
  }
  return null;
});

const liveStage = computed(() => {
  if (latestProgress.value?.stage) return STAGE_LABELS[latestProgress.value.stage] || '处理中';
  if (props.status === 'completed') return '完成验收';
  if (props.status === 'failed') return '等待处理';
  return props.loading ? '模型处理中' : '阶段记录';
});

const liveSummary = computed(() => (
  latestProgress.value?.summary
  || props.statusMessage
  || stepSummary(props.process.at(-1) || {})
  || '正在读取当前草稿并决定下一项操作'
));

const liveNextAction = computed(() => latestProgress.value?.nextAction || '完成当前回合后将自动衔接下一项任务');
const reasoningPreview = computed(() => compactReasoning(liveReasoning.value));
const completedToolCount = computed(() => props.toolCalls.filter((call) => (
  call?.result?.ok !== false && call?.result?.skipped !== true
)).length);
</script>

<template>
  <div class="ai-process-panel">
    <p class="ai-process-summary">{{ latestSummary }}</p>

    <section v-if="loading" class="ai-thinking-status" aria-label="模型当前处理阶段">
      <header>
        <BrainCircuit :size="15" />
        <strong>当前阶段</strong>
        <span class="ai-thinking-stage">{{ liveStage }}</span>
        <span class="ai-live-pulse" aria-hidden="true"></span>
      </header>
      <p class="ai-thinking-summary">{{ liveSummary }}</p>
      <div class="ai-thinking-next">
        <ArrowRight :size="14" />
        <span>{{ liveNextAction }}</span>
      </div>
      <details v-if="reasoningPreview" class="ai-thinking-activity">
        <summary>
          <span>查看模型活动</span>
          <ChevronDown :size="14" />
        </summary>
        <p>{{ reasoningPreview }}</p>
      </details>
    </section>

    <!-- The trace title, the run counts and the expander share one row so the
         monitor never repeats the same status on three stacked lines. -->
    <details class="ai-process-disclosure" :open="loading">
      <summary class="ai-process-header">
        <span class="ai-tool-title">
          <ListChecks :size="15" />
          <span>执行轨迹</span>
        </span>
        <small>{{ process.length }} 轮 · {{ completedToolCount }} 完成 / {{ toolCalls.length }} 调用</small>
        <ChevronDown class="ai-process-caret" :size="15" aria-hidden="true" />
      </summary>
      <div class="ai-process-detail-scroll">
        <div v-if="reasoning && !process.some((step) => step.reasoning)" class="ai-reasoning-box">
          <strong>模型活动</strong>
          <p>{{ compactReasoning(reasoning) }}</p>
        </div>

        <article
          v-for="(step, stepIndex) in process"
          :key="`step-${step.round || stepIndex}`"
          class="ai-process-step"
          :class="stepState(step)"
        >
          <header class="ai-process-step-head">
            <span class="ai-step-state-icon" aria-hidden="true">
              <LoaderCircle v-if="stepState(step) === 'running' && isLatestStep(stepIndex)" :size="15" />
              <TriangleAlert v-else-if="stepState(step) === 'warning'" :size="15" />
              <CheckCircle2 v-else-if="stepState(step) === 'complete'" :size="15" />
              <Circle v-else :size="15" />
            </span>
            <strong>{{ stepTitle(step, stepIndex) }}</strong>
            <small>第 {{ step.round || stepIndex + 1 }} 轮 · {{ step.tools?.length || 0 }} 调用</small>
          </header>
          <div v-if="stepSummary(step)" class="ai-step-brief">
            <p>{{ stepSummary(step) }}</p>
            <small v-if="stepNextAction(step)">
              <ArrowRight :size="13" />
              {{ stepNextAction(step) }}
            </small>
          </div>
          <details v-if="step.reasoning" class="ai-reasoning-disclosure">
            <summary><BrainCircuit :size="14" />模型活动<ChevronDown :size="13" /></summary>
            <p class="ai-process-text">{{ compactReasoning(step.reasoning) }}</p>
          </details>
          <p v-if="step.content" class="ai-process-text ai-model-note">{{ step.content }}</p>
          <p v-if="!step.reasoning && !step.content && !step.tools?.length" class="ai-process-text empty">等待模型返回本轮流程...</p>
          <div v-if="step.tools?.length" class="ai-tool-detail-list">
            <details v-for="(call, index) in step.tools" :key="`${call.name}-${index}`" class="ai-tool-detail">
              <summary>
                <span><Wrench :size="14" />{{ toolLabel(call.name) }}</span>
                <small>{{ toolResultLabel(call.result) }}</small>
              </summary>
              <div class="ai-tool-technical-name">{{ call.name }}</div>
              <strong>参数</strong>
              <pre>{{ formatAiValue(call.arguments) }}</pre>
              <strong>结果</strong>
              <pre>{{ formatAiValue(call.result) }}</pre>
            </details>
          </div>
        </article>
        <div v-if="!process.length && toolCalls.length" class="ai-tool-detail-list standalone">
          <details v-for="(call, index) in toolCalls" :key="`${call.name}-${index}`" class="ai-tool-detail">
            <summary>
              <span><Wrench :size="14" />{{ toolLabel(call.name) }}</span>
              <small>{{ toolResultLabel(call.result) }}</small>
            </summary>
            <div class="ai-tool-technical-name">{{ call.name }}</div>
            <strong>参数</strong>
            <pre>{{ formatAiValue(call.arguments) }}</pre>
            <strong>结果</strong>
            <pre>{{ formatAiValue(call.result) }}</pre>
          </details>
        </div>
      </div>
    </details>
  </div>
</template>
