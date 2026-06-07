import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const testDir = path.dirname(currentFile);
const testDeclarationPattern = /^\s*(?:describe|it|test)(?:\.(?:only|skip|todo))?\s*\(/;
const directDisabledTestPattern = /\b(?:describe|it|test)\.(?:only|skip|todo)\s*\(/;
const disabledTestOptionPattern = /\b(?:only|skip|todo)\s*:\s*(?:true|\s*(?=[,}]|$))/;

function isLineComment(line) {
  return line.trimStart().startsWith('//');
}

function maskNonCodeText(text) {
  let masked = '';
  let mode = 'code';
  let quote = '';
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (mode === 'lineComment') {
      if (char === '\r' || char === '\n') {
        masked += char;
        mode = 'code';
      } else {
        masked += ' ';
      }
      continue;
    }

    if (mode === 'blockComment') {
      if (char === '\r' || char === '\n') {
        masked += char;
      } else if (char === '*' && nextChar === '/') {
        masked += '  ';
        mode = 'code';
        index += 1;
      } else {
        masked += ' ';
      }
      continue;
    }

    if (mode === 'string') {
      if (char === '\r' || char === '\n') {
        masked += char;
        if (quote !== '`') {
          mode = 'code';
        }
        escaped = false;
        continue;
      }

      masked += ' ';
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        mode = 'code';
      }
      continue;
    }

    if (char === '/' && nextChar === '/') {
      masked += '  ';
      mode = 'lineComment';
      index += 1;
      continue;
    }

    if (char === '/' && nextChar === '*') {
      masked += '  ';
      mode = 'blockComment';
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      masked += ' ';
      quote = char;
      escaped = false;
      mode = 'string';
      continue;
    }

    masked += char;
  }

  return masked;
}

function createTestSource(fileName, text) {
  return {
    fileName,
    lines: text.split(/\r?\n/),
    maskedLines: maskNonCodeText(text).split(/\r?\n/)
  };
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
  return testFileNames().map((fileName) => createTestSource(fileName, fs.readFileSync(path.join(testDir, fileName), 'utf8')));
}

const testFiles = readTestFiles();

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

function findMockAssignmentViolations(sourceFiles) {
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

  for (const { fileName, maskedLines } of sourceFiles) {
    maskedLines.forEach((line, index) => {
      for (const rule of mockRules) {
        if (!rule.mockPattern.test(line)) continue;
        if (!hasRestoreBeforeNextTest(maskedLines, index, rule.restorePattern)) {
          violations.push(`${fileName}:${index + 1} assigns ${rule.label} without a restore guard`);
        }
      }
    });
  }

  return violations;
}

function findMockRestoreViolations(sourceFiles) {
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

  for (const { fileName, maskedLines } of sourceFiles) {
    maskedLines.forEach((line, index) => {
      for (const rule of restoreRules) {
        if (!rule.pattern.test(line)) continue;
        if (previousNonEmptyLine(maskedLines, index) !== '} finally {') {
          violations.push(`${fileName}:${index + 1} restores ${rule.label} outside finally`);
        }
      }
    });
  }

  return violations;
}

function findDisabledTestViolations(sourceFiles) {
  const violations = [];

  for (const { fileName, maskedLines } of sourceFiles) {
    let scanningTestOptions = false;

    maskedLines.forEach((line, index) => {
      const startsTestDeclaration = testDeclarationPattern.test(line);
      if (startsTestDeclaration) {
        scanningTestOptions = true;
      }

      if (directDisabledTestPattern.test(line) || (scanningTestOptions && disabledTestOptionPattern.test(line))) {
        violations.push(`${fileName}:${index + 1} contains a focused, skipped, or todo test`);
      }

      if (scanningTestOptions && /(?:=>|\bfunction\b|;\s*$)/.test(line)) {
        scanningTestOptions = false;
      }
    });
  }

  return violations;
}

test('global test mock assignments have restore guards', () => {
  assert.deepEqual(findMockAssignmentViolations(testFiles), []);
});

test('global test mocks are restored from finally blocks', () => {
  assert.deepEqual(findMockRestoreViolations(testFiles), []);
});

test('backend tests do not commit focused, skipped, or todo test cases', () => {
  assert.deepEqual(findDisabledTestViolations(testFiles), []);
});

test('test hygiene ignores disabled-test text inside comments and strings', () => {
  const sourceFiles = [
    createTestSource('sample.test.js', [
      "const fixture = \"test.skip('fixture only', () => {})\";",
      "const template = `test.only('template only', () => {})`;",
      '// test.todo("comment only", () => {});',
      '/*',
      "test.skip('block comment only', () => {});",
      '*/',
      'const fixtureOptions = { skip: true, todo: "not a test option" };',
      "test('real skipped option', { skip: true }, () => {});",
      "test('real todo option', {",
      "  todo: 'not ready'",
      '}, () => {});',
      "test.only('real focused test', () => {});"
    ].join('\n'))
  ];

  assert.deepEqual(findDisabledTestViolations(sourceFiles), [
    'sample.test.js:8 contains a focused, skipped, or todo test',
    'sample.test.js:10 contains a focused, skipped, or todo test',
    'sample.test.js:12 contains a focused, skipped, or todo test'
  ]);
});

test('test hygiene ignores mock restore text inside comments and strings', () => {
  const sourceFiles = [
    createTestSource('sample.test.js', [
      "const fixture = 'console.warn = originalWarn;';",
      '/*',
      'console.warn = originalWarn;',
      '*/',
      'try {',
      '  console.warn = () => {};',
      '} finally {',
      '  console.warn = originalWarn;',
      '}',
      'console.warn = originalWarn;'
    ].join('\n'))
  ];

  assert.deepEqual(findMockRestoreViolations(sourceFiles), [
    'sample.test.js:10 restores console.warn outside finally'
  ]);
});

test('test hygiene ignores mock assignment text inside comments and strings', () => {
  const sourceFiles = [
    createTestSource('sample.test.js', [
      "const fixture = 'console.warn = () => {};';",
      '/*',
      'console.warn = () => {};',
      '*/',
      'test("mock guard", () => {',
      '  console.warn = () => {};',
      '  console.warn = originalWarn;',
      '});',
      'test("missing restore", () => {',
      '  console.warn = () => {};',
      '});'
    ].join('\n'))
  ];

  assert.deepEqual(findMockAssignmentViolations(sourceFiles), [
    'sample.test.js:10 assigns console.warn without a restore guard'
  ]);
});
