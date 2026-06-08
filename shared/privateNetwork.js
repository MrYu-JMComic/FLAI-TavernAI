export function isLocalOrPrivateBaseUrl(value) {
  try {
    const { hostname } = new URL(String(value || ''));
    const host = hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
    if (host === 'localhost' || host === '::1') {
      return true;
    }

    const address = parseIpv4Address(host);
    if (!address) {
      return false;
    }
    return (
      address.first === 127 ||
      (address.first === 0 && address.second === 0 && address.third === 0 && address.fourth === 0) ||
      address.first === 10 ||
      (address.first === 172 && address.second >= 16 && address.second <= 31) ||
      (address.first === 192 && address.second === 168) ||
      (address.first === 198 && address.second === 18)
    );
  } catch {
    return false;
  }
}

function parseIpv4Address(host) {
  let first = -1;
  let second = -1;
  let third = -1;
  let octetIndex = 0;
  let octetValue = 0;
  let hasDigit = false;

  for (let index = 0; index <= host.length; index += 1) {
    const isEnd = index === host.length;
    if (!isEnd) {
      const code = host.charCodeAt(index);
      if (code >= 48 && code <= 57) {
        hasDigit = true;
        octetValue = (octetValue * 10) + code - 48;
        if (octetValue > 255) {
          return null;
        }
        continue;
      }
      if (code !== 46) {
        return null;
      }
    }

    if (!hasDigit) {
      return null;
    }
    if (octetIndex === 0) {
      first = octetValue;
    } else if (octetIndex === 1) {
      second = octetValue;
    } else if (octetIndex === 2) {
      third = octetValue;
    } else if (isEnd) {
      return { first, second, third, fourth: octetValue };
    } else {
      return null;
    }
    octetIndex += 1;
    octetValue = 0;
    hasDigit = false;
  }

  return null;
}
