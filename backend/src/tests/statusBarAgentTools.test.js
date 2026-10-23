import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-status-bar-tools';

const { createAppDatabase } = await import('../db.js');
const { createCharacter, getCharacter } = await import('../modules/characters.js');
const { mergeAdvancedSettings, normalizeAdvancedSettings, normalizeAccessorySkills } = await import('../modules/advancedSettings.js');
const { upsertStatusBar, getStatusBar } = await import('../modules/statusBars.js');
const { createProviderProfile } = await import('../repositories/providerProfileRepository.js');
const { encryptSecret } = await import('../security.js');
const { runAccessoryAgents } = await import('../services/accessoryAgents.js');
const { accessorySkillThinkingOptions, resolveAccessorySkillSettings } = await import('../services/accessorySkillProvider.js');
const { executeStatusBarEdit, statusBarEditingTools } = await import('../services/statusBarAgentTools.js');
const { parseStatusBarRuntime, serializeStatusBarRuntime } = await import('../../../shared/statusBarRuntime.js');
const { describeAiTool } = await import('../services/toolRegistry.js');

const runtime = { renderer: 'runtime', framework: 'vue', html: '<p>{{ values.HP }}</p>', css: 'p { color: red; }', javascript: 'return {};' };
const initial = () => ({ name: 'State', template: serializeStatusBarRuntime(runtime), variables: [
  { name: 'HP', value: 80, type: 'meter', min: -10, max: 100, color: '#abcdef', unit: '点' },
  { name: 'Mood', value: 'calm', type: 'text', color: '' }
] });

test('precise status edits preserve omitted metadata and isolate variable removal', () => {
  const original = initial();
  const updated = executeStatusBarEdit(original, 'upsert_status_bar_variable', { name: 'hp', value: 40, unit: '' });
  assert.equal(updated.ok, true);
  const { unit: _unit, ...preserved } = original.variables[0];
  assert.deepEqual(updated.statusBar.variables[0], { ...preserved, value: 40 });
  assert.deepEqual(original, initial(), 'the input state is never mutated');
  const renamed = executeStatusBarEdit(updated.statusBar, 'upsert_status_bar_variable', { name: 'Mood', renameTo: 'Emotion', color: '#123456' });
  assert.equal(renamed.statusBar.variables[1].name, 'Emotion');
  assert.equal(renamed.statusBar.variables[1].value, 'calm');
  const removed = executeStatusBarEdit(renamed.statusBar, 'remove_status_bar_variable', { name: 'HP' });
  assert.equal(removed.ok, true);
  assert.deepEqual(removed.statusBar.variables.map(variable => variable.name), ['Emotion']);
  assert.equal(removed.statusBar.template, original.template);
  assert.equal(executeStatusBarEdit(original, 'upsert_status_bar_variable', { name: 'HP', renameTo: 'Mood' }).error, 'VARIABLE_NAME_CONFLICT');
  assert.equal(executeStatusBarEdit(original, 'upsert_status_bar_variable', { name: 'Missing' }).error, 'VARIABLE_VALUE_REQUIRED');
});

test('literal replacements report mismatches and preserve other runtime code sections', () => {
  const original = initial();
  const mismatch = executeStatusBarEdit(original, 'replace_status_bar_template', { section: 'css', search: 'blue', replacement: 'green' });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error, 'MATCH_COUNT_MISMATCH');
  assert.equal(mismatch.occurrences, 0);
  assert.equal(mismatch.recoverable, true);
  assert.deepEqual(mismatch.statusBar, original);
  const replaced = executeStatusBarEdit(original, 'replace_status_bar_template', { section: 'css', search: 'red', replacement: 'green' });
  assert.deepEqual(parseStatusBarRuntime(replaced.statusBar.template), { ...runtime, css: 'p { color: green; }' });
  const code = executeStatusBarEdit(replaced.statusBar, 'update_status_bar_code', { javascript: 'return { expanded: true };' });
  assert.deepEqual(parseStatusBarRuntime(code.statusBar.template), { ...runtime, css: 'p { color: green; }', javascript: 'return { expanded: true };' });
  const metadata = executeStatusBarEdit(code.statusBar, 'update_status_bar_metadata', { name: 'Detailed state' });
  assert.equal(metadata.statusBar.template, code.statusBar.template);
  assert.equal(executeStatusBarEdit(original, 'update_status_bar_code', { html: 'x'.repeat(50000) }).error, 'TEMPLATE_TOO_LARGE');
  const legacy = { ...original, template: '<span>{{HP}}</span>' };
  assert.equal(executeStatusBarEdit(legacy, 'remove_status_bar_variable', { name: 'HP' }).error, 'VARIABLE_REFERENCED');
  assert.deepEqual(parseStatusBarRuntime(executeStatusBarEdit(legacy, 'update_status_bar_code', { css: 'span {}' }).statusBar.template), {
    renderer: 'runtime', framework: 'html', html: legacy.template, css: 'span {}', javascript: ''
  });
});

test('status agent can create the 120th variable and rejects a 121st without blocking edits', () => {
  const original = {
    name: 'Full status bar', template: '',
    variables: Array.from({ length: 119 }, (_item, index) => ({ name: `Var ${index + 1}`, value: index, type: 'number' }))
  };
  const created = executeStatusBarEdit(original, 'upsert_status_bar_variable', { name: 'Var 120', value: 120, type: 'number' });
  assert.equal(created.ok, true);
  assert.equal(created.statusBar.variables.length, 120);
  assert.equal(created.statusBar.variables.at(-1).name, 'Var 120');
  const rejected = executeStatusBarEdit(created.statusBar, 'upsert_status_bar_variable', { name: 'Var 121', value: 121 });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, 'VARIABLE_LIMIT');
  assert.deepEqual(rejected.statusBar, created.statusBar);
  const edited = executeStatusBarEdit(created.statusBar, 'upsert_status_bar_variable', { name: 'Var 120', value: 999 });
  assert.equal(edited.ok, true);
  assert.equal(edited.statusBar.variables.length, 120);
  assert.equal(edited.statusBar.variables.at(-1).value, 999);
});

test('runtime Vue expressions never become blueprint variables and tool permissions apply', () => {
  const blueprint = normalizeAdvancedSettings({ statusBarBlueprint: initial() }).statusBarBlueprint;
  assert.deepEqual(blueprint.variables.map(variable => variable.name), ['HP', 'Mood']);
  const disabled = { tools: { update_status_bar_code: false, upsert_status_bar_variable: false } };
  assert.equal(statusBarEditingTools(disabled).some(tool => tool.function.name === 'update_status_bar_code'), false);
  assert.equal(executeStatusBarEdit(initial(), 'upsert_status_bar_variable', { name: 'HP', value: 1 }, disabled).error, 'TOOL_DISABLED');
  assert.equal(describeAiTool('update_status_bar_code').effect, 'write');
  assert.equal(describeAiTool('read_status_bar').effect, 'read');
  assert.equal(normalizeAccessorySkills({ statusBarAgent: { thinkingLevel: 'max' } }).statusBarAgent.thinkingLevel, 'max');
  assert.equal(normalizeAccessorySkills({ statusBarAgent: { thinkingLevel: 'invalid' } }).statusBarAgent.thinkingLevel, '');
  assert.deepEqual(accessorySkillThinkingOptions({ thinkingLevel: 'low' }, { thinkingLevel: '' }), { thinkingEnabled: true, thinkingLevel: 'low' });
  assert.deepEqual(accessorySkillThinkingOptions({ thinkingLevel: 'high' }, { thinkingLevel: 'off' }), { thinkingEnabled: false, thinkingLevel: 'off' });
  assert.throws(() => normalizeAdvancedSettings({ statusBarBlueprint: { template: serializeStatusBarRuntime({ ...runtime, html: 'x'.repeat(50000) }) } }),
    error => error.status === 400 && error.code === 'STATUS_BAR_TEMPLATE_TOO_LARGE');
});

test('status agent uses its own usable profile when the main provider is missing, including model and thinking', async () => {
  const env = setup();
  const profile = createProviderProfile(env.db, env.userId, {
    providerType: 'custom', gatewayName: 'Status Gateway', baseUrl: 'https://status-profile.test/v1', model: 'profile-model',
    encryptedApiKey: encryptSecret('sk-profile'), apiKeyHint: 'sk-****file', supportsReasoning: true, extraBody: '{}'
  }, { select: false });
  const skill = { enabled: true, providerProfileId: profile.id, modelOverride: 'deepseek-v4-pro', thinkingLevel: 'max' };
  env.conversation.settings.accessorySkills.statusBarAgent = skill;
  assert.equal(resolveAccessorySkillSettings(env.db, env.userId, {}, skill).settings.thinkingLevel, 'max');
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return response('skip_status_bar_update', {});
  };
  try {
    const result = await runAccessoryAgents({ ...env, assistantMessage: { content: 'Nothing changes.' }, settings: {}, strictErrors: true });
    assert.equal(result[0].ok, true);
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /status-profile\.test/);
    assert.equal(requests[0].body.model, 'deepseek-v4-pro');
    assert.deepEqual(requests[0].body.thinking, { type: 'enabled' });
    assert.equal(requests[0].body.reasoning_effort, 'max');
  } finally {
    globalThis.fetch = originalFetch;
    env.db.close();
  }
});

test('status agent retries failed precise edits and persists successive code and metadata edits', async () => {
  const env = setup();
  const sequence = [
    ['replace_status_bar_template', { section: 'css', search: 'missing', replacement: 'green' }],
    ['replace_status_bar_template', { section: 'css', search: 'red', replacement: 'green' }],
    ['upsert_status_bar_variable', { name: 'HP', value: 45, color: '#123456' }],
    ['remove_status_bar_variable', { name: 'Mood' }],
    ['skip_status_bar_update', {}]
  ];
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const [name, args] = sequence[requests.length - 1];
    return response(name, args);
  };
  try {
    const result = await runAccessoryAgents({ ...env, assistantMessage: { content: 'HP: 99/100.' }, settings: provider(), strictErrors: true });
    assert.equal(result[0].ok, true);
    assert.equal(requests.length, 5);
    assert.equal(JSON.parse(requests[1].messages.find(message => message.role === 'tool').content).error, 'MATCH_COUNT_MISMATCH');
    const stored = getStatusBar(env.db, env.userId, env.conversation.id);
    assert.deepEqual(stored.variables.map(variable => variable.name), ['HP']);
    assert.equal(stored.variables[0].value, 45);
    assert.equal(stored.variables[0].max, 100);
    assert.equal(stored.variables[0].color, '#123456');
    assert.equal(parseStatusBarRuntime(stored.template).css, 'p { color: green; }');
  } finally {
    globalThis.fetch = originalFetch;
    env.db.close();
  }
});

test('status agent template hints ignore JavaScript attributes and script source', async () => {
  const env = setup();
  const originalFetch = globalThis.fetch;
  let request = null;
  const template = `<button onclick="const {localState} = this; void '{{jsLabel}}';">Toggle</button>
<script>const {scriptState} = values; const label = '{{scriptLabel}}';</script>
<section><span class="sb-label">Health</span><span class="sb-val">{{HP}}</span></section>`;
  env.statusBar = upsertStatusBar(env.db, env.userId, env.conversation.id, { ...env.statusBar, template });
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return response('skip_status_bar_update', {});
  };
  try {
    const results = await runAccessoryAgents({ ...env, assistantMessage: { content: 'No change.' }, settings: provider(), strictErrors: true });
    assert.equal(results[0].ok, true);
    const context = JSON.parse(request.messages.find(message => message.role === 'user').content);
    assert.deepEqual(context.templateHints, { compositeRows: [], placeholders: ['HP'] });
    assert.equal(context.statusBar.template, template, 'the full source remains available for precise code editing');
    assert.deepEqual(context.variables.map(variable => variable.name), ['HP', 'Mood']);
  } finally {
    globalThis.fetch = originalFetch;
    env.db.close();
  }
});

test('disabled compatibility tool blocks narration fallback writes', async () => {
  const env = setup();
  env.conversation.settings.accessorySkills.statusBarAgent.tools = { update_status_bar: false };
  try {
    await runAccessoryAgents({ ...env, assistantMessage: { content: 'HP: 12/100.' }, settings: {} });
    assert.equal(getStatusBar(env.db, env.userId, env.conversation.id).variables[0].value, 80);
  } finally { env.db.close(); }
});

test('final status updates contain only surviving final values after repeated precise and compatibility edits', async () => {
  for (const compatibility of [false, true]) {
    const env = setup();
    const sequence = [
      ['upsert_status_bar_variable', { name: 'HP', value: 45 }],
      ['upsert_status_bar_variable', { name: 'Mood', value: 'angry' }],
      ['upsert_status_bar_variable', { name: 'HP', value: 55 }],
      ['remove_status_bar_variable', { name: 'Mood' }],
      compatibility ? ['update_status_bar', { variables: [{ name: 'HP', value: 60 }] }] : ['skip_status_bar_update', {}]
    ];
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      const [name, args] = sequence[calls++];
      return response(name, args);
    };
    try {
      const results = await runAccessoryAgents({ ...env, assistantMessage: { content: 'HP: 99/100.' }, settings: provider(), strictErrors: true });
      const stored = getStatusBar(env.db, env.userId, env.conversation.id);
      assert.equal(stored.variables[0].value, compatibility ? 60 : 55);
      assert.deepEqual(results[0].result.updates, stored.variables);
      assert.deepEqual(stored.variables.map(variable => variable.name), ['HP']);
    } finally {
      globalThis.fetch = originalFetch;
      env.db.close();
    }
  }
});

test('a failed precise save rolls back its mutation and later reads retain the previous status', async () => {
  const env = setup();
  env.db.exec(`CREATE TEMP TRIGGER fail_status_event BEFORE INSERT ON world_events
    WHEN NEW.event_type = 'status.updated' BEGIN SELECT RAISE(ABORT, 'forced status event failure'); END`);
  const sequence = [
    ['upsert_status_bar_variable', { name: 'HP', value: 45 }],
    ['read_status_bar', {}],
    ['skip_status_bar_update', {}]
  ];
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const [name, args] = sequence[requests.length - 1];
    return response(name, args);
  };
  try {
    const results = await runAccessoryAgents({ ...env, assistantMessage: { content: 'HP: 99/100.' }, settings: provider(), strictErrors: true });
    assert.equal(results[0].ok, true);
    assert.equal(getStatusBar(env.db, env.userId, env.conversation.id).variables[0].value, 80);
    const failure = JSON.parse(requests[1].messages.find(message => message.role === 'tool').content);
    assert.equal(failure.error, 'TOOL_EXECUTION_FAILED');
    const toolMessages = requests[2].messages.filter(message => message.role === 'tool');
    assert.equal(JSON.parse(toolMessages.at(-1).content).statusBar.variables[0].value, 80);
  } finally {
    globalThis.fetch = originalFetch;
    env.db.close();
  }
});

test('public character inheritance strips executable status templates while owners and user-authored templates keep them', () => {
  const env = setup();
  try {
    const character = createCharacter(env.db, env.userId, {
      name: 'Public runtime author', visibility: 'public', authorAdvancedSettings: { statusBarBlueprint: initial() }
    });
    const owner = getCharacter(env.db, env.userId, character.id);
    const publicCharacter = getCharacter(env.db, 'another-viewer', character.id);
    assert.equal(owner.authorAdvancedSettings.statusBarBlueprint.template, initial().template);
    const inherited = publicCharacter.authorAdvancedSettings.statusBarBlueprint;
    assert.equal(inherited.template, '');
    assert.equal(inherited.name, initial().name);
    assert.deepEqual(inherited.variables, initial().variables);
    assert.equal(mergeAdvancedSettings({ statusBarBlueprint: initial() }).statusBarBlueprint.template, '');
    assert.equal(mergeAdvancedSettings({ statusBarBlueprint: initial() }, {}, { allowAuthorDangerous: true }).statusBarBlueprint.template, initial().template);
    assert.equal(mergeAdvancedSettings({ statusBarBlueprint: initial() }, { statusBarBlueprint: initial() }).statusBarBlueprint.template, initial().template);
    const legacy = '<p>{{ HP }}</p>';
    assert.equal(mergeAdvancedSettings({ statusBarBlueprint: { ...initial(), template: legacy } }).statusBarBlueprint.template, legacy);
  } finally { env.db.close(); }
});

function setup() {
  const db = createAppDatabase(':memory:');
  const userId = 'status-tools-user';
  const timestamp = new Date().toISOString();
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(userId, userId, 'hash', timestamp);
  const character = createCharacter(db, userId, { name: 'Hero' });
  const conversation = { id: 'status-tools-conversation', settings: { accessorySkills: { statusBarAgent: { enabled: true } } } };
  db.prepare('INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(conversation.id, userId, character.id, 'Status tools', timestamp, timestamp);
  const statusBar = upsertStatusBar(db, userId, conversation.id, initial());
  return { db, userId, conversation, character, statusBar };
}

function provider() {
  return { providerType: 'custom', gatewayName: 'Mock', baseUrl: 'https://status-test.test/v1', model: 'mock-model', apiKey: 'sk-test', extraBody: {} };
}

function response(name, args) {
  return Response.json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [
    { id: `tool-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }
  ] } }] });
}
