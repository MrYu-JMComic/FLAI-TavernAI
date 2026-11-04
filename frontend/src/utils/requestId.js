/** Create a random request identity on secure origins and HTTP LAN deployments. */
export function createRequestId() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
