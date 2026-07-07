import assert from 'node:assert/strict';
import test from 'node:test';

const {
  clearFrontendDiagnostics,
  getFrontendDiagnostics,
  recordFrontendDiagnostic
} = await import('../../../frontend/src/diagnostics.js');

test('frontend diagnostics keeps recent non-blocking error details', () => {
  clearFrontendDiagnostics();

  recordFrontendDiagnostic('csrf.preload', new Error('token endpoint failed'), {
    path: '/api/csrf-token',
    status: 503,
    ignored: false
  });

  const diagnostics = getFrontendDiagnostics();
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].id, 'diag-1');
  assert.equal(diagnostics[0].source, 'csrf.preload');
  assert.equal(diagnostics[0].message, 'token endpoint failed');
  assert.equal(diagnostics[0].name, 'Error');
  assert.match(diagnostics[0].stack, /token endpoint failed/);
  assert.deepEqual(diagnostics[0].context, {
    path: '/api/csrf-token',
    status: 503,
    ignored: false
  });
});

test('frontend diagnostics redacts secret-shaped context and caps retained entries', () => {
  clearFrontendDiagnostics();

  for (let index = 0; index < 55; index += 1) {
    recordFrontendDiagnostic('provider.refresh', `failure ${index}`, {
      apiKey: 'sk-secret-value',
      nested: { token: 'raw-token-value', safe: index }
    });
  }

  const diagnostics = getFrontendDiagnostics();
  assert.equal(diagnostics.length, 50);
  assert.equal(diagnostics[0].message, 'failure 5');
  assert.equal(diagnostics[49].id, 'diag-55');
  assert.deepEqual(diagnostics[49].context, {
    apiKey: '[redacted]',
    nested: { token: '[redacted]', safe: 54 }
  });
});
