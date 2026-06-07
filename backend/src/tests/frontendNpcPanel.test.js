import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readRepoText, readVueBlock } from './frontendSfcTestUtils.js';

const npcPanelSource = readRepoText('frontend/src/components/NpcPanel.vue');

test('NpcPanel disables NPC mutations while one action is busy', () => {
  const scriptSetup = readVueBlock(npcPanelSource, 'script');
  const template = readVueBlock(npcPanelSource, 'template');
  const style = readVueBlock(npcPanelSource, 'style');

  assert.match(scriptSetup, /const npcActionBusyId = ref\(''\)/);
  assert.match(scriptSetup, /const npcActionBusy = computed\(\(\) => Boolean\(npcActionBusyId\.value\)\)/);
  assert.match(scriptSetup, /function startNpcAction\(actionId\)/);
  assert.match(scriptSetup, /function finishNpcAction\(actionId, mutationToken, conversationId, npcName = null\)/);
  assert.match(scriptSetup, /async function loadNpcs\(options = {}\)/);
  assert.equal(countMatches(scriptSetup, /const allowWhileBusy = Boolean\(options\.allowWhileBusy\);/g), 2);
  assert.match(scriptSetup, /async function loadNpcs\(options = {}\)[\s\S]*if \(!allowWhileBusy && npcActionBusy\.value\) return;[\s\S]*const requestToken = \+\+npcLoadToken;/);
  assert.match(scriptSetup, /await loadNpcDetail\({ allowWhileBusy }\);/);
  assert.match(scriptSetup, /if \(npcPanelDisposed \|\| npcActionBusy\.value\) return;/);
  assert.match(scriptSetup, /async function loadNpcDetail\(options = {}\)[\s\S]*if \(!allowWhileBusy && npcActionBusy\.value\) return;[\s\S]*const requestToken = \+\+npcDetailToken;/);
  assert.equal(countMatches(scriptSetup, /await loadNpcs\({ allowWhileBusy: true }\);/g), 6);
  assert.equal(countMatches(scriptSetup, /if \(!startNpcAction\(actionId\)\) return;/g), 7);
  assert.equal(countMatches(scriptSetup, /finally\s*{\s*finishNpcAction\(actionId, mutationToken, conversationId/g), 7);
  assert.match(scriptSetup, /npcActionBusyId\.value = ''/);

  assert.match(template, /:disabled="!emptyNpcNames\.length \|\| loading \|\| npcActionBusy"/);
  assert.match(template, /:disabled="loading \|\| npcActionBusy"/);
  assert.match(template, /:aria-busy="isNpcActionBusy\('npc-remove-empty'\)"/);
  assert.match(template, /:aria-busy="isNpcActionBusy\('npc-remove-selected'\)"/);
  assert.match(template, /:aria-busy="isNpcActionBusy\('memory-create'\)"/);
  assert.match(template, /:aria-busy="isNpcActionBusy\(memoryActionId\(mem\.id\)\)"/);
  assert.match(template, /:aria-busy="isNpcActionBusy\('behavior-create'\)"/);
  assert.match(template, /:aria-busy="isNpcActionBusy\(behaviorToggleActionId\(beh\.id\)\)"/);
  assert.match(template, /:aria-busy="isNpcActionBusy\(behaviorDeleteActionId\(beh\.id\)\)"/);
  assert.ok(countMatches(template, /:disabled="npcActionBusy"/g) >= 12);

  assert.match(style, /\.npc-refresh:disabled,/);
  assert.match(style, /\.npc-card-delete:disabled/);
  assert.match(style, /\.npc-card-delete:hover:not\(:disabled\)/);
});
