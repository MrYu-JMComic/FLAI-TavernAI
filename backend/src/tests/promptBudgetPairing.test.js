import assert from 'node:assert/strict';
import test from 'node:test';

process.env.APP_SECRET = 'test-secret-prompt-budget-pairing';

const { applyPromptBudget } = await import('../services/promptPipeline.js');

function rolesOf(result) {
  return result.messages.map((message) => message.role);
}

function countOrphanedAssistants(roles) {
  let orphans = 0;
  for (let index = 0; index < roles.length; index += 1) {
    if (roles[index] !== 'assistant') continue;
    // An assistant turn must be preceded by a user turn, or by another assistant
    // turn that is itself part of a reply chain.
    let cursor = index - 1;
    while (cursor >= 0 && roles[cursor] === 'assistant') cursor -= 1;
    if (cursor < 0 || roles[cursor] !== 'user') orphans += 1;
  }
  return orphans;
}

test('budget trimming does not orphan an assistant reply', () => {
  // The large user turn must be dropped to fit the budget. Its short assistant reply
  // used to survive, leaving the model reading an answer with no question.
  const result = applyPromptBudget([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'X'.repeat(2000) },
    { role: 'assistant', content: 'short reply' },
    { role: 'user', content: 'latest' }
  ], 300);

  const roles = rolesOf(result);
  assert.equal(countOrphanedAssistants(roles), 0, `orphaned assistant in ${roles.join(' -> ')}`);
  assert.ok(result.budget.truncated);
  assert.ok(!result.messages.some((message) => String(message.content).includes('short reply')));
});

test('budget trimming keeps multi-turn history well formed', () => {
  const result = applyPromptBudget([
    { role: 'system', content: 'You are a character.' },
    { role: 'user', content: 'A'.repeat(500) },
    { role: 'assistant', content: 'B'.repeat(500) },
    { role: 'user', content: 'C'.repeat(500) },
    { role: 'assistant', content: 'D'.repeat(500) },
    { role: 'user', content: 'Latest' }
  ], 1200);

  const roles = rolesOf(result);
  assert.equal(countOrphanedAssistants(roles), 0, `orphaned assistant in ${roles.join(' -> ')}`);
  assert.equal(roles[0], 'system', 'system prompt must survive');
  assert.equal(roles.at(-1), 'user', 'latest user turn must survive');
});

test('budget trimming drops consecutive assistant replies with their user turn', () => {
  const result = applyPromptBudget([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'Q'.repeat(1500) },
    { role: 'assistant', content: 'part one' },
    { role: 'assistant', content: 'part two' },
    { role: 'user', content: 'latest' }
  ], 260);

  const roles = rolesOf(result);
  assert.equal(countOrphanedAssistants(roles), 0, `orphaned assistant in ${roles.join(' -> ')}`);
  const kept = result.messages.map((message) => String(message.content));
  assert.ok(!kept.some((content) => content.includes('part one')));
  assert.ok(!kept.some((content) => content.includes('part two')));
});

test('system prompt and latest user turn are never omitted', () => {
  const result = applyPromptBudget([
    { role: 'system', content: 'CHARACTER DEFINITION' },
    { role: 'user', content: 'Z'.repeat(5000) },
    { role: 'assistant', content: 'Y'.repeat(5000) },
    { role: 'user', content: 'the actual question' }
  ], 200);

  const contents = result.messages.map((message) => String(message.content));
  assert.ok(contents.some((content) => content.includes('CHARACTER DEFINITION')));
  assert.ok(contents.some((content) => content.includes('the actual question')));
});
