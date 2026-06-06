import assert from 'node:assert/strict';
import test from 'node:test';

const { sanitizeFields } = await import('../services/sanitize.js');

test('sanitizeFields treats null field lists as empty', () => {
  const payload = {
    name: '<b>Ada</b>',
    bio: '<strong>Hello</strong>'
  };

  const sanitized = sanitizeFields(payload, null, null);

  assert.deepEqual(sanitized, payload);
  assert.notEqual(sanitized, payload);
});
