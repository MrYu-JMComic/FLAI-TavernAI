import { existsSync, readFileSync, statSync } from 'node:fs';

const smallTextFileLimitBytes = 1024 * 1024;

export function readSmallTextFile(filePath) {
  const stats = statSync(filePath);
  if (stats.size > smallTextFileLimitBytes) {
    return '';
  }
  return readFileSync(filePath, 'utf8');
}

export function readJsonFile(filePath, fallback) {
  if (!existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(readFileSync(filePath, 'utf8'));
}
