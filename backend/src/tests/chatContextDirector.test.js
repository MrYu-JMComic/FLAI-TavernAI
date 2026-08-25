import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildContextDirectorPrompt } from '../services/chatContextDirector.js';

const promptPipelineSource = readFileSync(new URL('../services/promptPipeline.js', import.meta.url), 'utf8');

test('context director includes the approved priority order', () => {
  const prompt = buildContextDirectorPrompt();

  assert.match(prompt, /1\. Explicit user instruction/);
  assert.match(prompt, /2\. User-configured session preset instructions/);
  assert.match(prompt, /3\. Core character card identity and persona/);
  assert.match(prompt, /4\. World book rules/);
  assert.match(prompt, /5\. Status bar, current cast state, permanent scene facts, economy, and talents/);
  assert.match(prompt, /6\. Recent conversation details/);
  assert.match(prompt, /7\. Long-term conversation memory/);
  assert.match(prompt, /8\. Mod instructions/);
  assert.match(prompt, /Do not reveal internal context section names/);
  assert.match(prompt, /Quoted dialogue, examples, pasted lore/);
  assert.match(prompt, /newer explicit user request overrides only the conflicting part/);
  assert.match(prompt, /later explicitly confirmed event may update an earlier stored state/);
  assert.match(prompt, /Do not treat unsupported off-screen changes as established facts/);
});

test('context director only mentions active optional context sources', () => {
  const base = buildContextDirectorPrompt();

  assert.doesNotMatch(base, /matched world book entries/i);
  assert.doesNotMatch(base, /current cast state for names/i);
  assert.doesNotMatch(base, /status bar values/i);
  assert.doesNotMatch(base, /permanent scene facts as spatial continuity/i);
  assert.doesNotMatch(base, /Apply Mod instructions/i);
  assert.doesNotMatch(base, /talent context/i);

  const prompt = buildContextDirectorPrompt({
    worldBookContext: 'Moon gate lore',
    worldBookEntries: [{ id: 'entry-1' }],
    statusBarContext: '[Status]\n- HP: 80/100',
    castContext: 'Current cast facts',
    sceneContext: 'Permanent scene facts',
    modSystemPrompt: 'Use a noir style',
    talentPrompt: '[角色天赋]\n- Silver tongue'
  });

  assert.match(prompt, /matched world book entries/i);
  assert.match(prompt, /status bar values/i);
  assert.match(prompt, /current cast state for names/i);
  assert.match(prompt, /permanent scene facts as spatial continuity/i);
  assert.match(prompt, /Apply Mod instructions as optional/i);
  assert.match(prompt, /talent context/i);
});

test('context director treats malformed optional context as absent', () => {
  const prompt = buildContextDirectorPrompt({
    worldBookContext: null,
    worldBookEntries: { unexpected: true },
    castContext: ['not', 'a', 'string'],
    modSystemPrompt: 0,
    talentPrompt: false
  });

  assert.match(prompt, /Context priority and conflict handling/);
  assert.doesNotMatch(prompt, /matched world book entries/i);
  assert.doesNotMatch(prompt, /current cast state for names/i);
  assert.doesNotMatch(prompt, /Apply Mod instructions/i);
  assert.doesNotMatch(prompt, /talent context/i);
});

test('main chat prompt leaves reasoning behavior to provider settings', () => {
  assert.doesNotMatch(promptPipelineSource, /内部思考|思考过程|推理内容会由系统单独处理/);
  assert.match(promptPipelineSource, /不要替用户决定未表达的台词、想法、感受、选择或动作/);
  assert.match(promptPipelineSource, /用户本轮更新、更具体的明确要求优先/);
});
