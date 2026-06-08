import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatches, readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

const { readFileAsDataUrl } = await import('../../../frontend/src/utils/fileReaders.js');
const fileReadersSource = readRepoText('frontend/src/utils/fileReaders.js');
const { script: settingsViewScript } = readVueBlocks('frontend/src/views/SettingsView.vue', ['script']);
const { script: characterFormScript } = readVueBlocks('frontend/src/views/CharacterFormView.vue', ['script']);
const { script: characterImagePanelScript } = readVueBlocks('frontend/src/components/CharacterImagePanel.vue', ['script']);
const chatAppearanceSource = readRepoText('frontend/src/composables/chat/useChatAppearance.js');

function restoreFileReader(originalFileReader) {
  if (originalFileReader === undefined) {
    delete globalThis.FileReader;
  } else {
    globalThis.FileReader = originalFileReader;
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

test('frontend image upload paths share the safe Data URL reader', () => {
  assert.match(fileReadersSource, /export function readFileAsDataUrl\(file, errorMessage = '文件读取失败'\)/);
  assert.match(
    fileReadersSource,
    /try \{\s*reader\.readAsDataURL\(file\);\s*\} catch \{\s*reader\.onerror\?\.\(\);\s*\}/
  );

  const files = [
    settingsViewScript,
    characterFormScript,
    characterImagePanelScript,
    chatAppearanceSource
  ];

  for (const source of files) {
    assert.match(source, /readFileAsDataUrl/);
    assert.doesNotMatch(source, /function readAsDataUrl/);
  }

  assert.doesNotMatch(chatAppearanceSource, /function readFileAsDataUrl\(file\) \{/);
  assert.equal(countMatches(settingsViewScript, /readFileAsDataUrl\(file, '头像读取失败'\)/g), 1);
  assert.equal(countMatches(characterFormScript, /readFileAsDataUrl\(file, '头像读取失败'\)/g), 1);
  assert.equal(countMatches(characterFormScript, /readFileAsDataUrl\(file, '背景图片读取失败'\)/g), 1);
  assert.equal(countMatches(characterImagePanelScript, /readFileAsDataUrl\(file, '图片读取失败'\)/g), 1);
  assert.equal(countMatches(chatAppearanceSource, /readFileAsDataUrl\(file, '背景图片读取失败'\)/g), 1);
});
