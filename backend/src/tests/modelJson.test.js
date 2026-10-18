import assert from 'node:assert/strict';
import test from 'node:test';
import { parseModelJsonObject } from '../utils/modelJson.js';

const plan = { version: 2, operations: [] };
const json = JSON.stringify(plan);
const matches = value => Object.hasOwn(value, 'version') || Object.hasOwn(value, 'operations');
const parse = (text, options = {}) => parseModelJsonObject(text, { matches, ...options });
const rejects = (text, code = 'MODEL_JSON_INVALID', options = {}) => assert.throws(() => parse(text, options), { code });

test('model JSON accepts presentation wrappers and ignores prose citations and labels', () => {
  for (const text of [json, `\uFEFF${json}`, `Here is the plan:\n\`\`\`json\n${json}\n\`\`\`\nDone.`,
    `[Plan result]\n${json}\n[Review complete]`, `参考 [1] 和 [2, 3]，格式 {格式说明}：\n${json}`,
    `<response>${json}</response>`, `A "format {note}" precedes ${json}`]) {
    assert.deepEqual(parse(text), plan);
  }
});

test('model JSON unwraps only configured envelopes, singleton arrays and one string encoding', () => {
  for (const value of [{ plan }, { result: plan }, { result: { plan } }, [plan], { result: [plan] },
    JSON.stringify(plan), { plan: JSON.stringify(plan) }, [JSON.stringify(plan)]]) {
    assert.deepEqual(parse(JSON.stringify(value)), plan);
  }
  assert.deepEqual(parse(JSON.stringify({ payload: plan }), { wrapperKeys: ['payload'] }), plan);
  assert.deepEqual(parse('{"result":"done","operations":[],"version":2}'), { result: 'done', ...plan });
  assert.deepEqual(parseModelJsonObject(JSON.stringify({ result: plan })), plan);
  assert.deepEqual(parse(JSON.stringify({ plan, note: 'explanation', notes: null, explanation: 'text' })), plan);
});

test('model JSON does not discard business fields attached to transport wrappers', () => {
  for (const value of [{ plan, conversationId: 'other' }, { plan, changes: {} },
    { result: { plan, conversationId: 'other' } }, { plan, note: { instructions: 'text' } }]) {
    rejects(JSON.stringify(value));
  }
});

test('model JSON preserves a single nonmatching object for caller schema diagnostics', () => {
  const unknown = { unexpected: true, summary: null };
  assert.deepEqual(parse(JSON.stringify(unknown)), unknown);
  assert.deepEqual(parse(JSON.stringify({ payload: plan })), { payload: plan });
  assert.deepEqual(parseModelJsonObject('{"hello":"world"}'), { hello: 'world' });
});

test('model JSON accepts comments and trailing commas without rewriting quoted content', () => {
  const quote = 'https://host/path // comment /* quote */ ,} ,] {braces} "double" \\path\n下一行';
  const text = `/* header */ { // plan\n"version":2, "operations":[{"quote":${JSON.stringify(quote)},},], /* end */ }`;
  assert.deepEqual(parse(text), { version: 2, operations: [{ quote }] });
  assert.deepEqual(parse('{"version":2,"operations":[],}// done'), plan);
});

test('model JSON rejects duplicate keys including escaped-equivalent and nested keys', () => {
  for (const text of ['{"version":2,"version":2,"operations":[]}',
    '{"version":2,"\\u0076ersion":2,"operations":[]}',
    '{"operations":[{"name":"a","name":"b"}]}',
    '{"result":{"operations":[],"operations":[]}}']) rejects(text);
});

test('model JSON never chooses between multiple matching candidates', () => {
  for (const text of [`${json}\n${json}`, `\`\`\`json\n${json}\n\`\`\`\n${json}`,
    JSON.stringify({ plan, result: plan }), JSON.stringify({ ...plan, result: plan })]) {
    rejects(text, 'MODEL_JSON_AMBIGUOUS');
  }
  assert.deepEqual(parse(`Metadata: {"note":"ok"}\n${json}`), plan);
});

test('model JSON does not select a nested object from a malformed or truncated candidate', () => {
  for (const text of [`{"plan":${json}`, `{"plan":${json},broken}`, `{"plan":${json}]`,
    `{"broken": [${json}]`, `${json}\n{"version":2`, `{"version":2,"operations":[}`,
    `{"version":2,"operations":[],`, `{"plan": ${json}, "note":"unfinished`,
    `{bad: ${json}}`, `[${json}`, `${json}}`, `${json}]`, `${json}\n/* unfinished`]) rejects(text);
});

test('model JSON refuses multi-element arrays, repeated encoding and executable syntax', () => {
  for (const text of [JSON.stringify([plan, plan]), JSON.stringify({ result: [plan, plan] }),
    JSON.stringify([0, plan]), JSON.stringify(JSON.stringify(JSON.stringify(plan))),
    '{version:2,operations:[]}', '{"operations":undefined}', '{"operations":NaN}',
    '{"operations":[],"run":(()=>1)()}', '{"operations":[1,,]}']) rejects(text);
  for (const text of ['', 'No plan.', 'null', '42', '[1]', '[]', '"not JSON"']) rejects(text);
});

test('model JSON enforces input, nesting and transport depth limits', () => {
  rejects(json, 'MODEL_JSON_INVALID', { maxLength: 5 });
  rejects('{"operations":[[[[]]]]}', 'MODEL_JSON_INVALID', { maxDepth: 2 });
  rejects(JSON.stringify({ result: { plan } }), 'MODEL_JSON_INVALID', { maxWrapperDepth: 1 });
  assert.deepEqual(parse(json, { maxWrapperDepth: 0 }), plan);
  for (const options of [{ maxLength: -1 }, { maxDepth: 0 }, { maxWrapperDepth: -1 }]) {
    rejects(json, 'MODEL_JSON_INVALID', options);
  }
});

test('model JSON preserves values and own prototype-shaped keys without coercion', () => {
  const parsed = parse('{"version":"2","operations":[],"enabled":"false","summary":null,"__proto__":{"polluted":true}}');
  assert.equal(parsed.version, '2');
  assert.equal(parsed.enabled, 'false');
  assert.equal(parsed.summary, null);
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
  assert.equal(Object.hasOwn(parsed, '__proto__'), true);
  assert.equal(parsed.__proto__.polluted, true);
  assert.equal({}.polluted, undefined);
});

test('model JSON shape wrappers and key normalization are explicitly opt in', () => {
  const value = { Payload: { RESULT: plan }, META: { latency: 2 } };
  assert.deepEqual(parse(JSON.stringify(value)), value);
  assert.deepEqual(parse(JSON.stringify(value), {
    wrapperKeyNormalizer: key => key.toLowerCase(),
    wrapperShapeMatcher: item => Boolean(item?.RESULT),
    wrapperSiblingKeys: ['meta'],
    wrapperSiblingMatcher: () => true,
  }), plan);
  rejects(JSON.stringify({ Payload: { RESULT: plan }, other: { operations: [] } }), 'MODEL_JSON_AMBIGUOUS', {
    wrapperKeyNormalizer: key => key.toLowerCase(),
    wrapperShapeMatcher: item => Boolean(item?.RESULT || item?.operations),
  });
});

test('model JSON wrapper fields can be excluded only by an explicit caller strategy', () => {
  const value = { ...plan, data: plan };
  rejects(JSON.stringify(value), 'MODEL_JSON_AMBIGUOUS', { wrapperKeys: ['data'] });
  assert.deepEqual(parse(JSON.stringify(value), {
    wrapperKeys: ['data'],
    wrapperFieldMatcher: (_parent, key) => key !== 'data',
  }), value);
});
