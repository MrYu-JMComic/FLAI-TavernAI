import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
  createStatusBarRuntimeExample,
  mapStatusBarTemplateMarkup,
  parseStatusBarRuntime,
  serializeStatusBarRuntime
} from '../../../shared/statusBarRuntime.js';
import { renderStatusTemplate } from '../../../shared/statusTemplateRenderer.js';
import { createAppDatabase } from '../db/runtime.js';
import { normalizeStatusBarBlueprint } from '../modules/advancedSettings.js';
import { createStatusBarTemplate, listStatusBarTemplates } from '../modules/statusBarTemplates.js';
import { getStatusBar, updateStatusBarVariables, upsertStatusBar } from '../modules/statusBars.js';
import {
  captureConversationSnapshot,
  restoreConversationSnapshot
} from '../repositories/conversationSnapshotRepository.js';
import { buildExportEnvelope, importExportEnvelope } from '../services/exportEnvelopes.js';
import { saveStatusBarSchema } from '../validations/schemas.js';
import { useChatAccessory } from '../../../frontend/src/composables/chat/useChatAccessory.js';
import { normalizeStatusBarBlueprintForPayload } from '../../../frontend/src/composables/character/useCharacterStatusBlueprint.js';
import { buildStatusBarRuntimeDocument } from '../../../frontend/src/utils/statusBarRuntimeDocument.js';

const userId = 'runtime-user';
const conversationId = 'runtime-conversation';
const vueGlobalSource = readFileSync(new URL('../../../frontend/node_modules/vue/dist/vue.global.prod.js', import.meta.url), 'utf8');

async function mountRuntimeDocument(config, waitForAction = 'ready', options = {}) {
  const messages = [];
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const initial = {
    id: 'runtime-frame-test', moduleUrl: 'about:blank#vue',
    statusBar: { id: 'runtime-bar', name: 'Runtime', variables: [{ name: 'HP', value: 23 }] },
    context: { char: 'Runtime Character' },
    ...options
  };
  const dom = new JSDOM(buildStatusBarRuntimeDocument(config, initial), {
    url: 'https://flai.test/status-runtime', runScripts: 'dangerously',
    beforeParse(window) {
      // Exercise the shipped browser runtime in its own realm without fetching
      // a CDN or recreating Vue's reactivity behavior in the test.
      window.eval(vueGlobalSource);
      window.ResizeObserver = class {
        observe() {}
        disconnect() { window.resizeDisconnected = true; }
      };
      window.postMessage = (message) => {
        messages.push(message);
        if (message.action === waitForAction) readyResolve();
        if (message.action === 'error') readyReject(new Error(message.message));
      };
    }
  });
  const timeout = setTimeout(() => readyReject(new Error('Runtime did not become ready')), 10000);
  try {
    await ready;
  } catch (error) {
    dom.window.close();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  function send(action, payload = {}) {
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      source: dom.window,
      data: { type: 'flai-status-host', id: initial.id, action, ...payload }
    }));
  }
  return { dom, messages, send };
}

function createDatabase() {
  const database = createAppDatabase(':memory:');
  const now = new Date().toISOString();
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, 'runtime-user', 'hash', now);
  database.prepare(`INSERT INTO characters (
    id, user_id, name, gender, age, background, worldview, persona, opening_message, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('runtime-character', userId, 'Runtime Character', '', '', '', '', '', '', now, now);
  database.prepare(`INSERT INTO conversations (
    id, user_id, character_id, title, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(conversationId, userId, 'runtime-character', 'Runtime Conversation', now, now);
  return database;
}

function runtimeTemplate(framework = 'vue') {
  return serializeStatusBarRuntime({
    framework,
    html: '\n<section v-for="item in variables"><b>{{ item.name }}</b>{{ values.HP }}</section>\n',
    css: '\n@media (min-width: 1px) { section { --tone: red; color: var(--tone); } }\n',
    javascript: '\nconst state = { pending }; window.runtimeLabel = "{{ not_a_status_variable }}";\n'
  });
}

test('runtime protocol distinguishes executable configurations from legacy templates', () => {
  for (const input of [
    '', '<b>{{ HP }}</b>', '{"variant":"neon"}', '{"framework":"vue","html":"<b>HP</b>"}',
    '{"renderer":"other","framework":"html"}', 'null', '[]', 'true', '{broken'
  ]) {
    assert.equal(parseStatusBarRuntime(input), null, String(input));
  }
  for (const framework of ['html', 'vue']) {
    const template = runtimeTemplate(framework);
    const parsed = parseStatusBarRuntime(template);
    assert.equal(parsed.renderer, 'runtime');
    assert.equal(parsed.framework, framework);
    assert.equal(serializeStatusBarRuntime(parsed), template);
  }
});

test('runtime serialization preserves source whitespace, script delimiters and Vue expressions', () => {
  const source = {
    framework: 'vue',
    html: ' \n<div>{{ values.HP }}</div><script>window.flag = "</script>";</script>\n ',
    css: ' \n@import url("https://example.test/theme.css"); :root { --mark: "</style>"; }\n ',
    javascript: ' \nreturn { label: "</script>", template: "{{ values.HP }}", symbol: "\u2028\u2029" };\n '
  };
  const parsed = parseStatusBarRuntime(serializeStatusBarRuntime(source));
  for (const key of ['framework', 'html', 'css', 'javascript']) {
    assert.equal(parsed[key], source[key], key);
  }
  const oversized = serializeStatusBarRuntime({ ...source, html: 'x'.repeat(50001) });
  assert.equal(parseStatusBarRuntime(oversized).html.length, 50001);
  assert.equal(saveStatusBarSchema.safeParse({ name: 'Too large', variables: [], template: oversized }).success, false);
});

test('runtime examples are valid configurations for both supported frameworks', () => {
  for (const framework of ['html', 'vue']) {
    const example = createStatusBarRuntimeExample(framework);
    const parsed = parseStatusBarRuntime(typeof example === 'string' ? example : serializeStatusBarRuntime(example));
    assert.ok(parsed);
    assert.equal(parsed.framework, framework);
    assert.ok(parsed.html.trim());
  }
});

test('scripted display templates preserve script state and authored bindings across DOM updates', async (t) => {
  const templateHtml = (value) => `<section id="panel"><output id="hp">${value}</output>
    <button id="add">Add HP</button><output id="boot"></output><output id="loaded"></output></section>
    <script type="application/json" id="data">{"label":"{unchanged}"}</script>
    <script>
      window.boots = (window.boots || 0) + 1;
      const button = document.getElementById('add');
      window.originalButton = button;
      button.addEventListener('click', () => api.setVariable('HP', values.HP + 1));
      document.getElementById('boot').textContent = String(window.boots);
      const inserted = document.createElement('span');
      inserted.textContent = 'Script content';
      document.getElementById('panel').prepend(inserted);
      document.addEventListener('DOMContentLoaded', () => document.getElementById('loaded').textContent = 'loaded');
      api.onCleanup(() => window.didCleanup = true);
    </script>`;
  const runtime = await mountRuntimeDocument({ framework: 'html', html: '', css: '', javascript: '' }, 'ready', {
    templateHtml: templateHtml(23)
  });
  t.after(() => runtime.dom.window.close());
  const { window } = runtime.dom;
  assert.equal(window.document.querySelector('#boot').textContent, '1');
  assert.equal(window.document.querySelector('#loaded').textContent, 'loaded');
  assert.equal(window.document.querySelector('#data').textContent, '{"label":"{unchanged}"}');
  runtime.send('update', { statusBar: { variables: [{ name: 'HP', value: 24 }] }, templateHtml: templateHtml(24) });
  assert.equal(window.document.querySelector('#hp').textContent, '24');
  assert.equal(window.document.querySelector('#boot').textContent, '1');
  assert.equal(window.document.querySelector('#panel').firstChild.textContent, 'Script content');
  assert.equal(window.document.querySelector('#add'), window.originalButton);
  window.originalButton.click();
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.messages.find((message) => message.action === 'update-variables').updates)), [
    { name: 'HP', value: 25 }
  ]);
  runtime.send('dispose');
  assert.equal(window.didCleanup, true);
});

test('conditional template insertions preserve listeners on identical unkeyed controls', async (t) => {
  const source = `{{#if HP > 5}}<button>New</button>{{/if}}<button>Existing</button>
    <script>
      window.original = document.querySelector('button');
      window.clicks = 0;
      window.original.addEventListener('click', () => window.clicks++);
    </script>`;
  const render = value => mapStatusBarTemplateMarkup(source, markup => renderStatusTemplate(markup, {
    resolveVariable: () => ({ name: 'HP', value, displayValue: String(value) })
  }), { markNodes: true });
  const runtime = await mountRuntimeDocument({ framework: 'html', html: '', css: '', javascript: '' }, 'ready', {
    templateHtml: render(5)
  });
  t.after(() => runtime.dom.window.close());
  const { window } = runtime.dom;
  runtime.send('update', { statusBar: { variables: [{ name: 'HP', value: 6 }] }, templateHtml: render(6) });
  const buttons = window.document.querySelectorAll('button');
  assert.deepEqual(Array.from(buttons, button => button.textContent), ['New', 'Existing']);
  assert.equal(buttons[1], window.original);
  buttons[1].click();
  assert.equal(window.clicks, 1);
  runtime.send('update', { statusBar: { variables: [{ name: 'HP', value: 4 }] }, templateHtml: render(4) });
  assert.equal(window.document.querySelector('button'), window.original);
  window.original.click();
  assert.equal(window.clicks, 2);
});

test('generated HTML runtime executes events, receives updates and cleans up on disposal', async (t) => {
  const runtime = await mountRuntimeDocument({
    framework: 'html',
    html: '<output id="hp"></output><button onclick="api.setVariable(\'HP\', values.HP + 1)">Add</button>',
    css: 'output { color: red; }',
    javascript: `window.setupCount = (window.setupCount || 0) + 1;
window.sourceText = '</script>\u2028\u2029';
const output = document.getElementById('hp');
const render = () => { output.textContent = values.HP + ':' + context.char; };
render();
api.onUpdate(render);
api.onCleanup(() => { window.cleanupCount = (window.cleanupCount || 0) + 1; });`
  });
  t.after(() => runtime.dom.window.close());
  const { window } = runtime.dom;
  assert.equal(window.document.querySelector('#hp').textContent, '23:Runtime Character');
  assert.equal(window.sourceText, '</script>\u2028\u2029');
  window.document.querySelector('button').click();
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.messages.at(-1).updates)), [{ name: 'HP', value: 24 }]);

  runtime.send('update', { statusBar: { variables: [{ name: 'HP', value: 41 }] }, context: { char: 'Updated' } });
  await window.Vue.nextTick();
  assert.equal(window.document.querySelector('#hp').textContent, '41:Updated');
  assert.equal(window.setupCount, 1);
  runtime.send('dispose');
  runtime.send('dispose');
  assert.equal(window.cleanupCount, 1);
  assert.equal(window.resizeDisconnected, true);
  let lateCleanup = 0;
  window.api.onCleanup(() => { lateCleanup += 1; });
  assert.equal(lateCleanup, 1);
  runtime.send('update', { statusBar: { variables: [{ name: 'HP', value: 99 }] } });
  assert.equal(window.document.querySelector('#hp').textContent, '41:Updated');
});

test('generated Vue runtime renders bindings, reacts without rerunning code and unmounts', async (t) => {
  const runtime = await mountRuntimeDocument({
    framework: 'vue', html: '<output id="hp">{{ label }}:{{ values.HP }}</output>', css: '',
    javascript: `window.setupCount = (window.setupCount || 0) + 1;
return { label: Vue.ref('Vue') };`
  });
  t.after(() => runtime.dom.window.close());
  const { window } = runtime.dom;
  assert.equal(window.document.querySelector('#hp').textContent, 'Vue:23');
  runtime.send('update', { statusBar: { variables: [{ name: 'HP', value: 17 }] }, context: {} });
  await window.Vue.nextTick();
  assert.equal(window.document.querySelector('#hp').textContent, 'Vue:17');
  assert.equal(window.setupCount, 1);
  runtime.send('dispose');
  assert.equal(window.document.querySelector('#hp'), null);
});

test('async Vue setup immediately cleans up resources registered after disposal', async (t) => {
  const runtime = await mountRuntimeDocument({
    framework: 'vue', html: '<output id="late-mount">Late mount</output>', css: '',
    javascript: `window.setupFinished = new Promise((resolve) => { window.markFinished = resolve; });
const resumed = new Promise((resolve) => { window.resumeSetup = resolve; });
api.quickReply('setup-started');
await resumed;
api.onCleanup(() => { window.cleanupCount = (window.cleanupCount || 0) + 1; });
window.markFinished();
return {};`
  }, 'quick-reply');
  t.after(() => runtime.dom.window.close());
  const { window } = runtime.dom;
  runtime.send('dispose');
  window.resumeSetup();
  await window.setupFinished;
  await window.Vue.nextTick();
  assert.equal(window.cleanupCount, 1);
  assert.equal(window.document.querySelector('#late-mount'), null);
  assert.equal(window.resizeDisconnected, true);
});

test('runtime saves and variable updates keep code intact without inferring JavaScript or Vue identifiers', (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const template = runtimeTemplate();
  const original = upsertStatusBar(database, userId, conversationId, {
    name: 'Runtime', template, variables: [{ name: 'HP', type: 'meter', value: 80, max: 100 }]
  });
  assert.equal(original.template, template);
  assert.deepEqual(original.variables.map((item) => item.name), ['HP']);

  const updated = updateStatusBarVariables(database, userId, conversationId, [{ name: 'HP', value: 65 }]);
  assert.equal(updated.template, template);
  assert.deepEqual(updated.variables.map((item) => item.name), ['HP']);
  assert.equal(updated.variables[0].value, 65);

  const codeOnly = upsertStatusBar(database, userId, conversationId, { name: 'Code only', template, variables: [] });
  assert.deepEqual(codeOnly.variables, []);
});

test('runtime character blueprints preserve code and only their explicitly declared variables', () => {
  const template = runtimeTemplate();
  const blueprint = normalizeStatusBarBlueprint({
    name: 'Runtime blueprint', template,
    variables: [{ name: 'HP', type: 'number', value: 23 }]
  });
  assert.equal(blueprint.template, template);
  assert.deepEqual(blueprint.variables.map((item) => item.name), ['HP']);
  assert.equal(blueprint.variables[0].value, 23);
  assert.deepEqual(normalizeStatusBarBlueprint({ template, variables: [] }).variables, []);

  const frontendPayload = normalizeStatusBarBlueprintForPayload({ template, variables: [] });
  assert.equal(frontendPayload.template, template);
  assert.deepEqual(frontendPayload.variables, []);
});

test('code-only runtime bars remain visible and survive opening and saving the chat editor', async (t) => {
  const template = runtimeTemplate();
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    if (requestUrl === '/api/csrf-token') {
      return Response.json({ csrfToken: 'runtime-csrf' });
    }
    assert.equal(requestUrl, '/api/conversations/runtime-conversation/status-bar');
    assert.equal(options.method, 'PUT');
    const payload = JSON.parse(options.body);
    requests.push(payload);
    return Response.json({ id: 'runtime-status', conversationId, ...payload });
  };
  const errors = [];
  const accessory = useChatAccessory({
    conversation: { value: { id: conversationId, character: { name: 'Runtime Character' } } },
    showActionNotice() {}, showError(message) { errors.push(message); }
  });
  t.after(() => accessory.cleanupAccessory());
  try {
    accessory.applyStatusBarUpdate({ id: 'runtime-status', conversationId, name: 'Code only', template, variables: [] });
    assert.equal(accessory.hasStatusBarContent.value, true);
    accessory.openStatusBarEditor();
    await accessory.saveStatusBarChanges();
    assert.deepEqual(errors, []);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].template, template);
    assert.deepEqual(requests[0].variables, []);
    assert.equal(accessory.statusBar.value.template, template);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('runtime template export and import preserve executable code and avoid phantom variables', (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const template = runtimeTemplate('html');
  createStatusBarTemplate(database, userId, { name: 'Runtime template', template, variables: [] });
  const envelope = buildExportEnvelope(database, userId, 'status-bar-templates');
  assert.equal(envelope.items.length, 1);
  assert.equal(envelope.items[0].template, template);
  assert.deepEqual(envelope.items[0].variables, []);

  const result = importExportEnvelope(database, userId, 'status-bar-templates', envelope);
  assert.equal(result.imported, 1);
  const imported = listStatusBarTemplates(database, userId).find((item) => item.id === result.items[0].id);
  assert.equal(imported.template, template);
  assert.deepEqual(imported.variables, []);
});

test('oversized runtime imports fail without persisting truncated code or changing the active bar', (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const original = upsertStatusBar(database, userId, conversationId, {
    name: 'Original', template: runtimeTemplate(), variables: []
  });
  const template = serializeStatusBarRuntime({ framework: 'vue', html: 'x'.repeat(50001) });
  assert.throws(
    () => upsertStatusBar(database, userId, conversationId, { name: 'Oversized', template, variables: [] }),
    { status: 400, code: 'STATUS_BAR_TEMPLATE_TOO_LARGE' }
  );
  assert.equal(getStatusBar(database, userId, conversationId).template, original.template);

  const result = importExportEnvelope(database, userId, 'status-bar-templates', {
    items: [{ name: 'Oversized runtime', template, variables: [] }]
  });
  assert.equal(result.imported, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(listStatusBarTemplates(database, userId).length, 0);
  assert.throws(
    () => normalizeStatusBarBlueprint({ template, variables: [] }),
    { status: 400, code: 'STATUS_BAR_TEMPLATE_TOO_LARGE' }
  );
});

test('conversation snapshot restore preserves runtime code and its variable values', (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const template = runtimeTemplate();
  upsertStatusBar(database, userId, conversationId, {
    name: 'Runtime checkpoint', template,
    variables: [{ name: 'HP', type: 'number', value: 23 }]
  });
  const snapshot = captureConversationSnapshot(database, userId, conversationId);
  upsertStatusBar(database, userId, conversationId, { name: 'Changed', template: '', variables: [] });
  restoreConversationSnapshot(database, userId, conversationId, snapshot);
  const restored = getStatusBar(database, userId, conversationId);
  assert.equal(restored.template, template);
  assert.equal(restored.name, 'Runtime checkpoint');
  assert.deepEqual(restored.variables.map((item) => [item.name, item.value]), [['HP', 23]]);
});
