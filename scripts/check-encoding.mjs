import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function comparePathText(left, right) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

const scannedExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.ps1',
  '.ts',
  '.tsx',
  '.vue'
]);

const skippedNames = new Set([
  '.git',
  '.runtime-check',
  'build',
  'dist',
  'node_modules',
  'uploads'
]);

const skippedRelativeDirs = new Set([
  path.normalize('backend/data'),
  path.normalize('backend/uploads')
]);

const suspiciousCodePoints = [
  0xfffd, 0x951f, 0x9418, 0x9477, 0x9422, 0x6fb6, 0x6dc7, 0x9352,
  0x9359, 0x934f, 0x9350, 0x9354, 0x93b5, 0x93ac, 0x93ad, 0x93c3,
  0x93c6, 0x5a11, 0x59dd, 0x7035, 0x59af, 0x6e1a, 0x4f79, 0x722e,
  0x9417, 0x9365, 0x7f02, 0x7ed4, 0x95c2, 0x704f, 0x74ba, 0x7edb,
  0x6939, 0x9353, 0x630e, 0x6f48, 0x95c4, 0x612f, 0x93b8, 0x9286,
  0x4e23, 0x4e44, 0x4e1f, 0x74d2, 0x7e43, 0x6d7c, 0x8930, 0x68e3,
  0x7459, 0x58ca, 0x7caf, 0x6769, 0x7f01, 0x7eef, 0x8364, 0x701b,
  0x6a3b, 0x608a, 0x5a34, 0x7d21, 0x6748, 0x56ad, 0x6ec4, 0x951b,
  0x9358, 0x93c2
];

const suspiciousChars = new Set();
for (const point of suspiciousCodePoints) {
  suspiciousChars.add(String.fromCodePoint(point));
}

function hasSuspiciousChar(text) {
  for (const char of text) {
    if (suspiciousChars.has(char)) {
      return true;
    }
  }
  return false;
}

function shouldSkipDirectory(dir) {
  const name = path.basename(dir);
  if (skippedNames.has(name)) {
    return true;
  }
  const relative = path.relative(projectRoot, dir);
  return skippedRelativeDirs.has(relative);
}

function* walk(dir) {
  if (shouldSkipDirectory(dir)) {
    return;
  }

  const entries = readdirSync(dir, { withFileTypes: true })
    .sort((left, right) => comparePathText(left.name, right.name));

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(entryPath);
      continue;
    }
    if (entry.isFile() && scannedExtensions.has(path.extname(entry.name).toLowerCase())) {
      yield entryPath;
    }
  }
}

function getLineReportText(text, start, end) {
  const normalizedEnd = end > start && text[end - 1] === '\r' ? end - 1 : end;
  return text.slice(start, normalizedEnd).trim().slice(0, 180);
}

function findSuspiciousLines(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const hits = [];
  let lineNumber = 1;
  let lineStart = 0;
  let lineHasSuspiciousChar = false;

  for (let index = 0; index <= text.length; index += 1) {
    const char = text[index];
    if (char === '\n' || index === text.length) {
      if (lineHasSuspiciousChar) {
        hits.push({
          line: lineNumber,
          text: getLineReportText(text, lineStart, index)
        });
      }
      lineNumber += 1;
      lineStart = index + 1;
      lineHasSuspiciousChar = false;
      continue;
    }

    if (!lineHasSuspiciousChar && hasSuspiciousChar(char)) {
      lineHasSuspiciousChar = true;
    }
  }

  return hits;
}

const failures = [];
let scannedFileCount = 0;

for (const filePath of walk(projectRoot)) {
  const stats = statSync(filePath);
  if (stats.size > 1024 * 1024) {
    continue;
  }

  scannedFileCount += 1;
  const hits = findSuspiciousLines(filePath);
  if (hits.length) {
    failures.push({
      file: path.relative(projectRoot, filePath),
      hits
    });
  }
}

if (failures.length) {
  console.error('Possible Chinese encoding corruption found. Save files as UTF-8 and repair these lines:');
  for (const failure of failures) {
    console.error(`\n${failure.file}`);
    for (const hit of failure.hits.slice(0, 12)) {
      console.error(`  ${hit.line}: ${hit.text}`);
    }
    if (failure.hits.length > 12) {
      console.error(`  ... ${failure.hits.length - 12} more`);
    }
  }
  process.exit(1);
}

console.log(`Encoding check passed: scanned ${scannedFileCount} files; no common Chinese mojibake markers found.`);
