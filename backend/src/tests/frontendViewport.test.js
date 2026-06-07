import assert from 'node:assert/strict';
import test from 'node:test';

const { isPhoneViewport, isViewportMatch, useViewport } = await import('../../../frontend/src/composables/useViewport.js');
const { buildChatScriptContext } = await import('../../../frontend/src/utils/chatAppearance.js');

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

test('isViewportMatch falls back to innerWidth for min-width queries', () => {
  withWindow({ innerWidth: 1180 }, () => {
    assert.equal(isViewportMatch('(min-width: 981px)'), true);
  });

  withWindow({ innerWidth: 760 }, () => {
    assert.equal(isViewportMatch('(min-width: 981px)'), false);
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

test('chat appearance script context uses viewport fallback without matchMedia', () => {
  withWindow({ innerWidth: 740 }, () => {
    assert.equal(buildChatScriptContext().isMobile, true);
  });

  withWindow({ innerWidth: 900 }, () => {
    assert.equal(buildChatScriptContext().isMobile, false);
  });
});
