import { appConfig } from '../config.js';
import { AppError, appErrorFrom, publicErrorMessage } from '../errors.js';

/**
 * Build a stable error envelope for routes that handle an exception locally.
 * Raw provider/SQL messages are never returned for 5xx responses (or for
 * production 4xx responses); the original error remains available to the
 * caller's logger through the returned normalized error.
 */
export function routeErrorPayload(error, options = {}) {
  const status = Number.isInteger(options.status)
    ? options.status
    : Number.isInteger(error?.status) ? error.status : 400;
  const isProduction = options.isProduction ?? appConfig.isProduction;
  const safePublicMessage = options.publicMessage
    || (error instanceof AppError
      ? error.publicMessage
      : (isProduction || status >= 500)
        ? options.fallback || (status >= 500 ? undefined : '请求参数无效')
        : undefined);
  const normalized = appErrorFrom(error, {
    status,
    code: options.code || error?.code,
    publicMessage: safePublicMessage
  });
  const message = publicErrorMessage(normalized, status, {
    isProduction
  });
  return {
    error: message,
    code: normalized.code,
    normalized
  };
}

export function sendRouteError(response, error, options = {}) {
  const payload = routeErrorPayload(error, options);
  response.status(Number.isInteger(options.status) ? options.status : payload.normalized.status).json({
    error: payload.error,
    code: payload.code
  });
  return payload.normalized;
}
