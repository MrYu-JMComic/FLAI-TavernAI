import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isStatusTemplateLoopCollection,
  isStatusTemplateMeterProperty,
  parseStatusTemplateExpression,
  parseStatusTemplateToken
} from '../../../shared/statusTemplateTokens.js';
import {
  collectStatusTemplateReferences,
  renderStatusTemplate,
  validateStatusTemplateSyntax
} from '../../../shared/statusTemplateRenderer.js';

function variable(name, value, extra = {}) {
  const numeric = typeof value === 'number';
  const max = extra.max ?? (numeric ? 100 : '');
  const isMeter = numeric && Number(max) > 0;
  return {
    name,
    value,
    max: isMeter ? max : '',
    isMeter,
    percentage: isMeter ? Math.min(100, Math.max(0, (value / max) * 100)) : 0,
    color: extra.color || '#6c757d',
    displayValue: isMeter ? `${value}/${max}` : String(value ?? '')
  };
}

const VARIABLES = [
  variable('体力', 72, { color: '#27ae60' }),
  variable('金币', 1250, { max: 0 }),
  variable('姓名', '林晚'),
  variable('事件', ''),
  variable('心情', '平静 {{姓名}}'),
  variable('随身物品', '长剑、药水，地图;无')
];

function render(template, options = {}) {
  return renderStatusTemplate(template, {
    resolveVariable: (name) => VARIABLES.find((item) => item.name === String(name).trim()) || null,
    listVariables: () => VARIABLES,
    ...options
  });
}

test('status template expressions parse properties, filters and control tokens', () => {
  assert.deepEqual(parseStatusTemplateToken('体力.max'), { rawName: '体力', rawProperty: 'max' });
  assert.deepEqual(parseStatusTemplateToken('体力 | percent'), { rawName: '体力', rawProperty: 'percent' });
  assert.deepEqual(parseStatusTemplateToken('#if 体力 > 50'), { rawName: '体力', rawProperty: '' });
  assert.deepEqual(parseStatusTemplateToken('#each 随身物品'), { rawName: '随身物品', rawProperty: '' });
  assert.deepEqual(parseStatusTemplateToken('#each meters'), { rawName: '', rawProperty: '' });
  assert.deepEqual(parseStatusTemplateToken('/if'), { rawName: '', rawProperty: '' });
  assert.deepEqual(parseStatusTemplateToken('@name'), { rawName: '', rawProperty: '' });

  const filtered = parseStatusTemplateExpression('姓名 | default:"待定" | truncate:4');
  assert.equal(filtered.kind, 'variable');
  assert.deepEqual(filtered.filters, [
    { name: 'default', args: ['待定'] },
    { name: 'truncate', args: ['4'] }
  ]);

  const condition = parseStatusTemplateExpression('#unless 事件 == "故事尚未开始"');
  assert.equal(condition.kind, 'open');
  assert.equal(condition.control, 'unless');
  assert.deepEqual(condition.condition.right, { type: 'literal', value: '故事尚未开始' });

  assert.equal(parseStatusTemplateExpression('#while x').kind, 'unknown');
  assert.equal(isStatusTemplateMeterProperty('bar'), true);
  assert.equal(isStatusTemplateMeterProperty('color'), false);
  assert.equal(isStatusTemplateLoopCollection('Meters'), true);
  assert.equal(isStatusTemplateLoopCollection('随身物品'), false);
});

test('status template renderer resolves values, properties and filters', () => {
  assert.equal(render('{{体力}}/{{体力.max}} {{体力.percent}} {{体力 | bar:5}}'), '72/100 72% ████░');
  assert.equal(render('{{金币 | pad:6}} {{金币 | round:0}}'), '001250 1250');
  assert.equal(render('{{事件 | default:"故事尚未开始"}} · {{姓名 | prefix:"@" | upper}}'), '故事尚未开始 · @林晚');
  assert.equal(render('{{心情}}'), '平静 林晚');
  assert.equal(render('{{未知变量}}|{{体力.remaining}}'), '|28');
  assert.equal(render('{{体力 | replace:"7":"8"}}'), '82');
  assert.equal(render('{体力}/{体力.max}'), '72/100');
});

test('status template renderer leaves CSS braces inside style blocks untouched', () => {
  const css = '<style>.x{color:#fff}.y{display:grid;gap:4px}@media (max-width:600px){.x{color:red}}</style>';
  assert.equal(render(css), css);
  assert.equal(render('<style>.bar{width:{{体力.percent}}}</style>'), '<style>.bar{width:72%}</style>');
});

test('status template renderer evaluates conditional and loop blocks', () => {
  assert.equal(render('{{#if 体力 > 50}}健康{{else}}虚弱{{/if}}'), '健康');
  assert.equal(render('{{#if 体力 < 50}}健康{{else}}虚弱{{/if}}'), '虚弱');
  assert.equal(render('{{#unless 事件}}暂无事件{{/unless}}'), '暂无事件');
  assert.equal(render('{{#if 姓名 == "林晚"}}是{{/if}}{{#if !事件}}空{{/if}}'), '是空');
  assert.equal(
    render('{{#each meters}}{{@index}}:{{@name}}={{@percent}};{{/each}}'),
    '1:体力=72%;'
  );
  assert.equal(
    render('{{#each texts}}[{{@name}}]{{/each}}'),
    '[金币][姓名][事件][心情][随身物品]'
  );
  // Unbalanced blocks never throw; the open block simply runs to the end.
  assert.equal(render('{{#if 体力}}A{{#each variables}}'), 'A');
});

test('status template renderer iterates list variables and skips placeholder items', () => {
  assert.equal(
    render('{{#each 随身物品}}<span class="sb-chip">{{@index}}.{{@value}}</span>{{/each}}'),
    '<span class="sb-chip">1.长剑</span><span class="sb-chip">2.药水</span><span class="sb-chip">3.地图</span>'
  );
  assert.equal(render('{{#each 不存在}}x{{/each}}'), '');
  assert.equal(render('{{#each 事件}}x{{/each}}'), '');
});

test('status template renderer escapes values only when asked and keeps depth bounded', () => {
  const html = render('<b>{{姓名}}</b>', { escape: (value) => String(value).replace(/</g, '&lt;') });
  assert.equal(html, '<b>林晚</b>');
  const recursive = { name: '循环', value: '{{循环}}', max: '', isMeter: false, percentage: 0, color: '', displayValue: '' };
  const output = renderStatusTemplate('{{循环}}', {
    resolveVariable: () => recursive,
    listVariables: () => [recursive]
  });
  assert.match(output, /^(\{\{循环\}\})?$/);
});

test('status template references skip control tokens and mark meter filters', () => {
  const references = collectStatusTemplateReferences(
    '{{#if 体力 > 金币}}{{体力 | percent}}{{/if}}{{#each meters}}{{@name}}{{/each}}{{#each 随身物品}}{{/each}}{{姓名}}'
  );
  assert.deepEqual(
    references.map((item) => [item.rawName, item.rawProperty]),
    [['体力', ''], ['金币', ''], ['体力', 'percent'], ['随身物品', ''], ['姓名', '']]
  );
});

test('status template syntax validation reports unbalanced or unknown blocks', () => {
  assert.deepEqual(validateStatusTemplateSyntax('{{#if 体力}}ok{{/if}}{{#each variables}}{{@name}}{{/each}}'), []);
  assert.deepEqual(validateStatusTemplateSyntax('{{#each 随身物品}}{{@value}}{{/each}}'), []);
  assert.deepEqual(validateStatusTemplateSyntax('<style>.x{color:#fff}</style>'), []);
  assert.match(validateStatusTemplateSyntax('{{#if 体力}}ok')[0], /块未闭合/);
  assert.match(validateStatusTemplateSyntax('{{/if}}')[0], /多余的/);
  assert.match(validateStatusTemplateSyntax('{{#each}}{{/each}}')[0], /需要指定遍历对象/);
  assert.match(validateStatusTemplateSyntax('{{#while 体力}}')[0], /不支持的控制标记/);
  assert.match(validateStatusTemplateSyntax('{{@name}}')[0], /只能在 \{\{#each\}\} 块内/);
  assert.match(validateStatusTemplateSyntax('{{#if 体力}}{{/each}}')[0], /块闭合顺序不正确/);
});
