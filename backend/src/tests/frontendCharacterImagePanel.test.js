import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readVueBlocks } from './frontendSfcTestUtils.js';

const { script: characterImagePanelScript, template: characterImagePanelTemplate } = readVueBlocks(
  'frontend/src/components/CharacterImagePanel.vue'
);

test('CharacterImagePanel retry action ignores events while images are loading', () => {
  assert.match(
    characterImagePanelScript,
    /function retryLoadImages\(\)\s*{\s*if \(loading\.value\) return;\s*loadImages\(\);/
  );
  assert.match(
    characterImagePanelTemplate,
    /<button class="ghost-button small" type="button" :disabled="loading" :aria-busy="loading" @click="retryLoadImages">/
  );
});

test('CharacterImagePanel disables image actions while one image mutation is busy', () => {
  assert.match(characterImagePanelScript, /const imageActionBusy = computed\(\(\) => Boolean\(imageActionBusyId\.value\)\)/);
  assert.match(characterImagePanelScript, /const imagePanelBusy = computed\(\(\) => uploading\.value \|\| imageActionBusy\.value\)/);
  assert.match(
    characterImagePanelScript,
    /if \(props\.disabled \|\| imagePanelBusy\.value \|\| !characterId \|\| !files\.length\)\s*{\s*return;\s*}\s*const uploadToken = \+\+imageUploadToken;/
  );
  assert.match(characterImagePanelScript, /function startImageAction\(actionId\)/);
  assert.match(characterImagePanelScript, /function finishImageAction\(mutationToken, characterId\)/);
  assert.equal(countMatches(characterImagePanelScript, /if \(!characterId \|\| !startImageAction\(imageId\)\) return;/g), 2);
  assert.match(characterImagePanelScript, /if \(!startImageAction\(imageId\)\) return;/);
  assert.match(characterImagePanelScript, /if \(!characterId \|\| !startImageAction\('image-order'\)\) return;/);
  assert.equal(countMatches(characterImagePanelScript, /finally\s*{\s*finishImageAction\(mutationToken, characterId\);\s*}/g), 4);

  assert.match(characterImagePanelTemplate, /:class="{ disabled: imagePanelBusy }"/);
  assert.match(characterImagePanelTemplate, /:disabled="imagePanelBusy"/);
  assert.match(characterImagePanelTemplate, /:draggable="!isImageActionDisabled\(\)"/);
  assert.equal(countMatches(characterImagePanelTemplate, /:disabled="isImageActionDisabled\(\)"/g), 8);
  assert.equal(countMatches(characterImagePanelTemplate, /:aria-busy="isImageActionBusy\(image\.id\)"/g), 3);
  assert.match(characterImagePanelTemplate, /:aria-busy="imageActionBusyId === 'image-order'"/);
});
