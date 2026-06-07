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
    /async function doCreateSave\(\)\s*{\s*if \(savePanelBusy\.value\) return;/
  );
  assert.match(
    saveLoadPanelScript,
    /async function doLoadSave\(item\)\s*{\s*if \(savePanelBusy\.value\) return;/
  );
  assert.match(
    saveLoadPanelScript,
    /async function doDeleteSave\(item\)\s*{\s*if \(savePanelBusy\.value\) return;/
  );
  assert.match(
    saveLoadPanelScript,
    /function beginRename\(item\)\s*{\s*if \(savePanelBusy\.value\) return;/
  );
  assert.match(
    saveLoadPanelScript,
    /if \(!name \|\| savePanelBusy\.value\) return;/
  );

  assert.equal(countMatches(saveLoadPanelTemplate, /:disabled="isSaveActionDisabled\(\)"/g), 4);
  assert.equal(countMatches(saveLoadPanelTemplate, /:aria-busy="isSaveItemBusy\(item\)"/g), 5);
  assert.match(saveLoadPanelTemplate, /:disabled="savePanelBusy"/);
  assert.match(saveLoadPanelTemplate, /class="save-retry-button" type="button" :disabled="savePanelBusy"/);
  assert.doesNotMatch(saveLoadPanelTemplate, /:disabled="busyId === item\.id"/);
});
