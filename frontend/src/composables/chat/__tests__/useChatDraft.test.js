import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useChatDraft } from '../useChatDraft.js';

const storageKey = 'flai-chat-drafts:v1';
const drafts = [];

function createDraft(overrides = {}) {
  const state = { input: ref(''), conversationId: ref('chat-1'), userId: ref('user-1'), ...overrides };
  const draft = useChatDraft(state);
  drafts.push(draft);
  return { ...state, ...draft };
}

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
});

afterEach(() => {
  for (const draft of drafts.splice(0)) draft.cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('chat text drafts', () => {
  it('preserves and persists a prefilled composer instead of replacing it', () => {
    const first = createDraft();
    first.input.value = 'cached';
    first.cleanup();
    const next = createDraft({ input: ref('prefilled') });
    expect(next.input.value).toBe('prefilled');
    next.cleanup();
    expect(createDraft().input.value).toBe('prefilled');
  });

  it('debounces writes and restores exact whitespace on remount', () => {
    const first = createDraft();
    first.input.value = 'one';
    first.input.value = '  two\nthree  ';
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    vi.advanceTimersByTime(250);
    expect(first.draftStatus.value).toBe('saved');
    first.cleanup();
    expect(createDraft().input.value).toBe('  two\nthree  ');
  });

  it('flushes on navigation and isolates users and conversations', () => {
    const draft = createDraft();
    draft.input.value = 'chat one';
    draft.conversationId.value = 'chat-2';
    expect(draft.input.value).toBe('');
    draft.input.value = 'chat two';
    draft.userId.value = 'user-2';
    expect(draft.input.value).toBe('');
    draft.input.value = 'other user';
    draft.userId.value = 'user-1';
    expect(draft.input.value).toBe('chat two');
    draft.conversationId.value = 'chat-1';
    expect(draft.input.value).toBe('chat one');
  });

  it('flushes the latest keystroke on pagehide and cleanup', () => {
    const draft = createDraft();
    draft.input.value = 'before refresh';
    window.dispatchEvent(new Event('pagehide'));
    expect(JSON.parse(sessionStorage.getItem(storageKey)).entries[0].text).toBe('before refresh');
    draft.input.value = 'before leaving';
    draft.cleanup();
    expect(createDraft().input.value).toBe('before leaving');
    draft.input.value = 'late callback';
    vi.runAllTimers();
    expect(createDraft().input.value).toBe('before leaving');
  });

  it('clears submitted text immediately without reviving it on reload', () => {
    const draft = createDraft();
    draft.input.value = 'sent';
    draft.flushDraft();
    draft.input.value = '';
    expect(JSON.parse(sessionStorage.getItem(storageKey)).entries).toEqual([]);
    expect(createDraft().input.value).toBe('');
  });

  it('ignores expired or malformed entries and recovers corrupted storage', () => {
    sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, entries: [
      { scope: '["user-1","chat-1"]', text: 'expired', savedAt: Date.now() - 8 * 86400000 },
      { scope: '["user-1","chat-1"]', text: { unexpected: true }, savedAt: Date.now() }
    ] }));
    expect(createDraft().input.value).toBe('');
    sessionStorage.setItem(storageKey, '{broken');
    const draft = createDraft();
    draft.input.value = 'recovered';
    draft.flushDraft();
    expect(draft.draftStatus.value).toBe('saved');
    expect(createDraft().input.value).toBe('recovered');
  });

  it('bounds retained drafts and reports oversized text without truncating it', () => {
    const draft = createDraft();
    for (let index = 0; index < 25; index += 1) {
      draft.conversationId.value = `chat-${index}`;
      draft.input.value = `draft ${index}`;
    }
    draft.flushDraft();
    expect(JSON.parse(sessionStorage.getItem(storageKey)).entries).toHaveLength(20);
    draft.input.value = 'x'.repeat(512 * 1024);
    draft.flushDraft();
    expect(draft.draftStatus.value).toBe('unavailable');
    expect(draft.input.value.length).toBe(512 * 1024);
    const entries = JSON.parse(sessionStorage.getItem(storageKey)).entries;
    expect(entries).toHaveLength(19);
    expect(entries.some((entry) => entry.scope.endsWith('"chat-24"]'))).toBe(false);
  });

  it('reports storage denial without breaking typing and can retry later', () => {
    const draft = createDraft();
    const denied = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    draft.input.value = 'still available';
    expect(() => draft.flushDraft()).not.toThrow();
    expect(draft.input.value).toBe('still available');
    expect(draft.draftStatus.value).toBe('unavailable');
    denied.mockRestore();
    draft.flushDraft();
    expect(draft.draftStatus.value).toBe('saved');
  });
});
