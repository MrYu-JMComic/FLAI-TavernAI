import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAdvancedSettings } from '../modules/advancedSettings.js';
import {
  CHARACTER_DRAFT_EDIT_TOOL,
  CHARACTER_DRAFT_READ_TOOLS,
  characterDraftEditingTools,
  executeCharacterDraftEdit
} from '../services/characterAssistantEditing.js';
import { parseStatusBarRuntime, serializeStatusBarRuntime } from '../../../shared/statusBarRuntime.js';

const runtime = {
  renderer: 'runtime', framework: 'vue', html: '<p>{{ values.HP }}</p>',
  css: 'p { color: red; }', javascript: 'return { expanded: true };'
};

function fixture() {
  return {
    name: 'Original', visibility: 'private', persona: 'A careful sailor. Keeps a blue notebook.',
    background: 'A coastal city.', openingMessage: 'Welcome aboard.',
    tags: ['sailor', 'careful'],
    regexRules: [{ label: 'Cleanup', pattern: 'old', replacement: 'new', enabled: true }],
    renderPlugins: [{ label: 'Notes', pattern: 'note', type: 'fold' }],
    modSuggestions: [{ name: 'Weather', content: 'Keep weather consistent.' }],
    authorAdvancedSettings: normalizeAdvancedSettings({
      statusBarPrompt: 'Update HP after each scene. Keep Mood stable.',
      statusBarBlueprint: {
        name: 'Ship', template: serializeStatusBarRuntime(runtime),
        variables: [{ name: 'HP', value: 80, type: 'meter', min: 0, max: 100, unit: 'pt', color: '#abcdef' }]
      },
      customCss: 'body { color: red; }', customJs: 'return { ready: true };',
      desktopBackgroundUrl: '/uploads/old.png',
      accessorySkills: { statusBarAgent: { enabled: 'auto', modelOverride: 'private-model' } }
    })
  };
}

const edit = (draft, edits, options) => executeCharacterDraftEdit(CHARACTER_DRAFT_EDIT_TOOL, { edits }, draft, options);

test('character exact text edits change only the supplied story snippet and return concise metadata', () => {
  const draft = fixture();
  const original = structuredClone(draft);
  const result = edit(draft, [{ path: 'persona', oldText: 'blue notebook', newText: 'green notebook' }]);
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(draft.persona, 'A careful sailor. Keeps a green notebook.');
  assert.deepEqual(draft.authorAdvancedSettings, original.authorAdvancedSettings);
  assert.deepEqual(draft.regexRules, original.regexRules);
  assert.deepEqual(result.sections, ['persona']);
  assert.deepEqual(result.changes, [{ path: 'persona', replacements: 1, beforeLength: original.persona.length, afterLength: draft.persona.length }]);
  assert.equal(Object.hasOwn(result, 'applied'), false);
  assert.equal(Object.hasOwn(result, 'character'), false);
  assert.ok(!JSON.stringify(result).includes('A careful sailor'));
});

test('missing or ambiguous matches fail atomically and require explicit replacement of all occurrences', () => {
  const draft = fixture();
  draft.persona = 'red red';
  const original = structuredClone(draft);
  const ambiguous = edit(draft, [{ path: 'persona', oldText: 'red', newText: 'blue' }]);
  assert.equal(ambiguous.error, 'AMBIGUOUS_MATCH');
  assert.equal(ambiguous.occurrences, 2);
  assert.deepEqual(draft, original);
  const missing = edit(draft, [
    { path: 'persona', oldText: 'red red', newText: 'blue blue' },
    { path: 'background', oldText: 'does not exist', newText: 'ignored' }
  ]);
  assert.equal(missing.error, 'TEXT_NOT_FOUND');
  assert.equal(missing.editIndex, 1);
  assert.equal(missing.occurrences, 0);
  assert.deepEqual(draft, original);
  assert.ok(!JSON.stringify(missing).includes('A coastal city'));
  const replaced = edit(draft, [{ path: 'persona', oldText: 'red', newText: '$& blue', replaceAll: true }]);
  assert.equal(replaced.ok, true);
  assert.equal(replaced.changes[0].replacements, 2);
  assert.equal(draft.persona, '$& blue $& blue', 'replacement text is literal, including dollar tokens');
});

test('a batch applies edits in order while invalid paths, disabled targets and invalid arguments roll back everything', () => {
  const draft = fixture();
  const sequential = edit(draft, [
    { path: 'persona', oldText: 'blue notebook', newText: 'green notebook' },
    { path: 'persona', oldText: 'green notebook', newText: 'black notebook' }
  ]);
  assert.equal(sequential.ok, true);
  assert.match(draft.persona, /black notebook/);
  const original = structuredClone(draft);
  for (const [target, expected, options] of [
    [{ path: 'statusBarPrompt', oldText: 'Update', newText: 'Check' }, 'SECTION_NOT_ENABLED', { enabledSections: { advancedSettings: false } }],
    [{ path: '__proto__.polluted', oldText: 'x', newText: 'y' }, 'INVALID_PATH'],
    [{ path: 'tags', oldText: 'sailor', newText: 'captain' }, 'STRUCTURED_FIELD_REQUIRES_PATCH'],
    [{ path: 'persona', oldText: '', newText: 'accidental insertion' }, 'TOOL_ARGUMENTS_INVALID'],
    [{ path: 'persona', oldText: 'sailor', newText: 123 }, 'TOOL_ARGUMENTS_INVALID']
  ]) {
    const result = edit(draft, [{ path: 'background', oldText: 'coastal', newText: 'inland' }, target], options);
    assert.equal(result.error, expected);
    assert.deepEqual(draft, original);
  }
  assert.equal({}.polluted, undefined);
});

test('status prompt and runtime section edits preserve all other status bar content', () => {
  const draft = fixture();
  const original = structuredClone(draft);
  const prompt = edit(draft, [{ path: 'statusBarPrompt', oldText: 'after each scene', newText: 'after injury' }]);
  assert.equal(prompt.ok, true);
  assert.deepEqual(draft.authorAdvancedSettings.statusBarBlueprint, original.authorAdvancedSettings.statusBarBlueprint);
  const code = edit(draft, [{ path: 'statusBarBlueprint.css', oldText: 'red', newText: 'blue' }]);
  assert.equal(code.ok, true);
  assert.deepEqual(code.sections, ['advancedSettings']);
  assert.deepEqual(parseStatusBarRuntime(draft.authorAdvancedSettings.statusBarBlueprint.template), { ...runtime, css: 'p { color: blue; }' });
  assert.deepEqual(draft.authorAdvancedSettings.statusBarBlueprint.variables, original.authorAdvancedSettings.statusBarBlueprint.variables);
  assert.equal(draft.authorAdvancedSettings.statusBarPrompt, 'Update HP after injury. Keep Mood stable.');
  assert.deepEqual(draft.authorAdvancedSettings.accessorySkills, original.authorAdvancedSettings.accessorySkills);
  assert.equal(draft.authorAdvancedSettings.customJs, original.authorAdvancedSettings.customJs);
});

test('raw template edits retain the format and code sections require an existing runtime document', () => {
  const draft = fixture();
  draft.authorAdvancedSettings.statusBarBlueprint.template = '<style>p { color: red; }</style><p>{{HP}}</p>';
  const original = structuredClone(draft);
  assert.equal(edit(draft, [{ path: 'statusBarBlueprint.css', oldText: 'red', newText: 'blue' }]).error, 'RUNTIME_REQUIRED');
  assert.deepEqual(draft, original);
  assert.equal(edit(draft, [{ path: 'statusBarBlueprint.template', oldText: 'red', newText: 'blue' }]).ok, true);
  assert.equal(draft.authorAdvancedSettings.statusBarBlueprint.template, '<style>p { color: blue; }</style><p>{{HP}}</p>');
  assert.equal(parseStatusBarRuntime(draft.authorAdvancedSettings.statusBarBlueprint.template), null);
});

test('edits to serialized runtime source reject invalid JSON and roll back the entire batch', () => {
  const draft = fixture();
  const original = structuredClone(draft);
  const result = edit(draft, [
    { path: 'persona', oldText: 'blue', newText: 'green' },
    { path: 'statusBarBlueprint.template', oldText: 'red', newText: 'blue"' }
  ]);
  assert.equal(result.error, 'INVALID_RUNTIME_TEMPLATE');
  assert.deepEqual(draft, original);
  const formatChange = edit(draft, [{ path: 'statusBarBlueprint.template', oldText: original.authorAdvancedSettings.statusBarBlueprint.template, newText: '<p>{{HP}}</p>' }]);
  assert.equal(formatChange.error, 'INVALID_RUNTIME_TEMPLATE');
  assert.deepEqual(draft, original);
  const valid = edit(draft, [{ path: 'statusBarBlueprint.template', oldText: 'red', newText: 'blue' }]);
  assert.equal(valid.ok, true);
  assert.deepEqual(parseStatusBarRuntime(draft.authorAdvancedSettings.statusBarBlueprint.template), { ...runtime, css: 'p { color: blue; }' });
});

test('text and serialized template limits reject overflow without truncation or partial writes', () => {
  const draft = fixture();
  const original = structuredClone(draft);
  const oversized = edit(draft, [{ path: 'openingMessage', oldText: 'Welcome', newText: 'x'.repeat(5000) }]);
  assert.equal(oversized.error, 'FIELD_TOO_LARGE');
  assert.equal(oversized.maxLength, 5000);
  assert.deepEqual(draft, original);
  const runtimeOverflow = edit(draft, [{ path: 'statusBarBlueprint.css', oldText: runtime.css, newText: 'x'.repeat(49900) }]);
  assert.equal(runtimeOverflow.error, 'TEMPLATE_TOO_LARGE');
  assert.deepEqual(draft, original);
  const plain = fixture();
  plain.authorAdvancedSettings.statusBarBlueprint.template = 'a'.repeat(50000);
  const plainOriginal = structuredClone(plain);
  assert.equal(edit(plain, [{ path: 'statusBarBlueprint.template', oldText: 'a', newText: 'aa', replaceAll: true }]).error, 'FIELD_TOO_LARGE');
  assert.deepEqual(plain, plainOriginal);
});

test('reads paginate minified source and long multiline fields without leaking other fields', () => {
  const draft = fixture();
  const minified = 'a'.repeat(8000) + 'UNIQUE_TAIL';
  draft.authorAdvancedSettings.customCss = minified;
  let combined = '';
  let offset = 0;
  do {
    const result = executeCharacterDraftEdit('read_character_field', { path: 'customCss', offset }, draft);
    assert.equal(result.ok, true);
    assert.ok(result.content.length <= 4000);
    assert.equal(result.offset, offset);
    assert.equal(result.startLine, 1);
    assert.equal(Object.hasOwn(result, 'character'), false);
    combined += result.content;
    offset = result.nextOffset;
  } while (offset !== null);
  assert.equal(combined, minified);
  draft.persona = 'line\n'.repeat(250);
  const multiline = executeCharacterDraftEdit('read_character_field', { path: 'persona', limit: 12000 }, draft);
  assert.equal(multiline.lineCount, 120);
  assert.equal(multiline.content, 'line\n'.repeat(120));
  assert.equal(multiline.nextOffset, 600);
  const second = executeCharacterDraftEdit('read_character_field', { path: 'persona', offset: multiline.nextOffset }, draft);
  assert.equal(second.startLine, 121);
  assert.equal(executeCharacterDraftEdit('read_character_field', { path: 'persona', offset: 5000 }, draft).error, 'INVALID_READ_RANGE');
  assert.equal(executeCharacterDraftEdit('read_character_field', { path: 'persona', limit: 12001 }, draft).error, 'INVALID_READ_RANGE');
});

test('structured fields are independently readable JSON and excluded context blocks inspection', () => {
  const draft = fixture();
  for (const [path, value] of [
    ['tags', draft.tags], ['regexRules', draft.regexRules], ['renderPlugins', draft.renderPlugins],
    ['modSuggestions', draft.modSuggestions], ['accessorySkills', draft.authorAdvancedSettings.accessorySkills],
    ['statusBarBlueprint.variables', draft.authorAdvancedSettings.statusBarBlueprint.variables]
  ]) {
    const read = executeCharacterDraftEdit('read_character_field', { path }, draft, { enabledSections: { advancedSettings: false } });
    assert.equal(read.format, 'json');
    assert.deepEqual(JSON.parse(read.content), value);
  }
  const read = executeCharacterDraftEdit('read_character_field', { path: 'persona' }, draft, { excludeCharacterContext: true });
  assert.equal(read.error, 'CHARACTER_CONTEXT_EXCLUDED');
  assert.equal(executeCharacterDraftEdit('search_character_draft', { query: 'sailor' }, draft, { excludeCharacterContext: true }).error, 'CHARACTER_CONTEXT_EXCLUDED');
  assert.equal(Object.hasOwn(read, 'content'), false);
});

test('searches use literal text, bounded snippets, correct offsets and no duplicate runtime copies', () => {
  const draft = fixture();
  draft.persona = 'İA\nLiteral .* ' + 'cat '.repeat(100);
  const literal = executeCharacterDraftEdit('search_character_draft', { query: '.*', path: 'persona' }, draft);
  assert.equal(literal.matches.length, 1);
  assert.equal(literal.matches[0].offset, draft.persona.indexOf('.*'));
  assert.equal(literal.matches[0].line, 2);
  const insensitive = executeCharacterDraftEdit('search_character_draft', { query: 'a', path: 'persona', caseSensitive: false, maxResults: 1 }, draft);
  assert.equal(insensitive.matches[0].offset, 1);
  const bounded = executeCharacterDraftEdit('search_character_draft', { query: 'cat', path: 'persona', maxResults: 3 }, draft);
  assert.equal(bounded.matches.length, 3);
  assert.equal(bounded.truncated, true);
  assert.ok(bounded.matches.every(match => match.snippet.length <= 240));
  const css = executeCharacterDraftEdit('search_character_draft', { query: 'p { color: red; }' }, draft);
  assert.deepEqual(css.matches.map(match => match.path), ['statusBarBlueprint.css']);
  assert.equal(executeCharacterDraftEdit('search_character_draft', { query: '' }, draft).ok, false);
  assert.equal(executeCharacterDraftEdit('search_character_draft', { query: 'cat', maxResults: 31 }, draft).ok, false);
});

test('visibility and image edits validate values and no-op edits do not alter a sparse draft', () => {
  const draft = fixture();
  assert.equal(edit(draft, [{ path: 'visibility', oldText: 'private', newText: 'public' }]).ok, true);
  assert.equal(draft.visibility, 'public');
  const original = structuredClone(draft);
  assert.equal(edit(draft, [{ path: 'visibility', oldText: 'public', newText: 'invalid' }]).error, 'INVALID_VISIBILITY');
  assert.deepEqual(draft, original);
  assert.equal(edit(draft, [{ path: 'desktopBackgroundUrl', oldText: '/uploads/old.png', newText: 'javascript:bad' }]).error, 'INVALID_BACKGROUND_URL');
  assert.deepEqual(draft, original);
  assert.equal(edit(draft, [{ path: 'desktopBackgroundUrl', oldText: 'old.png', newText: 'new.png' }]).ok, true);
  assert.equal(draft.authorAdvancedSettings.desktopBackgroundUrl, '/uploads/new.png');
  const sparse = { authorAdvancedSettings: { statusBarPrompt: 'Keep HP stable.' } };
  const sparseOriginal = structuredClone(sparse);
  const noChange = edit(sparse, [{ path: 'statusBarPrompt', oldText: 'HP', newText: 'HP' }]);
  assert.equal(noChange.changed, false);
  assert.deepEqual(noChange.sections, []);
  assert.deepEqual(sparse, sparseOriginal);
});

test('profile text edits use the saved character limits and retain a valid fifty-character name', () => {
  const draft = fixture();
  draft.name = 'N'.repeat(50);
  draft.gender = 'G'.repeat(20);
  draft.age = 'A'.repeat(20);
  assert.equal(edit(draft, [{ path: 'persona', oldText: 'blue', newText: 'green' }]).ok, true);
  assert.equal(draft.name, 'N'.repeat(50));
  assert.equal(edit(draft, [{ path: 'name', oldText: 'N'.repeat(50), newText: 'M'.repeat(50) }]).ok, true);
  const original = structuredClone(draft);
  for (const [path, oldText, newText, maxLength] of [
    ['name', 'M'.repeat(50), 'N'.repeat(51), 50],
    ['gender', 'G'.repeat(20), 'G'.repeat(21), 20],
    ['age', 'A'.repeat(20), 'A'.repeat(21), 20]
  ]) {
    const result = edit(draft, [{ path, oldText, newText }]);
    assert.equal(result.error, 'FIELD_TOO_LARGE');
    assert.equal(result.maxLength, maxLength);
    assert.deepEqual(draft, original);
  }
});

test('editing tool schemas separate read access from text mutation and reject arbitrary properties', () => {
  assert.deepEqual([...CHARACTER_DRAFT_READ_TOOLS], ['read_character_field', 'search_character_draft']);
  assert.equal(CHARACTER_DRAFT_EDIT_TOOL, 'edit_character_text');
  assert.ok(characterDraftEditingTools.every(tool => tool.function.parameters.additionalProperties === false));
  const readPaths = characterDraftEditingTools[0].function.parameters.properties.path.enum;
  const editPaths = characterDraftEditingTools[2].function.parameters.properties.edits.items.properties.path.enum;
  assert.ok(readPaths.includes('regexRules'));
  assert.equal(editPaths.includes('regexRules'), false);
  assert.ok(editPaths.includes('statusBarBlueprint.css'));
});
