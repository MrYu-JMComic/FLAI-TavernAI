import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), '../../..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertTextMatches(text, patterns) {
  for (const pattern of patterns) {
    assert.match(text, pattern);
  }
}

function assertTextDoesNotMatch(text, patterns) {
  for (const pattern of patterns) {
    assert.doesNotMatch(text, pattern);
  }
}

function runNodeScript(relativePath, args = []) {
  return execFileSync(process.execPath, [path.join(repoRoot, relativePath), ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

function spawnNodeScript(relativePath, args = []) {
  return spawnSync(process.execPath, [path.join(repoRoot, relativePath), ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

function findAvailableCommand(candidates, args) {
  for (const command of candidates) {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (result.status === 0) {
      return command;
    }
  }
  return '';
}

const gitCommand = findAvailableCommand(['git'], ['--version']);
const powershellCommand = findAvailableCommand(
  process.platform === 'win32' ? ['powershell', 'pwsh'] : ['pwsh', 'powershell'],
  ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']
);

function writeFixtureFile(root, relativePath, text) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
}

function createPrepareCommitFixture(prefix, trackedPath) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  writeFixtureFile(fixtureRoot, 'scripts/prepare-commit.ps1', readText('scripts/prepare-commit.ps1'));
  writeFixtureFile(fixtureRoot, trackedPath, 'before\n');

  execFileSync(gitCommand, ['init'], { cwd: fixtureRoot, encoding: 'utf8' });
  execFileSync(gitCommand, ['add', 'scripts/prepare-commit.ps1', trackedPath], {
    cwd: fixtureRoot,
    encoding: 'utf8'
  });
  execFileSync(gitCommand, [
    '-c',
    'user.name=FLAI Test',
    '-c',
    'user.email=flai-test@example.invalid',
    'commit',
    '-m',
    'initial'
  ], { cwd: fixtureRoot, encoding: 'utf8' });

  return fixtureRoot;
}

function runPrepareCommitAll(fixtureRoot) {
  return spawnSync(powershellCommand, [
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(fixtureRoot, 'scripts', 'prepare-commit.ps1'),
    '-Stage',
    '-AllAllowed',
    '-IncludeUntracked',
    '-SkipEncodingCheck'
  ], {
    cwd: fixtureRoot,
    encoding: 'utf8'
  });
}

function getStagedPaths(fixtureRoot) {
  return execFileSync(gitCommand, ['diff', '--cached', '--name-only'], {
    cwd: fixtureRoot,
    encoding: 'utf8'
  })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .sort();
}

test('package scripts keep encoding checks wired into backend tests and frontend builds', () => {
  const backendPackage = readJson('backend/package.json');
  const frontendPackage = readJson('frontend/package.json');

  assert.equal(backendPackage.scripts.pretest, 'node ../scripts/check-encoding.mjs');
  assert.match(backendPackage.scripts.test, /\bnode\s+--test\b/);
  assert.match(backendPackage.scripts.test, /src\/tests\/\*\.test\.js/);

  assert.equal(frontendPackage.scripts.prebuild, 'node ../scripts/check-encoding.mjs');
  assert.equal(frontendPackage.scripts.build, 'vite build');
});

test('review gate keeps required validation stages wired', () => {
  const reviewGate = readText('scripts/review-gate.ps1');

  assertTextMatches(reviewGate, [
    /Invoke-LoggedNativeCommand\s+-File\s+"node"\s+-Arguments\s+@\("scripts\/check-encoding\.mjs"\)/,
    /Invoke-LoggedNativeCommand\s+-File\s+"node"\s+-Arguments\s+@\("scripts\/find-unreferenced-vue-components\.mjs"\)/,
    /Invoke-LoggedNativeCommand\s+-File\s+"node"\s+-Arguments\s+@\("scripts\/find-inaccessible-vue-controls\.mjs"\)/,
    /未引用 Vue 组件诊断/,
    /Vue 控件可访问性诊断/,
    /function\s+Invoke-CapturedNativeCommand/,
    /function\s+Invoke-LoggedNativeCommand/,
    /Push-Location\s+\$projectRoot\s*\r?\ntry\s*\{/,
    /}\s*finally\s*\{\s*\r?\n\s*Pop-Location\s*\r?\n\}\s*$/,
    /\$exitCode\s*=\s*1/,
    /Get-Command\s+\$File\s+-ErrorAction\s+Stop\s+\|\s+Out-Null/,
    /&\s+\$File\s+@Arguments\s+2>&1\s+\|\s+ForEach-Object\s+\{\s*\$_\.ToString\(\)\s*\}/,
    /\$exitCode\s*=\s*\$LASTEXITCODE/,
    /\$null\s+-eq\s+\$LASTEXITCODE/,
    /finally\s*\{[\s\S]*\$ErrorActionPreference\s*=\s*\$prevEAP[\s\S]*if\s+\(\$WorkingDirectory\)\s*\{[\s\S]*Pop-Location[\s\S]*\}/,
    /ExitCode\s*=\s*\$exitCode/,
    /Output\s*=\s*@\(\$output\)/,
    /Invoke-CapturedNativeCommand\s+-File\s+\$File\s+-WorkingDirectory\s+\$WorkingDirectory\s+-Arguments\s+\$Arguments/,
    /return\s+\$result\.ExitCode/,
    /Invoke-LoggedNativeCommand\s+-File\s+"npm"\s+-WorkingDirectory\s+"backend"\s+-Arguments\s+@\("test"\)/,
    /Invoke-LoggedNativeCommand\s+-File\s+"npm"\s+-WorkingDirectory\s+"frontend"\s+-Arguments\s+@\("run",\s*"build"\)/,
    /Invoke-LoggedNativeCommand\s+-File\s+"git"\s+-Arguments\s+@\("diff",\s*"--check"\)/,
    /Invoke-LoggedNativeCommand\s+-File\s+"git"\s+-Arguments\s+@\("diff",\s*"--cached",\s*"--check"\)/,
    /Invoke-CapturedNativeCommand\s+-File\s+"git"\s+-Arguments\s+@\("status",\s*"--short"\)/,
    /Git working tree diff whitespace check failed/,
    /Git staged diff whitespace check failed/,
    /Git status check failed/,
    /exit\s+1/
  ]);
  assertTextDoesNotMatch(reviewGate, [
    /\$failures\s*\+=\s*["']未引用组件/,
    /function\s+Invoke-GitDiffCheck/,
    /node\s+scripts\/[^\\s]+\.mjs\s+2>&1\s+\|\s+Write-Host/,
    /\$gitStatus\s*=\s*git\s+status\s+--short/,
    /\$LASTEXITCODE\s+-ne\s+0/
  ]);
  assert.equal((reviewGate.match(/\bPop-Location\b/g) ?? []).length, 2);
});

test('encoding checker keeps reports in scope and reports scan coverage', () => {
  const encodingCheck = readText('scripts/check-encoding.mjs');

  assertTextMatches(encodingCheck, [
    /function comparePathText/,
    /const suspiciousChars = new Set\(\);/,
    /for \(const point of suspiciousCodePoints\)/,
    /suspiciousChars\.add\(String\.fromCodePoint\(point\)\);/,
    /function hasSuspiciousChar/,
    /function getLineReportText/,
    /const text = readFileSync\(filePath, 'utf8'\);/,
    /let lineStart = 0;/,
    /if \(!lineHasSuspiciousChar && hasSuspiciousChar\(char\)\)/,
    /scannedFileCount\s*\+=\s*1/,
    /scanned\s+\$\{scannedFileCount\}\s+files/
  ]);
  assertTextDoesNotMatch(encodingCheck, [
    /path\.normalize\(['"]automation\/reports['"]\)/,
    /localeCompare/,
    /suspiciousCodePoints\.map/,
    /readFileSync\(filePath\);\s*\r?\n\s*const text = buffer\.toString\('utf8'\)/,
    /text\.split\(\s*\/\\r\?\\n\/\s*\)/,
    /\[\s*\.\.\.\s*line\s*\]\.some/
  ]);
});

test('encoding checker flags common UTF-8-as-GBK mojibake markers', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flai-encoding-check-'));
  try {
    writeFixtureFile(fixtureRoot, 'scripts/check-encoding.mjs', readText('scripts/check-encoding.mjs'));
    writeFixtureFile(fixtureRoot, 'B-bad.md', `# ${String.fromCodePoint(0x951b)} upper\n`);
    writeFixtureFile(fixtureRoot, 'a-bad.md', `ok\r\n# ${String.fromCodePoint(0x951b)} lower\n`);

    const result = spawnSync(process.execPath, [path.join(fixtureRoot, 'scripts', 'check-encoding.mjs')], {
      cwd: fixtureRoot,
      encoding: 'utf8'
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Possible Chinese encoding corruption found/);
    assert.ok(result.stderr.indexOf('B-bad.md') < result.stderr.indexOf('a-bad.md'), result.stderr);
    assert.match(result.stderr, /a-bad\.md\r?\n\s+2: #/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('Markdown report archiver keeps deterministic report ordering', () => {
  const archiver = readText('scripts/archive-markdown-reports.mjs');
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flai-report-archive-'));

  try {
    writeFixtureFile(fixtureRoot, 'scripts/archive-markdown-reports.mjs', archiver);
    writeFixtureFile(fixtureRoot, 'automation/reports/2026-06-09-z-report.md', '# 2026-06-09 z\n');
    writeFixtureFile(fixtureRoot, 'automation/reports/2026-06-10-b-report.md', '# 2026-06-10 b\n');
    writeFixtureFile(fixtureRoot, 'automation/reports/2026-06-10-A-report.md', '# 2026-06-10 A\n');

    assertTextMatches(archiver, [
      /function compareReportText/,
      /error\?\.code !== 'ENOENT'/,
      /function readOptionValue/,
      /value\.startsWith\('--'\)/,
      /const parts = \{\};/,
      /parts\[part\.type\] = part\.value;/,
      /const listItemPattern = \/\^- `\(\[\^`\]\+\)`\$\/gm;/,
      /while \(\(item = listItemPattern\.exec\(match\[1\]\)\)\)/,
      /let section;/,
      /while \(\(section = sectionPattern\.exec\(text\)\)\)/,
      /sections\.set\(section\[1\], section\[2\]\.trimEnd\(\)\);/,
      /function formatArchiveList/,
      /for \(const name of names\)/,
      /listItems\.push\(/,
      /return listItems\.join\('\\n'\);/,
      /const archivedNames = \[\];/,
      /archivedNames\.push\(file\.name\)/,
      /archived: archivedNames,/,
      /removedDuplicateTopLevel: deleted\.length - archivedNames\.length/,
      /const candidateOutput = \{\};/,
      /candidateOutput\[date\] = names;/,
      /const results = \[\];/,
      /results\.push\(archiveGroup\(date, files\)\)/,
      /--exclude requires a dated top-level report filename/
    ]);
    assertTextDoesNotMatch(archiver, [
      /localeCompare/,
      /existsSync/,
      /formatToParts\(new Date\(\)\)\.map/,
      /\[\.\.\.match\[1\]\.matchAll/,
      /text\.matchAll\(sectionPattern\)/,
      /names\.map\(\(name\)/,
      /archived: newSections\.map/,
      /Object\.fromEntries\(groups\.map/,
      /const results = groups\.map/
    ]);

    const badExcludeRun = spawnSync(process.execPath, [
      path.join(fixtureRoot, 'scripts/archive-markdown-reports.mjs'),
      '--all',
      '--exclude',
      '--dry-run'
    ], {
      cwd: fixtureRoot,
      encoding: 'utf8'
    });

    assert.notEqual(badExcludeRun.status, 0);
    assert.match(badExcludeRun.stderr, /--exclude requires a value/);
    assert.equal(
      fs.existsSync(path.join(fixtureRoot, 'automation/reports/2026-06-10-A-report.md')),
      true
    );

    const badExcludeNameRun = spawnSync(process.execPath, [
      path.join(fixtureRoot, 'scripts/archive-markdown-reports.mjs'),
      '--all',
      '--exclude',
      'not-a-report.md',
      '--dry-run'
    ], {
      cwd: fixtureRoot,
      encoding: 'utf8'
    });

    assert.notEqual(badExcludeNameRun.status, 0);
    assert.match(badExcludeNameRun.stderr, /--exclude requires a dated top-level report filename/);
    assert.equal(
      fs.existsSync(path.join(fixtureRoot, 'automation/reports/2026-06-10-A-report.md')),
      true
    );

    const dryRun = spawnSync(process.execPath, [
      path.join(fixtureRoot, 'scripts/archive-markdown-reports.mjs'),
      '--all',
      '--dry-run'
    ], {
      cwd: fixtureRoot,
      encoding: 'utf8'
    });

    assert.equal(dryRun.status, 0, `${dryRun.stdout}\n${dryRun.stderr}`);
    const dryRunOutput = JSON.parse(dryRun.stdout);
    assert.deepEqual(Object.keys(dryRunOutput.candidates), ['2026-06-09', '2026-06-10']);
    assert.deepEqual(dryRunOutput.candidates['2026-06-10'], [
      '2026-06-10-A-report.md',
      '2026-06-10-b-report.md'
    ]);

    const archiveRun = spawnSync(process.execPath, [
      path.join(fixtureRoot, 'scripts/archive-markdown-reports.mjs'),
      '--date',
      '2026-06-10'
    ], {
      cwd: fixtureRoot,
      encoding: 'utf8'
    });

    assert.equal(archiveRun.status, 0, `${archiveRun.stdout}\n${archiveRun.stderr}`);
    assert.deepEqual(JSON.parse(archiveRun.stdout), {
      archivedDates: [
        {
          archive: 'automation/reports/archive/daily-reports-2026-06-10.md',
          archived: ['2026-06-10-A-report.md', '2026-06-10-b-report.md'],
          removedDuplicateTopLevel: 0,
          totalArchivedForDate: 2
        }
      ]
    });
    const archiveText = fs.readFileSync(
      path.join(fixtureRoot, 'automation/reports/archive/daily-reports-2026-06-10.md'),
      'utf8'
    );
    assert.deepEqual(
      [...archiveText.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]),
      ['2026-06-10-A-report.md', '2026-06-10-b-report.md']
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('diagnostic scripts share safe file-read helpers', () => {
  const fileUtils = readText('scripts/diagnostic-file-utils.mjs');
  const unreferencedScanner = readText('scripts/find-unreferenced-vue-components.mjs');
  const accessibilityScanner = readText('scripts/find-inaccessible-vue-controls.mjs');

  assertTextMatches(fileUtils, [
    /const smallTextFileLimitBytes = 1024 \* 1024;/,
    /export function compareDiagnosticText/,
    /export function getCliOptionValue/,
    /export function\* walkFiles/,
    /export function toPosixPath/,
    /export function maskNonNewlineText/,
    /export function escapeRegExp/,
    /export function readSmallTextFile/,
    /export function readJsonFile/
  ]);
  assertTextDoesNotMatch(fileUtils, [
    /rawArgs\.find/,
    /rawArgs\.indexOf/,
    /split\(path\.sep\)\.join\('\/'\)/,
    /localeCompare/
  ]);
  assertTextMatches(unreferencedScanner, [
    /import \{ compareDiagnosticText, escapeRegExp, getCliOptionValue, maskNonNewlineText, readJsonFile, readSmallTextFile, toPosixPath, walkFiles \} from '\.\/diagnostic-file-utils\.mjs';/,
    /function\s+createRangeMembershipChecker/,
    /while \(rangeIndex < ranges\.length && ranges\[rangeIndex\]\[1\] <= index\)/,
    /const isInsideStringLiteral = createRangeMembershipChecker\(stringLiteralRanges\);/,
    /const isInsideRegexLiteral = createRangeMembershipChecker\(regexLiteralRanges\);/,
    /isInsideStringLiteral\(match\.index\) \|\|/,
    /isInsideRegexLiteral\(match\.index\)/
  ]);
  assertTextDoesNotMatch(unreferencedScanner, [
    /function readSmallTextFile/,
    /function getOptionValue/,
    /function\* walk/,
    /function toPosixPath/,
    /function maskNonNewlineText/,
    /function escapeRegExp/,
    /function\s+isInsideStringLiteral\(index, ranges\)/,
    /ranges\.some\(\(\[start, end\]\)/,
    /localeCompare/
  ]);
  assertTextMatches(accessibilityScanner, [
    /import \{ compareDiagnosticText, escapeRegExp, getCliOptionValue, maskNonNewlineText, readSmallTextFile, toPosixPath, walkFiles \} from '\.\/diagnostic-file-utils\.mjs';/,
    /const boundAttributePatternCache = new Map\(\);/,
    /const staticAttributePatternCache = new Map\(\);/,
    /const closingTagPatternCache = new Map\(\);/,
    /const scannableControlPattern = \/<\(\?:button\|input\|textarea\|select\)\\b\/i;/,
    /const ariaHiddenTruePattern = \/\^true\$\/i;/,
    /const hiddenInputTypePattern = \/\^hidden\$\/i;/,
    /const nonWhitespaceTextPattern = \/\\S\/;/,
    /const staticTokenSeparatorPattern = \/\\s\/;/,
    /function\s+maskQuotedAttributeMarkup/,
    /function\s+hasScannableControl/,
    /function\s+buildLineStarts/,
    /function\s+lineNumberAt/,
    /function\s+getBoundAttributePattern/,
    /function\s+getStaticAttributePattern/,
    /function\s+getClosingTagPattern/,
    /function\s+forEachStaticToken/,
    /function\s+hasNonWhitespaceText/,
    /return scannableControlPattern\.test\(text\);/,
    /boundAttributePatternCache\.set\(key, new RegExp/,
    /staticAttributePatternCache\.set\(key, new RegExp/,
    /closingTagPatternCache\.set\(key, new RegExp/,
    /function\s+hasBoundAttribute\(attrs, names\)\s*\{\s*\r?\n\s*for \(const name of names\)/,
    /if \(getBoundAttributePattern\(name\)\.test\(attrs\)\) \{/,
    /const match = attrs\.match\(getStaticAttributePattern\(name\)\);/,
    /function\s+hasNonEmptyStaticAttribute\(attrs, names\)\s*\{\s*\r?\n\s*for \(const name of names\)/,
    /if \(getStaticAttribute\(attrs, name\)\.trim\(\)\.length > 0\) \{/,
    /function\s+collectStaticAriaLabelledByIds/,
    /forEachStaticToken\(labelledBy, \(id\) => \{/,
    /referencedIds\.add\(id\);/,
    /function\s+buildReferencedNameIndex/,
    /const referencedIds = collectStaticAriaLabelledByIds\(text\);/,
    /if \(!referencedIds\.size\) \{/,
    /return referencedNameIndex;/,
    /if \(!referencedIds\.has\(id\) \|\| referencedNameIndex\.has\(id\)\)/,
    /referencedNameIndex\.set\(id, elementProvidesName\(attrs, body\)\);/,
    /if \(referencedNameIndex\.size === referencedIds\.size\) \{/,
    /break;/,
    /function\s+findElementBodyRange/,
    /const closePattern = getClosingTagPattern\(tagName\);/,
    /const bodyRange = findElementBodyRange\(text, tagName, tagEnd\);/,
    /const bodyRange = findElementBodyRange\(text, 'button', tagEnd\);/,
    /buttonPattern\.lastIndex = bodyRange\.nextIndex;/,
    /const labelClosePattern = getClosingTagPattern\('label'\);/,
    /labelClosePattern\.lastIndex = index;/,
    /let hasReferencedName = false;/,
    /if \(referencedNameIndex\.get\(id\) === true\) \{/,
    /hasReferencedName = true;/,
    /return false;/,
    /return hasReferencedName;/,
    /function\s+buildExternalLabelNameIndex/,
    /return externalLabelNameIndex\.has\(id\);/,
    /closePattern\.lastIndex = tagEnd \+ 1;/,
    /const closeMatch = closePattern\.exec\(text\);/,
    /return ariaHiddenTruePattern\.test\(getStaticAttribute\(attrs, 'aria-hidden'\)\.trim\(\)\);/,
    /return hiddenInputTypePattern\.test\(getStaticAttribute\(attrs, 'type'\)\.trim\(\)\);/,
    /return nonWhitespaceTextPattern\.test\(text\);/,
    /return hasNonWhitespaceText\(stripTags\(body\)\);/,
    /return hasNonWhitespaceText\(stripTags\(stripLabelControlContent\(text\)\)\);/,
    /if \(!hasScannableControl\(text\)\) \{\s*\r?\n\s*continue;\s*\r?\n\s*\}\s*\r?\n\s*const lineStarts = buildLineStarts\(text\);/,
    /const referencedNameIndex = buildReferencedNameIndex\(text\);/,
    /const externalLabelNameIndex = buildExternalLabelNameIndex\(text, referencedNameIndex\);/,
    /findButtonViolations\(fileLabel, text, lineStarts, referencedNameIndex\)/,
    /findFormControlViolations\(fileLabel, text, lineStarts, externalLabelNameIndex, referencedNameIndex\)/,
    /hasAssociatedLabel\(text, attrs, match\.index, externalLabelNameIndex, referencedNameIndex\)/,
    /text\.lastIndexOf\('<label', index\)/,
    /function\s+hasProvidedAttribute/,
    /function\s+inputHasNativeAccessibleName/
  ]);
  assertTextDoesNotMatch(accessibilityScanner, [
    /function\s+inputValueProvidesName/,
    /function\s+inputAltProvidesName/,
    /return \/<\(\?:button\|input\|textarea\|select\)\\b\/i\.test\(text\);/,
    /return \/\^true\$\/i\.test\(getStaticAttribute\(attrs, 'aria-hidden'\)\.trim\(\)\);/,
    /return \/\^hidden\$\/i\.test\(getStaticAttribute\(attrs, 'type'\)\.trim\(\)\);/,
    /stripTags\(body\)\.replace\(\/\\s\+\/g, ''\)\.length > 0/,
    /stripTags\(stripLabelControlContent\(text\)\)\.replace\(\/\\s\+\/g, ''\)\.length > 0/,
    /slice\(0,\s*index\)\.split/,
    /const before = text\.slice\(0,\s*index\)/,
    /closePattern\.exec\(text\.slice\(tagEnd \+ 1\)\)/,
    /lineNumberAt\(text,\s*match\.index\)/,
    /hasAssociatedLabel\(text, attrs, match\.index\)/,
    /function\s+findElementByStaticId/,
    /function\s+referencedElementProvidesName/,
    /hasAccessibleNameAttribute\(attrs, text\)/,
    /buildExternalLabelNameIndex\(text\);/,
    /const closePattern = \/<\\\/button\\s\*>\/gi;/,
    /const labelClosePattern = \/<\\\/label\\s\*>\/gi;/,
    /function readSmallTextFile/,
    /function getOptionValue/,
    /function\* walk/,
    /function toPosixPath/,
    /function maskNonNewlineText/,
    /function escapeRegExp/,
    /names\.some\(\(name\) => getBoundAttributePattern\(name\)\.test\(attrs\)\)/,
    /names\.some\(\(name\) => getStaticAttribute\(attrs, name\)\.trim\(\)\.length > 0\)/,
    /labelledBy\.split\(\/\\s\+\/\)/,
    /localeCompare/
  ]);
});

test('diagnostic file utilities keep shared helper behavior stable', async () => {
  const utils = await import(pathToFileURL(path.join(repoRoot, 'scripts/diagnostic-file-utils.mjs')));
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flai-diagnostic-utils-'));

  try {
    writeFixtureFile(fixtureRoot, 'nested/source.txt', 'plain text');
    writeFixtureFile(fixtureRoot, 'config/options.json', '{"ok":true}');
    writeFixtureFile(fixtureRoot, 'config/broken.json', '{"ok":');
    writeFixtureFile(fixtureRoot, 'config/large.json', ' '.repeat(1024 * 1024) + '{"ok":true}');
    writeFixtureFile(fixtureRoot, 'large.txt', 'x'.repeat((1024 * 1024) + 1));
    writeFixtureFile(fixtureRoot, 'B.txt', 'B');
    writeFixtureFile(fixtureRoot, 'a.txt', 'a');

    assert.equal(utils.compareDiagnosticText('B.txt', 'a.txt'), -1);
    assert.equal(utils.compareDiagnosticText('same', 'same'), 0);
    assert.equal(utils.compareDiagnosticText('z.txt', 'a.txt'), 1);
    assert.equal(utils.getCliOptionValue(['--project-root', 'fixture-root'], '--project-root'), 'fixture-root');
    assert.equal(utils.getCliOptionValue(['--project-root=inline-root'], '--project-root'), 'inline-root');
    assert.equal(
      utils.getCliOptionValue(['--project-root', 'separate-root', '--project-root=inline-root'], '--project-root'),
      'inline-root'
    );
    assert.equal(utils.getCliOptionValue(['--project-root='], '--project-root'), null);
    assert.equal(utils.getCliOptionValue(['--project-root=', '--project-root', 'fixture-root'], '--project-root'), 'fixture-root');
    assert.equal(utils.getCliOptionValue(['--project-root'], '--project-root'), null);
    assert.equal(utils.getCliOptionValue(['--project-root', ''], '--project-root'), null);
    assert.equal(utils.getCliOptionValue(['--project-root', '--json'], '--project-root'), null);
    assert.equal(utils.getCliOptionValue(['--project-root', '--json', '--project-root', 'fixture-root'], '--project-root'), 'fixture-root');
    assert.equal(utils.getCliOptionValue([], '--project-root'), null);
    assert.equal(utils.toPosixPath(['nested', 'source.txt'].join(path.sep)), 'nested/source.txt');
    assert.equal(utils.toPosixPath('nested\\source.txt'), 'nested/source.txt');
    assert.equal(utils.toPosixPath('nested\\mixed/source.txt'), 'nested/mixed/source.txt');
    assert.equal(utils.maskNonNewlineText('a\r\n<tag>'), ' \r\n     ');
    assert.equal(utils.escapeRegExp('A+B*(test)?[x]\\'), 'A\\+B\\*\\(test\\)\\?\\[x\\]\\\\');
    assert.equal(utils.readSmallTextFile(path.join(fixtureRoot, 'nested/source.txt')), 'plain text');
    assert.equal(utils.readSmallTextFile(path.join(fixtureRoot, 'large.txt')), '');
    assert.equal(utils.readSmallTextFile(path.join(fixtureRoot, 'missing.txt')), '');
    assert.equal(utils.readSmallTextFile(path.join(fixtureRoot, 'nested')), '');
    assert.deepEqual(utils.readJsonFile(path.join(fixtureRoot, 'config/options.json'), { ok: false }), { ok: true });
    assert.deepEqual(utils.readJsonFile(path.join(fixtureRoot, 'config/broken.json'), { broken: true }), { broken: true });
    assert.deepEqual(utils.readJsonFile(path.join(fixtureRoot, 'config/large.json'), { large: true }), { large: true });
    assert.deepEqual(utils.readJsonFile(path.join(fixtureRoot, 'missing.json'), { missing: true }), { missing: true });
    assert.deepEqual(
      [...utils.walkFiles(fixtureRoot)]
        .map((filePath) => utils.toPosixPath(path.relative(fixtureRoot, filePath))),
      ['B.txt', 'a.txt', 'config/broken.json', 'config/large.json', 'config/options.json', 'large.txt', 'nested/source.txt']
    );
    assert.deepEqual([...utils.walkFiles(path.join(fixtureRoot, 'missing-dir'))], []);
    assert.deepEqual([...utils.walkFiles(path.join(fixtureRoot, 'nested/source.txt'))], []);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('prepare commit stages single tracked and untracked paths as separate targets', {
  skip: !gitCommand || !powershellCommand
}, () => {
  const fixtureRoot = createPrepareCommitFixture('flai-prepare-commit-', 'tracked.txt');

  try {
    writeFixtureFile(fixtureRoot, 'tracked.txt', 'after\n');
    writeFixtureFile(fixtureRoot, 'untracked.txt', 'new\n');

    const result = runPrepareCommitAll(fixtureRoot);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(getStagedPaths(fixtureRoot), ['tracked.txt', 'untracked.txt']);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('prepare commit preserves comma-containing path names', {
  skip: !gitCommand || !powershellCommand
}, () => {
  const fixtureRoot = createPrepareCommitFixture('flai-prepare-commit-comma-', 'tracked,comma.txt');

  try {
    writeFixtureFile(fixtureRoot, 'tracked,comma.txt', 'after\n');
    writeFixtureFile(fixtureRoot, 'untracked,comma.txt', 'new\n');

    const result = runPrepareCommitAll(fixtureRoot);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(getStagedPaths(fixtureRoot), ['tracked,comma.txt', 'untracked,comma.txt']);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('frontend API module stays importable by Node-based diagnostics', () => {
  const result = spawnSync(process.execPath, ['-e', "import('./frontend/src/api.js')"], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
});

test('unreferenced Vue component scanner reports candidates without failing by default', () => {
  const output = runNodeScript('scripts/find-unreferenced-vue-components.mjs');
  const jsonOutput = runNodeScript('scripts/find-unreferenced-vue-components.mjs', ['--json']);
  const parsed = JSON.parse(jsonOutput);
  const scanner = readText('scripts/find-unreferenced-vue-components.mjs');

  assert.ok(Array.isArray(parsed.candidates));
  assert.ok(Array.isArray(parsed.reviewed));
  assert.match(scanner, /function\s+toKebabCase/);
  assert.match(scanner, /function\s+componentLookupNames/);
  assert.match(scanner, /return basename === kebabName \? \[basename\] : \[basename, kebabName\];/);
  assert.match(scanner, /function\s+componentTagPatterns/);
  assert.match(scanner, /function\s+componentTagPatterns\(lookupNames\)/);
  assert.match(scanner, /<\\\\s\*\$\{escapedName\}/);
  assert.match(scanner, /function\s+componentIsAttributePatterns/);
  assert.match(scanner, /function\s+componentIsAttributePatterns\(lookupNames\)/);
  assert.match(scanner, /<\\\\s\*component/);
  assert.match(scanner, /v-bind:is/);
  assert.match(scanner, /function\s+maskComponentTokenSearchText/);
  assert.match(scanner, /function\s+maskComponentIsAttributeSearchText/);
  assert.match(scanner, /function\s+maskVueScriptAndStyleBlocks/);
  assert.match(scanner, /function\s+maskVueAttributeValueNoise/);
  assert.match(scanner, /preserveComponentIsAttributes/);
  assert.match(scanner, /function\s+collectComponentReferenceLiterals/);
  assert.match(scanner, /import\\\.meta\\\.glob/);
  assert.match(scanner, /function\s+stripImportSuffix/);
  assert.match(scanner, /for \(let index = 0; index < text\.length; index \+= 1\)/);
  assert.match(scanner, /if \(char === '\?' \|\| char === '#'\) \{/);
  assert.doesNotMatch(scanner, /\.split\(\s*\/\[\?#\]\//);
  assert.doesNotMatch(scanner, /frontendRelativeWithoutExtension/);
  assert.doesNotMatch(scanner, /@\/\$\{frontendRelative/);
  assert.doesNotMatch(scanner, /\.component\('\$\{/);
  assert.match(scanner, /function\s+resolveComponentReference/);
  assert.match(scanner, /function\s+resolveComponentGlob/);
  assert.match(scanner, /function\s+globToRegExp/);
  assert.match(scanner, /const sources = \[\];/);
  assert.match(scanner, /resolvedPath: path\.resolve\(filePath\)/);
  assert.match(scanner, /for \(const source of sourceIndex\)/);
  assert.doesNotMatch(scanner, /\[\.\.\.walkFiles\(frontendSrc\)\]\s*\.\s*filter/);
  assert.doesNotMatch(scanner, /path\.resolve\(source\.filePath\)/);
  assert.doesNotMatch(scanner, /\[\.\.\.new Set\(\[basename,\s*kebabName\]\)\]\.flatMap/);
  assert.doesNotMatch(scanner, /names\.flatMap\(\(name\)/);
  assert.match(scanner, /const lookupNames = componentLookupNames\(componentPath\);/);
  assert.match(scanner, /const tagPatterns = componentTagPatterns\(lookupNames\);/);
  assert.match(scanner, /const isAttributePatterns = componentIsAttributePatterns\(lookupNames\);/);
  assert.doesNotMatch(scanner, /componentTagPatterns\(componentPath\)/);
  assert.doesNotMatch(scanner, /componentIsAttributePatterns\(componentPath\)/);
  assert.match(scanner, /function\s+loadReviewedComponents/);
  assert.match(scanner, /const reviewedComponents = new Map\(\);/);
  assert.match(scanner, /for \(const entry of reviewed\)/);
  assert.match(scanner, /const file = toPosixPath\(entry\.file\.trim\(\)\);/);
  assert.match(scanner, /reviewedComponents\.set\(file,/);
  assert.doesNotMatch(scanner, /reviewed\s*\.\s*filter\(\(entry\)/);
  assert.doesNotMatch(scanner, /reviewed\s*\.\s*filter\([\s\S]*?\.map\(\(entry\)/);
  assert.match(scanner, /function\s+collectUnreferencedComponents/);
  assert.match(scanner, /const unreferencedComponents = collectUnreferencedComponents\(sourceIndex\);/);
  assert.match(scanner, /function\s+splitReviewedComponents/);
  assert.match(scanner, /const \{ candidates, reviewed \} = splitReviewedComponents\(unreferencedComponents, reviewedComponents\);/);
  assert.doesNotMatch(scanner, /\[\.\.\.walkFiles\(componentsDir\)\]\s*\.\s*filter/);
  assert.doesNotMatch(scanner, /const candidates = unreferencedComponents\s*\.\s*filter/);
  assert.doesNotMatch(scanner, /const reviewed = unreferencedComponents\s*\.\s*filter/);
  assert.match(scanner, /reviewed-unreferenced-vue-components\.json/);
  for (const candidate of parsed.candidates) {
    assert.match(candidate.file, /^frontend\/src\/components\/.+\.vue$/);
    assert.equal(candidate.references.length, 0);
  }
  for (const component of parsed.reviewed) {
    assert.match(component.file, /^frontend\/src\/components\/.+\.vue$/);
    assert.equal(component.references.length, 0);
    assert.ok(component.review.status);
  }

  if (parsed.candidates.length) {
    assert.match(output, /Potentially unreferenced Vue components:/);
  } else {
    assert.match(output, /No unreviewed potentially unreferenced Vue components found\./);
  }
  if (parsed.reviewed.length) {
    assert.match(output, /Reviewed dormant Vue components:/);
  }

  const strictRun = spawnNodeScript('scripts/find-unreferenced-vue-components.mjs', ['--fail-on-candidates']);
  assert.equal(strictRun.status, parsed.candidates.length ? 1 : 0);
});

test('unreferenced Vue component scanner resolves path aliases and globbed references', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flai-vue-scan-'));
  try {
    writeFixtureFile(fixtureRoot, 'frontend/src/components/AliasWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/BoundKebabWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/BoundStringWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/DirectWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/DynamicExpressionOnlyWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/IsAttributeMarkupOnlyWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/SrcWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/globbed/GlobbedWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/CommentOnlyWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/JsStringOnlyWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/NameOnlyWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/NonComponentBoundIsOnlyWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/NonComponentStaticIsOnlyWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/PascalWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/PathOnlyWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/PrefixOnlyWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/PrefixOnlyWidgetPanel.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/ReExportedWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/RegexStaticImportOnlyWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/RegexTokenOnlyWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/StaticIsWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/StaticSpacedBoundKebabWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/StaticSpacedBoundStringWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/StaticSpacedIsWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/StaticUnquotedIsWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/StaticUnquotedKebabWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/StringImportOnlyWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/StringOnlyWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/TemplateAttributeStringOnlyWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/UnusedWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/ReviewedWidget.vue', '<template><div /></template>');
    writeFixtureFile(
      fixtureRoot,
      'automation/reviewed-unreferenced-vue-components.json',
      JSON.stringify({
        reviewed: [
          {
            file: 'frontend/src/components/ReviewedWidget.vue',
            status: 'fixture-reviewed',
            reason: 'Fixture review entry'
          }
        ]
      })
    );
    writeFixtureFile(
      fixtureRoot,
      'frontend/src/views/Registry.vue',
      `
<script setup>
import { defineAsyncComponent } from 'vue';
import DirectWidget from '../components/DirectWidget.vue';

const AliasWidget = defineAsyncComponent(() => import('@/components/AliasWidget'));
const SrcWidget = defineAsyncComponent(() => import('/src/components/SrcWidget.vue?component'));
const globbed = import.meta.glob('../components/globbed/*.vue');
export { default as ReExportedWidget } from '../components/ReExportedWidget.vue';
</script>
<template>
  <DirectWidget />
  <AliasWidget />
  <SrcWidget />
  <PascalWidget />
  <PrefixOnlyWidgetPanel />
  <component is="StaticIsWidget" />
  <component is = "StaticSpacedIsWidget" />
  <component is=StaticUnquotedIsWidget />
  <component is=static-unquoted-kebab-widget />
  <component :is="'BoundStringWidget'" />
  <component :is = "'StaticSpacedBoundStringWidget'" />
  <component v-bind:is="'bound-kebab-widget'" />
  <component v-bind:is = "'static-spaced-bound-kebab-widget'" />
  <component :is="DynamicExpressionOnlyWidget" />
</template>
`
    );
    writeFixtureFile(
      fixtureRoot,
      'frontend/src/views/NameOnlyNoise.vue',
      `
<script setup>
const cleanupNote = 'NameOnlyWidget should be reviewed before removal';
const pathNote = '@/components/PathOnlyWidget.vue should be reviewed before removal';
const htmlSnippet = '<StringOnlyWidget />';
</script>
<template>
  <p>NameOnlyWidget is mentioned as text, not rendered.</p>
  <p>@/components/PathOnlyWidget.vue is mentioned as text, not rendered.</p>
  <div is="NonComponentStaticIsOnlyWidget"></div>
  <section :is="'NonComponentBoundIsOnlyWidget'"></section>
  <component :is="'<IsAttributeMarkupOnlyWidget />'" />
  <div data-example="<TemplateAttributeStringOnlyWidget />"></div>
</template>
<style>
.string-only::after {
  content: '<string-only-widget></string-only-widget>';
}
</style>
`
    );
    writeFixtureFile(
      fixtureRoot,
      'frontend/src/views/JsStringOnlyNoise.js',
      `
const htmlSnippet = '<JsStringOnlyWidget />';
const isSnippet = '<component is="JsStringOnlyWidget" />';
const importSnippet = "import('../components/StringImportOnlyWidget.vue')";
const regexSnippet = /<RegexTokenOnlyWidget \\/>/;
const regexStaticImportSnippet = /import RegexStaticImportOnlyWidget from '..\\/components\\/RegexStaticImportOnlyWidget.vue'/;
`
    );
    writeFixtureFile(
      fixtureRoot,
      'frontend/src/views/CommentNoise.vue',
      `
<script setup>
// import('@/components/CommentOnlyWidget.vue');
/* const CommentOnlyWidget = defineAsyncComponent(() => import('../components/CommentOnlyWidget.vue')); */
</script>
<template>
  <!-- <comment-only-widget /> -->
</template>
`
    );

    const output = runNodeScript('scripts/find-unreferenced-vue-components.mjs', [
      '--project-root',
      fixtureRoot,
      '--json'
    ]);
    const parsed = JSON.parse(output);

    assert.deepEqual(
      parsed.candidates.map((candidate) => candidate.file),
      [
        'frontend/src/components/CommentOnlyWidget.vue',
        'frontend/src/components/DynamicExpressionOnlyWidget.vue',
        'frontend/src/components/IsAttributeMarkupOnlyWidget.vue',
        'frontend/src/components/JsStringOnlyWidget.vue',
        'frontend/src/components/NameOnlyWidget.vue',
        'frontend/src/components/NonComponentBoundIsOnlyWidget.vue',
        'frontend/src/components/NonComponentStaticIsOnlyWidget.vue',
        'frontend/src/components/PathOnlyWidget.vue',
        'frontend/src/components/PrefixOnlyWidget.vue',
        'frontend/src/components/RegexStaticImportOnlyWidget.vue',
        'frontend/src/components/RegexTokenOnlyWidget.vue',
        'frontend/src/components/StringImportOnlyWidget.vue',
        'frontend/src/components/StringOnlyWidget.vue',
        'frontend/src/components/TemplateAttributeStringOnlyWidget.vue',
        'frontend/src/components/UnusedWidget.vue'
      ]
    );
    assert.deepEqual(
      parsed.reviewed.map((component) => [component.file, component.review.status]),
      [['frontend/src/components/ReviewedWidget.vue', 'fixture-reviewed']]
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('Vue accessibility scanner reports unlabeled controls without failing by default', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flai-a11y-scan-'));
  try {
    writeFixtureFile(
      fixtureRoot,
      'frontend/src/components/ControlPanel.vue',
      `
<template>
  <button><XIcon /></button>
  <button aria-label="Close"><XIcon /></button>
  <button><span>Save</span></button>
  <div data-example="<button><Icon /></button><input /><textarea></textarea><select></select>"></div>
  <label for="named">Name</label>
  <input id="named" />
  <input type="submit" value="Save" />
  <input type="button" :value="dynamicButtonText" />
  <input type="image" alt="Search" />
  <input type="image" :alt="imageButtonLabel" />
  <label>Mode<select><option>Auto</option></select></label>
  <input type="hidden" />
  <textarea placeholder="Notes"></textarea>
  <textarea
    placeholder="<div class=&quot;card&quot;><span>{{HP}}</span></div>"
    aria-label="Template"
  ></textarea>
</template>
<script setup>
const exampleMarkup = '<button><Icon /></button><input />';
</script>
<style>
.sample::after {
  content: '<select></select>';
}
</style>
`
    );
    writeFixtureFile(
      fixtureRoot,
      'frontend/src/components/DynamicNamePanel.vue',
      `
<template>
  <button :aria-label="buttonLabel"><Icon /></button>
  <input v-bind:title="inputTitle" />
  <input aria-label=UnquotedName />
  <input title=UnquotedTitle />
  <label aria-label="Wrapped input name"><input /></label>
  <label for="external-label-name" aria-label="External input name"></label>
  <input id="external-label-name" />
  <label for=unquoted-external-name>Unquoted external input name</label>
  <input id=unquoted-external-name />
  <span id=unquoted-button-label>Unquoted dismiss</span>
  <button aria-labelledby=unquoted-button-label><Icon /></button>
  <span id=unquoted-input-label>Unquoted input name</span>
  <input aria-labelledby=unquoted-input-label />
  <button aria-labelledby="missing-token unquoted-button-label"><Icon /></button>
  <input aria-labelledby="missing-token unquoted-input-label" />
  <span id=dynamic-reference-label :title="dynamicReferenceTitle"></span>
  <input aria-labelledby=dynamic-reference-label />
</template>
`
    );
    writeFixtureFile(
      fixtureRoot,
      'frontend/src/components/EmptyNamePanel.vue',
      `
<template>
  <button aria-label=""><Icon /></button>
  <input title=" " />
  <textarea aria-labelledby=""></textarea>
  <input type="submit" value="" />
  <input type="image" alt="" />
  <label for="empty-external"></label>
  <input id="empty-external" />
  <label><input /></label>
  <button><span aria-hidden="true">x</span></button>
  <label><span aria-hidden=true>Hidden only</span><input /></label>
  <label><select><option>Auto</option></select></label>
  <span id="visible-button-label">Dismiss</span>
  <button aria-labelledby="visible-button-label"><Icon /></button>
  <span id="empty-button-label"><Icon /></span>
  <button aria-labelledby="empty-button-label"><Icon /></button>
  <span id="visible-input-label">Name</span>
  <input aria-labelledby="visible-input-label" />
  <input aria-labelledby="missing-input-label" />
  <span id="empty-input-label"></span>
  <input aria-labelledby="empty-input-label" />
</template>
`
    );
    writeFixtureFile(
      fixtureRoot,
      'frontend/src/components/ScriptFirstPanel.vue',
      `
<script setup>
const commentPrefix = '<!--';
</script>
<template>
  <button><Icon /></button>
  <!-- comment close marker -->
</template>
`
    );

    const jsonOutput = runNodeScript('scripts/find-inaccessible-vue-controls.mjs', [
      '--project-root',
      fixtureRoot,
      '--json'
    ]);
    const parsed = JSON.parse(jsonOutput);

    assert.deepEqual(
      parsed.violations.map((violation) => [violation.file, violation.control, violation.message]),
      [
        ['frontend/src/components/ControlPanel.vue', 'button', 'Icon-only button needs aria-label or aria-labelledby'],
        ['frontend/src/components/ControlPanel.vue', 'textarea', 'Form control needs an accessible label'],
        ['frontend/src/components/EmptyNamePanel.vue', 'button', 'Icon-only button needs aria-label or aria-labelledby'],
        ['frontend/src/components/EmptyNamePanel.vue', 'input', 'Form control needs an accessible label'],
        ['frontend/src/components/EmptyNamePanel.vue', 'textarea', 'Form control needs an accessible label'],
        ['frontend/src/components/EmptyNamePanel.vue', 'input', 'Form control needs an accessible label'],
        ['frontend/src/components/EmptyNamePanel.vue', 'input', 'Form control needs an accessible label'],
        ['frontend/src/components/EmptyNamePanel.vue', 'input', 'Form control needs an accessible label'],
        ['frontend/src/components/EmptyNamePanel.vue', 'input', 'Form control needs an accessible label'],
        ['frontend/src/components/EmptyNamePanel.vue', 'button', 'Icon-only button needs aria-label or aria-labelledby'],
        ['frontend/src/components/EmptyNamePanel.vue', 'input', 'Form control needs an accessible label'],
        ['frontend/src/components/EmptyNamePanel.vue', 'select', 'Form control needs an accessible label'],
        ['frontend/src/components/EmptyNamePanel.vue', 'button', 'Icon-only button needs aria-label or aria-labelledby'],
        ['frontend/src/components/EmptyNamePanel.vue', 'input', 'Form control needs an accessible label'],
        ['frontend/src/components/EmptyNamePanel.vue', 'input', 'Form control needs an accessible label'],
        ['frontend/src/components/ScriptFirstPanel.vue', 'button', 'Icon-only button needs aria-label or aria-labelledby']
      ]
    );

    const defaultRun = spawnNodeScript('scripts/find-inaccessible-vue-controls.mjs', ['--project-root', fixtureRoot]);
    assert.equal(defaultRun.status, 0);
    assert.match(defaultRun.stdout, /Potentially inaccessible Vue controls: 16/);

    const strictRun = spawnNodeScript('scripts/find-inaccessible-vue-controls.mjs', [
      '--project-root',
      fixtureRoot,
      '--fail-on-violations'
    ]);
    assert.equal(strictRun.status, 1);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
