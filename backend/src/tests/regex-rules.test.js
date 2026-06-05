import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret';

const { applyRegexRules, testRegexRule } = await import('../modules/characters.js');

// ── testRegexRule: contain mode ──

test('testRegexRule contain mode passes when text contains pattern', () => {
  const result = testRegexRule({ pattern: 'hello', mode: 'contain' }, 'say hello world');
  assert.equal(result.pass, true);
  assert.deepEqual(result.matches, ['hello']);
});

test('testRegexRule contain mode fails when text does not contain pattern', () => {
  const result = testRegexRule({ pattern: 'goodbye', mode: 'contain' }, 'say hello world');
  assert.equal(result.pass, false);
  assert.deepEqual(result.matches, []);
});

// ── testRegexRule: exact mode ──

test('testRegexRule exact mode passes when text matches exactly', () => {
  const result = testRegexRule({ pattern: 'hello', mode: 'exact' }, 'hello');
  assert.equal(result.pass, true);
  assert.deepEqual(result.matches, ['hello']);
});

test('testRegexRule exact mode fails when text does not match exactly', () => {
  const result = testRegexRule({ pattern: 'hello', mode: 'exact' }, 'hello world');
  assert.equal(result.pass, false);
  assert.deepEqual(result.matches, []);
});

// ── testRegexRule: regex mode ──

test('testRegexRule regex mode passes when pattern matches', () => {
  const result = testRegexRule({ pattern: '\\d+', mode: 'regex', flags: 'g' }, 'abc 123 def 456');
  assert.equal(result.pass, true);
  assert.deepEqual(result.matches, ['123', '456']);
});

test('testRegexRule regex mode fails when pattern does not match', () => {
  const result = testRegexRule({ pattern: '\\d+', mode: 'regex', flags: 'g' }, 'no numbers here');
  assert.equal(result.pass, false);
  assert.deepEqual(result.matches, []);
});

test('testRegexRule regex mode returns empty matches on invalid regex', () => {
  const result = testRegexRule({ pattern: '[invalid', mode: 'regex' }, 'test');
  assert.equal(result.pass, false);
  assert.deepEqual(result.matches, []);
});

// ── testRegexRule: preset mode ──

test('testRegexRule preset mode always passes', () => {
  const result = testRegexRule({ pattern: 'anything', mode: 'preset' }, 'any text');
  assert.equal(result.pass, true);
  assert.deepEqual(result.matches, []);
});

// ── testRegexRule: default mode ──

test('testRegexRule defaults to regex mode when mode is not specified', () => {
  const result = testRegexRule({ pattern: 'cat' }, 'the cat sat');
  assert.equal(result.pass, true);
  assert.deepEqual(result.matches, ['cat']);
});

// ── applyRegexRules: scriptMode ──

test('applyRegexRules applies jsScript when scriptMode is enabled', () => {
  const rules = [
    {
      label: 'uppercase script',
      pattern: 'hello',
      replacement: '',
      flags: 'g',
      scope: 'input',
      enabled: true,
      scriptMode: 1,
      jsScript: 'return text.toUpperCase();'
    }
  ];
  const result = applyRegexRules('hello world', rules, 'input');
  assert.equal(result, 'HELLO WORLD');
});

test('applyRegexRules falls back to replacement when scriptMode is disabled', () => {
  const rules = [
    {
      label: 'simple replace',
      pattern: 'hello',
      replacement: 'hi',
      flags: 'g',
      scope: 'input',
      enabled: true
    }
  ];
  const result = applyRegexRules('hello world', rules, 'input');
  assert.equal(result, 'hi world');
});

test('applyRegexRules falls back to replacement when jsScript is empty', () => {
  const rules = [
    {
      label: 'empty script',
      pattern: 'hello',
      replacement: 'hi',
      flags: 'g',
      scope: 'input',
      enabled: true,
      scriptMode: 1,
      jsScript: ''
    }
  ];
  const result = applyRegexRules('hello world', rules, 'input');
  assert.equal(result, 'hi world');
});

test('applyRegexRules scriptMode receives text, matches, and rule args', () => {
  const rules = [
    {
      label: 'args test',
      pattern: '(\\w+)',
      replacement: '',
      flags: 'g',
      scope: 'input',
      enabled: true,
      scriptMode: 1,
      jsScript: 'return matches.join(",");'
    }
  ];
  const result = applyRegexRules('foo bar', rules, 'input');
  assert.equal(result, 'foo,bar');
});

test('applyRegexRules handles script errors gracefully', () => {
  const rules = [
    {
      label: 'bad script',
      pattern: 'hello',
      replacement: 'fallback',
      flags: 'g',
      scope: 'input',
      enabled: true,
      scriptMode: 1,
      jsScript: 'throw new Error("boom");'
    }
  ];
  // On error, falls through to original text (no replacement applied)
  const result = applyRegexRules('hello world', rules, 'input');
  assert.equal(result, 'hello world');
});
