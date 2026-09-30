import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STATUS_EXPRESSION_FUNCTIONS,
  evaluateStatusExpression,
  parseStatusExpression
} from '../../../shared/statusTemplateExpression.js';
import {
  STATUS_TEMPLATE_FILTER_NAMES,
  collectStatusTemplateReferences,
  renderStatusTemplate,
  validateStatusTemplateSyntax
} from '../../../shared/statusTemplateRenderer.js';
import {
  STATUS_VARIABLE_TYPES,
  adjustStatusVariableValue,
  buildStatusDisplayVariable,
  cycleStatusVariableValue,
  resolveStatusVariableKind
} from '../../../shared/statusVariables.js';
import {
  STATUS_TEMPLATE_ACTIONS,
  buildStatusTemplateAiGuide,
  buildStatusTemplateReferenceGroups,
  documentedStatusExpressionFunctions,
  documentedStatusTemplateFilters
} from '../../../shared/statusTemplateSyntax.js';

const VARIABLES = [
  { name: '体力', value: 25, max: 100, color: '#27ae60' },
  { name: '好感', value: -20, min: -100, max: 100, type: 'meter' },
  { name: '金币', value: 12500, type: 'number', unit: 'G' },
  { name: '姓名', value: '林晚' },
  { name: '心情', value: '低落' },
  { name: '随身物品', value: '长剑、药水、地图', type: 'list' },
  { name: '林晚.好感', value: 60, max: 100 }
].map((variable) => buildStatusDisplayVariable(variable, '#888'));

function render(template) {
  return renderStatusTemplate(template, {
    resolveVariable: (name) => VARIABLES.find((item) => item.name === String(name).trim()) || null,
    listVariables: () => VARIABLES,
    context: { user: '旅人', char: '林晚', now: new Date(2026, 8, 26, 9, 5) }
  });
}

test('status variables resolve the four documented types', () => {
  assert.deepEqual([...STATUS_VARIABLE_TYPES], ['meter', 'number', 'text', 'list']);
  assert.equal(resolveStatusVariableKind({ name: 'a', value: 50, max: 100 }), 'meter');
  assert.equal(resolveStatusVariableKind({ name: 'a', value: 50, type: 'number' }), 'number');
  assert.equal(resolveStatusVariableKind({ name: 'a', value: '长剑、药水', type: 'list' }), 'list');
  assert.equal(resolveStatusVariableKind({ name: 'a', value: '待定' }), 'text');
  // A counter must not inherit the meter default of 100.
  const counter = buildStatusDisplayVariable({ name: '金币', value: 12500, type: 'number', unit: 'G' });
  assert.equal(counter.isMeter, false);
  assert.equal(counter.max, '');
  assert.equal(counter.displayValue, '12500 G');
  // A meter with a negative floor maps its range onto 0-100%.
  const affinity = buildStatusDisplayVariable({ name: '好感', value: -20, min: -100, max: 100, type: 'meter' });
  assert.equal(Math.round(affinity.percentage), 40);
  const list = buildStatusDisplayVariable({ name: '物品', value: '长剑、药水、地图', type: 'list' });
  assert.deepEqual(list.items, ['长剑', '药水', '地图']);
});

test('status variable actions clamp meters and cycle text choices', () => {
  const meter = { name: '体力', value: 25, min: 0, max: 100, type: 'meter' };
  assert.equal(adjustStatusVariableValue(meter, -40), 0);
  assert.equal(adjustStatusVariableValue(meter, 200), 100);
  assert.equal(adjustStatusVariableValue({ name: '金币', value: 10, type: 'number' }, -40), -30);
  assert.equal(cycleStatusVariableValue({ value: '探索' }, '探索|战斗|休息'), '战斗');
  assert.equal(cycleStatusVariableValue({ value: '休息' }, '探索|战斗|休息'), '探索');
  // Placeholder-looking options are real choices, not "empty" values.
  assert.equal(cycleStatusVariableValue({ value: '无' }, '无|有'), '有');
});

test('status template expressions evaluate arithmetic, comparison and helpers', () => {
  assert.equal(render('{{= 体力 * 2 + 1}}'), '51');
  assert.equal(render('{{= 体力 < 30 && 心情 == "低落" ? "危险" : "正常"}}'), '危险');
  assert.equal(render('{{= max(体力, 40)}} {{= round(体力 / 3, 1)}} {{= percent(体力, 200)}}%'), '40 8.3 13%');
  assert.equal(render('{{= count(随身物品)}} {{= item(随身物品, -1)}}'), '3 地图');
  assert.equal(render('{{= 称号 || "无名"}}'), '无名');
  assert.equal(render('{{#if 随身物品 contains "地图"}}有图{{/if}}'), '有图');
  // Built-ins come from the render context, never from variables.
  assert.equal(render('{{user}}/{{char}}/{{date}}/{{weekday}}'), '旅人/林晚/2026-09-26/星期六');
});

test('status template expressions cannot reach the host runtime', () => {
  for (const source of [
    'globalThis',
    'process.exit(1)',
    'constructor("return 1")()',
    'fetch("https://x.test")',
    '体力.constructor'
  ]) {
    const parsed = parseStatusExpression(source);
    // Either the parser refuses it, or it resolves to an ordinary (empty)
    // variable lookup; nothing reaches a real global.
    if (parsed.ok) {
      const value = evaluateStatusExpression(parsed.ast, { reference: () => '', builtin: () => '' });
      assert.equal(typeof value === 'object' && value !== null, false, source);
    }
  }
  assert.equal(parseStatusExpression('nope(1)').ok, false);
  assert.match(parseStatusExpression('体力 *').error, /意外结束/);
  assert.equal(parseStatusExpression('a'.repeat(2000)).ok, false);
});

test('status template filters cover numbers, meters, lists and mapping', () => {
  assert.equal(render('{{金币 | number}}'), '12,500');
  assert.equal(render('{{金币 | unit}}'), '12500 G');
  assert.equal(render('{{体力 | sign}} {{= 0 - 体力 | sign}}'), '+25 -25');
  assert.equal(render('{{体力 | stars:5}}'), '★☆☆☆☆');
  assert.equal(render('{{体力 | tier:"低,中,高"}}'), '低');
  assert.equal(render('{{心情 | map:"低落=😞;愉快=😀;*=❓"}}'), '😞');
  assert.equal(render('{{未知 | map:"低落=😞;*=❓"}}'), '❓');
  assert.equal(render('{{随身物品 | join:" / "}} {{随身物品 | first}} {{随身物品 | count}}'), '长剑 / 药水 / 地图 长剑 3');
  assert.equal(render('{{金币 | plus:500 | number}}'), '13,000');
  assert.equal(render('{{体力 | clamp:50:100}}'), '50');
});

test('status template blocks support else-if chains and typed collections', () => {
  assert.equal(render('{{#if 体力 > 50}}A{{else if 体力 > 20}}B{{else}}C{{/if}}'), 'B');
  assert.equal(render('{{#if 体力 > 90}}A{{else if 体力 > 80}}B{{else}}C{{/if}}'), 'C');
  assert.equal(
    render('{{#each 随身物品}}{{@value}}{{#unless @last}}、{{/unless}}{{/each}}'),
    '长剑、药水、地图'
  );
  assert.equal(render('{{#each numbers}}<{{@name}}>{{/each}}'), '<金币>');
  assert.equal(render('{{#each lists}}({{@name}}){{/each}}'), '(随身物品)');
  assert.equal(render('{{#each meters}}[{{@name}}]{{/each}}'), '[体力][好感][林晚.好感]');
});

test('dotted variable names stay whole unless the suffix is a property', () => {
  assert.equal(render('{{林晚.好感}} {{林晚.好感.percent}}'), '60 60%');
  assert.deepEqual(
    collectStatusTemplateReferences('{{= 体力 + 好感.max}} {{user}} {{getvar::金币}} {{林晚.好感.percent}}')
      .map((reference) => `${reference.rawName}|${reference.rawProperty}`),
    ['体力|', '好感|max', '金币|', '林晚.好感|percent']
  );
});

test('status template validation reports unusable syntax before it renders', () => {
  assert.deepEqual(validateStatusTemplateSyntax('{{#if 体力 > 50}}{{= 体力 | number}}{{else if 体力 > 20}}x{{/if}}'), []);
  assert.match(validateStatusTemplateSyntax('{{= 体力 *}}')[0], /无法解析/);
  assert.match(validateStatusTemplateSyntax('{{体力 | nope}}')[0], /未知过滤器/);
  assert.match(validateStatusTemplateSyntax('{{else}}')[0], /必须位于/);
  assert.match(validateStatusTemplateSyntax('{{#if 体力}}x')[0], /块未闭合/);
});

test('the documented syntax matches what the runtime implements', () => {
  // The editors' cheat sheet and the AI tool prompts are generated from the
  // same lists the renderer and the expression engine use.
  assert.deepEqual(
    [...documentedStatusTemplateFilters()].sort(),
    [...STATUS_TEMPLATE_FILTER_NAMES].sort()
  );
  assert.deepEqual(
    [...documentedStatusExpressionFunctions()].sort(),
    [...STATUS_EXPRESSION_FUNCTIONS].sort()
  );

  const guide = buildStatusTemplateAiGuide().join('\n');
  for (const type of STATUS_VARIABLE_TYPES) {
    assert.ok(guide.includes(type), `AI guide is missing variable type ${type}`);
  }
  for (const { action } of STATUS_TEMPLATE_ACTIONS) {
    assert.ok(guide.includes(action), `AI guide is missing action ${action}`);
  }

  const groups = buildStatusTemplateReferenceGroups();
  assert.deepEqual(
    groups.map((group) => group.key),
    ['placeholders', 'types', 'filters', 'blocks', 'expressions', 'actions', 'styles']
  );
  for (const group of groups) {
    assert.ok(group.items.length, `reference group ${group.key} is empty`);
    for (const item of group.items) {
      assert.equal(typeof item.code, 'string');
      assert.ok(item.summary, `reference item ${item.code} has no summary`);
    }
  }
});
