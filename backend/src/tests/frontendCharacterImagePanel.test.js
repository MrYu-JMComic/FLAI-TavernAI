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
    /function onDragOver\(index\) {\s*if \(isImageActionDisabled\(\) \|\| !isCurrentImageIndex\(dragIndex\.value\) \|\| !isCurrentImageIndex\(index\)\) return;\s*if \(dragOverIndex\.value !== index\) {\s*dragOverIndex\.value = index;\s*}/
  );
  assert.equal(countMatches(characterImagePanelScript, /if \(!characterId \|\| !isCurrentImageId\(imageId\) \|\| !startImageAction\(imageId\)\) return;/g), 2);
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

test('CharacterImagePanel scans selected upload files directly', () => {
  assert.match(
    characterImagePanelScript,
    /const files = collectUploadFiles\(input\?\.files\);/
  );
  assert.match(
    characterImagePanelScript,
    /function collectUploadFiles\(fileList\)\s*{\s*const files = \[\];[\s\S]*const count = Number\(fileList\?\.length\) \|\| 0;[\s\S]*for \(let index = 0; index < count; index \+= 1\) {[\s\S]*files\.push\(file\);[\s\S]*return files;[\s\S]*}/
  );
  assert.match(
    characterImagePanelScript,
    /function isSupportedImageFileType\(type\)\s*{\s*return type === 'image\/png' \|\| type === 'image\/jpeg' \|\| type === 'image\/webp';\s*}/
  );
  assert.match(characterImagePanelScript, /if \(!isSupportedImageFileType\(file\?\.type\)\) {/);
  assert.doesNotMatch(characterImagePanelScript, /Array\.from\(input\?\.files/);
  assert.doesNotMatch(characterImagePanelScript, /\['image\/png', 'image\/jpeg', 'image\/webp'\]\.includes/);
});

test('CharacterImagePanel ignores stale image item events before mutations', () => {
  assert.match(
    characterImagePanelScript,
    /function resetImagePanelState\(\)\s*{[\s\S]*setImagesIfChanged\(\[\]\);[\s\S]*editingImageId\.value = '';[\s\S]*editForm\.value = \{ sceneTag: '', emotionTag: '' \};[\s\S]*dragIndex\.value = -1;[\s\S]*dragOverIndex\.value = -1;[\s\S]*}/
  );
  assert.match(
    characterImagePanelScript,
    /function isCurrentImageId\(imageId\)\s*{\s*return Boolean\(getCurrentImageById\(imageId\)\);[\s\S]*}/
  );
  assert.match(
    characterImagePanelScript,
    /function isCurrentImageItem\(image\)\s*{\s*return Boolean\(image\?\.id && image\?\.characterId === props\.characterId && getCurrentImageById\(image\.id\)\);/
  );
  assert.match(
    characterImagePanelScript,
    /function isCurrentImageIndex\(index\)\s*{\s*return Number\.isInteger\(index\) && index >= 0 && index < images\.value\.length && isCurrentImageItem\(images\.value\[index\]\);/
  );
  assert.match(
    characterImagePanelScript,
    /function startEdit\(image\)\s*{\s*if \(isImageActionDisabled\(\) \|\| !isCurrentImageItem\(image\)\) return;\s*const currentImage = getCurrentImageById\(image\.id\);\s*if \(!currentImage\) return;[\s\S]*editingImageId\.value = currentImage\.id;[\s\S]*sceneTag: currentImage\.sceneTag \|\| '',[\s\S]*emotionTag: currentImage\.emotionTag \|\| ''/
  );
  assert.match(
    characterImagePanelScript,
    /async function removeImage\(imageId\)\s*{\s*if \(isImageActionDisabled\(\) \|\| !props\.characterId \|\| !isCurrentImageId\(imageId\)\) return;[\s\S]*if \(!window\.confirm/
  );
  assert.match(
    characterImagePanelScript,
    /function onDragStart\(index\)\s*{\s*if \(isImageActionDisabled\(\) \|\| !isCurrentImageIndex\(index\)\) return;/
  );
  assert.match(
    characterImagePanelScript,
    /!isCurrentImageIndex\(dragIndex\.value\) \|\|\s*!isCurrentImageIndex\(dragOverIndex\.value\) \|\|\s*dragIndex\.value === dragOverIndex\.value/
  );
});

test('CharacterImagePanel preserves unchanged image list references during refreshes', () => {
  assert.match(
    characterImagePanelScript,
    /function setImagesIfChanged\(nextImages\)\s*{\s*const normalizedImages = Array\.isArray\(nextImages\) \? nextImages : \[\];[\s\S]*if \(sameListItems\(currentImages, normalizedImages, sameImageSummary\)\) {\s*syncImageTransientStateWithList\(normalizedImages\);\s*return false;\s*}[\s\S]*images\.value = normalizedImages;\s*syncImageTransientStateWithList\(normalizedImages\);[\s\S]*return true;[\s\S]*}/
  );
  assert.match(
    characterImagePanelScript,
    /function sameListItems\(currentItems, nextItems, sameItem\)\s*{[\s\S]*if \(currentItems === nextItems\) {\s*return true;\s*}[\s\S]*if \(currentItems\.length !== nextItems\.length\) {\s*return false;\s*}[\s\S]*for \(let index = 0; index < currentItems\.length; index \+= 1\) {[\s\S]*if \(!sameItem\(currentItems\[index\], nextItems\[index\]\)\) {[\s\S]*return false;[\s\S]*return true;[\s\S]*}/
  );
  assert.match(
    characterImagePanelScript,
    /function sameImageSummary\(current = {}, next = {}\)\s*{[\s\S]*current\?\.id === next\?\.id[\s\S]*String\(current\?\.imageUrl \|\| ''\) === String\(next\?\.imageUrl \|\| ''\)[\s\S]*String\(current\?\.sceneTag \|\| ''\) === String\(next\?\.sceneTag \|\| ''\)[\s\S]*String\(current\?\.emotionTag \|\| ''\) === String\(next\?\.emotionTag \|\| ''\)[\s\S]*Boolean\(current\?\.isDefault\) === Boolean\(next\?\.isDefault\);[\s\S]*}/
  );
  assert.match(characterImagePanelScript, /setImagesIfChanged\(nextImages\);/);
  assert.match(characterImagePanelScript, /setImagesIfChanged\(reordered\);/);
  assert.ok(countMatches(characterImagePanelScript, /setImagesIfChanged\(\[\]\);/g) >= 2);
  assert.ok(countMatches(characterImagePanelScript, /setImagesIfChanged\(/g) >= 5);
  assert.doesNotMatch(characterImagePanelScript, /currentItems\.every/);
  assert.doesNotMatch(characterImagePanelScript, /\[\.\.\.images\.value\]/);
  assert.doesNotMatch(characterImagePanelScript, /reordered\.map/);
  assert.doesNotMatch(characterImagePanelScript, /images\.value\.find/);
  assert.doesNotMatch(characterImagePanelScript, /images\.value\.some/);
});

test('CharacterImagePanel clears stale edit and drag state after image-list refreshes', () => {
  assert.match(
    characterImagePanelScript,
    /function getCurrentImageById\(imageId, imageList = images\.value\)\s*{\s*const id = String\(imageId \|\| ''\);[\s\S]*if \(!id \|\| !characterId\) {[\s\S]*return null;[\s\S]*const currentImages = Array\.isArray\(imageList\) \? imageList : \[\];[\s\S]*for \(const image of currentImages\) {[\s\S]*if \(image\?\.id === id && image\?\.characterId === characterId\) {[\s\S]*return image;[\s\S]*return null;[\s\S]*}/
  );
  assert.match(
    characterImagePanelScript,
    /function syncImageTransientStateWithList\(currentImages\)\s*{\s*if \(editingImageId\.value && !getCurrentImageById\(editingImageId\.value, currentImages\)\) {[\s\S]*cancelEdit\(\);[\s\S]*if \(!isCurrentImageIndex\(dragIndex\.value\) \|\| !isCurrentImageIndex\(dragOverIndex\.value\)\) {[\s\S]*dragIndex\.value = -1;[\s\S]*dragOverIndex\.value = -1;[\s\S]*}/
  );
  assert.match(
    characterImagePanelScript,
    /if \(sameListItems\(currentImages, normalizedImages, sameImageSummary\)\) {\s*syncImageTransientStateWithList\(normalizedImages\);\s*return false;\s*}/
  );
  assert.match(
    characterImagePanelScript,
    /images\.value = normalizedImages;\s*syncImageTransientStateWithList\(normalizedImages\);/
  );
});
