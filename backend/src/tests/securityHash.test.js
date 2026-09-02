import assert from 'node:assert/strict';
import test from 'node:test';

const { hashPassword, verifyPassword } = await import('../security.js');

test('verifyPassword fails closed for malformed or oversized hashes', async () => {
  const valid = await hashPassword('hash-test-password');
  const parts = valid.split(':');
  const malformed = [
    '',
    'scrypt:short:short',
    `scrypt:${Buffer.alloc(16).toString('base64')}:${Buffer.alloc(32).toString('base64')}`,
    `scrypt:${Buffer.alloc(17).toString('base64')}:${parts[2]}`,
    `scrypt:${parts[1]}:${Buffer.alloc(63).toString('base64')}`,
    `scrypt:${parts[1]}:${parts[2]}:trailing`,
    `scrypt:${'x'.repeat(300)}:${parts[2]}`
  ];
  for (const value of malformed) {
    assert.equal(await verifyPassword('hash-test-password', value), false, value.slice(0, 32));
  }
  assert.equal(await verifyPassword('hash-test-password', valid), true);
});
