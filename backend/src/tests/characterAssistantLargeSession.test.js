import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { initializeDatabase, resetColumnCache } from '../db/schema.js';
import {
  beginCharacterAssistantTurn,
  createCharacterAssistantSession,
  finishCharacterAssistantTurn,
  getCharacterAssistantSession
} from '../modules/characterAssistantSessions.js';
import { createCharacterAssistantSessionsRouter } from '../routes/characterAssistantSessions.js';
import { scanJsonBoundary, validateAuthenticatedRequestBoundary } from '../validations/schemas.js';
import {
  buildWorldBookChanges,
  createWorldBookWorkspace,
  executeWorldBookWorkspaceTool,
  serializeWorldBookWorkspace
} from '../services/worldBooks/worldBookAssistantWorkspace.js';
import { insertUser, withServer } from './routeTestUtils.js';

function fixture() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  resetColumnCache();
  initializeDatabase(database);
  insertUser(database, 'owner');
  insertUser(database, 'other');
  const app = express();
  app.use(express.json({ limit: '12mb' }));
  app.use('/api/character-assistant/sessions', createCharacterAssistantSessionsRouter({
    db: database,
    requireAuth(request, response, next) {
      request.auth = { user: { id: request.headers['x-test-user'] || 'owner' } };
      validateAuthenticatedRequestBoundary(request, response, next);
    }
  }));
  app.use((error, _request, response, _next) => response.status(error.status || 500).json({ error: error.message }));
  return { database, app };
}

function patch(body, userId = 'owner') {
  return {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-test-user': userId },
    body: JSON.stringify(body)
  };
}

test('large generated sessions reopen, accept small edits, and retain their complete runtime for the next turn', async () => {
  const { database, app } = fixture();
  try {
    const session = createCharacterAssistantSession(database, 'owner', {
      character: { name: 'Draft', persona: 'Keep this persona', avatarUrl: '/original.png' }
    });
    const turn = beginCharacterAssistantTurn(database, 'owner', session.id, { requirement: 'Build the card' });
    const toolCalls = Array.from({ length: 1100 }, (_, index) => ({
      name: 'set_character_profile', args: { name: `Draft ${index}`, tags: ['tag'] },
      result: { ok: true, sections: ['profile'], applied: { name: `Draft ${index}` } }
    }));
    const process = [{ round: 1, content: 'x'.repeat(4_000_001), tools: toolCalls }];
    const checkpoint = { character: session.character, completedSections: ['profile'] };
    finishCharacterAssistantTurn(database, 'owner', turn, {
      assistantMessage: 'Draft prepared', changed: false, toolCalls, process, checkpoint
    });
    const generated = getCharacterAssistantSession(database, 'owner', session.id);

    await withServer(app, async baseUrl => {
      const url = `${baseUrl}/api/character-assistant/sessions/${session.id}`;
      const opened = await fetch(url);
      assert.equal(opened.status, 200);
      assert.deepEqual((await opened.json()).state.process, process);

      // Reposting the old server snapshot reproduces the original boundary error.
      const echoed = await fetch(url, patch({ state: generated.state }));
      assert.equal(echoed.status, 400);
      assert.match((await echoed.json()).error, /JSON.*字段过多/);

      const response = await fetch(url, patch({
        characterPatch: { avatarUrl: '/new.png' },
        statePatch: { requirement: 'Continue the draft', avatarDraft: null, selectedWorldBookIds: [] }
      }));
      assert.equal(response.status, 200);
      const updated = await response.json();
      assert.equal(updated.state.requirement, 'Continue the draft');
      assert.equal(updated.state.avatarDraft, null);
      assert.deepEqual(updated.state.selectedWorldBookIds, []);
      assert.deepEqual(updated.state.process, process);
      assert.deepEqual(updated.state.toolCalls, toolCalls);
      assert.deepEqual(updated.state.checkpoint, checkpoint);
      assert.deepEqual(updated.messages, generated.messages);
      assert.deepEqual(updated.character, { ...session.character, avatarUrl: '/new.png' });

      const next = beginCharacterAssistantTurn(database, 'owner', session.id, { requirement: updated.state.requirement });
      assert.equal(next.history.at(-1).content, 'Draft prepared');
      assert.deepEqual(next.session.state.checkpoint, checkpoint);
      finishCharacterAssistantTurn(database, 'owner', next, { assistantMessage: 'Continued', changed: false });
      assert.equal(getCharacterAssistantSession(database, 'owner', session.id).messages.at(-1).content, 'Continued');
    });
  } finally { database.close(); }
});

test('session patches retain ownership, running locks, replacement semantics, and input size checks', async () => {
  const { database, app } = fixture();
  try {
    const session = createCharacterAssistantSession(database, 'owner', {
      character: { name: 'Draft' }, state: { requirement: 'Original', plan: { steps: [] } }
    });
    await withServer(app, async baseUrl => {
      const url = `${baseUrl}/api/character-assistant/sessions/${session.id}`;
      assert.equal((await fetch(url, patch({ statePatch: { requirement: 'Foreign' } }, 'other'))).status, 404);
      const turn = beginCharacterAssistantTurn(database, 'owner', session.id, { requirement: 'Running' });
      assert.equal((await fetch(url, patch({ statePatch: { requirement: 'Concurrent edit' } }))).status, 409);
      finishCharacterAssistantTurn(database, 'owner', turn, { changed: false });

      for (const payload of [
        { statePatch: { requirement: 'x'.repeat(4_000_001) } },
        { characterPatch: { persona: 'x'.repeat(4_000_001) } },
        { statePatch: [] },
        { characterPatch: null },
        { statePatch: Object.fromEntries(Array.from({ length: 10_001 }, (_, index) => [`key${index}`, true])) }
      ]) {
        const before = getCharacterAssistantSession(database, 'owner', session.id);
        const response = await fetch(url, patch(payload));
        assert.equal(response.status, 400);
        assert.deepEqual(getCharacterAssistantSession(database, 'owner', session.id), before);
      }

      const replaced = await fetch(url, patch({ character: { name: 'Replacement' }, state: { requirement: '' } }));
      assert.equal(replaced.status, 200);
      const updated = await replaced.json();
      assert.deepEqual(updated.character, { name: 'Replacement' });
      assert.deepEqual(updated.state, { requirement: '' });
    });
  } finally { database.close(); }
});

test('world-book patches synchronize saved checkpoint and plan copies without resending the entries', async () => {
  const { database, app } = fixture();
  try {
    const workspace = createWorldBookWorkspace();
    for (let bookIndex = 0; bookIndex < 4; bookIndex += 1) {
      assert.equal(executeWorldBookWorkspaceTool(workspace, 'create_world_book', {
        localId: `book-${bookIndex}`, name: `Book ${bookIndex}`,
        entries: Array.from({ length: 30 }, (_, index) => ({ name: `Entry ${index}`, content: 'Lore', triggerKeys: 'Lore' }))
      }).ok, true);
    }
    const books = { worldBookWorkspace: serializeWorldBookWorkspace(workspace), worldBookChanges: buildWorldBookChanges(workspace) };
    const checkpoint = { character: { name: 'Draft', persona: 'Keep checkpoint persona' }, completedSections: ['persona'] };
    const planContext = { requirement: 'Keep this plan', worldBookContext: { selectedBookIds: [], workspace: null } };
    const session = createCharacterAssistantSession(database, 'owner', { character: { name: 'Draft' }, state: { checkpoint, planContext } });
    const legacyPatch = { ...books, checkpoint: { ...checkpoint, character: { ...checkpoint.character, ...books } } };
    assert.match(scanJsonBoundary({ statePatch: legacyPatch }), /JSON.*字段过多/);
    assert.equal(scanJsonBoundary({ statePatch: books }), '');

    await withServer(app, async baseUrl => {
      const url = `${baseUrl}/api/character-assistant/sessions/${session.id}`;
      const response = await fetch(url, patch({ statePatch: books }));
      assert.equal(response.status, 200);
      const { state } = await response.json();
      assert.deepEqual(state.checkpoint, { ...checkpoint, character: { ...checkpoint.character, ...books } });
      assert.deepEqual(state.planContext, { ...planContext, worldBookContext: { ...planContext.worldBookContext, workspace: books.worldBookWorkspace } });
      assert.deepEqual(state.worldBookChanges, books.worldBookChanges);

      const clearedBooks = await fetch(url, patch({ statePatch: { worldBookWorkspace: null, worldBookChanges: [] } }));
      const cleared = (await clearedBooks.json()).state;
      assert.equal(cleared.checkpoint.character.worldBookWorkspace, null);
      assert.deepEqual(cleared.checkpoint.character.worldBookChanges, []);
      assert.equal(cleared.planContext.worldBookContext.workspace, null);

      const explicitClear = await fetch(url, patch({ statePatch: { ...books, checkpoint: null, planContext: null } }));
      assert.equal(explicitClear.status, 200);
      const explicit = (await explicitClear.json()).state;
      assert.equal(explicit.checkpoint, null);
      assert.equal(explicit.planContext, null);
      const stillCleared = await fetch(url, patch({ statePatch: { worldBookWorkspace: null, worldBookChanges: [] } }));
      const after = (await stillCleared.json()).state;
      assert.equal(after.checkpoint, null);
      assert.equal(after.planContext, null);
    });
  } finally { database.close(); }
});
