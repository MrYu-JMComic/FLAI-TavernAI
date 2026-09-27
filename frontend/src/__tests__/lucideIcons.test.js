// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lucide from '@lucide/vue';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const LUCIDE_IMPORT = /import\s*\{([^}]*)\}\s*from\s*['"]@lucide\/vue['"]/g;

function listSourceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') files.push(...listSourceFiles(entryPath));
    } else if (/\.(vue|js)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

function collectImportedIcons() {
  const icons = new Map();
  for (const file of listSourceFiles(sourceRoot)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(LUCIDE_IMPORT)) {
      for (const specifier of match[1].split(',')) {
        const [exported] = specifier.trim().split(/\s+as\s+/);
        if (!exported) continue;
        if (!icons.has(exported)) icons.set(exported, []);
        icons.get(exported).push(path.relative(sourceRoot, file));
      }
    }
  }
  return icons;
}

describe('lucide icons', () => {
  it('every icon imported from @lucide/vue exists in the installed version', () => {
    const icons = collectImportedIcons();
    const missing = [...icons].filter(([name]) => !(name in lucide)).map(([name, files]) => `${name} (${files.join(', ')})`);

    expect(icons.size).toBeGreaterThan(50);
    expect(missing).toEqual([]);
  });
});
