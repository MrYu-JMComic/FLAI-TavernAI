import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), '../../..');
const sourceExtensions = new Set(['.js', '.mjs', '.cjs', '.vue', '.ts']);
const jsLikeSourceExtensions = new Set(['.js', '.mjs', '.cjs', '.ts']);
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
  const templateExpressionDepthStack = [];
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
        templateExpressionDepth = templateExpressionDepthStack.pop() || 0;
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
      templateExpressionDepthStack.push(templateExpressionDepth);
      templateExpressionDepth = 0;
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

function createSourceFile(fileLabel, text) {
  return {
    fileLabel,
    text,
    maskedText: maskSourceText(text),
    commentText: maskSourceText(text, { preserveComments: true })
  };
}

function readSourceFiles(rootDir) {
  const readFiles = [];

  for (const filePath of listSourceFiles(rootDir)) {
    const text = fs.readFileSync(filePath, 'utf8');
    readFiles.push(createSourceFile(relativePath(filePath), text));
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countIdentifier(maskedText, identifier) {
  const pattern = new RegExp(`\\b${escapeRegExp(identifier)}\\b`, 'g');
  return (maskedText.match(pattern) || []).length;
}

function toKebabCase(identifier) {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

function countVueTemplateComponentUsage(sourceFile, usageText, identifier) {
  if (!sourceFile.fileLabel.endsWith('.vue')) {
    return 0;
  }

  const kebabName = toKebabCase(identifier);
  const tagNames = kebabName === identifier ? [identifier] : [identifier, kebabName];

  return tagNames.reduce((count, tagName) => {
    const pattern = new RegExp(`<\\/?\\s*${escapeRegExp(tagName)}\\b`, 'g');
    return count + (usageText.match(pattern) || []).length;
  }, 0);
}

function countImportUsage(sourceFile, usageText, identifier) {
  return countIdentifier(usageText, identifier) + countVueTemplateComponentUsage(sourceFile, usageText, identifier);
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function addLineReference(linesByKey, key, lineNumber) {
  if (!linesByKey.has(key)) {
    linesByKey.set(key, []);
  }
  linesByKey.get(key).push(lineNumber);
}

function findDuplicateLineViolations(linesByKey, formatViolation) {
  const violations = [];

  for (const [key, lines] of linesByKey.entries()) {
    if (lines.length > 1) {
      violations.push(formatViolation(key, lines));
    }
  }

  return violations;
}

function isJsLikeSourceFile(fileLabel) {
  return jsLikeSourceExtensions.has(path.extname(fileLabel));
}

function isTestSourceFile(fileLabel) {
  return fileLabel.startsWith('backend/src/tests/');
}

function isSharedFrontendSfcTestHelper(fileLabel) {
  return fileLabel === 'backend/src/tests/frontendSfcTestUtils.js';
}

function isFrontendSourceTestFile(fileLabel) {
  return isTestSourceFile(fileLabel) && !isSharedFrontendSfcTestHelper(fileLabel);
}

function findStaticImportDeclarations(sourceFile) {
  const declarations = [];
  const importSourcePattern = /^\s*import\s+(?:[\s\S]*?\s+from\s+)?(['"])([^'"\r\n]+)\1(?:\s+(?:assert|with)\s+\{[\s\S]*?\})?\s*;?/gm;

  for (const match of sourceFile.text.matchAll(importSourcePattern)) {
    const maskedImport = sourceFile.maskedText.slice(match.index, match.index + match[0].length);
    if (!/^\s*import\b/.test(maskedImport)) {
      continue;
    }

    declarations.push({
      moduleName: match[2],
      index: match.index,
      endIndex: match.index + match[0].length
    });
  }

  return declarations;
}

function findTopLevelDeclarations(sourceFile, declarationPattern) {
  const declarations = [];
  let depth = 0;
  let cursor = 0;

  for (const match of sourceFile.maskedText.matchAll(declarationPattern)) {
    for (let i = cursor; i < match.index; i += 1) {
      if (sourceFile.maskedText[i] === '{') {
        depth += 1;
      } else if (sourceFile.maskedText[i] === '}') {
        depth = Math.max(0, depth - 1);
      }
    }

    if (depth === 0) {
      declarations.push({
        name: match[1],
        index: match.index,
        exported: /^\s*export\b/.test(match[0])
      });
    }
    cursor = match.index;
  }

  return declarations;
}

function findTopLevelFunctionDeclarations(sourceFile) {
  const functionDeclarationPattern = /^[^\S\r\n]*(?:export[^\S\r\n]+(?:default[^\S\r\n]+)?)?(?:async[^\S\r\n]+)?function(?:[^\S\r\n]*\*)?[^\S\r\n]+([A-Za-z_$][\w$]*)\b/gm;
  return findTopLevelDeclarations(sourceFile, functionDeclarationPattern);
}

function findTopLevelFunctionLikeConstDeclarations(sourceFile) {
  const functionLikeConstPattern = /^[^\S\r\n]*(?:export[^\S\r\n]+)?const[^\S\r\n]+([A-Za-z_$][\w$]*)[^\S\r\n]*(?::[^\r\n;]*)?=[^\S\r\n]*(?:async[^\S\r\n]+)?(?:function\b|(?:<[^=\r\n;{}]*>+[^\S\r\n]*)?\([^=\r\n;{}]*\)[^\S\r\n]*=>|[A-Za-z_$][\w$]*[^\S\r\n]*=>)/gm;
  return findTopLevelDeclarations(sourceFile, functionLikeConstPattern);
}

function parseNamedImportAliases(specifiers) {
  return specifiers
    .split(',')
    .map((specifier) => specifier.trim().replace(/^type\s+/, ''))
    .filter(Boolean)
    .map((specifier) => {
      const aliasMatch = specifier.match(/\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (aliasMatch) {
        return aliasMatch[1];
      }
      const nameMatch = specifier.match(/^([A-Za-z_$][\w$]*)$/);
      return nameMatch ? nameMatch[1] : null;
    })
    .filter(Boolean);
}

function parseImportBindings(importClause) {
  const bindings = [];
  const clause = importClause.trim().replace(/^type\s+/, '');
  const namedMatch = clause.match(/\{([\s\S]*?)\}/);
  const namespaceMatch = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  const defaultMatch = clause.match(/^([A-Za-z_$][\w$]*)\b/);

  if (defaultMatch) {
    bindings.push({ kind: 'default', alias: defaultMatch[1] });
  }
  if (namespaceMatch) {
    bindings.push({ kind: 'namespace', alias: namespaceMatch[1] });
  }
  if (namedMatch) {
    bindings.push(...parseNamedImportAliases(namedMatch[1]).map((alias) => ({ kind: 'named', alias })));
  }

  return bindings;
}

function findUnusedImportViolations(sourceFiles) {
  const violations = [];
  const importPattern = /^\s*import\s+([\s\S]*?)\s+from\b/gm;

  for (const sourceFile of sourceFiles) {
    for (const match of sourceFile.maskedText.matchAll(importPattern)) {
      const usageText = [
        sourceFile.maskedText.slice(0, match.index),
        ' '.repeat(match[0].length),
        sourceFile.maskedText.slice(match.index + match[0].length)
      ].join('');
      for (const binding of parseImportBindings(match[1])) {
        if (countImportUsage(sourceFile, usageText, binding.alias) === 0) {
          violations.push(`${sourceFile.fileLabel} imports unused ${binding.kind} binding ${binding.alias}`);
        }
      }
    }
  }

  return violations;
}

function findDuplicateImportSourceViolations(sourceFiles) {
  const violations = [];

  for (const sourceFile of sourceFiles) {
    const importsBySource = new Map();
    for (const declaration of findStaticImportDeclarations(sourceFile)) {
      addLineReference(importsBySource, declaration.moduleName, lineNumberAt(sourceFile.text, declaration.index));
    }

    violations.push(
      ...findDuplicateLineViolations(
        importsBySource,
        (moduleName, lines) => `${sourceFile.fileLabel} imports ${moduleName} from multiple declarations on lines ${lines.join(', ')}`
      )
    );
  }

  return violations;
}

function findLateImportDeclarationViolations(sourceFiles) {
  const violations = [];

  for (const sourceFile of sourceFiles) {
    if (!isJsLikeSourceFile(sourceFile.fileLabel)) {
      continue;
    }

    let previousImportEnd = 0;
    for (const declaration of findStaticImportDeclarations(sourceFile)) {
      if (sourceFile.maskedText.slice(previousImportEnd, declaration.index).trim()) {
        violations.push(
          `${sourceFile.fileLabel}:${lineNumberAt(sourceFile.text, declaration.index)} imports ${declaration.moduleName} after runtime code; keep import declarations before code`
        );
      }
      previousImportEnd = declaration.endIndex;
    }
  }

  return violations;
}

function findDuplicateTopLevelFunctionNameViolations(sourceFiles) {
  const violations = [];

  for (const sourceFile of sourceFiles) {
    if (!isJsLikeSourceFile(sourceFile.fileLabel)) {
      continue;
    }

    const linesByName = new Map();
    for (const declaration of findTopLevelFunctionDeclarations(sourceFile)) {
      addLineReference(linesByName, declaration.name, lineNumberAt(sourceFile.text, declaration.index));
    }

    violations.push(
      ...findDuplicateLineViolations(
        linesByName,
        (name, lines) => `${sourceFile.fileLabel} declares duplicate top-level function ${name} on lines ${lines.join(', ')}`
      )
    );
  }

  return violations;
}

function findUnusedPrivateTopLevelDeclarationViolations(sourceFiles, { declarationsFor, declarationLabel }) {
  const violations = [];

  for (const sourceFile of sourceFiles) {
    if (!isJsLikeSourceFile(sourceFile.fileLabel) || isTestSourceFile(sourceFile.fileLabel)) {
      continue;
    }

    for (const declaration of declarationsFor(sourceFile)) {
      if (declaration.exported) {
        continue;
      }
      if (countIdentifier(sourceFile.maskedText, declaration.name) <= 1) {
        violations.push(
          `${sourceFile.fileLabel}:${lineNumberAt(sourceFile.text, declaration.index)} declares unused private top-level ${declarationLabel} ${declaration.name}`
        );
      }
    }
  }

  return violations;
}

function findUnusedPrivateTopLevelFunctionViolations(sourceFiles) {
  return findUnusedPrivateTopLevelDeclarationViolations(sourceFiles, {
    declarationsFor: findTopLevelFunctionDeclarations,
    declarationLabel: 'function'
  });
}

function findUnusedPrivateTopLevelFunctionLikeConstViolations(sourceFiles) {
  return findUnusedPrivateTopLevelDeclarationViolations(sourceFiles, {
    declarationsFor: findTopLevelFunctionLikeConstDeclarations,
    declarationLabel: 'function-like const'
  });
}

function findDuplicateTestNameViolations(sourceFiles) {
  const violations = [];
  const testNamePattern = /\btest\s*\(\s*(['"])([^'"\r\n]+)\1/g;

  for (const sourceFile of sourceFiles) {
    if (!sourceFile.fileLabel.startsWith('backend/src/tests/')) {
      continue;
    }

    const linesByName = new Map();
    for (const match of sourceFile.text.matchAll(testNamePattern)) {
      if (sourceFile.maskedText.slice(match.index, match.index + 'test'.length) !== 'test') {
        continue;
      }

      addLineReference(linesByName, match[2], lineNumberAt(sourceFile.text, match.index));
    }

    violations.push(
      ...findDuplicateLineViolations(
        linesByName,
        (testName, lines) => `${sourceFile.fileLabel} declares duplicate test "${testName}" on lines ${lines.join(', ')}`
      )
    );
  }

  return violations;
}

function findDirectRepoTextReadViolations(sourceFiles, { isTargetPath, message }) {
  const violations = [];
  const directRepoTextReadPattern = /\breadRepoText\s*\(\s*(['"])([^'"]+)\1\s*\)/g;

  for (const sourceFile of sourceFiles) {
    if (!isFrontendSourceTestFile(sourceFile.fileLabel)) {
      continue;
    }

    for (const match of sourceFile.text.matchAll(directRepoTextReadPattern)) {
      if (
        sourceFile.maskedText.slice(match.index, match.index + 'readRepoText'.length) === 'readRepoText'
        && isTargetPath(match[2])
      ) {
        violations.push(`${sourceFile.fileLabel}:${lineNumberAt(sourceFile.text, match.index)} ${message}`);
      }
    }
  }

  return violations;
}

function findDirectVueBlockReadViolations(sourceFiles) {
  const violations = [];
  const directVueBlockReadPattern = /\breadVueBlock\b/;

  for (const sourceFile of sourceFiles) {
    if (!isFrontendSourceTestFile(sourceFile.fileLabel)) {
      continue;
    }

    violations.push(
      ...findMaskedLineViolations(
        sourceFile.fileLabel,
        sourceFile.maskedText,
        directVueBlockReadPattern,
        'uses readVueBlock directly; use readVueBlocks()'
      )
    );
  }

  violations.push(
    ...findDirectRepoTextReadViolations(sourceFiles, {
      isTargetPath: (targetPath) => targetPath.endsWith('.vue'),
      message: 'reads a Vue SFC directly; use readVueBlocks()'
    })
  );

  return violations;
}

function findDirectFrontendStyleReadViolations(sourceFiles) {
  return findDirectRepoTextReadViolations(sourceFiles, {
    isTargetPath: (targetPath) => targetPath === 'frontend/src/styles.css',
    message: 'reads frontend styles directly; use readFrontendStyles()'
  });
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

test('source hygiene resumes code after nested template literals', () => {
  const sample = [
    "const nested = `${items.map((item) => `- ${item.name}`).join('\\n')}`;",
    'debugger;'
  ].join('\n');

  assert.deepEqual(findTextLineViolations('sample.js', sample, debuggerStatementPattern, 'contains a debugger statement'), [
    'sample.js:2 contains a debugger statement'
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

test('source hygiene ignores comments and strings when finding unused imports', () => {
  const text = [
    "import unusedDefault, { unused, used as alias, type TypeOnly } from './sample.js';",
    "import UsedDefault from './used-default.js';",
    "import * as usedNamespace from './used-namespace.js';",
    "import * as unusedNamespace from './unused-namespace.js';",
    "const label = 'unusedDefault unused TypeOnly unusedNamespace';",
    '// unusedDefault unused TypeOnly unusedNamespace',
    'alias();',
    'UsedDefault();',
    'usedNamespace.run();'
  ].join('\n');
  const fixtureText = [
    'const fixture = `',
    "import { fake } from 'vue';",
    'fake();',
    '`;'
  ].join('\n');
  const vueComponentText = [
    '<script setup>',
    "import DefaultWidget from './DefaultWidget.vue';",
    "import { FancyWidget } from './FancyWidget.vue';",
    '</script>',
    '<template>',
    '  <default-widget />',
    '  <fancy-widget />',
    '</template>'
  ].join('\n');
  const sourceFiles = [
    createSourceFile('sample.js', text),
    createSourceFile('fixture.js', fixtureText),
    createSourceFile('Component.vue', vueComponentText)
  ];

  assert.deepEqual(findUnusedImportViolations(sourceFiles), [
    'sample.js imports unused default binding unusedDefault',
    'sample.js imports unused named binding unused',
    'sample.js imports unused named binding TypeOnly',
    'sample.js imports unused namespace binding unusedNamespace'
  ]);
});

test('source hygiene detects duplicate import declarations only in code', () => {
  const text = [
    "import alpha from './same.js';",
    "import { beta } from './same.js';",
    "// import gamma from './same.js';",
    "const fixture = \"import delta from './same.js';\";",
    "import epsilon from './other.js';"
  ].join('\n');
  const sourceFiles = [createSourceFile('sample.js', text)];

  assert.deepEqual(findDuplicateImportSourceViolations(sourceFiles), [
    'sample.js imports ./same.js from multiple declarations on lines 1, 2'
  ]);
});

test('source hygiene detects import declarations after runtime code only in JS-like files', () => {
  const orderedText = [
    '// top comment',
    "import alpha from './alpha.js';",
    'import {',
    '  beta',
    "} from './beta.js';",
    "const dynamicValue = import('./dynamic.js');"
  ].join('\n');
  const lateText = [
    "import alpha from './alpha.js';",
    "const fixture = \"import ignored from './ignored.js';\";",
    "// import ignored from './ignored.js';",
    'const value = 1;',
    "import late from './late.js';"
  ].join('\n');
  const vueText = [
    '<template><section /></template>',
    '<script setup>',
    'const value = 1;',
    "import Widget from './Widget.vue';",
    '</script>'
  ].join('\n');
  const sourceFiles = [
    createSourceFile('ordered.js', orderedText),
    createSourceFile('late.js', lateText),
    createSourceFile('Component.vue', vueText)
  ];

  assert.deepEqual(findLateImportDeclarationViolations(sourceFiles), [
    'late.js:5 imports ./late.js after runtime code; keep import declarations before code'
  ]);
});

test('source hygiene detects duplicate top-level function declarations only in JS-like files', () => {
  const text = [
    'function same() {}',
    'function parent() {',
    '  function same() {}',
    '}',
    "const fixture = 'function same() {}';",
    '// function same() {}',
    'export async function same() {}'
  ].join('\n');
  const vueText = [
    '<template><section /></template>',
    '<script setup>',
    'function same() {}',
    'function same() {}',
    '</script>'
  ].join('\n');
  const sourceFiles = [
    createSourceFile('sample.js', text),
    createSourceFile('Component.vue', vueText)
  ];

  assert.deepEqual(findDuplicateTopLevelFunctionNameViolations(sourceFiles), [
    'sample.js declares duplicate top-level function same on lines 1, 7'
  ]);
});

test('source hygiene detects unused private top-level functions in production JS-like files', () => {
  const text = [
    'function unusedHelper() {}',
    'function usedHelper() {}',
    'usedHelper();',
    'export function exportedHelper() {}',
    'function recursiveHelper() {',
    '  return recursiveHelper();',
    '}',
    "const fixture = 'unusedHelper';",
    '// unusedHelper',
    'function parent() {',
    '  function nestedUnused() {}',
    '}',
    'parent();'
  ].join('\n');
  const testText = [
    'function unusedTestHelper() {}'
  ].join('\n');
  const sourceFiles = [
    createSourceFile('backend/src/modules/sample.js', text),
    createSourceFile('backend/src/tests/sample.test.js', testText)
  ];

  assert.deepEqual(findUnusedPrivateTopLevelFunctionViolations(sourceFiles), [
    'backend/src/modules/sample.js:1 declares unused private top-level function unusedHelper'
  ]);
});

test('source hygiene detects unused private top-level function-like const declarations only at top level', () => {
  const text = [
    'const unusedArrow = () => {};',
    'const unusedTypedArrow: Handler = () => {};',
    'const unusedGenericArrow = <T>(value: T) => value;',
    'const unusedConstrainedGenericArrow = <T extends Array<string>>(value: T) => value;',
    'const usedArrow = () => {};',
    'usedArrow();',
    'const usedTypedArrow: Handler = () => {};',
    'usedTypedArrow();',
    'const usedGenericArrow = <T>(value: T) => value;',
    'usedGenericArrow("ok");',
    'const usedConstrainedGenericArrow = <T extends Array<string>>(value: T) => value;',
    'usedConstrainedGenericArrow(["ok"]);',
    'const recursiveArrow = () => recursiveArrow();',
    'const usedFunctionExpression = function () {};',
    'usedFunctionExpression();',
    'export const exportedConstrainedGenericArrow = <T extends Array<string>>(value: T) => value;',
    'export const exportedGenericArrow = <T>(value: T) => value;',
    'export const exportedTypedArrow: Handler = () => {};',
    'export const exportedArrow = () => {};',
    "const fixture = 'unusedArrow';",
    "const typedFixture = 'unusedTypedArrow';",
    "const genericFixture = 'unusedGenericArrow';",
    "const constrainedGenericFixture = 'unusedConstrainedGenericArrow';",
    '// unusedArrow',
    '// unusedTypedArrow',
    '// unusedGenericArrow',
    '// unusedConstrainedGenericArrow',
    'function parent() {',
    '  const nestedUnusedArrow = () => {};',
    '  const nestedTypedUnusedArrow: Handler = () => {};',
    '  const nestedGenericUnusedArrow = <T>(value: T) => value;',
    '  const nestedConstrainedGenericUnusedArrow = <T extends Array<string>>(value: T) => value;',
    '  return nestedUnusedArrow;',
    '}',
    'parent();'
  ].join('\n');
  const testText = [
    'const unusedTestArrow = () => {};'
  ].join('\n');
  const sourceFiles = [
    createSourceFile('backend/src/modules/sample.ts', text),
    createSourceFile('backend/src/tests/sample.test.js', testText)
  ];

  assert.deepEqual(findUnusedPrivateTopLevelFunctionLikeConstViolations(sourceFiles), [
    'backend/src/modules/sample.ts:1 declares unused private top-level function-like const unusedArrow',
    'backend/src/modules/sample.ts:2 declares unused private top-level function-like const unusedTypedArrow',
    'backend/src/modules/sample.ts:3 declares unused private top-level function-like const unusedGenericArrow',
    'backend/src/modules/sample.ts:4 declares unused private top-level function-like const unusedConstrainedGenericArrow'
  ]);
});

test('source hygiene detects duplicate test names only in code', () => {
  const text = [
    "test('same test name', () => {});",
    "test('same test name', () => {});",
    "// test('same test name', () => {});",
    "const fixture = \"test('same test name', () => {})\";",
    "test('different test name', () => {});"
  ].join('\n');
  const sourceFiles = [createSourceFile('backend/src/tests/sample.test.js', text)];

  assert.deepEqual(findDuplicateTestNameViolations(sourceFiles), [
    'backend/src/tests/sample.test.js declares duplicate test "same test name" on lines 1, 2'
  ]);
});

test('source hygiene detects multiline direct Vue SFC source reads', () => {
  const text = [
    "const source = readRepoText(",
    "  'frontend/src/views/SampleView.vue'",
    ');',
    "const blocks = readVueBlocks('frontend/src/views/SampleView.vue');",
    "// readRepoText('frontend/src/views/SampleView.vue');",
    "const label = \"readRepoText('frontend/src/views/SampleView.vue')\";"
  ].join('\n');
  const sourceFiles = [createSourceFile('backend/src/tests/sample.test.js', text)];

  assert.deepEqual(findDirectVueBlockReadViolations(sourceFiles), [
    'backend/src/tests/sample.test.js:1 reads a Vue SFC directly; use readVueBlocks()'
  ]);
});

test('source hygiene detects direct frontend style source reads', () => {
  const text = [
    "const styles = readRepoText('frontend/src/styles.css');",
    "const splitStyles = readRepoText(",
    "  'frontend/src/styles.css'",
    ');',
    'const sharedStyles = readFrontendStyles();',
    "// readRepoText('frontend/src/styles.css');",
    'const label = "readRepoText(\'frontend/src/styles.css\')"'
  ].join('\n');
  const helperText = [
    "export function readFrontendStyles() {",
    "  return readRepoText('frontend/src/styles.css');",
    '}'
  ].join('\n');
  const sourceFiles = [
    createSourceFile('backend/src/tests/sample.test.js', text),
    createSourceFile('backend/src/tests/frontendSfcTestUtils.js', helperText)
  ];

  assert.deepEqual(findDirectFrontendStyleReadViolations(sourceFiles), [
    'backend/src/tests/sample.test.js:1 reads frontend styles directly; use readFrontendStyles()',
    'backend/src/tests/sample.test.js:2 reads frontend styles directly; use readFrontendStyles()'
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

test('backend source does not contain unused imports', () => {
  assert.deepEqual(findUnusedImportViolations(backendSourceFiles), []);
});

test('frontend source does not contain unused imports', () => {
  assert.deepEqual(findUnusedImportViolations(frontendSourceFiles), []);
});

test('source files do not contain duplicate import declarations', () => {
  assert.deepEqual(findDuplicateImportSourceViolations([...backendSourceFiles, ...frontendSourceFiles]), []);
});

test('JS-like source files keep import declarations before runtime code', () => {
  assert.deepEqual(findLateImportDeclarationViolations([...backendSourceFiles, ...frontendSourceFiles]), []);
});

test('JS-like source files do not duplicate top-level function declarations', () => {
  assert.deepEqual(findDuplicateTopLevelFunctionNameViolations([...backendSourceFiles, ...frontendSourceFiles]), []);
});

test('production JS-like source files do not contain unused private top-level function declarations', () => {
  assert.deepEqual(findUnusedPrivateTopLevelFunctionViolations([...backendSourceFiles, ...frontendSourceFiles]), []);
});

test('production JS-like source files do not contain unused private top-level function-like const declarations', () => {
  assert.deepEqual(findUnusedPrivateTopLevelFunctionLikeConstViolations([...backendSourceFiles, ...frontendSourceFiles]), []);
});

test('backend tests do not contain duplicate test names', () => {
  assert.deepEqual(findDuplicateTestNameViolations(backendSourceFiles), []);
});

test('frontend SFC source tests use the shared Vue block reader', () => {
  assert.deepEqual(findDirectVueBlockReadViolations(backendSourceFiles), []);
});

test('frontend style source tests use the shared styles reader', () => {
  assert.deepEqual(findDirectFrontendStyleReadViolations(backendSourceFiles), []);
});
