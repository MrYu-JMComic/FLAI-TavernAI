const MAX_DIAGNOSTICS = 50;
const SECRET_KEY_PATTERN = /(?:api[_-]?key|authorization|cookie|secret|token|password|session)/i;

let nextDiagnosticId = 1;
const diagnostics = [];

export function recordFrontendDiagnostic(source, error, context = {}) {
  const entry = {
    id: `diag-${nextDiagnosticId}`,
    source: String(source || 'unknown'),
    message: normalizeDiagnosticMessage(error),
    name: normalizeDiagnosticName(error),
    stack: normalizeDiagnosticStack(error),
    context: sanitizeDiagnosticContext(context)
  };
  nextDiagnosticId += 1;
  diagnostics.push(entry);
  while (diagnostics.length > MAX_DIAGNOSTICS) {
    diagnostics.shift();
  }
  return entry;
}

export function getFrontendDiagnostics() {
  return diagnostics.map((entry) => ({
    ...entry,
    context: cloneDiagnosticValue(entry.context, '')
  }));
}

export function clearFrontendDiagnostics() {
  diagnostics.length = 0;
  nextDiagnosticId = 1;
}

function normalizeDiagnosticMessage(error) {
  if (error instanceof Error) {
    return error.message || error.name || 'Unknown error';
  }
  if (typeof error === 'string') {
    return error || 'Unknown error';
  }
  if (error && typeof error === 'object') {
    return String(error.message || error.error || 'Unknown error');
  }
  return String(error || 'Unknown error');
}

function normalizeDiagnosticName(error) {
  if (error instanceof Error) {
    return error.name || 'Error';
  }
  if (error && typeof error === 'object' && error.name) {
    return String(error.name);
  }
  return typeof error === 'string' ? 'Error' : typeof error;
}

function normalizeDiagnosticStack(error) {
  if (error instanceof Error && error.stack) {
    return String(error.stack);
  }
  return '';
}

function sanitizeDiagnosticContext(value) {
  return cloneDiagnosticValue(value, '');
}

function cloneDiagnosticValue(value, key) {
  if (SECRET_KEY_PATTERN.test(String(key || ''))) {
    return '[redacted]';
  }
  if (Array.isArray(value)) {
    const rows = [];
    for (let index = 0; index < value.length; index += 1) {
      rows.push(cloneDiagnosticValue(value[index], key));
    }
    return rows;
  }
  if (value && typeof value === 'object') {
    const output = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      output[entryKey] = cloneDiagnosticValue(entryValue, entryKey);
    }
    return output;
  }
  return value;
}
