import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), '../../..');

export function readRepoText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
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

export function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}
