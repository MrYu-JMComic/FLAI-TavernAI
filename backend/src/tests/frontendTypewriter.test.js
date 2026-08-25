import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const requireFromFrontend = createRequire(new URL('../../../frontend/package.json', import.meta.url));
const { effectScope, nextTick, ref } = requireFromFrontend('vue');
const { useTypewriterText } = await import('../../../frontend/src/composables/useTypewriterText.js');

test('typewriter shows history immediately and appends complete graphemes per frame', async () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const frames = new Map();
  let nextFrameId = 1;
  globalThis.requestAnimationFrame = (callback) => {
    const frameId = nextFrameId++;
    frames.set(frameId, callback);
    return frameId;
  };
  globalThis.cancelAnimationFrame = (frameId) => frames.delete(frameId);

  const source = ref('历史消息');
  const streaming = ref(false);
  const progress = [];
  const scope = effectScope();
  const typewriter = scope.run(() => useTypewriterText(
    source,
    streaming,
    (text) => progress.push(text)
  ));

  try {
    assert.equal(typewriter.displayedText.value, '历史消息');
    assert.equal(typewriter.isTyping.value, false);

    streaming.value = true;
    source.value += '👩‍💻e\u0301';
    await nextTick();
    assert.equal(typewriter.displayedText.value, '历史消息');
    assert.equal(frames.size, 1);

    runNextFrame(frames);
    assert.equal(typewriter.displayedText.value, '历史消息👩‍💻');
    assert.equal(typewriter.isTyping.value, true);

    runNextFrame(frames);
    assert.equal(typewriter.displayedText.value, '历史消息👩‍💻e\u0301');
    assert.deepEqual(progress, ['历史消息👩‍💻', '历史消息👩‍💻e\u0301']);
    streaming.value = false;
    await nextTick();
    assert.equal(typewriter.isTyping.value, false);

    source.value += '已编辑';
    await nextTick();
    assert.equal(typewriter.displayedText.value, '历史消息👩‍💻e\u0301已编辑');
    assert.equal(frames.size, 0);
    assert.equal(progress.length, 2);
  } finally {
    scope.stop();
    if (originalRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    if (originalCancelAnimationFrame === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  }
});

test('typewriter catches up faster after the stream closes and cancels pending frames on dispose', async () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const frames = new Map();
  let nextFrameId = 1;
  globalThis.requestAnimationFrame = (callback) => {
    const frameId = nextFrameId++;
    frames.set(frameId, callback);
    return frameId;
  };
  globalThis.cancelAnimationFrame = (frameId) => frames.delete(frameId);

  const source = ref('');
  const streaming = ref(true);
  const scope = effectScope();
  const typewriter = scope.run(() => useTypewriterText(source, streaming));

  try {
    source.value = 'x'.repeat(90);
    await nextTick();
    runNextFrame(frames);
    const streamingLength = typewriter.displayedText.value.length;
    assert.ok(streamingLength > 0 && streamingLength < 90);

    streaming.value = false;
    await nextTick();
    runNextFrame(frames);
    assert.ok(typewriter.displayedText.value.length - streamingLength > streamingLength);
    assert.ok(frames.size > 0);

    scope.stop();
    assert.equal(frames.size, 0);
  } finally {
    scope.stop();
    if (originalRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    if (originalCancelAnimationFrame === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  }
});

test('typewriter retypes non-prefix server corrections instead of jumping to the final text', async () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const frames = new Map();
  let nextFrameId = 1;
  globalThis.requestAnimationFrame = (callback) => {
    const frameId = nextFrameId++;
    frames.set(frameId, callback);
    return frameId;
  };
  globalThis.cancelAnimationFrame = (frameId) => frames.delete(frameId);

  const source = ref('draft');
  const streaming = ref(true);
  const progress = [];
  const scope = effectScope();
  const typewriter = scope.run(() => useTypewriterText(source, streaming, (text) => progress.push(text)));

  try {
    source.value = 'corrected';
    await nextTick();
    runNextFrame(frames);
    assert.equal(typewriter.displayedText.value, '');
    assert.deepEqual(progress, ['']);
    assert.equal(frames.size, 1);

    runNextFrame(frames);
    assert.equal(typewriter.displayedText.value, 'c');
    assert.deepEqual(progress, ['', 'c']);
  } finally {
    scope.stop();
    if (originalRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    if (originalCancelAnimationFrame === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  }
});

function runNextFrame(frames) {
  const entry = frames.entries().next().value;
  assert.ok(entry, 'expected a queued animation frame');
  const [frameId, callback] = entry;
  frames.delete(frameId);
  callback();
}
