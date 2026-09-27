import assert from 'node:assert/strict';
import test from 'node:test';

const { copyTextToClipboard } = await import('../../../frontend/src/utils/clipboard.js');

test('clipboard fallback copies on non-secure mobile contexts with a focused selection', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const calls = [];
  const textarea = {
    value: '',
    style: {},
    setAttribute(name, value) { this[name] = value; },
    focus(options) { calls.push(['focus', options]); },
    select() { calls.push(['select']); },
    setSelectionRange(start, end) { calls.push(['range', start, end]); }
  };
  const body = {
    appendChild(node) { calls.push(['append', node]); },
    removeChild(node) { calls.push(['remove', node]); }
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement(tag) { assert.equal(tag, 'textarea'); return textarea; },
      body,
      execCommand(command) { calls.push(['exec', command]); return true; }
    }
  });
  try {
    assert.equal(await copyTextToClipboard('手机局域网复制'), 'execCommand');
    assert.equal(textarea.value, '手机局域网复制');
    assert.deepEqual(calls.map((entry) => entry[0]), ['append', 'focus', 'select', 'range', 'exec', 'remove']);
    assert.deepEqual(calls[3], ['range', 0, '手机局域网复制'.length]);
  } finally {
    restoreGlobal('navigator', originalNavigator);
    restoreGlobal('document', originalDocument);
  }
});

test('clipboard helper prefers the secure Clipboard API when available', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const writes = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: async (value) => writes.push(value) } }
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: undefined });
  try {
    assert.equal(await copyTextToClipboard('secure copy'), 'clipboard');
    assert.deepEqual(writes, ['secure copy']);
  } finally {
    restoreGlobal('navigator', originalNavigator);
    restoreGlobal('document', originalDocument);
  }
});

function restoreGlobal(name, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}
