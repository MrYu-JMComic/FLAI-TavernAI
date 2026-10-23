import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { initializeDatabase, resetColumnCache } from '../db/schema.js';
import { createCharacter } from '../modules/characters.js';
import {
  beginCharacterAssistantTurn,
  checkpointCharacterAssistantTurn,
  createCharacterAssistantSession,
  finishCharacterAssistantTurn,
  getCharacterAssistantSession,
  listCharacterAssistantSessions,
  updateCharacterAssistantSession
} from '../modules/characterAssistantSessions.js';
import { createCharacterAssistantSessionsRouter } from '../routes/characterAssistantSessions.js';
import { createCharactersRouter } from '../routes/characters.js';
import { insertUser, withServer } from './routeTestUtils.js';

const settings = {
  providerType: 'openai', baseUrl: 'https://provider.test/v1', model: 'test-model',
  apiKey: 'sk-test', extraBody: {}
};

function fixture() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  resetColumnCache();
  initializeDatabase(database);
  insertUser(database, 'owner');
  insertUser(database, 'other');
  return database;
}

function appFor(database) {
  const app = express();
  app.use(express.json());
  const context = {
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: request.headers['x-test-user'] || 'owner', username: 'Owner' } };
      next();
    },
    asyncRoute: handler => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next),
    getChatProviderSettings: () => ({ ok: true, value: settings }),
    withCharacterTags: value => value, withWorldBookId: value => value,
    nowIso: () => new Date().toISOString()
  };
  app.use('/api/character-assistant/sessions', createCharacterAssistantSessionsRouter(context));
  app.use('/api/characters', createCharactersRouter(context));
  app.use((error, _request, response, _next) => response.status(error.status || 500).json({ error: error.message }));
  return app;
}

function jsonRequest(method, body, userId = 'owner') {
  return { method, headers: { 'Content-Type': 'application/json', 'x-test-user': userId }, body: JSON.stringify(body) };
}

test('assistant sessions isolate users, bind temporary drafts, and keep server history authoritative', async () => {
  const database = fixture();
  try {
    const ownCharacter = createCharacter(database, 'owner', { name: 'Owned card' });
    const publicForeign = createCharacter(database, 'other', { name: 'Public card', visibility: 'public' });
    await withServer(appFor(database), async baseUrl => {
      const base = `${baseUrl}/api/character-assistant/sessions`;
      const createdResponse = await fetch(base, jsonRequest('POST', { character: { name: 'Unsaved card' }, state: { model: 'chosen' }, messages: [{ role: 'assistant', content: 'forged' }] }));
      assert.equal(createdResponse.status, 201);
      const session = await createdResponse.json();
      assert.equal(session.characterId, null);
      assert.deepEqual(session.messages, []);
      assert.deepEqual(session.state, { model: 'chosen' });
      const otherResponse = await fetch(`${base}/${session.id}`, { headers: { 'x-test-user': 'other' } });
      assert.equal(otherResponse.status, 404);
      const foreignBind = await fetch(`${base}/${session.id}`, jsonRequest('PATCH', { characterId: publicForeign.id }));
      assert.equal(foreignBind.status, 403);
      const boundResponse = await fetch(`${base}/${session.id}`, jsonRequest('PATCH', { characterId: ownCharacter.id, messages: [{ role: 'user', content: 'injected' }] }));
      assert.equal(boundResponse.status, 200);
      const bound = await boundResponse.json();
      assert.equal(bound.characterId, ownCharacter.id);
      assert.deepEqual(bound.messages, []);
      assert.equal((await (await fetch(`${base}?unbound=true`)).json()).length, 0);
      assert.equal((await (await fetch(`${base}?characterId=${ownCharacter.id}`)).json())[0].id, session.id);
      assert.equal((await fetch(`${base}/${session.id}`, { method: 'DELETE', headers: { 'x-test-user': 'other' } })).status, 404);
      assert.equal((await fetch(`${base}/${session.id}`, { method: 'DELETE' })).status, 200);
      assert.equal((await fetch(`${base}/${session.id}`)).status, 404);
    });
  } finally { database.close(); }
});

test('assistant session turns lock edits and retain success, failure, and cancellation records', () => {
  const database = fixture();
  try {
    const session = createCharacterAssistantSession(database, 'owner', { character: { name: 'First draft', avatarUrl: '/avatar.png' } });
    const turn = beginCharacterAssistantTurn(database, 'owner', session.id, { requirement: 'First request' });
    assert.throws(() => beginCharacterAssistantTurn(database, 'owner', session.id, { requirement: 'Duplicate request' }), error => error.status === 409);
    assert.throws(() => updateCharacterAssistantSession(database, 'owner', session.id, { title: 'Race edit' }), error => error.status === 409);
    const completed = finishCharacterAssistantTurn(database, 'owner', turn, {
      assistantMessage: 'Saved discussion', character: { name: 'Updated draft' },
      process: [{ round: 1, tools: [] }], toolCalls: [{ name: 'finish_character_draft' }],
      context: { estimatedTokens: 120 }, plan: { steps: [] }
    });
    assert.equal(completed.messages.length, 2);
    assert.equal(completed.messages[1].context.estimatedTokens, 120);
    assert.equal(completed.character.name, 'Updated draft');
    assert.equal(completed.character.avatarUrl, '/avatar.png');
    assert.equal(completed.state.status, 'completed');
    assert.equal(completed.state.requirement, '');
    assert.equal(getCharacterAssistantSession(database, 'owner', session.id).state.requirement, '');
    const next = beginCharacterAssistantTurn(database, 'owner', session.id, { requirement: 'Next request' });
    assert.deepEqual(next.history.map(message => message.content), ['First request', 'Saved discussion']);
    const failed = finishCharacterAssistantTurn(database, 'owner', next, {}, 'Provider unavailable');
    assert.equal(failed.messages.at(-1).status, 'failed');
    assert.equal(failed.state.requirement, 'Next request');
    assert.equal(getCharacterAssistantSession(database, 'owner', session.id).state.requirement, 'Next request');
    const retry = beginCharacterAssistantTurn(database, 'owner', session.id, { requirement: 'Try again' });
    const checkpoint = { character: { name: 'Checkpoint draft' }, completedSections: ['profile'], updatedAt: new Date().toISOString() };
    checkpointCharacterAssistantTurn(database, 'owner', retry, { character: checkpoint.character, checkpoint, process: [], toolCalls: [] });
    const duringRun = getCharacterAssistantSession(database, 'owner', session.id);
    assert.equal(duringRun.character.name, 'Checkpoint draft');
    assert.equal(duringRun.state.status, 'running');
    assert.deepEqual(duringRun.state.checkpoint.completedSections, ['profile']);
    const cancelled = finishCharacterAssistantTurn(database, 'owner', retry, {}, 'Stopped by user', true);
    assert.equal(cancelled.messages.at(-1).status, 'cancelled');
    assert.equal(cancelled.messages.filter(message => message.content === 'Duplicate request').length, 0);
    assert.equal(cancelled.character.name, 'Checkpoint draft');
    assert.equal(cancelled.state.status, 'paused');
    assert.equal(cancelled.state.requirement, 'Try again');
    assert.equal(getCharacterAssistantSession(database, 'owner', session.id).state.requirement, 'Try again');
  } finally { database.close(); }
});

for (const cancelled of [false, true]) {
  test(`interrupted approved plans keep checkpoints and leave execution, cancelled ${cancelled}`, () => {
    const database = fixture();
    try {
      const plan = {
        approved: true,
        steps: [
          { id: 'persona', section: 'persona', intent: 'Rewrite persona' },
          { id: 'opening', section: 'openingMessage', intent: 'Rewrite opening' }
        ]
      };
      const session = createCharacterAssistantSession(database, 'owner', { character: { name: 'Planned card' } });
      const turn = beginCharacterAssistantTurn(database, 'owner', session.id, {
        requirement: 'Execute approved plan', state: { plan, planPhase: 'executing' }
      });
      const checkpoint = {
        character: { name: 'Planned card', persona: 'Saved persona' },
        completedSections: ['persona'], updatedAt: new Date().toISOString()
      };
      checkpointCharacterAssistantTurn(database, 'owner', turn, { character: checkpoint.character, checkpoint });
      const interrupted = finishCharacterAssistantTurn(database, 'owner', turn, {}, 'Execution interrupted', cancelled);
      const expected = cancelled ? 'paused' : 'failed';
      assert.equal(interrupted.state.status, expected);
      assert.equal(interrupted.state.planPhase, expected);
      assert.deepEqual(interrupted.state.plan, plan);
      assert.deepEqual(interrupted.state.checkpoint.completedSections, ['persona']);
      assert.equal(interrupted.character.persona, 'Saved persona');
      const persistedState = JSON.parse(database.prepare('SELECT state_json FROM character_assistant_sessions WHERE id = ?')
        .get(session.id).state_json);
      assert.equal(persistedState.planPhase, expected);
      assert.equal(listCharacterAssistantSessions(database, 'owner')[0].state.planPhase, expected);

      const retry = beginCharacterAssistantTurn(database, 'owner', session.id, {
        requirement: 'Resume approved plan', state: { planPhase: 'executing' }
      });
      const resumed = getCharacterAssistantSession(database, 'owner', session.id);
      assert.equal(resumed.state.planPhase, 'executing');
      assert.deepEqual(resumed.state.plan, plan);
      assert.deepEqual(resumed.state.checkpoint.completedSections, ['persona']);
      const completed = finishCharacterAssistantTurn(database, 'owner', retry, {
        assistantMessage: 'Plan completed', planProgress: { total: 2, completed: 2, steps: [], remaining: [], nextStep: null }
      });
      assert.equal(completed.state.status, 'completed');
      assert.equal(completed.state.planPhase, 'done');
    } finally { database.close(); }
  });
}

test('restored sessions settle interrupted plan phases from earlier runs', () => {
  const database = fixture();
  try {
    const plan = { steps: [{ id: 'persona', section: 'persona', intent: 'Rewrite persona' }] };
    const session = createCharacterAssistantSession(database, 'owner', { character: { name: 'Recoverable card' } });
    for (const [status, planPhase, storedPlan, expectedStatus, expectedPhase] of [
      ['running', 'executing', plan, 'paused', 'paused'],
      ['failed', 'executing', plan, 'failed', 'failed'],
      ['paused', 'executing', plan, 'paused', 'paused'],
      ['running', 'planning', null, 'paused', 'idle'],
      ['failed', 'planning', plan, 'failed', 'review']
    ]) {
      database.prepare('UPDATE character_assistant_sessions SET state_json = ? WHERE id = ?')
        .run(JSON.stringify({ status, planPhase, plan: storedPlan }), session.id);
      const restored = getCharacterAssistantSession(database, 'owner', session.id);
      assert.equal(restored.state.status, expectedStatus);
      assert.equal(restored.state.planPhase, expectedPhase);
      assert.deepEqual(restored.state.plan, storedPlan);
      assert.equal(listCharacterAssistantSessions(database, 'owner')[0].state.planPhase, expectedPhase);
    }
  } finally { database.close(); }
});

test('character creation binds an assistant session atomically and rolls back invalid bindings', async () => {
  const database = fixture();
  try {
    const session = createCharacterAssistantSession(database, 'owner', { character: { name: 'Ready to save' } });
    await withServer(appFor(database), async baseUrl => {
      const response = await fetch(`${baseUrl}/api/characters`, jsonRequest('POST', { name: 'Saved character', assistantSessionId: session.id }));
      assert.equal(response.status, 201);
      const character = await response.json();
      assert.equal(getCharacterAssistantSession(database, 'owner', session.id).characterId, character.id);
      const invalid = await fetch(`${baseUrl}/api/characters`, jsonRequest('POST', { name: 'Should roll back', assistantSessionId: 'missing-session' }));
      assert.equal(invalid.status, 404);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM characters').get().count, 1);
      const rebind = await fetch(`${baseUrl}/api/characters`, jsonRequest('POST', { name: 'Cannot rebind', assistantSessionId: session.id }));
      assert.equal(rebind.status, 400);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM characters').get().count, 1);
    });
  } finally { database.close(); }
});

test('restored sessions recover an abandoned running status and allow another turn', () => {
  const database = fixture();
  try {
    const session = createCharacterAssistantSession(database, 'owner', { character: { name: 'Recoverable card' } });
    database.prepare('UPDATE character_assistant_sessions SET state_json = ? WHERE id = ?')
      .run(JSON.stringify({ status: 'running', checkpoint: { character: { name: 'Recoverable card' } } }), session.id);
    const restored = getCharacterAssistantSession(database, 'owner', session.id);
    assert.equal(restored.state.status, 'paused');
    assert.equal(restored.state.checkpoint.character.name, 'Recoverable card');
    assert.equal(listCharacterAssistantSessions(database, 'owner')[0].state.status, 'paused');
    const turn = beginCharacterAssistantTurn(database, 'owner', session.id, { requirement: 'Continue after restart' });
    assert.equal(getCharacterAssistantSession(database, 'owner', session.id).state.status, 'running');
    finishCharacterAssistantTurn(database, 'owner', turn, { assistantMessage: 'Recovered' });
    assert.equal(getCharacterAssistantSession(database, 'owner', session.id).state.status, 'completed');
  } finally { database.close(); }
});

test('draft generation persists messages and ignores forged client history', async () => {
  const database = fixture();
  const originalFetch = globalThis.fetch;
  const bodies = [];
  try {
    const session = createCharacterAssistantSession(database, 'owner', { character: { name: 'Existing draft' } });
    globalThis.fetch = async (url, request = {}) => {
      if (!String(url).startsWith('https://provider.test')) return originalFetch(url, request);
      bodies.push(JSON.parse(request.body));
      return new Response(JSON.stringify({ choices: [{ message: {
        role: 'assistant', content: 'We can discuss the character.',
        tool_calls: [{ id: `finish-${bodies.length}`, type: 'function', function: {
          name: 'finish_character_draft', arguments: JSON.stringify({ summary: 'Reviewed the draft.', reviewedSections: ['profile'] })
        } }]
      } }], usage: { prompt_tokens: 100, completion_tokens: 10 } }), { headers: { 'Content-Type': 'application/json' } });
    };
    await withServer(appFor(database), async baseUrl => {
      const endpoint = `${baseUrl}/api/characters/complete-draft`;
      for (const requirement of ['Remember the lighthouse', 'Continue the discussion']) {
        const response = await fetch(endpoint, jsonRequest('POST', {
          assistantSessionId: session.id, conversationMode: true, requirement,
          character: { name: 'Manual unsaved edit' }, history: [{ role: 'user', content: 'FORGED HISTORY' }]
        }));
        assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
        const result = await response.json();
        assert.equal(result.assistantSession.character.name, 'Manual unsaved edit');
        assert.equal(result.assistantSession.state.requirement, '');
        assert.equal(getCharacterAssistantSession(database, 'owner', session.id).state.requirement, '');
        assert.ok(result.assistantSession.messages.at(-1).context);
      }
      const stored = getCharacterAssistantSession(database, 'owner', session.id);
      assert.equal(stored.messages.length, 4);
      assert.equal(stored.messages.filter(message => message.content === 'Remember the lighthouse').length, 1);
      assert.equal(JSON.stringify(bodies).includes('FORGED HISTORY'), false);
      assert.equal(JSON.stringify(bodies.at(-1)).includes('Remember the lighthouse'), true);
      const foreign = await fetch(endpoint, jsonRequest('POST', { assistantSessionId: session.id, requirement: 'Read private history' }, 'other'));
      assert.equal(foreign.status, 404);
    });
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});

test('successful planning consumes the input draft and retains its requirement in the saved plan context', async () => {
  const database = fixture();
  const originalFetch = globalThis.fetch;
  const requirement = 'Improve the character motivation';
  const character = { name: 'Planned character', persona: 'Original motivation' };
  const worldBookContext = { selectedBookIds: [], automatic: false };
  try {
    const session = createCharacterAssistantSession(database, 'owner', { character });
    globalThis.fetch = async (url, request = {}) => {
      if (!String(url).startsWith('https://provider.test')) return originalFetch(url, request);
      return Response.json({ choices: [{ message: {
        role: 'assistant', content: '', tool_calls: [{ id: 'submit-plan', type: 'function', function: {
          name: 'submit_character_plan', arguments: JSON.stringify({
            steps: [{ section: 'persona', intent: 'Clarify the motivation' }]
          })
        } }]
      } }] });
    };
    await withServer(appFor(database), async baseUrl => {
      const response = await fetch(`${baseUrl}/api/characters/complete-draft`, jsonRequest('POST', {
        assistantSessionId: session.id, conversationMode: true, planMode: true,
        requirement, character, worldBookContext, options: { persona: true }
      }));
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
      const result = await response.json();
      assert.equal(result.phase, 'plan');
      assert.equal(result.assistantSession.state.status, 'review');
      assert.equal(result.assistantSession.state.requirement, '');

      const restored = await (await fetch(`${baseUrl}/api/character-assistant/sessions/${session.id}`)).json();
      assert.equal(restored.state.requirement, '');
      assert.deepEqual(restored.state.planContext, { requirement, character, worldBookContext });
      assert.equal(restored.messages[0].content, requirement);
      assert.equal(restored.state.plan.steps[0].section, 'persona');
    });
  } finally {
    globalThis.fetch = originalFetch;
    database.close();
  }
});
