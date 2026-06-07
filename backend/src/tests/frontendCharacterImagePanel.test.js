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
  assert.match(
    characterImagePanelScript,
    /function onDragOver\(index\) {\s*if \(isImageActionDisabled\(\)\) return;\s*if \(dragOverIndex\.value !== index\) {\s*dragOverIndex\.value = index;\s*}/
  );
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

test('CharacterImagePanel preserves unchanged image list references during refreshes', () => {
  assert.match(
    characterImagePanelScript,
    /function setImagesIfChanged\(nextImages\)\s*{\s*const normalizedImages = Array\.isArray\(nextImages\) \? nextImages : \[\];[\s\S]*if \(sameListItems\(currentImages, normalizedImages, sameImageSummary\)\) {\s*return false;\s*}[\s\S]*images\.value = normalizedImages;[\s\S]*return true;[\s\S]*}/
  );
  assert.match(
    characterImagePanelScript,
    /function sameListItems\(currentItems, nextItems, sameItem\)\s*{[\s\S]*if \(currentItems === nextItems\) {\s*return true;\s*}[\s\S]*if \(currentItems\.length !== nextItems\.length\) {\s*return false;\s*}[\s\S]*currentItems\.every\(\(item, index\) => sameItem\(item, nextItems\[index\]\)\);[\s\S]*}/
  );
  assert.match(
    characterImagePanelScript,
    /function sameImageSummary\(current = {}, next = {}\)\s*{[\s\S]*current\?\.id === next\?\.id[\s\S]*String\(current\?\.imageUrl \|\| ''\) === String\(next\?\.imageUrl \|\| ''\)[\s\S]*String\(current\?\.sceneTag \|\| ''\) === String\(next\?\.sceneTag \|\| ''\)[\s\S]*String\(current\?\.emotionTag \|\| ''\) === String\(next\?\.emotionTag \|\| ''\)[\s\S]*Boolean\(current\?\.isDefault\) === Boolean\(next\?\.isDefault\);[\s\S]*}/
  );
  assert.match(characterImagePanelScript, /setImagesIfChanged\(nextImages\);/);
  assert.match(characterImagePanelScript, /setImagesIfChanged\(reordered\);/);
  assert.ok(countMatches(characterImagePanelScript, /setImagesIfChanged\(\[\]\);/g) >= 2);
  assert.ok(countMatches(characterImagePanelScript, /setImagesIfChanged\(/g) >= 5);
});
