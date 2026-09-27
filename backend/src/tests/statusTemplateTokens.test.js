import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseStatusTemplateToken } from '../../../shared/statusTemplateTokens.js';
import { normalizeStatusBarBlueprint } from '../modules/advancedSettings.js';

const advancedSettingsSource = readFileSync(new URL('../modules/advancedSettings.js', import.meta.url), 'utf8');

test('status template token helper splits a trailing property but keeps dotted names whole', () => {
  assert.deepEqual(parseStatusTemplateToken('HP.max'), {
    rawName: 'HP',
    rawProperty: 'max'
  });
  // Only a known property is split off, so per-character names survive.
  assert.deepEqual(parseStatusTemplateToken('林晚.好感'), {
    rawName: '林晚.好感',
    rawProperty: ''
  });
  assert.deepEqual(parseStatusTemplateToken('林晚.好感.percent'), {
    rawName: '林晚.好感',
    rawProperty: 'percent'
  });
  assert.deepEqual(parseStatusTemplateToken('Mood.text.value'), {
    rawName: 'Mood.text',
    rawProperty: 'value'
  });
  assert.deepEqual(parseStatusTemplateToken('Focus'), {
    rawName: 'Focus',
    rawProperty: ''
  });
  assert.deepEqual(parseStatusTemplateToken('getvar::HP'), {
    rawName: 'HP',
    rawProperty: ''
  });
  // Built-ins are never variables.
  assert.deepEqual(parseStatusTemplateToken('user'), { rawName: '', rawProperty: '' });
});

test('advanced settings status blueprint placeholders use the shared token parser', () => {
  const blueprint = normalizeStatusBarBlueprint({
    template: '{{ HP.max }} {{ Mood.text.value }} {Focus.color}',
    variables: []
  });

  assert.deepEqual(
    blueprint.variables.map((variable) => ({
      name: variable.name,
      value: variable.value,
      max: variable.max
    })),
    [
      { name: 'HP', value: 0, max: 100 },
      { name: 'Mood.text', value: '', max: undefined },
      { name: 'Focus', value: 0, max: 100 }
    ]
  );
  assert.match(advancedSettingsSource, /from '..\/..\/..\/shared\/statusTemplateTokens\.js'/);
  assert.match(
    advancedSettingsSource,
    /function inferStatusVariablesFromTemplate\(template, variables = \[\]\) \{[\s\S]*const inferred = dedupeStatusVariables\(variables\);[\s\S]*const seen = collectStatusVariableKeys\(inferred\);/
  );
  assert.match(
    advancedSettingsSource,
    /function collectStatusVariableKeys\(variables = \[\]\) \{\s*const keys = new Set\(\);\s*for \(const item of Array\.isArray\(variables\) \? variables : \[\]\) \{\s*keys\.add\(normalizeStatusVariableKey\(item\?\.name\)\);\s*\}\s*return keys;\s*\}/
  );
  assert.doesNotMatch(advancedSettingsSource, /token\.split\('\.'\)/);
  assert.doesNotMatch(advancedSettingsSource, /new Set\(inferred\.map/);
});

test('advanced settings status variables normalize with a capped direct loop', () => {
  const variables = [{ name: '', value: 'ignored' }];
  for (let index = 0; index < 65; index += 1) {
    variables.push({ name: `Var ${index}`, value: String(index), color: index === 0 ? '#abc' : 'bad' });
  }

  const blueprint = normalizeStatusBarBlueprint({
    variables,
    template: '{{ LateTemplateVar }}'
  });

  assert.equal(blueprint.variables.length, 60);
  assert.equal(blueprint.variables[0].name, 'Var 0');
  assert.equal(blueprint.variables[0].value, 0);
  assert.equal(blueprint.variables[0].max, 100);
  assert.equal(blueprint.variables[0].color, '#abc');
  assert.equal(blueprint.variables.at(-1).name, 'Var 59');
  assert.equal(blueprint.variables.some((variable) => variable.name === 'LateTemplateVar'), false);

  const normalizeStart = advancedSettingsSource.indexOf('function normalizeStatusVariables(value, template = \'\') {');
  const normalizeEnd = advancedSettingsSource.indexOf('\nfunction normalizeStatusVariableValue', normalizeStart);
  assert.ok(normalizeStart >= 0 && normalizeEnd > normalizeStart);

  const normalizeHelper = advancedSettingsSource.slice(normalizeStart, normalizeEnd);
  assert.match(normalizeHelper, /const normalized = \[\];/);
  assert.match(normalizeHelper, /for \(let index = 0; index < sourceVariables\.length; index \+= 1\) \{/);
  assert.match(normalizeHelper, /normalized\.length >= STATUS_BLUEPRINT_VARIABLE_LIMIT/);
  assert.match(normalizeHelper, /normalized\.push\(\{/);
  assert.doesNotMatch(normalizeHelper, /\.map\(/);
  assert.doesNotMatch(normalizeHelper, /\.filter\(/);
});
