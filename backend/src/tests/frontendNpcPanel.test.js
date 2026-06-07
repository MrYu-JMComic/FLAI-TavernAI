import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readVueBlocks } from './frontendSfcTestUtils.js';

const {
  script: npcPanelScript,
  template: npcPanelTemplate,
  style: npcPanelStyle
} = readVueBlocks('frontend/src/components/NpcPanel.vue', ['script', 'template', 'style']);

test('NpcPanel disables NPC mutations while one action is busy', () => {
  assert.match(npcPanelScript, /const npcActionBusyId = ref\(''\)/);
  assert.match(npcPanelScript, /const npcActionBusy = computed\(\(\) => Boolean\(npcActionBusyId\.value\)\)/);
  assert.match(npcPanelScript, /function startNpcAction\(actionId\)/);
  assert.match(npcPanelScript, /function finishNpcAction\(actionId, mutationToken, conversationId, npcName = null\)/);
  assert.match(npcPanelScript, /async function loadNpcs\(options = {}\)/);
  assert.equal(countMatches(npcPanelScript, /const allowWhileBusy = Boolean\(options\.allowWhileBusy\);/g), 2);
  assert.match(npcPanelScript, /async function loadNpcs\(options = {}\)[\s\S]*if \(!allowWhileBusy && npcActionBusy\.value\) return;[\s\S]*const requestToken = \+\+npcLoadToken;/);
  assert.match(npcPanelScript, /await loadNpcDetail\({ allowWhileBusy }\);/);
  assert.match(npcPanelScript, /if \(npcPanelDisposed \|\| npcActionBusy\.value\) return;/);
  assert.match(npcPanelScript, /async function loadNpcDetail\(options = {}\)[\s\S]*if \(!allowWhileBusy && npcActionBusy\.value\) return;[\s\S]*const requestToken = \+\+npcDetailToken;/);
  assert.equal(countMatches(npcPanelScript, /await loadNpcs\({ allowWhileBusy: true }\);/g), 6);
  assert.equal(countMatches(npcPanelScript, /if \(!startNpcAction\(actionId\)\) return;/g), 7);
  assert.equal(countMatches(npcPanelScript, /finally\s*{\s*finishNpcAction\(actionId, mutationToken, conversationId/g), 7);
  assert.match(npcPanelScript, /npcActionBusyId\.value = ''/);

  assert.match(npcPanelTemplate, /:disabled="!emptyNpcNames\.length \|\| loading \|\| npcActionBusy"/);
  assert.match(npcPanelTemplate, /:disabled="loading \|\| npcActionBusy"/);
  assert.match(npcPanelTemplate, /:aria-busy="isNpcActionBusy\('npc-remove-empty'\)"/);
  assert.match(npcPanelTemplate, /:aria-busy="isNpcActionBusy\('npc-remove-selected'\)"/);
  assert.match(npcPanelTemplate, /:aria-busy="isNpcActionBusy\('memory-create'\)"/);
  assert.match(npcPanelTemplate, /:aria-busy="isNpcActionBusy\(memoryActionId\(mem\.id\)\)"/);
  assert.match(npcPanelTemplate, /:aria-busy="isNpcActionBusy\('behavior-create'\)"/);
  assert.match(npcPanelTemplate, /:aria-busy="isNpcActionBusy\(behaviorToggleActionId\(beh\.id\)\)"/);
  assert.match(npcPanelTemplate, /:aria-busy="isNpcActionBusy\(behaviorDeleteActionId\(beh\.id\)\)"/);
  assert.ok(countMatches(npcPanelTemplate, /:disabled="npcActionBusy"/g) >= 12);

  assert.match(npcPanelStyle, /\.npc-refresh:disabled,/);
  assert.match(npcPanelStyle, /\.npc-card-delete:disabled/);
  assert.match(npcPanelStyle, /\.npc-card-delete:hover:not\(:disabled\)/);
});
