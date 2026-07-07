import assert from 'node:assert/strict';
import test from 'node:test';
import { readVueBlocks } from './frontendSfcTestUtils.js';

const { script: inspectorScript, template: inspectorTemplate } = readVueBlocks(
  'frontend/src/components/chat/ChatContextInspector.vue',
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

test('ChatContextInspector uses the shared prompt preview and memory APIs', () => {
  assert.match(inspectorScript, /previewConversationContext/);
  assert.match(inspectorScript, /fetchConversationMemories/);
  assert.match(inspectorScript, /fetchConversationBranchTree/);
  assert.match(inspectorScript, /confirmConversationMemory/);
  assert.match(inspectorScript, /disableConversationMemory/);
  assert.match(inspectorScript, /rollbackConversationMemory/);
  assert.match(
    inspectorScript,
    /const \[nextPreview, memoryResult, branchTreeResult\] = await Promise\.all\(\[[\s\S]*previewConversationContext\(conversationId, buildPreviewPayload\(\)\),[\s\S]*fetchConversationMemories\(conversationId\),[\s\S]*fetchConversationBranchTree\(conversationId\)/
  );
  assert.match(inspectorScript, /content: props\.draftContent \|\| ''/);
  assert.match(inspectorScript, /attachments: normalizePreviewAttachments\(props\.draftAttachments\)/);
  assert.match(inspectorScript, /payload\.presetId = presetId;/);
});

test('ChatContextInspector exposes prompt diagnostics and long-term memory review', () => {
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
  assert.match(inspectorTemplate, /长期记忆/);
  assert.match(inspectorTemplate, /待确认 \{\{ memoryStats\.pending \}\}/);
  assert.match(inspectorScript, /function memoryAuditLabel\(memory\)/);
  assert.match(inspectorTemplate, /memoryAuditLabel\(memory\)/);
  assert.match(inspectorTemplate, /@click="mutateMemory\(memory, 'confirm'\)"/);
  assert.match(inspectorTemplate, /@click="mutateMemory\(memory, 'disable'\)"/);
  assert.match(inspectorTemplate, /@click="mutateMemory\(memory, 'rollback'\)"/);
  assert.match(inspectorTemplate, /附加上下文/);
});

test('ChatHeader and ChatView wire the context inspector into the chat workspace', () => {
  assert.match(chatHeaderScript, /Brain/);
  assert.match(chatHeaderScript, /'open-context'/);
  assert.match(chatHeaderTemplate, /aria-label="上下文检查器"[\s\S]*@click="emit\('open-context'\)"/);
  assert.match(chatViewScript, /import ChatContextInspector from '..\/components\/chat\/ChatContextInspector\.vue'/);
  assert.match(chatViewScript, /const contextInspectorOpen = ref\(false\);/);
  assert.match(chatViewScript, /function openContextInspector\(\)[\s\S]*conversationReady\.value[\s\S]*contextInspectorOpen\.value = true;/);
  assert.match(chatViewScript, /function closeContextInspector\(\)[\s\S]*contextInspectorOpen\.value = false;/);
  assert.match(chatViewScript, /event\.key === 'Escape' && contextInspectorOpen\.value/);
  assert.match(chatViewTemplate, /@open-context="openContextInspector"/);
  assert.match(chatViewTemplate, /<ChatContextInspector[\s\S]*:open="contextInspectorOpen"[\s\S]*:draft-content="input"[\s\S]*:draft-attachments="chatAttachments"[\s\S]*:preset-id="selectedPresetId"[\s\S]*@close="closeContextInspector"/);
});
