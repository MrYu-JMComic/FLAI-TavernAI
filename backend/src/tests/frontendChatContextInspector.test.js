import assert from 'node:assert/strict';
import test from 'node:test';
import { readVueBlocks } from './frontendSfcTestUtils.js';

const { script: inspectorScript, template: inspectorTemplate } = readVueBlocks(
  'frontend/src/components/chat/ChatContextInspector.vue',
  ['script', 'template']
);
const { script: memoryReviewScript, template: memoryReviewTemplate } = readVueBlocks(
  'frontend/src/components/chat/ConversationMemoryReview.vue',
  ['script', 'template']
);
const { script: budgetScript, template: budgetTemplate } = readVueBlocks(
  'frontend/src/components/chat/ChatContextBudget.vue',
  ['script', 'template']
);
const { script: historyScript, template: historyTemplate } = readVueBlocks(
  'frontend/src/components/chat/ChatPromptHistory.vue',
  ['script', 'template']
);
const { script: chatHeaderScript, template: chatHeaderTemplate } = readVueBlocks(
  'frontend/src/components/chat/ChatHeader.vue',
  ['script', 'template']
);
const { script: chatViewScript, template: chatViewTemplate } = readVueBlocks(
  'frontend/src/views/ChatView.vue',
  ['script', 'template']
);

test('ChatContextInspector uses shared preview data and delegates focused context tools', () => {
  assert.match(inspectorScript, /previewConversationContext/);
  assert.match(inspectorScript, /fetchConversationBranchTree/);
  assert.match(
    inspectorScript,
    /const \[nextPreview, branchTreeResult\] = await Promise\.all\(\[[\s\S]*previewConversationContext\(conversationId, buildPreviewPayload\(\)\),[\s\S]*fetchConversationBranchTree\(conversationId\)/
  );
  assert.match(inspectorScript, /content: props\.draftContent \|\| ''/);
  assert.match(inspectorScript, /attachments: normalizePreviewAttachments\(props\.draftAttachments\)/);
  assert.match(inspectorScript, /payload\.presetId = presetId;/);
  assert.match(inspectorScript, /import ChatContextBudget from '\.\/ChatContextBudget\.vue'/);
  assert.match(inspectorScript, /import ChatPromptHistory from '\.\/ChatPromptHistory\.vue'/);
  assert.match(inspectorScript, /import ConversationMemoryReview from '\.\/ConversationMemoryReview\.vue'/);
  assert.match(inspectorScript, /emit\('memory-updated', result\)/);
  assert.match(inspectorScript, /await loadInspector\(\{ quiet: true \}\)/);
  assert.doesNotMatch(inspectorScript, /fetchConversationMemories|confirmConversationMemory|disableConversationMemory|rollbackConversationMemory|memoryActionBusyId/);
});

test('ChatContextInspector exposes prompt diagnostics and compact context views', () => {
  assert.match(inspectorTemplate, /Prompt Pipeline V2/);
  assert.match(inspectorScript, /label: '估算 Token'/);
  assert.match(inspectorScript, /value: formatNumber\(budget\.estimatedTokens\)/);
  assert.match(inspectorScript, /label: '预算上限'/);
  assert.match(inspectorScript, /const providerSummaryRows = computed/);
  assert.match(inspectorScript, /diagnostics\.providerDiagnosticId/);
  assert.match(inspectorScript, /const providerCapabilityRows = computed/);
  assert.match(inspectorScript, /\{ key: 'vision', label: '视觉' \}/);
  assert.match(inspectorTemplate, /Provider 诊断/);
  assert.match(inspectorTemplate, /v-for="item in providerSummaryRows"/);
  assert.match(inspectorTemplate, /v-for="item in providerCapabilityRows"/);
  assert.match(inspectorTemplate, /item\.enabled \? '开' : '关'/);
  assert.match(inspectorScript, /const truncationRows = computed/);
  assert.match(inspectorTemplate, /裁剪记录/);
  assert.match(inspectorTemplate, /分支树/);
  assert.match(inspectorTemplate, /v-for="branch in branchTreeRows"/);
  assert.match(inspectorTemplate, /层级 \{\{ branch\.depth \}\} · \{\{ branch\.messageCount \}\} 条消息/);
  assert.match(inspectorScript, /const branchSummaryTags = computed/);
  assert.match(inspectorScript, /const branchTreeRows = computed/);
  assert.match(inspectorScript, /function branchComparisonLabel\(comparison\)/);
  assert.match(inspectorTemplate, /Prompt 消息/);
  assert.match(inspectorTemplate, /世界书命中/);
  assert.match(inspectorScript, /const worldBookDiagnosticGroups = computed/);
  assert.match(inspectorScript, /const worldBookDiagnosticMisses = computed/);
  assert.match(inspectorScript, /function worldBookStatusLabel\(status\)/);
  assert.match(inspectorScript, /function worldBookMissKeyLabel\(item\)/);
  assert.match(inspectorScript, /function worldBookStatefulLabels\(match\)/);
  assert.match(inspectorTemplate, /match\.statusLabel/);
  assert.match(inspectorTemplate, /关键词：\{\{ match\.matchedKeys\.join\('、'\) \}\}/);
  assert.match(inspectorTemplate, /分组冲突/);
  assert.match(inspectorTemplate, /v-for="group in worldBookDiagnosticGroups"/);
  assert.match(inspectorTemplate, /未命中诊断/);
  assert.match(inspectorTemplate, /v-for="item in worldBookDiagnosticMisses"/);
  assert.match(inspectorTemplate, /附加上下文/);
  assert.match(inspectorTemplate, /role="tablist"/);
  assert.match(inspectorTemplate, /<Teleport to="body">/);
  for (const label of ['预览', '记忆', '实际请求', '预算']) assert.match(inspectorScript, new RegExp(`label: '${label}'`));
  assert.match(inspectorTemplate, /aria-controls/);
  assert.match(inspectorScript, /ArrowRight/);
  assert.match(inspectorTemplate, /<ConversationMemoryReview[\s\S]*@changed="handleMemoryChanged"/);
  assert.match(inspectorTemplate, /<ChatPromptHistory[\s\S]*activeView === 'history'/);
  assert.match(inspectorTemplate, /<ChatContextBudget[\s\S]*@changed="loadInspector\(\{ quiet: true \}\)"/);
});

test('split context tools scope requests, protect stale state, and keep budget writes numeric-only', () => {
  assert.match(memoryReviewScript, /import \{ apiRequest \} from '\.\.\/\.\.\/api\/core\.js'/);
  assert.match(memoryReviewScript, /function isCurrentMutation\(conversationId, token\)/);
  assert.match(memoryReviewTemplate, /<CastConfirmDialog/);

  assert.match(budgetScript, /const BUDGET_CONFIG_FIELDS = \['inputTokenLimit', 'reservedOutputTokens', 'imageTokensPerImage', 'contextWindowTokens'\]/);
  assert.match(budgetScript, /for \(const key of BUDGET_CONFIG_FIELDS\)/);
  assert.match(budgetScript, /entries\.push\(\[key, null\]\)/);
  assert.match(budgetScript, /Number\.isInteger\(numeric\)/);
  assert.doesNotMatch(budgetScript, /forModel|forProviderType/);
  assert.match(budgetScript, /function isCurrent\(conversationId, current\)/);
  assert.match(budgetTemplate, /provider\?\.providerType/);
  assert.match(budgetTemplate, /provider\?\.model/);
  assert.match(budgetTemplate, /估算值 · 非精确计数/);

  assert.match(historyScript, /function isCurrent\(conversationId, current\)/);
  assert.match(historyScript, /tokenEstimate/);
  assert.match(historyTemplate, /tokenCount\(request\)/);
  assert.match(historyTemplate, /生成状态：\{\{ detail\.status \}\}/);
  assert.match(historyTemplate, /HTTP \{\{ request\.httpStatus/);
  assert.match(historyTemplate, /敏感字段已脱敏/);
  assert.match(historyTemplate, /请求 JSON 已截断/);
  assert.match(historyTemplate, /未记录线上传输/);
  assert.doesNotMatch(historyTemplate, /v-html/);
});

test('ChatHeader and ChatView wire the context inspector into the chat workspace', () => {
  assert.match(chatHeaderScript, /Brain/);
  assert.match(chatHeaderScript, /'open-context'/);
  assert.match(chatHeaderTemplate, /runMoreAction\('open-context', \$event\)[\s\S]*上下文检查器/);
  assert.match(chatViewScript, /const ChatContextInspector = defineAsyncComponent\(\(\) => import\('\.\.\/components\/chat\/ChatContextInspector\.vue'\)\);/);
  assert.match(chatViewScript, /const contextInspectorOpen = ref\(false\);/);
  assert.match(chatViewScript, /function openContextInspector\(\)[\s\S]*conversationReady\.value[\s\S]*contextInspectorOpen\.value = true;/);
  assert.match(chatViewScript, /function closeContextInspector\(\)[\s\S]*contextInspectorOpen\.value = false;/);
  assert.match(chatViewScript, /event\.key === 'Escape' && contextInspectorOpen\.value/);
  assert.match(chatViewTemplate, /@open-context="\(event\) => openWorkspaceTool\('context', event\)"/);
  assert.match(chatViewTemplate, /<ChatContextInspector[\s\S]*:open="contextInspectorOpen"[\s\S]*:draft-content="input"[\s\S]*:draft-attachments="chatAttachments"[\s\S]*:preset-id="selectedPresetId"[\s\S]*@close="closeWorkspaceTool\('context'\)"/);
});
