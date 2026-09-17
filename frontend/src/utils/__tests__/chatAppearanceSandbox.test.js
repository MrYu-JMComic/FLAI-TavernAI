import { describe, expect, it } from 'vitest';
import { runChatCustomScript } from '../chatAppearance.js';

// jsdom does not execute scripts inside sandboxed srcdoc iframes, so the real
// isolation is covered by e2e/chat-custom-script-sandbox.spec.js. These tests
// pin the parts observable without a script-running frame: the frame is created
// with the right sandbox attributes, and the DOM-less fallback still works.
describe('custom script sandbox', () => {
  it('creates a script-only iframe without same-origin access', async () => {
    const created = [];
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = (tagName, ...rest) => {
      const element = originalCreateElement(tagName, ...rest);
      if (String(tagName).toLowerCase() === 'iframe') created.push(element);
      return element;
    };
    try {
      // The frame never answers in jsdom, so only inspect what was built.
      runChatCustomScript('ctx.notify("hi");', { root: document.body }).catch(() => {});
      await Promise.resolve();

      expect(created).toHaveLength(1);
      const sandbox = created[0].getAttribute('sandbox');
      expect(sandbox).toBe('allow-scripts');
      expect(sandbox).not.toContain('allow-same-origin');
      expect(created[0].srcdoc).toContain('addEventListener');
      // The script body must travel by postMessage, not be inlined into the frame.
      expect(created[0].srcdoc).not.toContain('ctx.notify("hi")');
    } finally {
      document.createElement = originalCreateElement;
      for (const frame of created) frame.remove();
    }
  });

  it('returns null for an empty script without creating a frame', async () => {
    const before = document.querySelectorAll('iframe').length;
    await expect(runChatCustomScript('   ')).resolves.toBeNull();
    expect(document.querySelectorAll('iframe').length).toBe(before);
  });
});
