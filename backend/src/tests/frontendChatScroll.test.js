import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText } from './frontendSfcTestUtils.js';

const { useChatScroll } = await import('../../../frontend/src/composables/chat/useChatScroll.js');
const chatScrollSource = readRepoText('frontend/src/composables/chat/useChatScroll.js');

function refValue(value) {
  return { value };
}

function withFakeWindow(callback) {
  const originalWindow = globalThis.window;
  globalThis.window = {
    getComputedStyle() {
      return {
        paddingTop: '16px',
        paddingBottom: '120px'
      };
    },
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    localStorage: {
      setItem() {}
    }
  };

  try {
    return callback();
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
}

function withFakeAnimationFrame(callback) {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const frames = new Map();
  let nextFrameId = 1;

  globalThis.requestAnimationFrame = (handler) => {
    const frameId = nextFrameId;
    nextFrameId += 1;
    frames.set(frameId, handler);
    return frameId;
  };
  globalThis.cancelAnimationFrame = (frameId) => {
    frames.delete(frameId);
  };

  function flushFrame() {
    const [frameId, handler] = frames.entries().next().value || [];
    if (!frameId) {
      return false;
    }
    frames.delete(frameId);
    handler();
    return true;
  }

  try {
    return callback({ frames, flushFrame });
  } finally {
    if (originalRequestAnimationFrame === undefined) {
      delete globalThis.requestAnimationFrame;
    } else {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    }
    if (originalCancelAnimationFrame === undefined) {
      delete globalThis.cancelAnimationFrame;
    } else {
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  }
}

test('chat scroll can anchor a sent message above the composer padding', () => {
  withFakeWindow(() => {
    const messageElement = {
      dataset: { messageId: 'user-1' },
      getBoundingClientRect() {
        return { top: 530, bottom: 580, height: 50 };
      }
    };
    const scroller = {
      scrollTop: 300,
      scrollHeight: 1400,
      clientHeight: 600,
      querySelectorAll() {
        return [messageElement];
      },
      getBoundingClientRect() {
        return { top: 0, bottom: 600, height: 600 };
      },
      scrollTo({ top }) {
        this.scrollTop = top;
      }
    };

    const scroll = useChatScroll({
      messageScroller: refValue(scroller),
      conversationId: refValue('conv-1')
    });

    assert.equal(scroll.scrollToMessage('user-1', { smooth: false, block: 'end', padding: 20 }), true);
    assert.equal(scroller.scrollTop, 420);
    assert.equal(scroll.isPinnedToBottom(), false);

    scroll.cleanup();
  });
});

test('chat scroll message lookup scans DOM nodes without cloning the node list', () => {
  assert.match(
    chatScrollSource,
    /function findMessageElement\(messageId\) \{[\s\S]*const targetId = String\(messageId\);[\s\S]*const elements = el\.querySelectorAll\('\.deep-message'\);[\s\S]*for \(let index = 0; index < elements\.length; index \+= 1\) \{[\s\S]*if \(element\?\.dataset\?\.messageId === targetId\) \{[\s\S]*return element;[\s\S]*return null;\s*\}/
  );
  assert.doesNotMatch(chatScrollSource, /\[\.\.\.el\.querySelectorAll\('\.deep-message'\)\]/);
  assert.doesNotMatch(chatScrollSource, /querySelectorAll\('\.deep-message'\)\][\s\S]*\.find\(/);
});

test('chat scroll coalesces passive scroll state updates into one animation frame', () => {
  withFakeWindow(() => withFakeAnimationFrame(({ frames, flushFrame }) => {
    const scroller = {
      scrollTop: 100,
      scrollHeight: 1000,
      clientHeight: 300
    };

    const scroll = useChatScroll({
      messageScroller: refValue(scroller),
      conversationId: refValue('conv-1')
    });

    scroll.handleMessageScroll();
    scroll.handleMessageScroll();
    assert.equal(frames.size, 1);
    assert.equal(scroll.distanceToBottom.value, 0);

    assert.equal(flushFrame(), true);
    assert.equal(scroll.distanceToBottom.value, 600);
    assert.equal(frames.size, 0);

    scroller.scrollTop = 250;
    scroll.handleMessageScroll();
    assert.equal(flushFrame(), true);
    assert.equal(scroll.distanceToBottom.value, 450);

    scroll.cleanup();
  }));
});
