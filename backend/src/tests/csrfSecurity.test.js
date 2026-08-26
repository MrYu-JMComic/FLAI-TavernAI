import assert from 'node:assert/strict';
import test from 'node:test';

process.env.APP_SECRET = 'csrf-security-test-secret';

const { csrfProtection, csrfTokenEndpoint } = await import('../services/csrf.js');

test('CSRF tokens rotate and are bound to the authenticated session', () => {
  const first = issueToken({ auth: { sessionId: 'session-a' }, cookies: {}, headers: {} });
  const second = issueToken({ auth: { sessionId: 'session-a' }, cookies: {}, headers: {} });
  assert.notEqual(first.token, second.token);

  let called = false;
  csrfProtection({
    method: 'POST',
    auth: { sessionId: 'session-a' },
    cookies: { flai_csrf: first.token, flai_csrf_bind: 'session-a' },
    headers: {
      origin: 'http://localhost:5173',
      'sec-fetch-site': 'same-site',
      'x-csrf-token': first.token
    }
  }, mockResponse(), () => {
    called = true;
  });
  assert.equal(called, true);

  const replayResponse = mockResponse();
  csrfProtection({
    method: 'POST',
    auth: { sessionId: 'session-b' },
    cookies: { flai_csrf: first.token, flai_csrf_bind: 'session-a' },
    headers: {
      origin: 'http://localhost:5173',
      'x-csrf-token': first.token
    }
  }, replayResponse, () => assert.fail('replayed token must not pass'));
  assert.equal(replayResponse.statusCode, 419);
  assert.equal(replayResponse.body.code, 'CSRF_TOKEN_INVALID');
});

test('CSRF protection rejects cross-site mutation metadata before token checks', () => {
  const response = mockResponse();
  csrfProtection({
    method: 'DELETE',
    cookies: {},
    headers: {
      origin: 'https://attacker.example',
      'sec-fetch-site': 'cross-site'
    }
  }, response, () => assert.fail('cross-site request must not pass'));
  assert.equal(response.statusCode, 419);
  assert.equal(response.body.code, 'CSRF_ORIGIN_INVALID');
});

function issueToken(request) {
  const response = mockResponse();
  csrfTokenEndpoint(request, response);
  return {
    token: response.body.csrfToken,
    cookies: response.cookies
  };
}

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    cookies: {},
    cookie(name, value) {
      this.cookies[name] = value;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}
