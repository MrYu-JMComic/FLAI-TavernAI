import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { normalizeRegexFlags } from '../../../shared/regexFlags.js';

test('shared regex flag normalization preserves existing backend semantics', () => {
  assert.equal(normalizeRegexFlags('ggiimzzzsyvd'), 'gimsyvd');
  assert.equal(normalizeRegexFlags(''), 'g');
  assert.equal(normalizeRegexFlags(0), 'g');
  assert.equal(normalizeRegexFlags('zz', 'u'), 'u');
  assert.equal(normalizeRegexFlags('gugy'), 'guy');
});

test('backend regex flag normalizers use the shared direct scanner', () => {
  const sourceFiles = [
    '../modules/characters.js',
    '../services/characterAssistant.js',
    '../routes/regex.js'
  ];

  for (const sourceFile of sourceFiles) {
    const source = fs.readFileSync(new URL(sourceFile, import.meta.url), 'utf8');
    assert.match(source, /from '..\/..\/..\/shared\/regexFlags\.js'/);
    assert.match(source, /normalizeRegexFlags\(/);
    assert.doesNotMatch(source, /function normalizeFlags\(flags\)/);
    assert.doesNotMatch(source, /new Set\(String\(flags/);
    assert.doesNotMatch(source, /\.\.\.new Set\(String\(flags/);
    assert.doesNotMatch(source, /String\(flags \|\| 'g'\)\.replace\(\/\[\^dgimsuvy\]\//);
  }
});
