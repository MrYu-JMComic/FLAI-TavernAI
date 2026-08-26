import assert from 'node:assert/strict';
import test from 'node:test';

process.env.APP_SECRET = 'provider-url-policy-test-secret';

const {
  assertProviderUrlAllowed,
  isPrivateOrSpecialAddress,
  parseProviderUrl
} = await import('../services/providerUrlPolicy.js');
const { fetchProviderRequest } = await import('../services/providerHttp.js');

test('provider URL policy rejects unsafe URL syntax and restricted ports', () => {
  assert.throws(() => parseProviderUrl('file:///etc/passwd'), { code: 'PROVIDER_PROTOCOL_BLOCKED' });
  assert.throws(() => parseProviderUrl('https://user:secret@example.com/v1'), { code: 'PROVIDER_CREDENTIALS_BLOCKED' });
  assert.throws(() => parseProviderUrl('http://example.com:22/v1'), { code: 'PROVIDER_PORT_BLOCKED' });
  assert.throws(() => parseProviderUrl('not a URL'), { code: 'PROVIDER_URL_INVALID' });
});

test('provider URL policy classifies IPv4 and IPv6 special ranges', () => {
  const blocked = [
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.2',
    '198.18.0.1',
    '224.0.0.1',
    '::',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '::ffff:127.0.0.1',
    '::ffff:8.8.8.8'
  ];
  for (const address of blocked) {
    assert.equal(isPrivateOrSpecialAddress(address), true, address);
  }
  assert.equal(isPrivateOrSpecialAddress('8.8.8.8'), false);
  assert.equal(isPrivateOrSpecialAddress('2606:4700:4700::1111'), false);
});

test('provider URL policy checks every resolved address and fails closed', async () => {
  await assert.rejects(
    assertProviderUrlAllowed('https://provider.example/v1', {
      resolveDns: true,
      lookup: async () => [{ address: '8.8.8.8' }, { address: '10.0.0.2' }]
    }),
    { code: 'PROVIDER_PRIVATE_NETWORK_BLOCKED' }
  );
  await assert.rejects(
    assertProviderUrlAllowed('https://provider.example/v1', {
      resolveDns: true,
      lookup: async () => []
    }),
    { code: 'PROVIDER_HOST_UNRESOLVED' }
  );
  const allowed = await assertProviderUrlAllowed('https://provider.example/v1', {
    resolveDns: true,
    lookup: async () => [{ address: '8.8.8.8' }]
  });
  assert.equal(allowed.hostname, 'provider.example');
});

test('provider URL policy accepts DNS fake-IP proxy mappings but rejects literal benchmark targets', async () => {
  const allowed = await assertProviderUrlAllowed('https://api.deepseek.com/v1', {
    resolveDns: true,
    lookup: async () => [{ address: '198.18.1.9' }]
  });
  assert.equal(allowed.hostname, 'api.deepseek.com');

  await assert.rejects(
    assertProviderUrlAllowed('https://198.18.1.9/v1', { resolveDns: true }),
    { code: 'PROVIDER_PRIVATE_NETWORK_BLOCKED' }
  );
});

test('provider redirects cannot cross into metadata or private networks', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, {
      status: 302,
      headers: { Location: 'http://169.254.169.254/latest/meta-data' }
    });
  };
  try {
    await assert.rejects(
      fetchProviderRequest('https://provider.example/v1/models', {}, {
        resolveDns: true,
        lookup: async () => [{ address: '8.8.8.8' }]
      }),
      { code: 'PROVIDER_PRIVATE_NETWORK_BLOCKED' }
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
