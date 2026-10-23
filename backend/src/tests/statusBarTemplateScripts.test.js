import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasStatusBarTemplateScripts,
  hasStatusBarTemplateRuntime,
  mapStatusBarTemplateMarkup,
  parseStatusBarRuntime,
  serializeStatusBarRuntime,
  stripStatusBarTemplateScripts,
  stripStatusBarTemplateCode
} from '../../../shared/statusBarRuntime.js';
import { renderStatusTemplate } from '../../../shared/statusTemplateRenderer.js';
import { createAppDatabase } from '../db/runtime.js';
import { normalizeStatusBarBlueprint, sanitizeAuthorAdvancedSettings } from '../modules/advancedSettings.js';
import { getStatusBar, normalizeStatusBarPayload, updateStatusBarVariables, upsertStatusBar } from '../modules/statusBars.js';
import { normalizeStatusBarBlueprintForPayload } from '../../../frontend/src/composables/character/useCharacterStatusBlueprint.js';
import { executeStatusBarEdit } from '../services/statusBarAgentTools.js';

const inlineScript = `<ScRiPt data-template="{{scriptAttribute}}" title="a > b" data-label='c > d'>
const {foo} = source;
window.templateText = "{{scriptValue}}";
window.rowMarkup = '<span class="sb-label">Script row</span><span class="sb-val">Fake</span>';
</ScRiPt>`;
const dataScript = '<script type="application/json">{"object":"{{jsonValue}}","list":["{jsonKey}"]}</script>';
const template = `<output>{{HP}}</output>${inlineScript}${dataScript}`;

test('custom template detection handles real script tags while preserving the JSON runtime protocol', () => {
  for (const source of [template, '<SCRIPT>run()</SCRIPT>', '<script src="a > b.js"></script>', '<script>unfinished', '<script']) {
    assert.equal(hasStatusBarTemplateScripts(source), true, source);
    assert.equal(parseStatusBarRuntime(source), null, source);
  }
  for (const source of [
    '', '<output>{{HP}}</output>', '<scripture>text</scripture>',
    '<!-- <script>fake()</script> -->', '<!-- <script>unfinished',
    '<div title="<script>fake()</script>"></div>',
    '<style>.label::after { content: "<script>fake()</script>"; }</style>',
    '<textarea><script>fake()</script></textarea>',
    JSON.stringify({ template }), JSON.stringify(template),
    serializeStatusBarRuntime({ framework: 'html', html: template })
  ]) {
    assert.equal(hasStatusBarTemplateScripts(source), false, source);
  }
  assert.equal(hasStatusBarTemplateScripts({ html: template }), false);
});

test('custom template interpolation protects complete executable and data scripts including their attributes', () => {
  const resolved = [];
  const result = mapStatusBarTemplateMarkup(template, markup => renderStatusTemplate(markup, {
    resolveVariable(name) {
      resolved.push(name);
      return name === 'HP' ? { name: 'HP', value: 23, displayValue: '23' } : null;
    }
  }));
  assert.equal(result, `<output>23</output>${inlineScript}${dataScript}`);
  assert.deepEqual(resolved, ['HP']);
  assert.equal(stripStatusBarTemplateScripts(template), '<output>{{HP}}</output>');
});

test('runtime detection recognizes actual event and JavaScript URL attributes without matching text examples', () => {
  for (const source of [
    '<button onclick="run()">Click</button>',
    '<button OnClick="if (a > b) run()">Click</button>',
    '<img onerror=run()>', '<button onclick>Click</button>',
    '<a href="javascript:void 0">Link</a>',
    '<a href="JaVaScRiPt&#58;void 0">Link</a>',
    '<a href="java&#x09;script&colon;void 0">Link</a>',
    '<svg><a xlink:href="javascript:void 0">Link</a></svg>',
    '<form action="javascript:void 0"></form>',
    '<script>run()</script>'
  ]) assert.equal(hasStatusBarTemplateRuntime(source), true, source);
  for (const source of [
    '', '<output>{{HP}}</output>',
    '<!-- <button onclick="run()">Click</button> -->',
    '<div title="onclick=run() and javascript:void 0">Example</div>',
    '<div title="<button onclick=run()>">Example</div>',
    '<style>.label::after { content: "<button onclick=run()>"; }</style>',
    '<textarea><button onclick="run()">Click</button></textarea>',
    '<div data-onclick="run()" data-link="javascript:void 0">Example</div>',
    '<a href="https://example.test/javascript:reference">Link</a>',
    JSON.stringify({ html: '<button onclick="run()">Click</button>' }),
    serializeStatusBarRuntime({ framework: 'html', html: '<button onclick="run()">Click</button>' })
  ]) assert.equal(hasStatusBarTemplateRuntime(source), false, source);
  assert.equal(hasStatusBarTemplateRuntime({ html: '<button onclick="run()">Click</button>' }), false);
});

test('event and JavaScript URL source remains literal while visible and CSS placeholders render', () => {
  const handler = `onclick="const {localState} = this; void '{{literal}}'; if (a > b) this.classList.toggle('open')"`;
  const link = `href="javascript:const {linkState} = api; void '{{linkLiteral}}'"`;
  const source = `<style>.panel { width: {{HP.percent}}; }</style><button ${handler} style="width:{{HP.percent}}">{{HP}}</button><a ${link}>Action</a>`;
  const resolved = [];
  const rendered = mapStatusBarTemplateMarkup(source, markup => renderStatusTemplate(markup, {
    resolveVariable(name) {
      resolved.push(name);
      return name === 'HP' ? { name: 'HP', value: 25, max: 100, isMeter: true, percentage: 25, displayValue: '25' } : null;
    }
  }));
  assert.equal(rendered, `<style>.panel { width: 25%; }</style><button ${handler} style="width:25%">25</button><a ${link}>Action</a>`);
  assert.equal(resolved.every(name => name === 'HP'), true);
  assert.equal(stripStatusBarTemplateCode(source), '<style>.panel { width: {{HP.percent}}; }</style><button  style="width:{{HP.percent}}">{{HP}}</button><a >Action</a>');
  assert.equal(stripStatusBarTemplateScripts(source), source);
  const marked = mapStatusBarTemplateMarkup(source, markup => markup, { markNodes: true });
  assert.ok(marked.includes(handler));
  assert.ok(marked.includes(link));
  assert.match(marked, /data-flai-template-node="sb-/);
});

test('script protection keeps unterminated sources and avoids marker collisions and replacement expansion', () => {
  const unfinished = '<script data-template="{{attribute}}" title="a > b">const {foo} = source; "{{value}}";';
  assert.equal(mapStatusBarTemplateMarkup(`<b>{{HP}}</b>${unfinished}`, markup => markup.replace('{{HP}}', '19')),
    `<b>19</b>${unfinished}`);
  assert.equal(stripStatusBarTemplateScripts(`<b>{{HP}}</b>${unfinished}`), '<b>{{HP}}</b>');
  assert.equal(mapStatusBarTemplateMarkup('<script data-value="{{unclosed}}', markup => markup.replace(/\{[^}]+\}/g, 'changed')),
    '<script data-value="{{unclosed}}');
  const source = 'FLAI_STATUS_SCRIPT_BLOCK_0_END<script>const literal = "$& $1 {{value}}";</script>';
  assert.equal(mapStatusBarTemplateMarkup(source, markup => markup), source);
});

test('commented pseudo scripts remain comments and do not hide following template markup', () => {
  const comment = '<!-- <script title="a > b">fake()</script> -->';
  const source = `${comment}<b>{{HP}}</b>${inlineScript}`;
  assert.equal(mapStatusBarTemplateMarkup(source, markup => markup.replace('{{HP}}', '27')),
    `${comment}<b>27</b>${inlineScript}`);
  assert.equal(stripStatusBarTemplateScripts(source), `${comment}<b>{{HP}}</b>`);
});

test('raw scripted templates save unchanged and infer variables only from surrounding HTML', (t) => {
  const persistedTemplate = `${template}<button onclick="const {eventState} = this; void '{{eventLabel}}';">Toggle</button>`;
  const database = createAppDatabase(':memory:');
  t.after(() => database.close());
  const now = new Date().toISOString();
  database.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run('template-script-user', 'template-script-user', 'hash', now);
  database.prepare(`INSERT INTO characters (
    id, user_id, name, gender, age, background, worldview, persona, opening_message, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('template-script-character', 'template-script-user', 'Script', '', '', '', '', '', '', now, now);
  database.prepare(`INSERT INTO conversations (
    id, user_id, character_id, title, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('template-script-conversation', 'template-script-user', 'template-script-character', 'Script', now, now);
  const saved = upsertStatusBar(database, 'template-script-user', 'template-script-conversation', {
    name: 'Scripted template', template: persistedTemplate, variables: []
  });
  assert.equal(saved.template, persistedTemplate);
  assert.deepEqual(saved.variables.map(variable => variable.name), ['HP']);
  updateStatusBarVariables(database, 'template-script-user', 'template-script-conversation', [{ name: 'HP', value: 15 }]);
  const reloaded = getStatusBar(database, 'template-script-user', 'template-script-conversation');
  assert.equal(reloaded.template, persistedTemplate);
  assert.deepEqual(reloaded.variables.map(variable => variable.name), ['HP']);
  assert.equal(reloaded.variables[0].value, 15);
});

test('frontend and backend character blueprints infer HTML variables while ignoring script source and attributes', () => {
  for (const normalize of [normalizeStatusBarBlueprint, normalizeStatusBarBlueprintForPayload]) {
    const blueprint = normalize({ template, variables: [] });
    assert.equal(blueprint.template, template);
    assert.deepEqual(blueprint.variables.map(variable => variable.name), ['HP']);
    const explicit = normalize({ template: '<output>{{HP}}</output><script>"{{HP.percentage}}"</script>', variables: [{ name: 'HP', value: 'Fine' }] });
    assert.equal(explicit.variables[0].value, 'Fine');
    assert.equal(explicit.variables[0].max, undefined);
  }
});

test('scripted custom templates follow the existing author runtime trust setting', () => {
  const input = { statusBarBlueprint: { name: 'Scripted author template', template, variables: [{ name: 'HP', value: 23 }] } };
  const untrusted = sanitizeAuthorAdvancedSettings(input);
  assert.equal(untrusted.statusBarBlueprint.template, '');
  assert.deepEqual(untrusted.statusBarBlueprint.variables.map(variable => variable.name), ['HP']);
  const trusted = sanitizeAuthorAdvancedSettings(input, { allowDangerous: true });
  assert.equal(trusted.statusBarBlueprint.template, template);
  const displayTemplate = '<output>{{HP}}</output><!-- <script>example()</script> -->';
  assert.equal(sanitizeAuthorAdvancedSettings({ statusBarBlueprint: { template: displayTemplate } }).statusBarBlueprint.template,
    displayTemplate);
});

test('event templates preserve their source and infer display variables without JavaScript bindings', () => {
  const source = `<style>.panel { width: {{HP.percent}}%; color: #ff69b4; }</style>
<button OnClick="const {localState} = this; const label = '{{jsLabel}}'; this.nextElementSibling.classList.toggle('open');">Toggle</button>
<a href="javascript:const {linkState} = api; void '{{linkLabel}}'">Action</a>
<section class="panel"><output>{{HP}}</output><span style="color:{{Mood.color}}">{{Mood}}</span></section>`;
  for (const normalize of [normalizeStatusBarPayload, normalizeStatusBarBlueprint, normalizeStatusBarBlueprintForPayload]) {
    const result = normalize({ template: source, variables: [] });
    assert.equal(result.template, source);
    assert.deepEqual(result.variables.map(variable => variable.name), ['HP', 'Mood']);
    assert.equal(result.variables[0].max, 100);
  }
  const edited = executeStatusBarEdit({ name: 'Events', template: '', variables: [] }, 'update_status_bar_metadata', { template: source });
  assert.equal(edited.ok, true);
  assert.equal(edited.statusBar.template, source);
  assert.deepEqual(edited.statusBar.variables.map(variable => variable.name), ['HP', 'Mood']);
});

test('JavaScript-only references do not block precise variable removal', () => {
  const source = `<button onclick="const {Hidden} = values; void '{{Hidden}}';">Toggle</button><output>{{HP}}</output>`;
  const result = executeStatusBarEdit({ name: 'Events', template: source, variables: [
    { name: 'HP', value: 23, max: 100, color: '' }, { name: 'Hidden', value: 'local', color: '' }
  ] }, 'remove_status_bar_variable', { name: 'Hidden' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.statusBar.variables.map(variable => variable.name), ['HP']);
  assert.equal(result.statusBar.template, source);
});

test('raw event handlers and JavaScript links follow the author runtime trust setting', () => {
  for (const source of [
    '<button onclick="this.classList.toggle(\'open\')">Toggle</button>',
    '<img src="missing" onerror="this.alt=\'Missing\'">',
    '<a href="javascript:void 0">Link</a>'
  ]) {
    const input = { statusBarBlueprint: { template: source, variables: [{ name: 'HP', value: 23 }] } };
    assert.equal(sanitizeAuthorAdvancedSettings(input).statusBarBlueprint.template, '', source);
    assert.equal(sanitizeAuthorAdvancedSettings(input, { allowDangerous: true }).statusBarBlueprint.template, source);
  }
  for (const source of [
    '<!-- <button onclick="run()">Example</button> --><output>{{HP}}</output>',
    '<div title="onclick=example">Example</div>',
    '<style>.example::after { content: "onclick=example"; }</style>',
    '<button data-sb-action="toggle" data-sb-target="panel">Toggle</button>'
  ]) {
    assert.equal(sanitizeAuthorAdvancedSettings({ statusBarBlueprint: { template: source } }).statusBarBlueprint.template, source);
  }
});
