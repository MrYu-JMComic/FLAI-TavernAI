import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readVueBlocks } from './frontendSfcTestUtils.js';

const { script: saveLoadPanelScript, template: saveLoadPanelTemplate } = readVueBlocks(
  'frontend/src/components/SaveLoadPanel.vue'
);

test('SaveLoadPanel disables all item actions while one save item mutation is busy', () => {
  assert.match(
    saveLoadPanelScript,
    /const hasSaveItemActionBusy = computed\(\(\) => Boolean\(busyId\.value\)\)/
  );
  assert.match(
    saveLoadPanelScript,
    /const saveActionBusy = computed\(\(\) => saving\.value \|\| hasSaveItemActionBusy\.value\)/
  );
  assert.match(
    saveLoadPanelScript,
    /const savePanelBusy = computed\(\(\) => loading\.value \|\| saveActionBusy\.value\)/
  );
  assert.match(
    saveLoadPanelScript,
    /async function loadSaves\(\)[\s\S]*if \(savePanelBusy\.value\) return;[\s\S]*const requestToken = \+\+savesLoadToken;/
  );
  assert.match(
    saveLoadPanelScript,
    /function isSaveActionDisabled\(\)\s*{\s*return savePanelBusy\.value;\s*}/
  );
  assert.match(
    saveLoadPanelScript,
    /function requestClose\(\)\s*{\s*if \(saveActionBusy\.value\) return;\s*emit\('close'\);/
  );
  assert.match(
    saveLoadPanelScript,
    /async function doCreateSave\(\)\s*{\s*if \(savePanelBusy\.value\) return;/
  );
  assert.match(
    saveLoadPanelScript,
    /async function doLoadSave\(item\)\s*{\s*if \(savePanelBusy\.value \|\| !isCurrentSaveItem\(item\)\) return;/
  );
  assert.match(
    saveLoadPanelScript,
    /async function doDeleteSave\(item\)\s*{\s*if \(savePanelBusy\.value \|\| !isCurrentSaveItem\(item\)\) return;/
  );
  assert.match(
    saveLoadPanelScript,
    /function beginRename\(item\)\s*{\s*if \(savePanelBusy\.value \|\| !isCurrentSaveItem\(item\)\) return;/
  );
  assert.match(
    saveLoadPanelScript,
    /if \(!name \|\| savePanelBusy\.value \|\| !isCurrentSaveItem\(item\)\) return;/
  );

  assert.equal(countMatches(saveLoadPanelTemplate, /:disabled="isSaveActionDisabled\(\)"/g), 4);
  assert.equal(countMatches(saveLoadPanelTemplate, /:aria-busy="isSaveItemBusy\(item\)"/g), 5);
  assert.match(saveLoadPanelTemplate, /:disabled="savePanelBusy"/);
  assert.match(saveLoadPanelTemplate, /class="save-retry-button" type="button" :disabled="savePanelBusy"/);
  assert.match(saveLoadPanelTemplate, /@click\.self="requestClose"/);
  assert.match(saveLoadPanelTemplate, /:disabled="saveActionBusy"[\s\S]*:aria-busy="saveActionBusy"[\s\S]*@click="requestClose"/);
  assert.doesNotMatch(saveLoadPanelTemplate, /:disabled="busyId === item\.id"/);
  assert.doesNotMatch(saveLoadPanelTemplate, /@click(?:\.self)?="emit\('close'\)"/);
});

test('SaveLoadPanel preserves save-list references for unchanged refresh results', () => {
  assert.match(
    saveLoadPanelScript,
    /function setSavesIfChanged\(nextSaves\)\s*{\s*const normalizedSaves = Array\.isArray\(nextSaves\) \? nextSaves : \[\];[\s\S]*if \(sameSaveList\(currentSaves, normalizedSaves\)\) {\s*return false;\s*}[\s\S]*saves\.value = normalizedSaves;[\s\S]*return true;[\s\S]*}/
  );
  assert.match(
    saveLoadPanelScript,
    /function sameSaveList\(currentSaves, nextSaves\)\s*{[\s\S]*if \(currentSaves === nextSaves\) {\s*return true;\s*}[\s\S]*currentSaves\.every\(\(save, index\) => sameSaveSummary\(save, nextSaves\[index\]\)\);[\s\S]*}/
  );
  assert.match(
    saveLoadPanelScript,
    /function sameSaveSummary\(current = {}, next = {}\)\s*{[\s\S]*current\?\.id === next\?\.id[\s\S]*current\?\.conversationId === next\?\.conversationId[\s\S]*current\?\.name === next\?\.name[\s\S]*current\?\.preview === next\?\.preview[\s\S]*current\?\.createdAt === next\?\.createdAt;[\s\S]*}/
  );
  assert.match(
    saveLoadPanelScript,
    /const nextSaves = await fetchSaves\(conversationId\);[\s\S]*setSavesIfChanged\(nextSaves\);/
  );
  assert.match(
    saveLoadPanelScript,
    /await deleteSave\(item\.id, conversationId\);[\s\S]*removeSaveItemByIdIfPresent\(item\.id\);/
  );
  assert.match(
    saveLoadPanelScript,
    /function removeSaveItemByIdIfPresent\(saveId\) \{\s*const nextSaves = \[\];\s*let changed = false;[\s\S]*for \(const save of saves\.value\) \{[\s\S]*if \(save\?\.id === saveId\) \{[\s\S]*changed = true;[\s\S]*} else \{[\s\S]*nextSaves\.push\(save\);[\s\S]*}[\s\S]*if \(changed\) \{[\s\S]*setSavesIfChanged\(nextSaves\);[\s\S]*return changed;/
  );
  assert.match(
    saveLoadPanelScript,
    /function updateSaveItemNameIfChanged\(saveId, nextName\) \{\s*const nextSaves = \[\];\s*let changed = false;[\s\S]*for \(const save of saves\.value\) \{[\s\S]*if \(save\?\.id === saveId\) \{[\s\S]*const nextSave = \{ \.\.\.save, name: nextName \};[\s\S]*if \(!sameSaveSummary\(save, nextSave\)\) \{[\s\S]*changed = true;[\s\S]*nextSaves\.push\(nextSave\);[\s\S]*} else \{[\s\S]*nextSaves\.push\(save\);[\s\S]*}[\s\S]*if \(changed\) \{[\s\S]*setSavesIfChanged\(nextSaves\);[\s\S]*return changed;/
  );
  assert.match(
    saveLoadPanelScript,
    /const updated = await renameSave\(item\.id, name, conversationId\);[\s\S]*updateSaveItemNameIfChanged\(item\.id, updated\.name\);/
  );
  assert.ok(countMatches(saveLoadPanelScript, /setSavesIfChanged\(/g) >= 5);
  assert.doesNotMatch(saveLoadPanelScript, /\n\s+saves\.value = nextSaves;/);
  assert.doesNotMatch(saveLoadPanelScript, /\n\s+saves\.value = \[\];/);
  assert.doesNotMatch(saveLoadPanelScript, /\n\s+saves\.value = saves\.value\.filter/);
  assert.doesNotMatch(saveLoadPanelScript, /setSavesIfChanged\(saves\.value\.filter/);
  assert.doesNotMatch(saveLoadPanelScript, /saves\.value\.findIndex/);
  assert.doesNotMatch(saveLoadPanelScript, /saves\.value\[[^\]]+\]\s*=/);
});

test('SaveLoadPanel ignores stale save item events before mutations', () => {
  assert.match(
    saveLoadPanelScript,
    /function isCurrentSaveItem\(item\)\s*{\s*const conversationId = props\.conversationId;[\s\S]*if \(!conversationId \|\| !item\?\.id \|\| item\.conversationId !== conversationId\) \{\s*return false;\s*\}[\s\S]*return saves\.value\.some\(\(save\) => save\?\.id === item\.id && save\?\.conversationId === conversationId\);[\s\S]*}/
  );
  assert.match(
    saveLoadPanelScript,
    /function isCurrentSaveLoadResult\(result, conversationId\)\s*{\s*return result\?\.conversationId === conversationId;\s*}/
  );
  assert.match(
    saveLoadPanelScript,
    /async function doLoadSave\(item\)\s*{\s*if \(savePanelBusy\.value \|\| !isCurrentSaveItem\(item\)\) return;[\s\S]*const result = await loadSave\(item\.id, conversationId\);[\s\S]*if \(!isCurrentSaveLoadResult\(result, conversationId\)\) return;[\s\S]*emit\('loaded', \{ \.\.\.result, conversationId \}\);/
  );
  assert.doesNotMatch(saveLoadPanelScript, /result\?\.conversationId && result\.conversationId !== conversationId/);
  assert.match(
    saveLoadPanelScript,
    /async function doDeleteSave\(item\)\s*{\s*if \(savePanelBusy\.value \|\| !isCurrentSaveItem\(item\)\) return;[\s\S]*await deleteSave\(item\.id, conversationId\);/
  );
  assert.match(
    saveLoadPanelScript,
    /function beginRename\(item\)\s*{\s*if \(savePanelBusy\.value \|\| !isCurrentSaveItem\(item\)\) return;/
  );
  assert.match(
    saveLoadPanelScript,
    /if \(!name \|\| savePanelBusy\.value \|\| !isCurrentSaveItem\(item\)\) return;[\s\S]*const updated = await renameSave\(item\.id, name, conversationId\);/
  );
});
