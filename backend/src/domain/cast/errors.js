export class CastDomainError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'CastDomainError';
    this.code = options.code || 'CAST_INVALID';
    this.statusCode = options.statusCode || 400;
    this.status = this.statusCode;
    this.details = options.details || null;
  }
}

export function castNotFound(message = 'Cast resource not found') {
  return new CastDomainError(message, { code: 'CAST_NOT_FOUND', statusCode: 404 });
}

export function castConflict(message = 'Cast resource changed') {
  return new CastDomainError(message, { code: 'CAST_CONFLICT', statusCode: 409 });
}

export function castForbidden(message = 'Cast operation is not allowed') {
  return new CastDomainError(message, { code: 'CAST_FORBIDDEN', statusCode: 403 });
}
