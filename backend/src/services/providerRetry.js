const DEFAULT_RETRY_DELAYS_MS = Object.freeze([1_500, 4_000]);

/**
 * Retry a provider call for transient failures (429, 5xx, gateway credential
 * pool temporarily empty, network resets). Non-retryable errors are rethrown
 * immediately; abort signals stop the loop without waiting.
 */
export async function retryProviderCall(operation, options = {}) {
  const delays = Array.isArray(options.retryDelaysMs) ? options.retryDelaysMs : DEFAULT_RETRY_DELAYS_MS;
  const signal = options.signal;
  let attempt = 0;
  for (;;) {
    throwIfAborted(signal);
    try {
      return await operation(attempt);
    } catch (error) {
      if (signal?.aborted || attempt >= delays.length || !isTransientProviderError(error)) {
        throw error;
      }
      options.onRetry?.(error, attempt + 1);
      await wait(delays[attempt], signal);
      attempt += 1;
    }
  }
}

export function isTransientProviderError(error) {
  if (!error || typeof error !== 'object') return false;
  if (error.name === 'AbortError') return false;
  if (error.retryable === true) return true;
  const status = providerErrorStatus(error);
  return status === 408 || status === 429 || status >= 500;
}

export function providerErrorStatus(error) {
  const candidates = [error?.status, error?.statusCode, error?.response?.status];
  for (const value of candidates) {
    const status = Number(value);
    if (Number.isInteger(status) && status > 0) return status;
  }
  return 0;
}

function wait(delayMs, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, Math.max(0, Number(delayMs) || 0));
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException('The provider retry was aborted', 'AbortError'));
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
  throw signal.reason || new DOMException('The provider call was aborted', 'AbortError');
}
