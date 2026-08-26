import { appConfig } from './config.js';

export const INTERNAL_ERROR_MESSAGE = '服务器内部错误，请稍后重试';

export class AppError extends Error {
  constructor(status, code, publicMessage, options = {}) {
    super(options.cause ? String(options.cause.message || options.cause) : publicMessage, options);
    this.name = 'AppError';
    this.status = Number.isInteger(status) ? status : 500;
    this.code = String(code || 'INTERNAL_ERROR');
    this.publicMessage = String(publicMessage || INTERNAL_ERROR_MESSAGE);
    this.cause = options.cause;
    this.details = options.details;
  }
}

export function publicErrorMessage(error, status = 500, options = {}) {
  if (error?.publicMessage) {
    return String(error.publicMessage);
  }
  const isProduction = options.isProduction ?? appConfig.isProduction;
  if (!isProduction && status < 500) {
    return String(error?.message || '请求失败');
  }
  return status >= 500 ? INTERNAL_ERROR_MESSAGE : String(error?.message || '请求失败');
}

export function appErrorFrom(error, options = {}) {
  if (error instanceof AppError) {
    return error;
  }
  const status = Number.isInteger(options.status) ? options.status : Number(error?.status) || 500;
  const code = options.code || error?.code || (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
  const message = options.publicMessage || (status >= 500 ? INTERNAL_ERROR_MESSAGE : error?.message || '请求失败');
  return new AppError(status, code, message, { cause: error, details: options.details });
}
