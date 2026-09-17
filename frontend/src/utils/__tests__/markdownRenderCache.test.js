import { describe, expect, it } from 'vitest';
import { createMarkdownRenderCache } from '../markdownRenderCache.js';

describe('bounded Markdown cache', () => {
  it('refreshes hits and evicts the least recently used entry', () => {
    const cache = createMarkdownRenderCache({ maxEntries: 2 });
    cache.set('a', 'first');
    cache.set('b', 'second');
    expect(cache.get('a')).toBe('first');
    cache.set('c', 'third');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('first');
    expect(cache.size).toBe(2);
  });

  it('bounds key plus HTML bytes and accounts for replacements', () => {
    const cache = createMarkdownRenderCache({ maxBytes: 20 });
    cache.set('a', '1234');
    cache.set('b', '1234');
    expect(cache.bytes).toBe(20);
    cache.set('a', '1');
    expect(cache.bytes).toBe(14);
    cache.set('c', '123');
    expect(cache.bytes).toBe(12);
    expect(cache.get('b')).toBeUndefined();
  });

  it('skips oversized renders without evicting history and caches empty HTML', () => {
    const cache = createMarkdownRenderCache({ maxEntryBytes: 12 });
    cache.set('a', '');
    cache.set('large', 'x'.repeat(100));
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBe('');
    expect(cache.get('large')).toBeUndefined();
  });
});
