<script setup>
import { computed } from 'vue';
import MarkdownContent from '../MarkdownContent.vue';
import {
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ListChecks,
  LoaderCircle,
  MessageCircle,
  TriangleAlert,
  Wrench
} from '@lucide/vue';
import { countOwnObjectKeys } from '../../utils/objectKeys';

const props = defineProps({
  loading: { type: Boolean, default: false },
  finalContent: { type: String, default: '' },
  process: { type: Array, default: () => [] },
  reasoning: { type: String, default: '' },
  status: { type: String, default: 'idle' },
  statusMessage: { type: String, default: '' },
  toolCalls: { type: Array, default: () => [] }
});

const TOOL_LABELS = Object.freeze({
  update_character_profile: '更新基础资料',
  update_character_story: '完善角色叙事',
  read_character_field: '读取指定内容',
  search_character_draft: '定位草稿片段',
  edit_character_text: '精确修改文本',
  patch_character_data: '修改指定数据项',
  upsert_status_bar_variable: '修改指定状态变量',
  remove_status_bar_variable: '移除指定状态变量',
  update_status_bar_code: '修改状态栏代码分区',
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
const TOOL_ERROR_LABELS = Object.freeze({
  ROUND_ACTION_LIMIT: '旧版单步限制',
  PENDING_ACTION_REQUIRED: '旧版待处理队列',
  PENDING_ACTIONS_REMAIN: '旧版待处理队列',
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
  if (Array.isArray(result?.changes)) return `修改 ${result.changes.length} 处`;
  if (typeof result?.totalLength === 'number') return result.truncated ? '已读取片段' : '已读取';
  if (Array.isArray(result?.matches)) return `找到 ${result.matches.length} 处`;
  if (typeof result?.count === 'number') return `写入 ${result.count} 项`;
  if (result?.applied && typeof result.applied === 'object') return `更新 ${countOwnObjectKeys(result.applied)} 项`;
  if (result?.rule?.label) return `规则：${result.rule.label}`;
  return result?.ok === true ? '成功' : '已返回';
}

function toolLabel(name) {
  return TOOL_LABELS[name] || name || '未知工具';
}

function stepActivity(step = {}) {
  const tools = Array.isArray(step.tools) ? step.tools : [];
  if (Array.isArray(step.activity) && step.activity.length) {
    return step.activity.flatMap((item) => {
      if (item?.type === 'content' && String(item.text || '').trim()) {
        return [{ type: 'assistant', text: String(item.text), round: step.round }];
      }
      if (item?.type !== 'tool') return [];
      const index = Number(item.index);
      const tool = Number.isInteger(index) ? tools[index] : null;
      return tool ? [{ type: 'tool', tool, round: step.round }] : [];
    });
  }
  const entries = [];
  if (String(step.content || '').trim()) entries.push({ type: 'assistant', text: String(step.content), round: step.round });
  for (const tool of tools) entries.push({ type: 'tool', tool, round: step.round });
  return entries;
}

function sameText(first, second) {
  return String(first || '').replace(/\s+/g, ' ').trim() === String(second || '').replace(/\s+/g, ' ').trim();
}

function compactReasoning(value) {
  const text = String(value || '').replace(/\r\n/g, '\n').trim();
  if (text.length <= 1200) return text;
  return `…${text.slice(-1200)}`;
}

function buildWorkflowEntries(process = [], finalContent = '') {
  const raw = [];
  for (const step of Array.isArray(process) ? process : []) raw.push(...stepActivity(step));
  const finalText = String(finalContent || '').trim();
  if (finalText) {
    const lastAssistant = raw.findLastIndex((entry) => entry.type === 'assistant');
    if (lastAssistant >= 0) {
      const text = String(raw[lastAssistant].text || '').trim();
      if (sameText(text, finalText)) raw.splice(lastAssistant, 1);
      else if (text.endsWith(finalText)) {
        raw[lastAssistant].text = text.slice(0, -finalText.length).trim();
        if (!raw[lastAssistant].text) raw.splice(lastAssistant, 1);
      }
    }
  }

  const entries = [];
  for (const entry of raw) {
    if (entry.type === 'tool') {
      const previous = entries.at(-1);
      if (previous?.type === 'tools') {
        previous.tools.push(entry.tool);
      } else {
        entries.push({ type: 'tools', round: entry.round, tools: [entry.tool] });
      }
      continue;
    }
    entries.push(entry);
  }
  return entries;
}

function batchLabel(tools = []) {
  if (tools.length > 1) return `执行 ${tools.length} 项操作`;
  return toolLabel(tools[0]?.name);
}

function batchResultLabel(tools = []) {
  const failed = tools.filter((tool) => tool?.result?.ok === false).length;
  if (failed) return `${failed} 项失败`;
  return tools.length > 1 ? `${tools.length} 项完成` : toolResultLabel(tools[0]?.result);
}

const completedToolCount = computed(() => props.toolCalls.filter((call) => (
  call?.result?.ok !== false && call?.result?.skipped !== true
)).length);
const workflowEntries = computed(() => buildWorkflowEntries(props.process, props.finalContent));
const operationCount = computed(() => workflowEntries.value.reduce((count, entry) => (
  count + (entry.type === 'tools' ? entry.tools.length : 0)
), 0) || props.toolCalls.length);
const reasoningText = computed(() => {
  const source = [props.reasoning, ...(Array.isArray(props.process) ? props.process.map((step) => step?.reasoning) : [])]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('\n\n');
  return compactReasoning(source);
});
const currentActivity = computed(() => {
  if (!props.loading) return '';
  const last = workflowEntries.value.at(-1);
  if (last?.type === 'tools') return props.statusMessage || '已收到工具结果，正在继续处理';
  if (last?.type === 'assistant') return props.statusMessage || '助手正在继续回复';
  return props.statusMessage || '正在整理上下文并开始处理';
});
</script>

<template>
  <section class="ai-process-panel ai-workflow" aria-label="助手活动">
      <header class="ai-workflow-header">
        <span class="ai-tool-title">
          <ListChecks :size="15" />
          <span>{{ loading ? '正在处理' : '助手活动' }}</span>
        </span>
        <small v-if="operationCount || completedToolCount">{{ operationCount }} 项操作 · {{ completedToolCount }} 项成功</small>
      </header>
      <div class="ai-workflow-timeline">
        <template v-for="(entry, index) in workflowEntries" :key="`workflow-${index}`">
          <article v-if="entry.type === 'assistant'" class="ai-workflow-assistant-message">
            <MessageCircle :size="14" aria-hidden="true" />
            <MarkdownContent :text="entry.text" />
          </article>
          <details v-else-if="entry.type === 'tools' && entry.tools.length > 1" class="ai-workflow-tool-batch">
            <summary>
              <Wrench :size="14" aria-hidden="true" />
              <span>{{ batchLabel(entry.tools) }}</span>
              <small>{{ batchResultLabel(entry.tools) }}</small>
              <ChevronDown :size="14" aria-hidden="true" />
            </summary>
            <div class="ai-workflow-tool-list">
              <details v-for="(call, callIndex) in entry.tools" :key="`${call.name}-${callIndex}`" class="ai-workflow-tool-item">
                <summary>
                  <span><Wrench :size="13" aria-hidden="true" />{{ toolLabel(call.name) }}</span>
                  <small :class="{ failed: call.result?.ok === false }">{{ toolResultLabel(call.result) }}</small>
                </summary>
                <div class="ai-tool-technical-name">{{ call.name }}</div>
                <strong>参数</strong>
                <pre>{{ formatAiValue(call.arguments) }}</pre>
                <strong>结果</strong>
                <pre>{{ formatAiValue(call.result) }}</pre>
              </details>
            </div>
          </details>
          <details v-else-if="entry.type === 'tools'" class="ai-workflow-tool-item">
            <summary>
              <span><Wrench :size="14" aria-hidden="true" />{{ toolLabel(entry.tools[0]?.name) }}</span>
              <small :class="{ failed: entry.tools[0]?.result?.ok === false }">{{ toolResultLabel(entry.tools[0]?.result) }}</small>
            </summary>
            <div class="ai-tool-technical-name">{{ entry.tools[0]?.name }}</div>
            <strong>参数</strong>
            <pre>{{ formatAiValue(entry.tools[0]?.arguments) }}</pre>
            <strong>结果</strong>
            <pre>{{ formatAiValue(entry.tools[0]?.result) }}</pre>
          </details>
        </template>
        <div v-if="loading" class="ai-workflow-current" role="status" aria-live="polite">
          <LoaderCircle :size="14" />
          <span>{{ currentActivity }}</span>
        </div>
        <div v-else-if="status === 'failed'" class="ai-workflow-current failed" role="status">
          <TriangleAlert :size="14" />
          <span>{{ statusMessage || '本轮未完成' }}</span>
        </div>
        <div v-else-if="status === 'completed' && !workflowEntries.length" class="ai-workflow-current completed" role="status">
          <CheckCircle2 :size="14" />
          <span>本轮已完成</span>
        </div>
        <details v-if="reasoningText" class="ai-workflow-thinking">
          <summary><BrainCircuit :size="14" />思考<ChevronDown :size="13" /></summary>
          <p>{{ reasoningText }}</p>
        </details>
      </div>
  </section>
</template>
