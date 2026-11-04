import assert from 'node:assert/strict';
import test from 'node:test';
import { readVueBlocks } from './frontendSfcTestUtils.js';

const { script: markdownScript } = readVueBlocks('frontend/src/components/MarkdownContent.vue');
const { script: messageScript } = readVueBlocks('frontend/src/components/chat/ChatMessageItem.vue');

// Runtime Unicode, correction, final flush, disposal and progress assertions now run
// against Vue SFCs in frontend/src/components/__tests__/streamRenderingLifecycle.test.js.
// The mobile newline/caret geometry check remains in chat-typewriter-newline.spec.js.
test('streaming forwards provider text directly to the bounded Markdown render scheduler', () => {
  assert.doesNotMatch(messageScript, /useTypewriterText/);
  assert.match(messageScript, /const displayedReasoning = reasoningSource;/);
  assert.match(messageScript, /const displayedContent = contentSource;/);
  assert.match(markdownScript, /const STREAM_RENDER_INTERVAL_MS = 32;/);
  assert.match(markdownScript, /if \(streamRenderTimer !== null\) return;/);
  assert.match(markdownScript, /streamRenderTimer = setTimeout\(\(\) => \{\s*streamRenderTimer = null;\s*renderMarkdownNow\(pendingMarkdownText, pendingRenderPlugins\);\s*}, STREAM_RENDER_INTERVAL_MS\);/);
});

test('finalization and unmount clear pending stream renders instead of replaying character frames', () => {
  assert.match(markdownScript, /if \(!mounted \|\| !props\.deferUpdates\) \{[\s\S]*clearTimeout\(streamRenderTimer\);[\s\S]*streamRenderTimer = null;[\s\S]*renderMarkdownNow\(pendingMarkdownText, pendingRenderPlugins\);\s*return;/);
  assert.match(markdownScript, /onBeforeUnmount\(\(\) => \{[\s\S]*clearTimeout\(streamRenderTimer\);[\s\S]*streamRenderTimer = null;/);
  assert.doesNotMatch(markdownScript, /requestAnimationFrame|cancelAnimationFrame/);
});