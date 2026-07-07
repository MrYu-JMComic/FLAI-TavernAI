import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), '../../..');

export function readRepoText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function normalizeRepoPath(relativePath) {
  return relativePath.replaceAll('\\', '/');
}

function readFrontendStylesFile(relativePath, visited = new Set()) {
  const normalizedPath = normalizeRepoPath(relativePath);
  if (visited.has(normalizedPath)) {
    return '';
  }
  visited.add(normalizedPath);

  const source = readRepoText(normalizedPath);
  const importPattern = /^@import\s+(['"])(\.{1,2}\/[^'"]+\.css)\1\s*;/gm;
  const currentDir = path.posix.dirname(normalizedPath);
  let output = '';
  let cursor = 0;

  for (const match of source.matchAll(importPattern)) {
    output += source.slice(cursor, match.index);
    const importedPath = path.posix.normalize(path.posix.join(currentDir, match[2]));
    output += readFrontendStylesFile(importedPath, visited);
    cursor = match.index + match[0].length;
  }

  return output + source.slice(cursor);
}

function readFrontendEntryStylesFile(relativePath) {
  const normalizedPath = normalizeRepoPath(relativePath);
  const source = readRepoText(normalizedPath);
  const importPattern = /^import\s+(['"])(\.{1,2}\/[^'"]+\.css)\1\s*;/gm;
  const currentDir = path.posix.dirname(normalizedPath);
  const visited = new Set();
  let output = '';

  for (const match of source.matchAll(importPattern)) {
    const importedPath = path.posix.normalize(path.posix.join(currentDir, match[2]));
    output += readFrontendStylesFile(importedPath, visited);
  }

  return output;
}

export function readFrontendStyles() {
  return readFrontendEntryStylesFile('frontend/src/main.js');
}

export function readVueBlock(source, tag) {
  if (tag === 'template') {
    const start = source.indexOf('<template>');
    const end = source.lastIndexOf('</template>');
    return start === -1 || end === -1 || end <= start
      ? ''
      : source.slice(start + '<template>'.length, end);
  }

  const match = source.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return match?.[1] || '';
}

export function readVueBlocks(relativePath, tags = ['script', 'template']) {
  const source = readRepoText(relativePath);
  return Object.fromEntries([
    ['source', source],
    ...tags.map((tag) => [tag, readVueBlock(source, tag)])
  ]);
}

export function countMatches(source, pattern) {
  if (pattern instanceof RegExp) {
    const flags = pattern.global ? pattern.flags : `${pattern.flags}g`;
    return [...String(source).matchAll(new RegExp(pattern.source, flags))].length;
  }

  return [...String(source).matchAll(pattern)].length;
}
