import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readRepoText, readVueBlock } from './frontendSfcTestUtils.js';

const characterImagePanelSource = readRepoText('frontend/src/components/CharacterImagePanel.vue');

test('CharacterImagePanel retry action ignores events while images are loading', () => {
  const scriptSetup = readVueBlock(characterImagePanelSource, 'script');
  const template = readVueBlock(characterImagePanelSource, 'template');

  assert.match(
    scriptSetup,
    /function retryLoadImages\(\)\s*{\s*if \(loading\.value\) return;\s*loadImages\(\);/
  );
  assert.match(
    template,
    /<button class="ghost-button small" type="button" :disabled="loading" :aria-busy="loading" @click="retryLoadImages">/
  );
});

test('CharacterImagePanel disables image actions while one image mutation is busy', () => {
  const scriptSetup = readVueBlock(characterImagePanelSource, 'script');
  const template = readVueBlock(characterImagePanelSource, 'template');

  assert.match(scriptSetup, /const imageActionBusy = computed\(\(\) => Boolean\(imageActionBusyId\.value\)\)/);
  assert.match(scriptSetup, /const imagePanelBusy = computed\(\(\) => uploading\.value \|\| imageActionBusy\.value\)/);
  assert.match(
    scriptSetup,
    /if \(props\.disabled \|\| imagePanelBusy\.value \|\| !characterId \|\| !files\.length\)\s*{\s*return;\s*}\s*const uploadToken = \+\+imageUploadToken;/
  );
  assert.match(scriptSetup, /function startImageAction\(actionId\)/);
  assert.match(scriptSetup, /function finishImageAction\(mutationToken, characterId\)/);
  assert.equal(countMatches(scriptSetup, /if \(!characterId \|\| !startImageAction\(imageId\)\) return;/g), 2);
  assert.match(scriptSetup, /if \(!startImageAction\(imageId\)\) return;/);
  assert.match(scriptSetup, /if \(!characterId \|\| !startImageAction\('image-order'\)\) return;/);
  assert.equal(countMatches(scriptSetup, /finally\s*{\s*finishImageAction\(mutationToken, characterId\);\s*}/g), 4);

  assert.match(template, /:class="{ disabled: imagePanelBusy }"/);
  assert.match(template, /:disabled="imagePanelBusy"/);
  assert.match(template, /:draggable="!isImageActionDisabled\(\)"/);
  assert.equal(countMatches(template, /:disabled="isImageActionDisabled\(\)"/g), 8);
  assert.equal(countMatches(template, /:aria-busy="isImageActionBusy\(image\.id\)"/g), 3);
  assert.match(template, /:aria-busy="imageActionBusyId === 'image-order'"/);
});
