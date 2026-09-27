import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAuthenticatedRequestBoundary } from '../validations/schemas.js';

test('authenticated request boundary validates params, query, and nested JSON with Zod', () => {
  let called = false;
  validateAuthenticatedRequestBoundary({
    params: { id: 'character-one' },
    query: { tag: 'friend', type: ['one', 'two'] },
    body: { nested: { enabled: true }, values: [1, null, 'three'] }
  }, responseStub(), () => {
    called = true;
  });
  assert.equal(called, true);
});

test('authenticated request boundary rejects oversized path and query values', () => {
  const response = responseStub();
  validateAuthenticatedRequestBoundary({
    params: { id: 'x'.repeat(501) },
    query: { value: 'y'.repeat(20_001) },
    body: undefined
  }, response, () => assert.fail('invalid request reached the handler'));
  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /过大|Too big/i);
});

test('authenticated request boundary rejects deep JSON iteratively without a stack overflow', () => {
  let value = {};
  for (let depth = 0; depth < 250; depth += 1) {
    value = { nested: value };
  }
  const response = responseStub();
  validateAuthenticatedRequestBoundary({ params: {}, query: {}, body: value }, response, () => {
    assert.fail('deep request reached the handler');
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /嵌套/);
});

function responseStub() {
  return {
    statusCode: 200,
    body: null,
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };
}
