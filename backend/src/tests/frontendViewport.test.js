import assert from 'node:assert/strict';
import test from 'node:test';

const { isPhoneViewport, useViewport } = await import('../../../frontend/src/composables/useViewport.js');

function withWindow(windowValue, callback) {
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const originalWindow = globalThis.window;
  globalThis.window = windowValue;
  try {
    return callback();
  } finally {
    if (hadWindow) {
      globalThis.window = originalWindow;
    } else {
      delete globalThis.window;
    }
  }
}

function silenceVueLifecycleWarnings(callback) {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    return callback();
  } finally {
    console.warn = originalWarn;
  }
}

test('isPhoneViewport falls back to innerWidth when matchMedia is unavailable', () => {
  withWindow({ innerWidth: 700 }, () => {
    assert.equal(isPhoneViewport(), true);
  });

  withWindow({ innerWidth: 900 }, () => {
    assert.equal(isPhoneViewport(), false);
  });
});

test('useViewport initializes from fallback width without matchMedia', () => {
  withWindow({ innerWidth: 610 }, () => {
    silenceVueLifecycleWarnings(() => {
      const viewport = useViewport({ breakpoint: '(max-width: 620px)' });
      assert.equal(viewport.isPhone.value, true);
    });
  });
});
