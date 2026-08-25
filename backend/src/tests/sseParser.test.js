import assert from 'node:assert/strict';
import test from 'node:test';
import { createSseParser } from '../../../shared/sse.js';

test('SSE parser handles BOM, comments, ids, and exactly one optional data space', () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push([
    '\ufeff: keep alive',
    'id: event-1',
    'event: content',
    'data: first',
    'data:  second',
    '',
    ''
  ].join('\r\n')), [{
    event: 'content',
    data: 'first\n second',
    id: 'event-1'
  }]);
});

test('SSE parser handles fields without colons and resets empty event types', () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push('event: stale\n\ndata\n\n'), [{
    event: 'message',
    data: '',
    id: ''
  }]);
});

test('SSE parser ignores ids containing NUL and carries the previous valid id', () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push('id: valid\ndata: one\n\nid: bad\0id\ndata: two\n\n'), [
    { event: 'message', data: 'one', id: 'valid' },
    { event: 'message', data: 'two', id: 'valid' }
  ]);
});

test('SSE parser handles CRLF split across chunks and lone CR line endings', () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push('event: done\r'), []);
  assert.deepEqual(parser.push('\ndata: ok\r'), []);
  assert.deepEqual(parser.push('\r'), [{ event: 'done', data: 'ok', id: '' }]);
});

test('SSE parser leniently flushes a final gateway event without a blank line', () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push('event: done\ndata: final'), []);
  assert.deepEqual(parser.end(), [{ event: 'done', data: 'final', id: '' }]);
  assert.deepEqual(parser.end(), []);
});
