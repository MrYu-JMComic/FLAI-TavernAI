import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), '../../..');
const sourceExtensions = new Set(['.js', '.mjs', '.cjs', '.vue', '.ts']);
const debuggerStatementPattern = /(?:^|[;{}\s)])debugger(?=\s*(?:;|$))/;
const frontendConsoleLogPattern = /(?:^|[^\w$])console\s*\.\s*log\s*\(/;
const frontendDebugConsolePattern = /(?:^|[^\w$])console\s*\.\s*(?:debug|trace)\s*\(/;
const frontendConsoleOutputPattern = /(?:^|[^\w$])console\s*\.\s*(?:debug|error|log|trace|warn)\s*\(/;
const qualitySuppressionCommentPattern = /(?:\/\/|\/\*)\s*(?:eslint-disable(?:-next-line|-line)?|@ts-(?:expect-error|ignore|nocheck))\b/;

function isSourceFile(filePath) {
  return sourceExtensions.has(path.extname(filePath));
}

function listSourceFiles(rootDir) {
  const files = [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(entryPath));
    } else if (entry.isFile() && isSourceFile(entryPath) && entryPath !== currentFile) {
      files.push(entryPath);
    }
  }

  return files;
}

function relativePath(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

function canStartRegexLiteral(maskedText) {
  const trimmed = maskedText.trimEnd();
  const lastLineBreakIndex = Math.max(trimmed.lastIndexOf('\n'), trimmed.lastIndexOf('\r'));
  const trimmedLine = trimmed.slice(lastLineBreakIndex + 1);
  if (!trimmedLine) return true;
  if (/[({\[=,:;!?&|+\-*~^<>]$/.test(trimmedLine)) return true;
  return /\b(?:await|case|delete|return|throw|typeof|void|yield)$/.test(trimmedLine);
}

function maskSourceText(text, { preserveComments = false } = {}) {
  let masked = '';
  let mode = 'code';
  let stringQuote = null;
  let escaped = false;
  let templateExpressionDepth = 0;
  let regexInCharClass = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (mode === 'lineComment') {
      if (char === '\r' || char === '\n') {
        masked += char;
        mode = 'code';
      } else {
        masked += preserveComments ? char : ' ';
      }
      continue;
    }

    if (mode === 'blockComment') {
      if (char === '\r' || char === '\n') {
        masked += char;
      } else if (char === '*' && nextChar === '/') {
        masked += preserveComments ? '*/' : '  ';
        mode = 'code';
        i += 1;
      } else {
        masked += preserveComments ? char : ' ';
      }
      continue;
    }

    if (mode === 'string') {
      if (char === '\r' || char === '\n') {
        masked += char;
        mode = 'code';
        escaped = false;
        continue;
      }
      masked += ' ';
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === stringQuote) {
        mode = 'code';
      }
      continue;
    }

    if (mode === 'regex') {
      if (char === '\r' || char === '\n') {
        masked += char;
        mode = 'code';
        escaped = false;
        regexInCharClass = false;
        continue;
      }

      masked += ' ';
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '[') {
        regexInCharClass = true;
      } else if (char === ']') {
        regexInCharClass = false;
      } else if (char === '/' && !regexInCharClass) {
        mode = 'regexFlags';
      }
      continue;
    }

    if (mode === 'regexFlags') {
      if (/[a-z]/i.test(char)) {
        masked += ' ';
        continue;
      }

      mode = 'code';
      i -= 1;
      continue;
    }

    if (mode === 'template') {
      if (char === '\r' || char === '\n') {
        masked += char;
        escaped = false;
        continue;
      }
      if (escaped) {
        masked += ' ';
        escaped = false;
        continue;
      }
      if (char === '\\') {
        masked += ' ';
        escaped = true;
        continue;
      }
      if (char === '`') {
        masked += ' ';
        mode = 'code';
        continue;
      }
      if (char === '$' && nextChar === '{') {
        masked += '  ';
        templateExpressionDepth += 1;
        mode = 'code';
        i += 1;
        continue;
      }
      masked += ' ';
      continue;
    }

    if (char === '\r' || char === '\n') {
      masked += char;
      continue;
    }

    if (char === '/' && nextChar === '/') {
      masked += preserveComments ? '//' : '  ';
      i += 1;
      mode = 'lineComment';
      continue;
    }

    if (char === '/' && nextChar === '*') {
      masked += preserveComments ? '/*' : '  ';
      mode = 'blockComment';
      i += 1;
      continue;
    }

    if (char === '/' && canStartRegexLiteral(masked)) {
      masked += ' ';
      mode = 'regex';
      escaped = false;
      regexInCharClass = false;
      continue;
    }

    if (char === '"' || char === "'") {
      masked += ' ';
      stringQuote = char;
      mode = 'string';
      escaped = false;
      continue;
    }

    if (char === '`') {
      masked += ' ';
      mode = 'template';
      escaped = false;
      continue;
    }

    if (templateExpressionDepth > 0) {
      if (char === '{') {
        templateExpressionDepth += 1;
        masked += char;
        continue;
      }
      if (char === '}') {
        templateExpressionDepth -= 1;
        if (templateExpressionDepth === 0) {
          masked += ' ';
          mode = 'template';
        } else {
          masked += char;
        }
        continue;
      }
    }

    masked += char;
  }

  return masked;
}

function findMaskedLineViolations(fileLabel, maskedText, pattern, message) {
  const violations = [];
  const lines = maskedText.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (pattern.test(line)) {
      violations.push(`${fileLabel}:${index + 1} ${message}`);
    }
  });

  return violations;
}

function findTextLineViolations(fileLabel, text, pattern, message) {
  return findMaskedLineViolations(fileLabel, maskSourceText(text), pattern, message);
}

function findCommentLineViolations(fileLabel, text, pattern, message) {
  return findMaskedLineViolations(fileLabel, maskSourceText(text, { preserveComments: true }), pattern, message);
}

function readSourceFiles(rootDir) {
  const readFiles = [];

  for (const filePath of listSourceFiles(rootDir)) {
    const text = fs.readFileSync(filePath, 'utf8');
    readFiles.push({
      fileLabel: relativePath(filePath),
      maskedText: maskSourceText(text),
      commentText: maskSourceText(text, { preserveComments: true })
    });
  }

  return readFiles;
}

function findSourceViolations(sourceFiles, pattern, message) {
  const violations = [];

  for (const sourceFile of sourceFiles) {
    violations.push(...findMaskedLineViolations(sourceFile.fileLabel, sourceFile.maskedText, pattern, message));
  }

  return violations;
}

function findSourceCommentViolations(sourceFiles, pattern, message) {
  const violations = [];

  for (const sourceFile of sourceFiles) {
    violations.push(...findMaskedLineViolations(sourceFile.fileLabel, sourceFile.commentText, pattern, message));
  }

  return violations;
}

const backendSourceFiles = readSourceFiles(path.join(repoRoot, 'backend/src'));
const frontendSourceFiles = readSourceFiles(path.join(repoRoot, 'frontend/src'));

test('source hygiene ignores comments and string literals', () => {
  const sample = [
    'const word = "debugger";',
    'const snippet = \'console.log("debug")\';',
    "// debugger; console.log('comment');",
    "/* console.log('block'); debugger; */",
    'const flags = { debugger: false };',
    'const enabled = window.debuggerEnabled;',
    'debugger;',
    'myconsole.log("not global console");',
    "console.log('real debug');",
    "console . log('spaced debug');"
  ].join('\n');

  assert.deepEqual(findTextLineViolations('sample.js', sample, debuggerStatementPattern, 'contains a debugger statement'), [
    'sample.js:7 contains a debugger statement'
  ]);
  assert.deepEqual(findTextLineViolations('sample.js', sample, frontendConsoleLogPattern, 'contains console.log debug output'), [
    'sample.js:9 contains console.log debug output',
    'sample.js:10 contains console.log debug output'
  ]);
});

test('source hygiene scans template interpolation code', () => {
  const sample = [
    "const text = `console.log('text only'); debugger;`;",
    "const call = `${console.log('real debug')}`;",
    "const spaced = `${console . log('spaced debug')}`;",
    "const stop = `${(() => { debugger; })()}`;"
  ].join('\n');

  assert.deepEqual(findTextLineViolations('sample.js', sample, debuggerStatementPattern, 'contains a debugger statement'), [
    'sample.js:4 contains a debugger statement'
  ]);
  assert.deepEqual(findTextLineViolations('sample.js', sample, frontendConsoleLogPattern, 'contains console.log debug output'), [
    'sample.js:2 contains console.log debug output',
    'sample.js:3 contains console.log debug output'
  ]);
});

test('source hygiene ignores regex literals', () => {
  const sample = [
    'const consolePattern = /console\\s*\\.\\s*log\\s*\\(/;',
    'const debuggerPattern = /debugger\\s*;/;',
    "console.log('real debug');",
    'debugger;'
  ].join('\n');

  assert.deepEqual(findTextLineViolations('sample.js', sample, debuggerStatementPattern, 'contains a debugger statement'), [
    'sample.js:4 contains a debugger statement'
  ]);
  assert.deepEqual(findTextLineViolations('sample.js', sample, frontendConsoleLogPattern, 'contains console.log debug output'), [
    'sample.js:3 contains console.log debug output'
  ]);
});

test('source hygiene detects frontend debug-only console methods', () => {
  const sample = [
    "const debugText = 'console.debug(\"text only\")';",
    '// console.trace("comment only");',
    'const debugPattern = /console\\.debug\\(/;',
    'logger.debug("not global console");',
    "console.debug('real debug');",
    "console . trace('real trace');"
  ].join('\n');

  assert.deepEqual(findTextLineViolations('sample.js', sample, frontendDebugConsolePattern, 'contains console debug output'), [
    'sample.js:5 contains console debug output',
    'sample.js:6 contains console debug output'
  ]);
});

test('source hygiene detects frontend raw console output', () => {
  const sample = [
    "const errorText = 'console.error(\"text only\")';",
    '// console.warn("comment only");',
    'const warnPattern = /console\\.warn\\(/;',
    'notify.error("not raw console");',
    "console.error('real error');",
    "console . warn('real warning');"
  ].join('\n');

  assert.deepEqual(findTextLineViolations('sample.js', sample, frontendConsoleOutputPattern, 'contains raw console output'), [
    'sample.js:5 contains raw console output',
    'sample.js:6 contains raw console output'
  ]);
});

test('source hygiene detects quality-suppression comments', () => {
  const sample = [
    "const text = '// eslint-disable-next-line no-console';",
    "const tsText = '@ts-ignore';",
    'const suppressPattern = /eslint-disable-next-line/;',
    '// eslint-disable-next-line no-console',
    '/* @ts-ignore */',
    '/* @ts-expect-error safe to ignore */',
    '// @ts-nocheck'
  ].join('\n');

  assert.deepEqual(findCommentLineViolations('sample.js', sample, qualitySuppressionCommentPattern, 'contains a quality-suppression comment'), [
    'sample.js:4 contains a quality-suppression comment',
    'sample.js:5 contains a quality-suppression comment',
    'sample.js:6 contains a quality-suppression comment',
    'sample.js:7 contains a quality-suppression comment'
  ]);
});

test('source files do not contain debugger statements', () => {
  assert.deepEqual(
    findSourceViolations([...backendSourceFiles, ...frontendSourceFiles], debuggerStatementPattern, 'contains a debugger statement'),
    []
  );
});

test('frontend source does not contain console.log debug output', () => {
  assert.deepEqual(findSourceViolations(frontendSourceFiles, frontendConsoleLogPattern, 'contains console.log debug output'), []);
});

test('frontend source does not contain debug-only console output', () => {
  assert.deepEqual(findSourceViolations(frontendSourceFiles, frontendDebugConsolePattern, 'contains console debug output'), []);
});

test('frontend source does not contain raw console output', () => {
  assert.deepEqual(findSourceViolations(frontendSourceFiles, frontendConsoleOutputPattern, 'contains raw console output'), []);
});

test('source files do not contain quality-suppression comments', () => {
  assert.deepEqual(
    findSourceCommentViolations([...backendSourceFiles, ...frontendSourceFiles], qualitySuppressionCommentPattern, 'contains a quality-suppression comment'),
    []
  );
});
