import { expect, test } from '@playwright/test';
import { registerUser } from './helpers.js';

// F-01 recommendation 3: owner custom JS runs in a script-only iframe, so it
// must not be able to reach this document's cookies, storage or same-origin
// fetch even though the owner authorized it.
test('owner custom scripts cannot reach app credentials or storage', async ({ page }) => {
  await registerUser(page);
  await page.evaluate(() => {
    document.cookie = 'flai_e2e_probe=secret-value; path=/';
    localStorage.setItem('flai_e2e_probe', 'secret-value');
  });

  const probe = await page.evaluate(async () => {
    const { runChatCustomScript } = await import('/src/utils/chatAppearance.js');
    const results = {};
    const record = (name, script) => runChatCustomScript(script, { root: document.body })
      .then(() => { results[name] = 'resolved'; })
      .catch((error) => { results[name] = `rejected:${String(error?.message || error)}`; });

    // Each probe throws inside the sandbox when the API is unreachable, which
    // is the outcome we want; a resolve would mean the data was readable.
    await record('cookie', 'if (document.cookie.includes("flai_e2e_probe")) throw new Error("COOKIE_READABLE"); ');
    await record('storage', 'if (localStorage.getItem("flai_e2e_probe")) throw new Error("STORAGE_READABLE"); ');
    await record('fetch', 'const r = await fetch("/api/auth/me", { credentials: "include" }); if (r.ok) throw new Error("SAME_ORIGIN_FETCH_OK");');
    await record('parentDom', 'if (typeof document !== "undefined" && document.querySelector(".chat-view")) throw new Error("PARENT_DOM_REACHABLE");');
    return results;
  });

  // Nothing may report the app's own cookie, storage, session or DOM.
  expect(probe.cookie).not.toContain('COOKIE_READABLE');
  expect(probe.storage).not.toContain('STORAGE_READABLE');
  expect(probe.fetch).not.toContain('SAME_ORIGIN_FETCH_OK');
  expect(probe.parentDom).not.toContain('PARENT_DOM_REACHABLE');

  // The app's own document still has the values, proving the probes ran
  // against a real origin rather than a blank page.
  await expect.poll(() => page.evaluate(() => document.cookie.includes('flai_e2e_probe'))).toBe(true);
});

test('sandboxed scripts still reach the whitelisted host API', async ({ page }) => {
  await registerUser(page);

  const calls = await page.evaluate(async () => {
    const { runChatCustomScript } = await import('/src/utils/chatAppearance.js');
    const seen = [];
    const cleanup = await runChatCustomScript(
      'await ctx.notify("from-sandbox"); ctx.onCleanup(() => {}); await ctx.wait(1);',
      {
        root: document.body,
        notify: (message) => { seen.push(message); }
      }
    );
    await cleanup?.();
    return { seen, hasCleanup: typeof cleanup === 'function' };
  });

  expect(calls.seen).toEqual(['from-sandbox']);
  expect(calls.hasCleanup).toBe(true);
});

test('sandbox cleanup stays local, runs in reverse order, and disposes the frame once', async ({ page }) => {
  await registerUser(page);
  const result = await page.evaluate(async () => {
    const { runChatCustomScript } = await import('/src/utils/chatAppearance.js');
    const seen = [];
    const initialFrames = document.querySelectorAll('iframe').length;
    const dispose = await runChatCustomScript(
      'onCleanup(async () => { await notify("registered"); }); return async () => { await ctx.notify("returned"); };',
      { notify: (message) => { seen.push(message); } }
    );
    const framesWhileActive = document.querySelectorAll('iframe').length;
    const callsBeforeCleanup = seen.length;
    await Promise.all([dispose(), dispose()]);
    await dispose();
    return { seen, initialFrames, framesWhileActive, finalFrames: document.querySelectorAll('iframe').length, callsBeforeCleanup };
  });
  expect(result.callsBeforeCleanup).toBe(0);
  expect(result.seen).toEqual(['returned', 'registered']);
  expect(result.framesWhileActive).toBe(result.initialFrames + 1);
  expect(result.finalFrames).toBe(result.initialFrames);
});

test('sandbox errors run registered cleanup and preserve the original error', async ({ page }) => {
  await registerUser(page);
  const result = await page.evaluate(async () => {
    const { runChatCustomScript } = await import('/src/utils/chatAppearance.js');
    const seen = [];
    const before = document.querySelectorAll('iframe').length;
    let message = '';
    try {
      await runChatCustomScript('ctx.onCleanup(async () => { await ctx.notify("cleaned"); }); throw new Error("script-failure");', {
        notify: (value) => { seen.push(value); }
      });
    } catch (error) {
      message = error.message;
    }
    return { seen, message, before, after: document.querySelectorAll('iframe').length };
  });
  expect(result.seen).toEqual(['cleaned']);
  expect(result.message).toBe('script-failure');
  expect(result.after).toBe(result.before);
});
