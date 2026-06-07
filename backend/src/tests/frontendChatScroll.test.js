import assert from 'node:assert/strict';
import test from 'node:test';

const { useChatScroll } = await import('../../../frontend/src/composables/chat/useChatScroll.js');

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
