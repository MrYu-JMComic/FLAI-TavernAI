import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readRepoText, readVueBlock } from './frontendSfcTestUtils.js';

const saveLoadPanelSource = readRepoText('frontend/src/components/SaveLoadPanel.vue');

test('SaveLoadPanel disables all item actions while one save item mutation is busy', () => {
  const scriptSetup = readVueBlock(saveLoadPanelSource, 'script');
  const template = readVueBlock(saveLoadPanelSource, 'template');

  assert.match(
    scriptSetup,
    /const hasSaveItemActionBusy = computed\(\(\) => Boolean\(busyId\.value\)\)/
  );
  assert.match(
    scriptSetup,
    /const saveActionBusy = computed\(\(\) => saving\.value \|\| hasSaveItemActionBusy\.value\)/
  );
  assert.match(
    scriptSetup,
    /const savePanelBusy = computed\(\(\) => loading\.value \|\| saveActionBusy\.value\)/
  );
  assert.match(
    scriptSetup,
    /async function loadSaves\(\)[\s\S]*if \(savePanelBusy\.value\) return;[\s\S]*const requestToken = \+\+savesLoadToken;/
  );
  assert.match(
    scriptSetup,
    /function isSaveActionDisabled\(\)\s*{\s*return savePanelBusy\.value;\s*}/
  );
  assert.match(
    scriptSetup,
    /async function doCreateSave\(\)\s*{\s*if \(savePanelBusy\.value\) return;/
  );
  assert.match(
    scriptSetup,
    /async function doLoadSave\(item\)\s*{\s*if \(savePanelBusy\.value\) return;/
  );
  assert.match(
    scriptSetup,
    /async function doDeleteSave\(item\)\s*{\s*if \(savePanelBusy\.value\) return;/
  );
  assert.match(
    scriptSetup,
    /function beginRename\(item\)\s*{\s*if \(savePanelBusy\.value\) return;/
  );
  assert.match(
    scriptSetup,
    /if \(!name \|\| savePanelBusy\.value\) return;/
  );

  assert.equal(countMatches(template, /:disabled="isSaveActionDisabled\(\)"/g), 4);
  assert.equal(countMatches(template, /:aria-busy="isSaveItemBusy\(item\)"/g), 5);
  assert.match(template, /:disabled="savePanelBusy"/);
  assert.match(template, /class="save-retry-button" type="button" :disabled="savePanelBusy"/);
  assert.doesNotMatch(template, /:disabled="busyId === item\.id"/);
});
