import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), '../../..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
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

  assert.match(reviewGate, /node\s+scripts\/check-encoding\.mjs/);
  assert.match(reviewGate, /node\s+scripts\/find-unreferenced-vue-components\.mjs/);
  assert.match(reviewGate, /node\s+scripts\/find-inaccessible-vue-controls\.mjs/);
  assert.match(reviewGate, /未引用 Vue 组件诊断/);
  assert.match(reviewGate, /Vue 控件可访问性诊断/);
  assert.doesNotMatch(reviewGate, /\$failures\s*\+=\s*["']未引用组件/);
  assert.match(reviewGate, /Push-Location\s+backend[\s\S]*npm\s+test/);
  assert.match(reviewGate, /Push-Location\s+frontend[\s\S]*npm\s+run\s+build/);
  assert.match(reviewGate, /\$LASTEXITCODE\s+-ne\s+0/);
  assert.match(reviewGate, /exit\s+1/);
});

test('encoding checker keeps reports in scope and reports scan coverage', () => {
  const encodingCheck = readText('scripts/check-encoding.mjs');

  assert.doesNotMatch(encodingCheck, /path\.normalize\(['"]automation\/reports['"]\)/);
  assert.match(encodingCheck, /scannedFileCount\s*\+=\s*1/);
  assert.match(encodingCheck, /scanned\s+\$\{scannedFileCount\}\s+files/);
});

test('encoding checker flags common UTF-8-as-GBK mojibake markers', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'flai-encoding-check-'));
  try {
    writeFixtureFile(fixtureRoot, 'scripts/check-encoding.mjs', readText('scripts/check-encoding.mjs'));
    writeFixtureFile(fixtureRoot, 'automation/backlog.md', `# ${String.fromCodePoint(0x951b)}\n`);

    const result = spawnSync(process.execPath, [path.join(fixtureRoot, 'scripts', 'check-encoding.mjs')], {
      cwd: fixtureRoot,
      encoding: 'utf8'
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Possible Chinese encoding corruption found/);
    assert.match(result.stderr, /automation[\\/]backlog\.md/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('diagnostic scripts share safe file-read helpers', () => {
  const fileUtils = readText('scripts/diagnostic-file-utils.mjs');
  const unreferencedScanner = readText('scripts/find-unreferenced-vue-components.mjs');
  const accessibilityScanner = readText('scripts/find-inaccessible-vue-controls.mjs');

  assert.match(fileUtils, /const smallTextFileLimitBytes = 1024 \* 1024;/);
  assert.match(fileUtils, /export function readSmallTextFile/);
  assert.match(fileUtils, /export function readJsonFile/);
  assert.match(unreferencedScanner, /import \{ readJsonFile, readSmallTextFile \} from '\.\/diagnostic-file-utils\.mjs';/);
  assert.match(accessibilityScanner, /import \{ readSmallTextFile \} from '\.\/diagnostic-file-utils\.mjs';/);
  assert.doesNotMatch(unreferencedScanner, /function readSmallTextFile/);
  assert.doesNotMatch(accessibilityScanner, /function readSmallTextFile/);
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
  assert.match(scanner, /function\s+componentTagPatterns/);
  assert.match(scanner, /<\\\\s\*\$\{escapedName\}/);
  assert.match(scanner, /function\s+componentIsAttributePatterns/);
  assert.match(scanner, /v-bind:is/);
  assert.match(scanner, /function\s+maskComponentTokenSearchText/);
  assert.match(scanner, /function\s+maskVueScriptAndStyleBlocks/);
  assert.match(scanner, /function\s+maskVueAttributeValueNoise/);
  assert.match(scanner, /function\s+collectComponentReferenceLiterals/);
  assert.match(scanner, /import\\\.meta\\\.glob/);
  assert.doesNotMatch(scanner, /frontendRelativeWithoutExtension/);
  assert.doesNotMatch(scanner, /@\/\$\{frontendRelative/);
  assert.doesNotMatch(scanner, /\.component\('\$\{/);
  assert.match(scanner, /function\s+resolveComponentReference/);
  assert.match(scanner, /function\s+resolveComponentGlob/);
  assert.match(scanner, /function\s+globToRegExp/);
  assert.match(scanner, /function\s+loadReviewedComponents/);
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
    writeFixtureFile(fixtureRoot, 'frontend/src/components/SrcWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/globbed/GlobbedWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/CommentOnlyWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/JsStringOnlyWidget.vue', '<template><div /></template>');
    writeFixtureFile(fixtureRoot, 'frontend/src/components/NameOnlyWidget.vue', '<template><div /></template>');
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
        'frontend/src/components/JsStringOnlyWidget.vue',
        'frontend/src/components/NameOnlyWidget.vue',
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
  <label for="named">Name</label>
  <input id="named" />
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
    assert.match(defaultRun.stdout, /Potentially inaccessible Vue controls: 14/);

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
