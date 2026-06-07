import assert from 'node:assert/strict';
import test from 'node:test';
import { readFrontendStyles } from './frontendSfcTestUtils.js';

const stylesSource = readFrontendStyles();

test('Mod editor content textarea keeps a stable focused height', () => {
  assert.match(
    stylesSource,
    /\.mod-editor-body textarea\s*{[\s\S]*height:\s*220px;[\s\S]*min-height:\s*220px;[\s\S]*max-height:\s*220px;[\s\S]*resize:\s*none;[\s\S]*overflow-y:\s*auto;[\s\S]*scrollbar-gutter:\s*stable;[\s\S]*}/
  );
  assert.match(
    stylesSource,
    /@media \(max-width: 768px\) {[\s\S]*\.mod-editor-body textarea\s*{[\s\S]*height:\s*180px;[\s\S]*min-height:\s*180px;[\s\S]*max-height:\s*180px;[\s\S]*}/
  );
});
