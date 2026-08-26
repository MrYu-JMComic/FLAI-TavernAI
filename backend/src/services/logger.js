import { appConfig } from '../config.js';

const LEVELS = Object.freeze({ silent: 0, error: 1, warn: 2, info: 3, debug: 4 });

function enabled(level) {
  return LEVELS[level] <= (LEVELS[appConfig.logLevel] ?? LEVELS.info);
}

function emit(level, event, fields = {}) {
  if (!enabled(level)) {
    return;
  }
  const payload = {
    time: new Date().toISOString(),
    level,
    event: String(event || 'log'),
    ...fields
  };
  const output = JSON.stringify(payload);
  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export const logger = Object.freeze({
  enabled,
  error: (event, fields) => emit('error', event, fields),
  warn: (event, fields) => emit('warn', event, fields),
  info: (event, fields) => emit('info', event, fields),
  debug: (event, fields) => emit('debug', event, fields)
});

export { LEVELS };
