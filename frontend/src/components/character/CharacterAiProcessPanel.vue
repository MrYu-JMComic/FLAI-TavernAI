<script setup>
import { ListChecks } from '@lucide/vue';
import { countOwnObjectKeys } from '../../utils/objectKeys';

defineProps({
  process: { type: Array, default: () => [] },
  reasoning: { type: String, default: '' },
  toolCalls: { type: Array, default: () => [] }
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
  if (result?.ok === false) return result.error || '失败';
  if (typeof result?.count === 'number') return `写入 ${result.count} 项`;
  if (result?.applied && typeof result.applied === 'object') return `更新 ${countOwnObjectKeys(result.applied)} 项`;
  if (result?.rule?.label) return `规则：${result.rule.label}`;
  return result?.ok === true ? '成功' : '已返回';
}
</script>

<template>
  <div class="ai-process-panel">
    <div class="ai-tool-title">
      <ListChecks :size="16" />
      <span>AI 过程 {{ process.length || 1 }} 轮 · 工具 {{ toolCalls.length }}</span>
    </div>
    <div v-if="reasoning" class="ai-reasoning-box">
      <strong>思考摘要</strong>
      <p>{{ reasoning }}</p>
    </div>
    <details
      v-for="(step, stepIndex) in process"
      :key="`step-${step.round || stepIndex}`"
      class="ai-process-step"
      open
    >
      <summary>
        <span>第 {{ step.round || stepIndex + 1 }} 轮</span>
        <small>{{ step.tools?.length || 0 }} 个工具</small>
      </summary>
      <p v-if="step.reasoning" class="ai-process-text">{{ step.reasoning }}</p>
      <p v-if="step.content" class="ai-process-text">{{ step.content }}</p>
      <p v-if="!step.reasoning && !step.content && !step.tools?.length" class="ai-process-text empty">等待模型返回本轮流程...</p>
      <div v-if="step.tools?.length" class="ai-tool-detail-list">
        <details v-for="(call, index) in step.tools" :key="`${call.name}-${index}`" class="ai-tool-detail" open>
          <summary>
            <span>{{ call.name }}</span>
            <small>{{ toolResultLabel(call.result) }}</small>
          </summary>
          <strong>参数</strong>
          <pre>{{ formatAiValue(call.arguments) }}</pre>
          <strong>结果</strong>
          <pre>{{ formatAiValue(call.result) }}</pre>
        </details>
      </div>
    </details>
    <div v-if="!process.length && toolCalls.length" class="ai-tool-detail-list standalone">
      <details v-for="(call, index) in toolCalls" :key="`${call.name}-${index}`" class="ai-tool-detail" open>
        <summary>
          <span>{{ call.name }}</span>
          <small>{{ toolResultLabel(call.result) }}</small>
        </summary>
        <strong>参数</strong>
        <pre>{{ formatAiValue(call.arguments) }}</pre>
        <strong>结果</strong>
        <pre>{{ formatAiValue(call.result) }}</pre>
      </details>
    </div>
  </div>
</template>
