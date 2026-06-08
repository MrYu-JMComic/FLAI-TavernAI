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
  assert.ok(countMatches(npcPanelScript, /await loadNpcs\({ allowWhileBusy: true }\);/g) >= 6);
  assert.ok(countMatches(npcPanelScript, /if \(!startNpcAction\(actionId\)\) return;/g) >= 7);
  assert.ok(countMatches(npcPanelScript, /finally\s*{\s*finishNpcAction\(actionId, mutationToken, conversationId/g) >= 7);
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

test('NpcPanel memory cards use a neutral themed card treatment', () => {
  assert.match(npcPanelTemplate, /class="npc-card npc-memory-card"/);
  assert.match(npcPanelStyle, /\.npc-card\s*{[\s\S]*var\(--surface, #fbfaf6\)[\s\S]*border-radius: 8px;/);
  assert.match(npcPanelStyle, /\.npc-memory-card\s*{[\s\S]*var\(--surface, #fbfaf6\)[\s\S]*var\(--surface-strong, #edf5ef\)/);
  assert.match(npcPanelStyle, /:root\[data-theme="dark"\] \.npc-memory-card/);
  assert.doesNotMatch(npcPanelStyle, /\.npc-card::before/);
  assert.doesNotMatch(npcPanelStyle, /\.npc-memory-card::before/);
  assert.doesNotMatch(npcPanelStyle, /\.npc-memory-card\s*{[\s\S]*linear-gradient\(90deg/);
  assert.doesNotMatch(npcPanelStyle, /var\(--surface-raised, #22223a\)/);
});

test('NpcPanel exposes NPC status aliases and memory seal metadata controls', () => {
  assert.match(npcPanelScript, /updateConversationNpc,/);
  assert.match(npcPanelScript, /const npcMetaForm = reactive\(\{/);
  assert.match(npcPanelScript, /const npcStatusOptions = \[/);
  assert.match(npcPanelScript, /function syncNpcMetaForm\(npc\)/);
  assert.match(npcPanelScript, /function parseNpcAliasesText\(value\)/);
  assert.match(npcPanelScript, /async function submitNpcMeta\(\)/);
  assert.match(npcPanelScript, /const actionId = 'npc-meta-save'/);
  assert.match(npcPanelScript, /updateConversationNpc\(conversationId, npcName,/);
  assert.match(npcPanelScript, /setNpcsIfChanged\(npcs\.value\.map/);
  assert.match(npcPanelScript, /memorySealActive/);

  assert.match(npcPanelTemplate, /detailTab === 'profile'/);
  assert.match(npcPanelTemplate, /<SlidersHorizontal :size="15" \/>/);
  assert.match(npcPanelTemplate, />资料</);
  assert.match(npcPanelTemplate, />状态</);
  assert.match(npcPanelTemplate, />别名</);
  assert.match(npcPanelTemplate, /每行一个精确别名/);
  assert.match(npcPanelTemplate, /记忆封存/);
  assert.match(npcPanelTemplate, /状态为死亡或永久离开时/);
  assert.match(npcPanelTemplate, />\s*保存\s*</);
  assert.match(npcPanelTemplate, /v-model="npcMetaForm\.status"/);
  assert.match(npcPanelTemplate, /v-model="npcMetaForm\.aliasesText"/);
  assert.match(npcPanelTemplate, /v-model="npcMetaForm\.memorySealed"/);
  assert.match(npcPanelTemplate, /:aria-busy="isNpcActionBusy\('npc-meta-save'\)"/);
  assert.match(npcPanelTemplate, /selectedNpcMemorySealActive/);
  assert.doesNotMatch(npcPanelTemplate, />Profile</);
  assert.doesNotMatch(npcPanelTemplate, />Status</);
  assert.doesNotMatch(npcPanelTemplate, />Aliases</);
  assert.doesNotMatch(npcPanelTemplate, />Save</);
  assert.doesNotMatch(npcPanelTemplate, /Memory sealed/);

  assert.match(npcPanelStyle, /\.npc-status-pill/);
  assert.match(npcPanelStyle, /\.npc-field-label/);
  assert.match(npcPanelStyle, /\.npc-meta-note/);
  assert.match(npcPanelStyle, /\.npc-seal-control/);
  assert.match(npcPanelStyle, /\.npc-seal-input:checked \+ \.npc-seal-control/);
});

test('NpcPanel aggregates panel stats and empty NPC names in one pass', () => {
  assert.match(
    npcPanelScript,
    /const npcPanelSummary = computed\(\(\) => \{[\s\S]*const sourceNpcs = Array\.isArray\(npcs\.value\) \? npcs\.value : \[\];[\s\S]*const stats = \{[\s\S]*npcCount: sourceNpcs\.length,[\s\S]*memoryCount: 0,[\s\S]*behaviorCount: 0[\s\S]*const emptyNpcNames = \[\];[\s\S]*for \(const npc of sourceNpcs\) \{[\s\S]*const memoryCount = Number\(npc\?\.memoryCount \|\| 0\);[\s\S]*const behaviorCount = Number\(npc\?\.behaviorCount \|\| 0\);[\s\S]*stats\.memoryCount \+= memoryCount;[\s\S]*stats\.behaviorCount \+= behaviorCount;[\s\S]*emptyNpcNames\.push\(npc\?\.name\);[\s\S]*return \{ stats, emptyNpcNames \};[\s\S]*\}\);/
  );
  assert.match(npcPanelScript, /const npcPanelStats = computed\(\(\) => npcPanelSummary\.value\.stats\);/);
  assert.match(npcPanelScript, /const emptyNpcNames = computed\(\(\) => npcPanelSummary\.value\.emptyNpcNames\);/);
  assert.doesNotMatch(npcPanelScript, /npcs\.value\.reduce/);
  assert.doesNotMatch(npcPanelScript, /const emptyNpcNames = computed\(\(\) => npcs\.value\s*\.\s*filter/);
});

test('NpcPanel selected NPC lookup scans current list directly', () => {
  assert.match(npcPanelScript, /const selectedNpcData = computed\(\(\) => getCurrentNpcByName\(selectedNpc\.value\)\);/);
  assert.match(
    npcPanelScript,
    /function getCurrentNpcByName\(name, sourceNpcs = npcs\.value\) \{\s*const targetName = String\(name \|\| ''\)\.trim\(\);[\s\S]*if \(!targetName\) \{[\s\S]*return null;[\s\S]*const currentNpcs = Array\.isArray\(sourceNpcs\) \? sourceNpcs : \[\];[\s\S]*for \(const npc of currentNpcs\) \{[\s\S]*if \(npc\?\.name === targetName\) \{[\s\S]*return npc;[\s\S]*return null;[\s\S]*\}/
  );
  assert.match(npcPanelScript, /if \(selectedNpc\.value && !getCurrentNpcByName\(selectedNpc\.value\)\) \{\s*setSelectedNpc\(''\);/);
  assert.doesNotMatch(npcPanelScript, /npcs\.value\.find/);
});

test('NpcPanel ignores stale NPC detail item actions', () => {
  assert.match(
    npcPanelScript,
    /function getCurrentMemory\(memoryId\)\s*{[\s\S]*memory\?\.id === memoryId[\s\S]*memory\?\.conversationId === props\.conversationId[\s\S]*memory\?\.npcName === selectedNpc\.value[\s\S]*}/
  );
  assert.match(
    npcPanelScript,
    /function getCurrentBehavior\(behaviorId\)\s*{[\s\S]*behavior\?\.id === behaviorId[\s\S]*behavior\?\.conversationId === props\.conversationId[\s\S]*behavior\?\.npcName === selectedNpc\.value[\s\S]*}/
  );
  assert.match(
    npcPanelScript,
    /async function removeMemory\(memoryId\)[\s\S]*const currentMemory = getCurrentMemory\(memoryId\);[\s\S]*if \(!conversationId \|\| !npcName \|\| !currentMemory\) return;[\s\S]*deleteNpcMemory\(conversationId, npcName, currentMemory\.id\)[\s\S]*removeMemoryByIdIfPresent\(currentMemory\.id\);/
  );
  assert.match(
    npcPanelScript,
    /async function toggleBehavior\(behavior\)[\s\S]*const currentBehavior = getCurrentBehavior\(behavior\?\.id\);[\s\S]*if \(!conversationId \|\| !npcName \|\| !currentBehavior\) return;[\s\S]*const behaviorId = currentBehavior\.id;[\s\S]*enabled: !currentBehavior\.enabled[\s\S]*if \(!getCurrentBehavior\(behaviorId\)\) return;[\s\S]*updateBehaviorByIdIfChanged\(behaviorId, updated\);/
  );
  assert.match(
    npcPanelScript,
    /async function removeBehavior\(behaviorId\)[\s\S]*const currentBehavior = getCurrentBehavior\(behaviorId\);[\s\S]*if \(!conversationId \|\| !npcName \|\| !currentBehavior\) return;[\s\S]*deleteNpcBehavior\(conversationId, npcName, currentBehavior\.id\)[\s\S]*removeBehaviorByIdIfPresent\(currentBehavior\.id\);/
  );
  assert.doesNotMatch(npcPanelScript, /Object\.assign\(behavior, updated\)/);
});

test('NpcPanel preserves unchanged NPC and detail list references during refreshes', () => {
  assert.match(
    npcPanelScript,
    /function setNpcsIfChanged\(nextNpcs\)\s*{\s*const normalizedNpcs = Array\.isArray\(nextNpcs\) \? nextNpcs : \[\];[\s\S]*if \(sameListItems\(currentNpcs, normalizedNpcs, sameNpcSummary\)\) {\s*return false;\s*}[\s\S]*npcs\.value = normalizedNpcs;[\s\S]*return true;[\s\S]*}/
  );
  assert.match(
    npcPanelScript,
    /function setMemoriesIfChanged\(nextMemories\)\s*{\s*const normalizedMemories = Array\.isArray\(nextMemories\) \? nextMemories : \[\];[\s\S]*if \(sameListItems\(currentMemories, normalizedMemories, sameMemorySummary\)\) {\s*return false;\s*}[\s\S]*memories\.value = normalizedMemories;[\s\S]*return true;[\s\S]*}/
  );
  assert.match(
    npcPanelScript,
    /function setBehaviorsIfChanged\(nextBehaviors\)\s*{\s*const normalizedBehaviors = Array\.isArray\(nextBehaviors\) \? nextBehaviors : \[\];[\s\S]*if \(sameListItems\(currentBehaviors, normalizedBehaviors, sameBehaviorSummary\)\) {\s*return false;\s*}[\s\S]*behaviors\.value = normalizedBehaviors;[\s\S]*return true;[\s\S]*}/
  );
  assert.match(
    npcPanelScript,
    /function sameNpcSummary\(current = {}, next = {}\)\s*{[\s\S]*current\?\.name === next\?\.name[\s\S]*Number\(current\?\.memoryCount \|\| 0\) === Number\(next\?\.memoryCount \|\| 0\)[\s\S]*String\(current\?\.source \|\| ''\) === String\(next\?\.source \|\| ''\)[\s\S]*sameListItems\(normalizeStringList\(current\?\.aliases\), normalizeStringList\(next\?\.aliases\), Object\.is\);[\s\S]*}/
  );
  assert.match(
    npcPanelScript,
    /function sameMemorySummary\(current = {}, next = {}\)\s*{[\s\S]*current\?\.id === next\?\.id[\s\S]*current\?\.conversationId === next\?\.conversationId[\s\S]*current\?\.npcName === next\?\.npcName[\s\S]*current\?\.memoryType === next\?\.memoryType[\s\S]*current\?\.content === next\?\.content[\s\S]*current\?\.createdAt === next\?\.createdAt;[\s\S]*}/
  );
  assert.match(
    npcPanelScript,
    /function sameBehaviorSummary\(current = {}, next = {}\)\s*{[\s\S]*current\?\.id === next\?\.id[\s\S]*current\?\.conversationId === next\?\.conversationId[\s\S]*current\?\.npcName === next\?\.npcName[\s\S]*current\?\.behaviorType === next\?\.behaviorType[\s\S]*current\?\.triggerCondition === next\?\.triggerCondition[\s\S]*current\?\.action === next\?\.action[\s\S]*Number\(current\?\.priority \|\| 0\) === Number\(next\?\.priority \|\| 0\)[\s\S]*Boolean\(current\?\.enabled\) === Boolean\(next\?\.enabled\)[\s\S]*current\?\.createdAt === next\?\.createdAt;[\s\S]*}/
  );

  assert.match(npcPanelScript, /setNpcsIfChanged\(nextNpcs\);[\s\S]*emit\('npcs-loaded', \{ conversationId, npcs: nextNpcs \}\);/);
  assert.match(npcPanelScript, /setMemoriesIfChanged\(mem\);[\s\S]*setBehaviorsIfChanged\(beh\);/);
  assert.match(npcPanelScript, /setMemoriesIfChanged\(\[mem, \.\.\.memories\.value\]\);/);
  assert.match(npcPanelScript, /setBehaviorsIfChanged\(\[\.\.\.behaviors\.value, beh\]\);/);
  assert.match(
    npcPanelScript,
    /function removeMemoryByIdIfPresent\(memoryId\) \{\s*const nextMemories = \[\];\s*let changed = false;[\s\S]*for \(const memory of memories\.value\) \{[\s\S]*if \(memory\?\.id === memoryId\) \{[\s\S]*changed = true;[\s\S]*} else \{[\s\S]*nextMemories\.push\(memory\);[\s\S]*}[\s\S]*if \(changed\) \{[\s\S]*setMemoriesIfChanged\(nextMemories\);[\s\S]*return changed;/
  );
  assert.match(
    npcPanelScript,
    /function updateBehaviorByIdIfChanged\(behaviorId, nextBehavior\) \{\s*const nextBehaviors = \[\];\s*let changed = false;[\s\S]*for \(const behavior of behaviors\.value\) \{[\s\S]*if \(behavior\?\.id === behaviorId\) \{[\s\S]*if \(!sameBehaviorSummary\(behavior, nextBehavior\)\) \{[\s\S]*changed = true;[\s\S]*nextBehaviors\.push\(nextBehavior\);[\s\S]*} else \{[\s\S]*nextBehaviors\.push\(behavior\);[\s\S]*}[\s\S]*if \(changed\) \{[\s\S]*setBehaviorsIfChanged\(nextBehaviors\);[\s\S]*return changed;/
  );
  assert.match(
    npcPanelScript,
    /function removeBehaviorByIdIfPresent\(behaviorId\) \{\s*const nextBehaviors = \[\];\s*let changed = false;[\s\S]*for \(const behavior of behaviors\.value\) \{[\s\S]*if \(behavior\?\.id === behaviorId\) \{[\s\S]*changed = true;[\s\S]*} else \{[\s\S]*nextBehaviors\.push\(behavior\);[\s\S]*}[\s\S]*if \(changed\) \{[\s\S]*setBehaviorsIfChanged\(nextBehaviors\);[\s\S]*return changed;/
  );
  assert.ok(countMatches(npcPanelScript, /setNpcsIfChanged\(/g) >= 3);
  assert.ok(countMatches(npcPanelScript, /setMemoriesIfChanged\(/g) >= 8);
  assert.ok(countMatches(npcPanelScript, /setBehaviorsIfChanged\(/g) >= 8);
  assert.doesNotMatch(npcPanelScript, /setMemoriesIfChanged\(memories\.value\.filter/);
  assert.doesNotMatch(npcPanelScript, /setBehaviorsIfChanged\(behaviors\.value\.filter/);
  assert.doesNotMatch(npcPanelScript, /setBehaviorsIfChanged\(behaviors\.value\.map\(\(item\) => \(item\.id === behaviorId \? updated : item\)\)\);/);
  assert.doesNotMatch(npcPanelScript, /memories\.value\.unshift/);
  assert.doesNotMatch(npcPanelScript, /behaviors\.value\.push/);
  assert.doesNotMatch(npcPanelScript, /\n\s+npcs\.value = \[\];/);
  assert.doesNotMatch(npcPanelScript, /\n\s+memories\.value = \[\];/);
  assert.doesNotMatch(npcPanelScript, /\n\s+behaviors\.value = \[\];/);
  assert.doesNotMatch(npcPanelScript, /\n\s+npcs\.value = nextNpcs;/);
  assert.doesNotMatch(npcPanelScript, /\n\s+memories\.value = mem;/);
  assert.doesNotMatch(npcPanelScript, /\n\s+behaviors\.value = beh;/);
  assert.doesNotMatch(npcPanelScript, /detailLoading\.value = true;\s*detailError\.value = '';\s*setMemoriesIfChanged\(\[\]\);/);
});
