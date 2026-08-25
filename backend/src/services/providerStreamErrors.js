export function providerStreamErrorMessage(payload, fallback = 'AI 供应商流式响应失败') {
  const error = payload?.error || payload?.response?.error;
  return firstNonEmptyText(
    typeof error === 'string' ? error : '',
    error?.message,
    payload?.message,
    error?.type,
    fallback
  );
}

export function hasProviderStreamError(payload, eventName = '') {
  return Boolean(
    String(eventName || '').trim().toLowerCase() === 'error'
    || payload?.type === 'error'
    || payload?.type === 'response.failed'
    || payload?.error
    || payload?.response?.error
  );
}

function firstNonEmptyText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}
