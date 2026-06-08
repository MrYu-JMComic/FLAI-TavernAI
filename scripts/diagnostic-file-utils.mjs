import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const smallTextFileLimitBytes = 1024 * 1024;

export function compareDiagnosticText(left, right) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function getCliOptionValue(rawArgs, name) {
  const inlinePrefix = `${name}=`;
  let separateValue = null;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg.startsWith(inlinePrefix)) {
      const value = arg.slice(inlinePrefix.length);
      if (value.trim()) {
        return value;
      }
      continue;
    }

    if (arg !== name || separateValue !== null) {
      continue;
    }

    const value = rawArgs[index + 1];
    if (value && !value.startsWith('--') && value.trim()) {
      separateValue = value;
    }
  }

  return separateValue;
}

export function* walkFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => compareDiagnosticText(a.name, b.name));
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(entryPath);
    } else if (entry.isFile()) {
      yield entryPath;
    }
  }
}

export function toPosixPath(filePath) {
  return filePath.replaceAll('\\', '/');
}

export function maskNonNewlineText(text) {
  return text.replace(/[^\r\n]/g, ' ');
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function readSmallTextFile(filePath) {
  try {
    const stats = statSync(filePath);
    if (!stats.isFile() || stats.size > smallTextFileLimitBytes) {
      return '';
    }
    return readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

export function readJsonFile(filePath, fallback) {
  try {
    const text = readSmallTextFile(filePath);
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}
