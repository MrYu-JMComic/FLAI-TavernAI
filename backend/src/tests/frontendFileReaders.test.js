import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

const { readFileAsDataUrl, validateImageDataUrl } = await import('../../../frontend/src/utils/fileReaders.js');
const fileReadersSource = readRepoText('frontend/src/utils/fileReaders.js');
const settingsProfileComposableSource = readRepoText('frontend/src/composables/settings/useSettingsProfile.js');
const { script: characterFormScript } = readVueBlocks('frontend/src/views/CharacterFormView.vue', ['script']);
const characterImageUploadsSource = readRepoText('frontend/src/composables/character/useCharacterImageUploads.js');
const { script: characterImagePanelScript } = readVueBlocks('frontend/src/components/CharacterImagePanel.vue', ['script']);
const chatAppearanceSource = readRepoText('frontend/src/composables/chat/useChatAppearance.js');

function restoreFileReader(originalFileReader) {
  if (originalFileReader === undefined) {
    delete globalThis.FileReader;
  } else {
    globalThis.FileReader = originalFileReader;
  }
}

function restoreImage(originalImage) {
  if (originalImage === undefined) {
    delete globalThis.Image;
  } else {
    globalThis.Image = originalImage;
  }
}

test('readFileAsDataUrl resolves FileReader data URLs as strings', async () => {
  const originalFileReader = globalThis.FileReader;

  class MockFileReader {
    constructor() {
      this.result = null;
      this.onload = null;
      this.onerror = null;
    }

    readAsDataURL(file) {
      this.result = file?.result;
      this.onload?.();
    }
  }

  globalThis.FileReader = MockFileReader;

  try {
    assert.equal(await readFileAsDataUrl({ result: 'data:image/png;base64,abc' }), 'data:image/png;base64,abc');
    assert.equal(await readFileAsDataUrl({ result: null }), '');
  } finally {
    restoreFileReader(originalFileReader);
  }
});

test('readFileAsDataUrl normalizes async and synchronous read failures', async () => {
  const originalFileReader = globalThis.FileReader;
  let readMode = 'error';

  class MockFileReader {
    constructor() {
      this.result = null;
      this.onload = null;
      this.onerror = null;
    }

    readAsDataURL() {
      if (readMode === 'throw') {
        throw new Error('native read failure');
      }
      this.onerror?.(new Error('native read failure'));
    }
  }

  globalThis.FileReader = MockFileReader;

  try {
    await assert.rejects(
      readFileAsDataUrl({}, '自定义读取失败'),
      /自定义读取失败/
    );

    readMode = 'throw';
    await assert.rejects(
      readFileAsDataUrl({}, '同步读取失败'),
      /同步读取失败/
    );
  } finally {
    restoreFileReader(originalFileReader);
  }
});

test('validateImageDataUrl checks image signatures and browser decoding', async () => {
  const originalImage = globalThis.Image;
  const tinyPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

  class MockImage {
    constructor() {
      this.naturalWidth = 0;
      this.naturalHeight = 0;
      this.onload = null;
      this.onerror = null;
    }

    set src(value) {
      if (value === tinyPngDataUrl) {
        this.naturalWidth = 1;
        this.naturalHeight = 1;
        this.onload?.();
        return;
      }
      this.onerror?.();
    }
  }

  globalThis.Image = MockImage;

  try {
    assert.equal(await validateImageDataUrl(tinyPngDataUrl), tinyPngDataUrl);
    await assert.rejects(
      validateImageDataUrl('data:image/png;base64,AAAA', '头像图片数据无效'),
      /头像图片数据无效/
    );
    await assert.rejects(
      validateImageDataUrl('data:image/jpeg;base64,iVBORw0KGgo=', '头像图片数据无效'),
      /头像图片数据无效/
    );
  } finally {
    restoreImage(originalImage);
  }
});

test('frontend image upload paths share the safe Data URL reader', () => {
  assert.match(fileReadersSource, /export function readFileAsDataUrl\(file, errorMessage = '文件读取失败'\)/);
  assert.match(fileReadersSource, /export function validateImageDataUrl\(dataUrl, errorMessage = '图片数据无效'\)/);
  assert.match(
    fileReadersSource,
    /try \{\s*reader\.readAsDataURL\(file\);\s*\} catch \{\s*reader\.onerror\?\.\(\);\s*\}/
  );

  const files = [
    settingsProfileComposableSource,
    characterImageUploadsSource,
    characterImagePanelScript,
    chatAppearanceSource
  ];

  for (const source of files) {
    assert.match(source, /readFileAsDataUrl/);
    assert.doesNotMatch(source, /function readAsDataUrl/);
  }

  assert.doesNotMatch(chatAppearanceSource, /function readFileAsDataUrl\(file\) \{/);
  assert.doesNotMatch(characterFormScript, /readFileAsDataUrl/);
  assert.equal(countMatches(settingsProfileComposableSource, /readFileAsDataUrl\(file, '头像读取失败'\)/g), 1);
  assert.equal(countMatches(settingsProfileComposableSource, /validateImageDataUrl\(/g), 1);
  assert.equal(countMatches(characterImageUploadsSource, /readFileAsDataUrl\(file, '头像读取失败'\)/g), 1);
  assert.equal(countMatches(characterImageUploadsSource, /validateImageDataUrl\(/g), 1);
  assert.equal(countMatches(characterImageUploadsSource, /readFileAsDataUrl\(file, '背景图片读取失败'\)/g), 1);
  assert.equal(countMatches(characterImagePanelScript, /readFileAsDataUrl\(file, '图片读取失败'\)/g), 1);
  assert.equal(countMatches(chatAppearanceSource, /readFileAsDataUrl\(file, '背景图片读取失败'\)/g), 1);
});
