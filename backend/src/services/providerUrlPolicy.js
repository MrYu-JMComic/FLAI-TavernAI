import dns from 'node:dns/promises';
import net from 'node:net';
import { appConfig } from '../config.js';

export const PROVIDER_MAX_REDIRECTS = 3;
export const PROVIDER_ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export class ProviderUrlError extends Error {
  constructor(message, code = 'PROVIDER_URL_REJECTED', options = {}) {
    super(message, options);
    this.name = 'ProviderUrlError';
    this.code = code;
    this.status = 400;
    this.publicMessage = message;
  }
}

export function providerUrlPolicyOptions(options = {}) {
  return {
    allowPrivateNetwork: options.allowPrivateNetwork === true,
    resolveDns: options.resolveDns ?? appConfig.providerResolveDns,
    lookup: options.lookup || dns.lookup
  };
}

export async function assertProviderUrlAllowed(value, options = {}) {
  const policy = providerUrlPolicyOptions(options);
  const url = parseProviderUrl(value);

  if (isPrivateOrSpecialHost(url.hostname)) {
    if (!policy.allowPrivateNetwork) {
      throw new ProviderUrlError('Provider Base URL cannot target a private or local network.', 'PROVIDER_PRIVATE_NETWORK_BLOCKED');
    }
    return url;
  }

  if (!policy.resolveDns) {
    return url;
  }

  let addresses;
  try {
    addresses = await policy.lookup(url.hostname, { all: true, verbatim: true });
  } catch (error) {
    // Reserved .test hosts are useful for local contract tests and are never
    // routable in production. Other resolution failures fail closed.
    if (!appConfig.isProduction && url.hostname.endsWith('.test')) {
      return url;
    }
    throw new ProviderUrlError('Provider host could not be resolved.', 'PROVIDER_HOST_UNRESOLVED', { cause: error });
  }

  const rows = Array.isArray(addresses) ? addresses : addresses ? [{ address: addresses }] : [];
  if (!rows.length) {
    throw new ProviderUrlError('Provider host could not be resolved.', 'PROVIDER_HOST_UNRESOLVED');
  }
  for (const address of rows) {
    const resolvedAddress = String(address?.address || '');
    // Clash and similar DNS fake-IP modes map public hostnames into the RFC 2544
    // benchmark range. Literal 198.18/15 URLs are still rejected above.
    if (isDnsProxyBenchmarkAddress(resolvedAddress)) {
      continue;
    }
    if (isPrivateOrSpecialAddress(resolvedAddress)) {
      if (!policy.allowPrivateNetwork) {
        throw new ProviderUrlError('Provider host resolves to a private or local network.', 'PROVIDER_PRIVATE_NETWORK_BLOCKED');
      }
    }
  }
  return url;
}

export function parseProviderUrl(value) {
  const text = String(value || '').trim();
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new ProviderUrlError('Provider Base URL must be a valid HTTP or HTTPS URL.', 'PROVIDER_URL_INVALID');
  }

  if (!PROVIDER_ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new ProviderUrlError('Provider Base URL must use HTTP or HTTPS.', 'PROVIDER_PROTOCOL_BLOCKED');
  }
  if (url.username || url.password) {
    throw new ProviderUrlError('Provider Base URL cannot contain credentials.', 'PROVIDER_CREDENTIALS_BLOCKED');
  }
  if (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535)) {
    throw new ProviderUrlError('Provider Base URL contains an invalid port.', 'PROVIDER_PORT_INVALID');
  }
  if (url.port && Number(url.port) < 1024 && ![80, 443].includes(Number(url.port))) {
    throw new ProviderUrlError('Provider Base URL uses a restricted port.', 'PROVIDER_PORT_BLOCKED');
  }
  url.hash = '';
  return url;
}

export function isPrivateOrSpecialHost(hostname) {
  const host = String(hostname || '').replace(/^\[(.*)\]$/, '$1').toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return true;
  }
  return isPrivateOrSpecialAddress(host);
}

export function isPrivateOrSpecialAddress(value) {
  const address = String(value || '').replace(/^\[(.*)\]$/, '$1').toLowerCase();
  const version = net.isIP(address);
  if (version === 4) {
    return isPrivateIpv4(address);
  }
  if (version === 6) {
    return isPrivateIpv6(address);
  }
  return false;
}

function isPrivateIpv4(value) {
  const octets = value.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = octets;
  return a === 0
    || a === 10
    || a === 100 && b >= 64 && b <= 127
    || a === 127
    || a === 169 && b === 254
    || a === 172 && b >= 16 && b <= 31
    || a === 192 && b === 0
    || a === 192 && b === 168
    || a === 192 && b === 2
    || a === 198 && (b === 18 || b === 19)
    || a === 198 && b === 51
    || a === 203 && b === 0 && octets[2] === 113
    || a >= 224;
}

function isDnsProxyBenchmarkAddress(value) {
  if (net.isIP(value) !== 4) {
    return false;
  }
  const firstSeparator = value.indexOf('.');
  const secondSeparator = value.indexOf('.', firstSeparator + 1);
  return value.slice(0, firstSeparator) === '198'
    && ['18', '19'].includes(value.slice(firstSeparator + 1, secondSeparator));
}

function isPrivateIpv6(value) {
  const groups = expandIpv6(value);
  if (!groups) {
    return true;
  }
  // IPv4-mapped and IPv4-compatible IPv6 addresses must use the IPv4 policy.
  if (groups.startsWith('00000000000000000000ffff')) {
    return true;
  }
  const first = Number.parseInt(groups.slice(0, 4), 16);
  return groups === '00000000000000000000000000000000'
    || groups.startsWith('00000000000000000000000000000001')
    || first >= 0xfc00 && first <= 0xfdff
    || first >= 0xfe80 && first <= 0xfebf
    || first >= 0xff00
    || first === 0x2001 && groups.startsWith('20010db8');
}

function expandIpv6(value) {
  const parts = value.split('::');
  if (parts.length > 2) {
    return '';
  }
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts[1] ? parts[1].split(':') : [];
  if (left.some(isHexGroupInvalid) || right.some(isHexGroupInvalid)) {
    return '';
  }
  const missing = 8 - left.length - right.length;
  if (parts.length === 1 && missing !== 0 || parts.length === 2 && missing < 1) {
    return '';
  }
  return [...left, ...Array.from({ length: missing }, () => '0'), ...right]
    .map((part) => part.padStart(4, '0'))
    .join('');
}

function isHexGroupInvalid(value) {
  return !value || value.length > 4 || !/^[0-9a-f]+$/i.test(value);
}
