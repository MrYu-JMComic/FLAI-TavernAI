import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCharacterDataPatch, characterDataPatchTool } from '../services/characterAssistantDataPatch.js';
import { normalizeAdvancedSettings } from '../modules/advancedSettings.js';

function normalize(draft) {
  return {
    ...structuredClone(draft),
    regexRules: draft.regexRules.map((rule) => ({ label: '规则', replacement: '', flags: 'g', scope: 'input', enabled: true, ...rule })),
    authorAdvancedSettings: normalizeAdvancedSettings(draft.authorAdvancedSettings)
  };
}

function createDraft() {
  return normalize({
    tags: ['旅行'],
    regexRules: [{ id: 'rule-1', label: '替换', pattern: 'before', replacement: 'after', flags: 'g', scope: 'input', enabled: true, groupName: '对话', priority: 3, scriptMode: false, jsScript: '' }],
    renderPlugins: [],
    modSuggestions: [],
    authorAdvancedSettings: {
      statusBarPrompt: '受伤时降低 HP。',
      statusBarBlueprint: { variables: [{ name: 'HP', type: 'number', value: 80 }] }
    }
  });
}

test('character data patch tool instructions are English', () => {
  assert.doesNotMatch(characterDataPatchTool.function.description, /[\u3400-\u9fff]/);
});

function patch(draft, edits, options = {}) {
  return applyCharacterDataPatch({ edits }, draft, options.sections || {}, options.normalize || normalize);
}

test('data patches append an item with defaults and preserve regex metadata on exact replacement', () => {
  const draft = createDraft();
  const original = structuredClone(draft);
  const result = patch(draft, [
    { op: 'replace', path: '/regexRules/0/replacement', oldValue: 'after', value: 'changed' },
    { op: 'add', path: '/regexRules/-', value: { pattern: 'second', replacement: 'new' } },
    { op: 'add', path: '/tags/-', value: 'a'.repeat(30) }
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(draft.regexRules[0], { ...original.regexRules[0], replacement: 'changed' });
  assert.equal(draft.regexRules[1].enabled, true);
  assert.deepEqual(draft.authorAdvancedSettings, original.authorAdvancedSettings);
  assert.deepEqual(result.sections, ['regexRules', 'tags']);
  assert.equal(JSON.stringify(result).includes('groupName'), false);
});

test('data patches reject a stale later edit atomically and require oldValue', () => {
  const draft = createDraft();
  const original = structuredClone(draft);
  const result = patch(draft, [
    { op: 'add', path: '/tags/-', value: '魔法' },
    { op: 'replace', path: '/regexRules/0/replacement', oldValue: 'stale', value: 'changed' }
  ]);
  assert.equal(result.error, 'DATA_PATCH_CONFLICT');
  assert.equal(result.editIndex, 1);
  assert.equal(result.recoverable, true);
  assert.deepEqual(draft, original);
  assert.equal(patch(draft, [{ op: 'remove', path: '/tags/0' }]).error, 'DATA_PATCH_INVALID');
  assert.deepEqual(draft, original);
});

test('data patches add and remove optional fields and array entries without rewriting their neighbors', () => {
  const draft = createDraft();
  assert.equal(patch(draft, [{ op: 'add', path: '/statusBarBlueprint/variables/0/unit', value: '点' }]).ok, true);
  assert.equal(draft.authorAdvancedSettings.statusBarBlueprint.variables[0].unit, '点');
  assert.equal(patch(draft, [{ op: 'remove', path: '/statusBarBlueprint/variables/0/unit', oldValue: '点' }]).ok, true);
  assert.equal(Object.hasOwn(draft.authorAdvancedSettings.statusBarBlueprint.variables[0], 'unit'), false);
  assert.equal(patch(draft, [{ op: 'remove', path: '/regexRules/0', oldValue: draft.regexRules[0] }]).ok, true);
  assert.deepEqual(draft.regexRules, []);
  assert.deepEqual(draft.tags, ['旅行']);
});

test('data patches reject invalid and unsafe regular expressions before committing', () => {
  for (const pattern of ['[', '(a+)+$']) {
    const draft = createDraft();
    const original = structuredClone(draft);
    const result = patch(draft, [{ op: 'replace', path: '/regexRules/0/pattern', oldValue: 'before', value: pattern }]);
    assert.equal(result.error, 'DATA_PATCH_INVALID');
    assert.deepEqual(draft, original);
  }
});

test('data patches reject prototype paths, nested unknown fields, array insertion, and ID changes', () => {
  const attempts = [
    { op: 'add', path: '/accessorySkills/__proto__/enabled', value: true },
    { op: 'add', path: '/regexRules/0/unknown', value: true },
    { op: 'add', path: '/tags/0', value: '移动' },
    { op: 'replace', path: '/regexRules/0/id', oldValue: 'rule-1', value: 'rule-2' },
    { op: 'replace', path: '/regexRules/0', oldValue: createDraft().regexRules[0], value: { pattern: 'new' } },
    { op: 'add', path: '/regexRules/-', value: { id: 'injected-id', pattern: 'new' } }
  ];
  for (const edit of attempts) {
    const draft = createDraft();
    const original = structuredClone(draft);
    assert.equal(patch(draft, [edit]).error, 'DATA_PATCH_INVALID');
    assert.deepEqual(draft, original);
  }
});

test('data patches reject normalization data loss and required default removal', () => {
  const draft = createDraft();
  const original = structuredClone(draft);
  const result = patch(draft, [{ op: 'replace', path: '/regexRules/0/replacement', oldValue: 'after', value: 'changed' }], {
    normalize: (value) => ({ ...normalize(value), regexRules: [] })
  });
  assert.equal(result.error, 'DATA_PATCH_INVALID');
  assert.deepEqual(draft, original);
  const removed = patch(draft, [{ op: 'remove', path: '/accessorySkills/statusBarAgent/enabled', oldValue: 'auto' }]);
  assert.equal(removed.error, 'DATA_PATCH_INVALID');
  assert.deepEqual(draft, original);
});

test('data patches respect disabled sections and report unchanged edits without completed sections', () => {
  const draft = createDraft();
  const original = structuredClone(draft);
  assert.equal(patch(draft, [{ op: 'replace', path: '/tags/0', oldValue: '旅行', value: '魔法' }], { sections: { tags: false } }).error, 'DATA_PATCH_SECTION_DISABLED');
  assert.deepEqual(draft, original);
  const unchanged = patch(draft, [{ op: 'replace', path: '/tags/0', oldValue: '旅行', value: '旅行' }]);
  assert.equal(unchanged.ok, true);
  assert.equal(unchanged.changed, false);
  assert.deepEqual(unchanged.sections, []);
});

test('data patches preserve maximum saved tag and render plugin lists and reject over-limit appends', () => {
  const draft = createDraft();
  draft.tags = Array.from({ length: 20 }, (_, index) => `标签 ${index + 1}`);
  draft.renderPlugins = Array.from({ length: 20 }, (_, index) => ({
    id: `plugin-${index + 1}`, label: `面板 ${index + 1}`, type: 'fold',
    pattern: `panel${index + 1}`, flags: 'u', titleTemplate: '$1', enabled: true
  }));
  draft.regexRules = Array.from({ length: 40 }, (_, index) => ({ ...draft.regexRules[0], id: `rule-${index + 1}` }));
  const original = structuredClone(draft);
  const result = patch(draft, [
    { op: 'replace', path: '/tags/19', oldValue: '标签 20', value: '最终标签' },
    { op: 'replace', path: '/renderPlugins/19/titleTemplate', oldValue: '$1', value: '详情：$1' }
  ]);
  assert.equal(result.ok, true);
  assert.equal(draft.tags.length, 20);
  assert.equal(draft.renderPlugins.length, 20);
  assert.deepEqual(draft.tags.slice(0, -1), original.tags.slice(0, -1));
  assert.deepEqual(draft.renderPlugins.slice(0, -1), original.renderPlugins.slice(0, -1));
  assert.deepEqual(draft.renderPlugins[19], { ...original.renderPlugins[19], titleTemplate: '详情：$1' });
  assert.deepEqual(draft.regexRules, original.regexRules);
  const updated = structuredClone(draft);
  for (const edit of [
    { op: 'add', path: '/tags/-', value: '第 21 项' },
    { op: 'replace', path: '/tags/19', oldValue: '最终标签', value: 'a'.repeat(31) },
    { op: 'add', path: '/renderPlugins/-', value: { pattern: 'extra' } },
    { op: 'add', path: '/regexRules/-', value: { pattern: 'extra' } }
  ]) {
    assert.equal(patch(draft, [edit]).error, 'DATA_PATCH_INVALID');
    assert.deepEqual(draft, updated);
  }
});
