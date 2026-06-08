import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseStatusTemplateToken } from '../../../shared/statusTemplateTokens.js';
import { normalizeStatusBarBlueprint } from '../modules/advancedSettings.js';

const advancedSettingsSource = readFileSync(new URL('../modules/advancedSettings.js', import.meta.url), 'utf8');

test('status template token helper keeps the complete suffix after the first dot', () => {
  assert.deepEqual(parseStatusTemplateToken('HP.max'), {
    rawName: 'HP',
    rawProperty: 'max'
  });
  assert.deepEqual(parseStatusTemplateToken('Mood.text.value'), {
    rawName: 'Mood',
    rawProperty: 'text.value'
  });
  assert.deepEqual(parseStatusTemplateToken('Focus'), {
    rawName: 'Focus',
    rawProperty: ''
  });
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
      { name: 'Mood', value: '', max: undefined },
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
