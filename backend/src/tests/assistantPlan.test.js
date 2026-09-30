import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASSISTANT_PLAN_STEP_LIMIT,
  buildPlanExecutionInstructions,
  buildPlanLedger,
  buildPlanPhaseInstructions,
  createSubmitPlanTool,
  normalizeApprovedPlan,
  normalizeAssistantPlan
} from '../services/assistantPlanTools.js';

const sectionValues = ['persona', 'openingMessage', 'worldBook'];

test('submit plan tool exposes only the caller section enum and stays schema safe', () => {
  const tool = createSubmitPlanTool({ name: 'submit_character_plan', sectionValues, stepLimit: 5 });
  const parameters = tool.function.parameters;
  assert.equal(tool.type, 'function');
  assert.equal(tool.function.name, 'submit_character_plan');
  assert.deepEqual(parameters.properties.steps.items.properties.section.enum, sectionValues);
  assert.equal(parameters.properties.steps.maxItems, 5);
  assert.deepEqual(parameters.required, ['steps']);
  assert.equal(parameters.additionalProperties, false);
  assert.equal(parameters.properties.steps.items.additionalProperties, false);
  assert.deepEqual(parameters.properties.steps.items.required, ['section', 'intent']);
  // The enum is a copy so a later caller cannot mutate the shared section list.
  assert.notEqual(parameters.properties.steps.items.properties.section.enum, sectionValues);
});

test('plan normalization drops out-of-scope sections and intentless steps', () => {
  const plan = normalizeAssistantPlan({
    steps: [
      { section: 'persona', intent: '  重写\n说话方式  ', detail: '保留现有口癖\n第二行' },
      { section: 'regexRules', intent: '添加替换规则' },
      { section: 'openingMessage', intent: '   ' },
      { section: 'worldBook', intent: '生成地点条目' }
    ],
    notes: '  先立人设，再写开场  ',
    risks: ['会覆盖现有开场白', '会覆盖现有开场白', '']
  }, { sectionValues });

  assert.deepEqual(plan.steps, [
    { id: 'step-1', section: 'persona', intent: '重写 说话方式', detail: '保留现有口癖\n第二行' },
    { id: 'step-2', section: 'worldBook', intent: '生成地点条目', detail: '' }
  ]);
  assert.equal(plan.notes, '先立人设，再写开场');
  assert.deepEqual(plan.risks, ['会覆盖现有开场白']);
});

test('plan normalization honours the step limit and keeps supplied step ids', () => {
  const steps = [];
  for (let index = 0; index < ASSISTANT_PLAN_STEP_LIMIT + 4; index += 1) {
    steps.push({ id: `given-${index}`, section: 'persona', intent: `第 ${index} 步` });
  }
  const capped = normalizeAssistantPlan({ steps }, { sectionValues });
  assert.equal(capped.steps.length, ASSISTANT_PLAN_STEP_LIMIT);
  assert.equal(capped.steps[0].id, 'given-0');

  const limited = normalizeAssistantPlan({ steps }, { sectionValues, stepLimit: 2 });
  assert.equal(limited.steps.length, 2);
});

test('approved plan keeps selected steps with their ids and rejects empty approvals', () => {
  const approved = normalizeApprovedPlan({
    approved: true,
    extraRequirement: '别改她的姓氏',
    steps: [
      { id: 'step-1', section: 'persona', intent: '重写说话方式', selected: true },
      { id: 'step-2', section: 'openingMessage', intent: '改为茶馆夜场', selected: false },
      { id: 'step-3', section: 'worldBook', intent: '生成阵营条目' }
    ]
  }, { sectionValues });

  assert.equal(approved.approved, true);
  assert.deepEqual(approved.steps.map((step) => step.id), ['step-1', 'step-3']);
  assert.equal(approved.extraRequirement, '别改她的姓氏');

  assert.equal(normalizeApprovedPlan({ approved: false, steps: [{ section: 'persona', intent: '改' }] }, { sectionValues }), null);
  assert.equal(normalizeApprovedPlan({ approved: true, steps: [] }, { sectionValues }), null);
  assert.equal(normalizeApprovedPlan({
    approved: true,
    steps: [{ section: 'persona', intent: '改', selected: false }]
  }, { sectionValues }), null);
  assert.equal(normalizeApprovedPlan({
    approved: true,
    steps: [{ section: 'advancedSettings', intent: '改高阶设置' }]
  }, { sectionValues }), null);
});

test('plan ledger derives completion from written sections rather than model claims', () => {
  const plan = normalizeAssistantPlan({
    steps: [
      { section: 'persona', intent: '重写说话方式' },
      { section: 'worldBook', intent: '生成阵营条目' },
      { section: 'openingMessage', intent: '改为茶馆夜场' }
    ]
  }, { sectionValues });

  assert.equal(buildPlanLedger(null, ['persona']), null);
  assert.equal(buildPlanLedger({ steps: [] }, ['persona']), null);

  const fresh = buildPlanLedger(plan, []);
  assert.equal(fresh.total, 3);
  assert.equal(fresh.completed, 0);
  assert.equal(fresh.nextStep.section, 'persona');
  assert.equal(fresh.remaining.length, 3);

  // A Set is what the character run state carries around.
  const midway = buildPlanLedger(plan, new Set(['persona', 'worldBook']));
  assert.equal(midway.completed, 2);
  assert.deepEqual(midway.steps.map((step) => step.status), ['completed', 'completed', 'pending']);
  assert.equal(midway.nextStep.section, 'openingMessage');

  const done = buildPlanLedger(plan, ['persona', 'worldBook', 'openingMessage']);
  assert.equal(done.completed, 3);
  assert.deepEqual(done.remaining, []);
  assert.equal(done.nextStep, null);
});

test('plan instructions name the submit tool and carry the approved steps', () => {
  const phaseLines = buildPlanPhaseInstructions('submit_world_book_plan').join('\n');
  assert.match(phaseLines, /只读规划阶段/);
  assert.match(phaseLines, /submit_world_book_plan/);

  assert.deepEqual(buildPlanExecutionInstructions(null), []);
  assert.deepEqual(buildPlanExecutionInstructions({ steps: [] }), []);

  const executionLines = buildPlanExecutionInstructions({
    steps: [
      { id: 'step-1', section: 'persona', intent: '重写说话方式', detail: '保留口癖' },
      { id: 'step-3', section: 'worldBook', intent: '生成阵营条目', detail: '' }
    ],
    notes: '先立人设',
    extraRequirement: '别改姓氏'
  }).join('\n');
  assert.match(executionLines, /计划步骤 1（persona）：重写说话方式｜保留口癖/);
  assert.match(executionLines, /计划步骤 2（worldBook）：生成阵营条目\n/);
  assert.match(executionLines, /workflow\.plan/);
  assert.match(executionLines, /计划备注：先立人设/);
  assert.match(executionLines, /planExtraRequirement/);
  // The plan text itself must stay out of the system prompt so it cannot be
  // read as a system command; only its presence is announced.
  assert.doesNotMatch(executionLines, /别改姓氏/);
});
