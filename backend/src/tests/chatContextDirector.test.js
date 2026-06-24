import assert from 'node:assert/strict';
import test from 'node:test';

import { buildContextDirectorPrompt } from '../services/chatContextDirector.js';

test('context director includes the approved priority order', () => {
  const prompt = buildContextDirectorPrompt();

  assert.match(prompt, /1\. Explicit user instruction/);
  assert.match(prompt, /2\. Core character card identity and persona/);
  assert.match(prompt, /3\. World book rules/);
  assert.match(prompt, /4\. Status bar and NPC memory\/state/);
  assert.match(prompt, /5\. Recent conversation details/);
  assert.match(prompt, /Do not reveal internal context section names/);
  assert.match(prompt, /Advance the scene only when it fits/);
});

test('context director only mentions active optional context sources', () => {
  const base = buildContextDirectorPrompt();

  assert.doesNotMatch(base, /matched world book entries/i);
  assert.doesNotMatch(base, /NPC or status context/i);
  assert.doesNotMatch(base, /Mod instructions/i);
  assert.doesNotMatch(base, /talent context/i);

  const prompt = buildContextDirectorPrompt({
    worldBookContext: 'Moon gate lore',
    worldBookEntries: [{ id: 'entry-1' }],
    npcBehaviorPrompt: 'NPC memory facts',
    modSystemPrompt: 'Use a noir style',
    talentPrompt: '[角色天赋]\n- Silver tongue'
  });

  assert.match(prompt, /matched world book entries/i);
  assert.match(prompt, /NPC or status context/i);
  assert.match(prompt, /Mod instructions/i);
  assert.match(prompt, /talent context/i);
});

test('context director treats malformed optional context as absent', () => {
  const prompt = buildContextDirectorPrompt({
    worldBookContext: null,
    worldBookEntries: { unexpected: true },
    npcBehaviorPrompt: ['not', 'a', 'string'],
    modSystemPrompt: 0,
    talentPrompt: false
  });

  assert.match(prompt, /Context priority and conflict handling/);
  assert.doesNotMatch(prompt, /matched world book entries/i);
  assert.doesNotMatch(prompt, /NPC or status context/i);
  assert.doesNotMatch(prompt, /Mod instructions/i);
  assert.doesNotMatch(prompt, /talent context/i);
});
