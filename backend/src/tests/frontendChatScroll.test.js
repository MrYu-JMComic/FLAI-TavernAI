import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText, readVueBlocks } from './frontendSfcTestUtils.js';

const { useChatScroll } = await import('../../../frontend/src/composables/chat/useChatScroll.js');
const chatScrollSource = readRepoText('frontend/src/composables/chat/useChatScroll.js');
const { source: virtualMessageListSource } = readVueBlocks('frontend/src/components/VirtualMessageList.vue');

function refValue(value) {
  return { value };
}

function withFakeWindow(callback, storedSnapshot = null) {
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
      getItem() {
        return storedSnapshot;
      },
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

function withNoAnimationFrame(callback) {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;

  try {
    return callback();
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

test('chat scroll falls back when animation frames are unavailable', () => {
  withFakeWindow(() => withNoAnimationFrame(() => {
    const scroller = {
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 300,
      scrollTo({ top }) {
        this.scrollTop = top;
      }
    };

    const scroll = useChatScroll({
      messageScroller: refValue(scroller),
      conversationId: refValue('conv-1')
    });

    assert.doesNotThrow(() => scroll.scrollToBottom(false, true));
    assert.equal(scroller.scrollTop, 700);

    scroller.scrollTop = 100;
    assert.doesNotThrow(() => scroll.restoreMessageScrollPosition(refValue([{ role: 'user' }])));
    assert.equal(scroller.scrollTop, 700);

    scroll.cleanup();
  }));
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

test('chat stream follow stays pinned in the same frame as message growth', () => {
  withFakeWindow(() => {
    const scroller = {
      scrollTop: 700,
      scrollHeight: 1000,
      clientHeight: 300
    };

    const scroll = useChatScroll({
      messageScroller: refValue(scroller),
      conversationId: refValue('conv-1')
    });

    scroller.scrollHeight = 1400;
    scroll.stickToBottomIfNeeded(false);

    assert.equal(scroller.scrollTop, 1100);
    assert.equal(scroll.distanceToBottom.value, 0);
    assert.equal(scroll.isPinnedToBottom(), true);
    assert.match(
      virtualMessageListSource,
      /\.virtual-scroll-container\s*\{[^}]*overflow-anchor:\s*none;/
    );
    assert.match(
      virtualMessageListSource,
      /\.virtual-scroll-spacer\s*\{[^}]*flex:\s*0 0 auto;/
    );

    scroll.cleanup();
  });
});

test('chat scroll delegates bottom jumps to the message list', () => {
  withFakeWindow(() => withNoAnimationFrame(() => {
    const calls = [];
    const scroller = {
      scrollTop: 0,
      scrollHeight: 1200,
      clientHeight: 300
    };
    const scroll = useChatScroll({
      messageScroller: refValue(scroller),
      conversationId: refValue('conv-1'),
      scrollToBottomFallback(smooth) {
        calls.push(smooth);
        scroller.scrollTop = 900;
        return true;
      }
    });

    scroll.scrollToBottom(false, true);
    assert.deepEqual(calls, [false]);
    assert.equal(scroller.scrollTop, 900);
    assert.equal(scroll.isPinnedToBottom(), true);
    scroll.cleanup();
  }));
});

test('chat scroll restores an unpinned near-bottom snapshot without resuming auto-follow', () => {
  const snapshot = JSON.stringify({ top: 650, pinned: false, savedAt: 1 });
  withFakeWindow(() => withNoAnimationFrame(() => {
    const scroller = {
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 300
    };
    const scroll = useChatScroll({
      messageScroller: refValue(scroller),
      conversationId: refValue('conv-1')
    });

    scroll.restoreMessageScrollPosition(refValue([{ id: 'message-1', role: 'assistant' }]));
    assert.equal(scroller.scrollTop, 650);
    assert.equal(scroll.isPinnedToBottom(), false);
    scroll.stickToBottomIfNeeded(false);
    assert.equal(scroller.scrollTop, 650);
    scroll.cleanup();
  }), snapshot);
});

test('chat scroll restores a message anchor and relative reading offset', () => {
  const snapshot = JSON.stringify({
    top: 40,
    pinned: false,
    anchorMessageId: 'message-2',
    anchorOffset: -25,
    savedAt: 1
  });
  withFakeWindow(() => withNoAnimationFrame(() => {
    const messageElement = {
      dataset: { messageId: 'message-2' },
      getBoundingClientRect() {
        return { top: 500 - scroller.scrollTop, bottom: 580 - scroller.scrollTop, height: 80 };
      }
    };
    const scroller = {
      scrollTop: 0,
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

    scroll.restoreMessageScrollPosition(refValue([{ id: 'message-2', role: 'assistant' }]));
    assert.equal(scroller.scrollTop, 509);
    assert.equal(scroll.isPinnedToBottom(), false);
    scroll.cleanup();
  }), snapshot);
});

test('manual scroll intent cancels a pending virtual anchor restoration', () => {
  const snapshot = JSON.stringify({
    top: 40,
    pinned: false,
    anchorMessageId: 'message-virtual',
    anchorOffset: 0,
    savedAt: 1
  });
  withFakeWindow(() => withFakeAnimationFrame(({ frames, flushFrame }) => {
    const scroller = {
      scrollTop: 0,
      scrollHeight: 1400,
      clientHeight: 600,
      querySelectorAll() {
        return [];
      }
    };
    const scroll = useChatScroll({
      messageScroller: refValue(scroller),
      conversationId: refValue('conv-1'),
      scrollToMessageFallback() {
        return true;
      }
    });

    scroll.restoreMessageScrollPosition(refValue([{ id: 'message-virtual', role: 'assistant' }]));
    assert.equal(flushFrame(), true);
    assert.equal(frames.size, 1);

    scroller.scrollTop = 230;
    scroll.handleWheelScrollIntent({ deltaY: -20 });
    assert.equal(frames.size, 0);
    assert.equal(scroller.scrollTop, 230);
    scroll.cleanup();
  }), snapshot);
});

test('message list keys and measurements survive local message id finalization', () => {
  assert.match(virtualMessageListSource, /const messageRenderKeys = new WeakMap\(\);/);
  assert.match(virtualMessageListSource, /getItemKey: \(index\) => getMessageRenderKey\(props\.messages\[index\], index\)/);
  assert.match(virtualMessageListSource, /:key="getMessageRenderKey\(message, index\)"/);
  assert.match(virtualMessageListSource, /:data-message-render-key="getMessageRenderKey\(message, index\)"/);
  assert.doesNotMatch(virtualMessageListSource, /:key="message\.id \|\| index"/);
});

test('virtual bottom jumps finish at the real container bottom after footer layout', () => {
  assert.match(
    virtualMessageListSource,
    /nextTick\(\(\) => \{[\s\S]*virtualizer\.value\?\.measure\?\.\(\);[\s\S]*scrollToLastMessage\(\);[\s\S]*nextTick\(\(\) => scrollContainerToBottom\(smooth\)\);/
  );
});
