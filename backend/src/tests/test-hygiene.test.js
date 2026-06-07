import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const testDir = path.dirname(currentFile);
const testDeclarationPattern = /^\s*(?:describe|it|test)(?:\.(?:only|skip|todo))?\s*\(/;
const directDisabledTestPattern = /\b(?:describe|it|test)\.(?:only|skip|todo)\s*\(/;
const disabledTestOptionPattern = /\b(?:only|skip|todo)\s*:\s*(?:true|['"`][^'"`]*['"`])/;

function isLineComment(line) {
  return line.trimStart().startsWith('//');
}

function previousNonEmptyLine(lines, index) {
  for (let i = index - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (line) return line;
  }
  return '';
}

function testFileNames() {
  return fs
    .readdirSync(testDir)
    .filter((name) => name.endsWith('.test.js') && path.join(testDir, name) !== currentFile);
}

function readTestFiles() {
  return testFileNames().map((fileName) => ({
    fileName,
    lines: fs.readFileSync(path.join(testDir, fileName), 'utf8').split(/\r?\n/)
  }));
}

const testFiles = readTestFiles();

function forEachTestSourceLine(callback) {
  for (const { fileName, lines } of testFiles) {
    lines.forEach((line, index) => {
      if (isLineComment(line)) return;
      callback({ fileName, lines, line, index });
    });
  }
}

function nextTestStartIndex(lines, index) {
  for (let i = index + 1; i < lines.length; i += 1) {
    if (!isLineComment(lines[i]) && testDeclarationPattern.test(lines[i])) return i;
  }
  return lines.length;
}

function hasRestoreBeforeNextTest(lines, index, restorePattern) {
  const endIndex = nextTestStartIndex(lines, index);
  for (let i = index + 1; i < endIndex; i += 1) {
    if (restorePattern.test(lines[i])) return true;
  }
  return false;
}

test('global test mock assignments have restore guards', () => {
  const mockRules = [
    {
      label: 'globalThis.fetch',
      mockPattern: /globalThis\.fetch\s*=(?!\s*originalFetch\b)/,
      restorePattern: /globalThis\.fetch\s*=\s*originalFetch;/
    },
    {
      label: 'Math.random',
      mockPattern: /Math\.random\s*=(?!\s*(?:origRandom|originalRandom)\b)/,
      restorePattern: /Math\.random\s*=\s*(?:origRandom|originalRandom);/
    },
    {
      label: 'console.warn',
      mockPattern: /console\.warn\s*=(?!\s*originalWarn\b)/,
      restorePattern: /console\.warn\s*=\s*originalWarn;/
    }
  ];
  const violations = [];

  forEachTestSourceLine(({ fileName, lines, line, index }) => {
    for (const rule of mockRules) {
      if (!rule.mockPattern.test(line)) continue;
      if (!hasRestoreBeforeNextTest(lines, index, rule.restorePattern)) {
        violations.push(`${fileName}:${index + 1} assigns ${rule.label} without a restore guard`);
      }
    }
  });

  assert.deepEqual(violations, []);
});

test('global test mocks are restored from finally blocks', () => {
  const restoreRules = [
    {
      label: 'globalThis.fetch',
      pattern: /globalThis\.fetch\s*=\s*originalFetch;/
    },
    {
      label: 'Math.random',
      pattern: /Math\.random\s*=\s*(?:origRandom|originalRandom);/
    },
    {
      label: 'console.warn',
      pattern: /console\.warn\s*=\s*originalWarn;/
    }
  ];
  const violations = [];

  forEachTestSourceLine(({ fileName, lines, line, index }) => {
    for (const rule of restoreRules) {
      if (!rule.pattern.test(line)) continue;
      if (previousNonEmptyLine(lines, index) !== '} finally {') {
        violations.push(`${fileName}:${index + 1} restores ${rule.label} outside finally`);
      }
    }
  });

  assert.deepEqual(violations, []);
});

test('backend tests do not commit focused, skipped, or todo test cases', () => {
  const violations = [];

  forEachTestSourceLine(({ fileName, line, index }) => {
    if (directDisabledTestPattern.test(line) || disabledTestOptionPattern.test(line)) {
      violations.push(`${fileName}:${index + 1} contains a focused, skipped, or todo test`);
    }
  });

  assert.deepEqual(violations, []);
});
