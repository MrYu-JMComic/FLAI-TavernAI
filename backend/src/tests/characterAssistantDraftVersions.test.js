import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { initializeDatabase, resetColumnCache } from '../db/schema.js';
import { createCharacter, getCharacter, updateCharacter } from '../modules/characters.js';
import { normalizeAdvancedSettings } from '../modules/advancedSettings.js';
import { setCharacterTags } from '../modules/tags.js';
import { applyWorldBookChanges, createWorldBook, getWorldBook, linkCharacter, listWorldBooks, unlinkCharacter } from '../services/worldBooks/worldBookService.js';
import { prepareWorldBookChangesForSave } from '../services/worldBooks/prepareWorldBookChanges.js';
import { applyWorldBookChangesSchema } from '../validations/schemas.js';
import { listOwnedLinkedBookIdsForCharacter } from '../repositories/worldBookRepository.js';
import {
  beginCharacterAssistantTurn, checkpointCharacterAssistantTurn, createCharacterAssistantSession,
  finishCharacterAssistantTurn, getCharacterAssistantSession, listCharacterAssistantDraftVersions,
  restoreCharacterAssistantDraftVersion, updateCharacterAssistantSession
} from '../modules/characterAssistantSessions.js';
import { createCharacterAssistantSessionsRouter } from '../routes/characterAssistantSessions.js';
import { createWorldBooksRouter } from '../routes/worldBooks.js';
import { worldBookApplyRequest } from '../../../frontend/src/utils/worldBookWorkspace.js';
import { insertUser, withServer } from './routeTestUtils.js';

function fixture(t) {
  const database = new DatabaseSync(':memory:');
  t.after(() => database.close());
  database.exec('PRAGMA foreign_keys = ON');
  resetColumnCache();
  initializeDatabase(database);
  insertUser(database, 'owner');
  insertUser(database, 'other');
  return database;
}

function updateDraft(database, sessionId, character) {
  const turn = beginCharacterAssistantTurn(database, 'owner', sessionId, { requirement: 'Improve the draft' });
  return finishCharacterAssistantTurn(database, 'owner', turn, { changed: true, character, summary: 'Draft updated' });
}

function sessionsApp(database) {
  const app = express();
  app.use(express.json());
  const context = {
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: request.headers['x-test-user'] || 'owner' } };
      next();
    },
    asyncRoute: handler => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next)
  };
  app.use('/sessions', createCharacterAssistantSessionsRouter(context));
  app.use('/world-books', createWorldBooksRouter(context));
  app.use((error, _request, response, _next) => response.status(error.status || 500).json({ error: error.message }));
  return app;
}

test('AI draft versions preserve before and after drafts without saving the bound character', t => {
  const database = fixture(t);
  const character = createCharacter(database, 'owner', { name: 'Saved card', persona: 'Saved persona' });
  const session = createCharacterAssistantSession(database, 'owner', { characterId: character.id });
  const updated = updateDraft(database, session.id, { persona: 'AI persona' });
  assert.equal(updated.character.persona, 'AI persona');
  assert.equal(getCharacter(database, 'owner', character.id).persona, 'Saved persona');
  assert.equal(updated.draftVersionCount, 2);
  const versions = listCharacterAssistantDraftVersions(database, 'owner', session.id);
  assert.deepEqual(versions.map(version => version.title), ['修改后 · Improve the draft', '修改前 · Improve the draft']);
  for (const version of versions) assert.deepEqual(Object.keys(version).sort(), ['createdAt', 'id', 'title']);
  assert.equal(updated.draftVersions, undefined);
  assert.equal(restoreCharacterAssistantDraftVersion(database, 'owner', session.id, versions[1].id).character.persona, 'Saved persona');
  assert.equal(getCharacter(database, 'owner', character.id).persona, 'Saved persona');
  assert.equal(getCharacterAssistantSession(database, 'owner', session.id).character.persona, 'Saved persona');
});

test('discussion, no-op checkpoints, and failures without changes do not create draft versions', t => {
  const database = fixture(t);
  const session = createCharacterAssistantSession(database, 'owner', { character: { name: 'Original' } });
  let turn = beginCharacterAssistantTurn(database, 'owner', session.id, { requirement: 'Discuss only' });
  checkpointCharacterAssistantTurn(database, 'owner', turn, {
    character: { name: 'Original', persona: '' }, checkpoint: { lastTool: 'report_character_progress' }
  });
  finishCharacterAssistantTurn(database, 'owner', turn, { changed: false, character: { name: 'Original' }, summary: 'No edits' });
  turn = beginCharacterAssistantTurn(database, 'owner', session.id, { requirement: 'Unavailable' });
  finishCharacterAssistantTurn(database, 'owner', turn, {}, 'Upstream unavailable');
  turn = beginCharacterAssistantTurn(database, 'owner', session.id, { requirement: 'Keep unchanged' });
  finishCharacterAssistantTurn(database, 'owner', turn, {
    changed: true, character: {
      name: 'Original', persona: '', background: '', worldview: '', openingMessage: '', gender: '', age: '',
      visibility: 'private', tags: [], regexRules: [], renderPlugins: [], modSuggestions: [],
      authorAdvancedSettings: normalizeAdvancedSettings({}), worldBookChanges: [],
      worldBookWorkspace: { version: 1, targets: [{ ref: 'existing:read-book', upserts: [], removals: [] }] }
    }
  });
  assert.deepEqual(listCharacterAssistantDraftVersions(database, 'owner', session.id), []);
  assert.equal(getCharacterAssistantSession(database, 'owner', session.id).draftVersionCount, 0);
});

for (const cancelled of [false, true]) {
  test(`interrupted mutations keep their original and partial draft versions, cancelled ${cancelled}`, t => {
    const database = fixture(t);
    const session = createCharacterAssistantSession(database, 'owner', { character: { name: 'Before' } });
    const turn = beginCharacterAssistantTurn(database, 'owner', session.id, { requirement: 'Rewrite' });
    checkpointCharacterAssistantTurn(database, 'owner', turn, {
      character: { name: 'Partial' }, checkpoint: { lastTool: 'update_character_profile', character: { name: 'Partial' } }
    });
    assert.equal(getCharacterAssistantSession(database, 'owner', session.id).draftVersionCount, 1);
    const interrupted = finishCharacterAssistantTurn(database, 'owner', turn, {}, 'Interrupted', cancelled);
    assert.equal(interrupted.draftVersionCount, 2);
    const versions = listCharacterAssistantDraftVersions(database, 'owner', session.id);
    assert.equal(versions[0].title, '中断时的草稿 · Rewrite');
    const restored = restoreCharacterAssistantDraftVersion(database, 'owner', session.id, versions[1].id);
    assert.equal(restored.character.name, 'Before');
    assert.deepEqual(restored.messages, interrupted.messages);
    assert.equal(restoreCharacterAssistantDraftVersion(database, 'owner', session.id, versions[0].id).character.name, 'Partial');
  });
}

test('restoring keeps a recovery draft, world book edits and links, and resets stale execution state', t => {
  const database = fixture(t);
  const workspace = { version: 1, targets: [{ ref: 'existing:book', bookId: 'book', upserts: [] }] };
  const draftState = {
    worldBookWorkspace: workspace, worldBookChanges: [], selectedWorldBookIds: ['book'],
    worldBookLinkDraft: { version: 1, baselineIds: ['previous-book'] },
    avatarDraft: { version: 1, baselineUrl: '/old-avatar.png' }, worldBookTargetOverride: ['book'], worldBookAutomatic: true
  };
  const session = createCharacterAssistantSession(database, 'owner', {
    character: { name: 'Before', avatarUrl: '/draft-avatar.png' }, state: draftState
  });
  const changedWorkspace = { ...workspace, targets: [{ ...workspace.targets[0], upserts: [{ entryId: 'entry', patch: { content: 'AI edit' } }] }] };
  const changed = updateDraft(database, session.id, {
    name: 'After', worldBookWorkspace: changedWorkspace, worldBookChanges: changedWorkspace.targets
  });
  const versions = listCharacterAssistantDraftVersions(database, 'owner', session.id);
  updateCharacterAssistantSession(database, 'owner', session.id, {
    character: { name: 'Manual recovery draft' },
    state: {
      ...changed.state, modelOverride: 'preferred-model', options: { persona: true },
      checkpoint: { character: { name: 'Stale checkpoint' } }, plan: { steps: [{ section: 'persona' }] },
      continuation: { previousToolNames: ['old_tool'] }, process: [{ round: 1 }], toolCalls: [{ name: 'old_tool' }],
      selectedWorldBookIds: ['different'], worldBookLinkDraft: null, avatarDraft: null, worldBookApplyRequest: { requestId: 'old-request' }
    }
  });
  const restored = restoreCharacterAssistantDraftVersion(database, 'owner', session.id, versions[1].id);
  assert.equal(restored.character.name, 'Before');
  for (const [key, value] of Object.entries(draftState)) assert.deepEqual(restored.state[key], value);
  assert.equal(restored.state.modelOverride, 'preferred-model');
  assert.deepEqual(restored.state.options, { persona: true });
  assert.equal(restored.state.status, 'idle');
  for (const key of ['checkpoint', 'plan', 'continuation', 'worldBookApplyRequest', 'context']) assert.equal(restored.state[key], null);
  assert.deepEqual(restored.state.process, []);
  assert.deepEqual(restored.state.toolCalls, []);
  assert.deepEqual(restored.messages, changed.messages);
  const recovery = listCharacterAssistantDraftVersions(database, 'owner', session.id)[0];
  assert.equal(recovery.title, '恢复前的草稿');
  assert.equal(restoreCharacterAssistantDraftVersion(database, 'owner', session.id, recovery.id).character.name, 'Manual recovery draft');
});

test('AI checkpoints, finished drafts, and restored versions retain pending new book link choices by ref', t => {
  const database = fixture(t);
  const previousChanges = [
    { ref: 'new:unlinked', addToCharacter: false }, { ref: 'new:linked', addToCharacter: true },
    { ref: 'new:default' }, { ref: 'new:old', addToCharacter: false },
    { ref: 'existing:book', bookId: 'book', addToCharacter: false }
  ];
  const session = createCharacterAssistantSession(database, 'owner', {
    character: { name: 'Before', worldBookChanges: previousChanges }, state: { worldBookChanges: previousChanges }
  });
  const changes = [
    { ref: 'new:unlinked', profile: { name: 'Unlinked book' } },
    { ref: 'new:linked', addToCharacter: false, profile: { name: 'Linked book' } },
    { ref: 'new:default', profile: { name: 'Default book' } },
    { ref: 'new:different', profile: { name: 'Different book' } },
    { ref: 'existing:book', bookId: 'book', profile: { name: 'Existing book' } }
  ];
  const character = { name: 'After', worldBookChanges: changes };
  const checkpoint = { character, lastTool: 'create_character_world_book' };
  const assertChoices = draft => {
    assert.equal(draft.worldBookChanges[0].addToCharacter, false);
    assert.equal(draft.worldBookChanges[1].addToCharacter, true);
    for (const index of [2, 3, 4]) assert.equal(Object.hasOwn(draft.worldBookChanges[index], 'addToCharacter'), false);
  };
  const turn = beginCharacterAssistantTurn(database, 'owner', session.id, { requirement: 'Improve pending books' });
  checkpointCharacterAssistantTurn(database, 'owner', turn, { character, checkpoint });
  const partial = getCharacterAssistantSession(database, 'owner', session.id);
  for (const draft of [partial.character, partial.state, partial.state.checkpoint.character]) assertChoices(draft);
  const finished = finishCharacterAssistantTurn(database, 'owner', turn, { changed: true, character, checkpoint });
  for (const draft of [finished.character, finished.state, finished.state.checkpoint.character]) assertChoices(draft);
  const versions = listCharacterAssistantDraftVersions(database, 'owner', session.id);
  const restored = restoreCharacterAssistantDraftVersion(database, 'owner', session.id, versions[0].id);
  assertChoices(restored.character);
  assertChoices(restored.state);
  assert.equal(Object.hasOwn(changes[0], 'addToCharacter'), false);
});

test('bound historical avatar restores record intent against the current saved avatar for reopening', t => {
  const database = fixture(t);
  const oldAvatarUrl = 'https://example.test/old-avatar.png';
  const newAvatarUrl = 'https://example.test/new-avatar.png';
  const character = createCharacter(database, 'owner', { name: 'Saved card', avatarUrl: oldAvatarUrl });
  const session = createCharacterAssistantSession(database, 'owner', {
    characterId: character.id, state: { avatarDraft: null }
  });
  updateDraft(database, session.id, { persona: 'AI change' });
  const before = listCharacterAssistantDraftVersions(database, 'owner', session.id).at(-1);
  updateCharacter(database, 'owner', character.id, { avatarUrl: newAvatarUrl });
  const restored = restoreCharacterAssistantDraftVersion(database, 'owner', session.id, before.id);
  assert.equal(restored.character.avatarUrl, oldAvatarUrl);
  assert.deepEqual(restored.state.avatarDraft, { version: 1, baselineUrl: newAvatarUrl });
  assert.deepEqual(getCharacterAssistantSession(database, 'owner', session.id).state.avatarDraft, restored.state.avatarDraft);
  assert.equal(getCharacter(database, 'owner', character.id).avatarUrl, newAvatarUrl);
  updateCharacter(database, 'owner', character.id, { avatarUrl: oldAvatarUrl });
  assert.equal(restoreCharacterAssistantDraftVersion(database, 'owner', session.id, before.id).state.avatarDraft, null);
});

for (const restoreEmptySelection of [false, true]) {
  test(`bound historical world book selections rebase link intent without updating saved links, empty ${restoreEmptySelection}`, t => {
    const database = fixture(t);
    const character = createCharacter(database, 'owner', { name: 'Saved card' });
    const historicalBook = createWorldBook(database, 'owner', { name: 'Historical book' });
    const currentBook = createWorldBook(database, 'owner', { name: 'Current book' });
    linkCharacter(database, 'owner', historicalBook.id, character.id);
    const selectedWorldBookIds = restoreEmptySelection ? [] : [historicalBook.id];
    const session = createCharacterAssistantSession(database, 'owner', {
      characterId: character.id,
      state: {
        selectedWorldBookIds,
        worldBookLinkDraft: restoreEmptySelection ? { version: 1, baselineIds: [historicalBook.id] } : null
      }
    });
    updateDraft(database, session.id, { persona: 'AI change' });
    const before = listCharacterAssistantDraftVersions(database, 'owner', session.id).at(-1);
    unlinkCharacter(database, 'owner', historicalBook.id, character.id);
    linkCharacter(database, 'owner', currentBook.id, character.id);

    const restored = restoreCharacterAssistantDraftVersion(database, 'owner', session.id, before.id);
    assert.deepEqual(restored.state.selectedWorldBookIds, selectedWorldBookIds);
    assert.deepEqual(restored.state.worldBookLinkDraft, { version: 1, baselineIds: [currentBook.id] });
    assert.deepEqual(getCharacterAssistantSession(database, 'owner', session.id).state.worldBookLinkDraft,
      restored.state.worldBookLinkDraft);
    assert.deepEqual(listOwnedLinkedBookIdsForCharacter(database, 'owner', character.id).map(row => row.id), [currentBook.id]);

    unlinkCharacter(database, 'owner', currentBook.id, character.id);
    if (!restoreEmptySelection) linkCharacter(database, 'owner', historicalBook.id, character.id);
    assert.equal(restoreCharacterAssistantDraftVersion(database, 'owner', session.id, before.id).state.worldBookLinkDraft, null);
  });
}

test('restoring a legacy draft without world book selections does not record unlink intent', t => {
  const database = fixture(t);
  const character = createCharacter(database, 'owner', { name: 'Saved card' });
  const book = createWorldBook(database, 'owner', { name: 'Linked book' });
  linkCharacter(database, 'owner', book.id, character.id);
  const session = createCharacterAssistantSession(database, 'owner', { characterId: character.id });
  updateDraft(database, session.id, { persona: 'AI change' });
  const before = listCharacterAssistantDraftVersions(database, 'owner', session.id).at(-1);
  const restored = restoreCharacterAssistantDraftVersion(database, 'owner', session.id, before.id);
  assert.equal(Object.hasOwn(restored.state, 'selectedWorldBookIds'), false);
  assert.equal(restored.state.worldBookLinkDraft, null);
  assert.deepEqual(listOwnedLinkedBookIdsForCharacter(database, 'owner', character.id).map(row => row.id), [book.id]);
});

test('version routes isolate users and sessions, reject running restores, and ignore client history fields', async t => {
  const database = fixture(t);
  const session = createCharacterAssistantSession(database, 'owner', { character: { name: 'Before' } });
  updateDraft(database, session.id, { name: 'After' });
  const otherSession = createCharacterAssistantSession(database, 'owner', { character: { name: 'Separate' } });
  const versions = listCharacterAssistantDraftVersions(database, 'owner', session.id);
  const app = express();
  app.use(express.json());
  app.use('/sessions', createCharacterAssistantSessionsRouter({
    db: database,
    requireAuth: (request, _response, next) => {
      request.auth = { user: { id: request.headers['x-test-user'] || 'owner' } };
      next();
    }
  }));
  await withServer(app, async baseUrl => {
    const url = `${baseUrl}/sessions/${session.id}`;
    assert.equal((await fetch(`${url}/versions`, { headers: { 'x-test-user': 'other' } })).status, 404);
    assert.equal((await fetch(`${url}/versions/${versions[0].id}/restore`, { method: 'POST', headers: { 'x-test-user': 'other' } })).status, 404);
    assert.equal((await fetch(`${baseUrl}/sessions/${otherSession.id}/versions/${versions[0].id}/restore`, { method: 'POST' })).status, 404);
    const turn = beginCharacterAssistantTurn(database, 'owner', session.id, { requirement: 'Run' });
    assert.equal((await fetch(`${url}/versions/${versions[0].id}/restore`, { method: 'POST' })).status, 409);
    finishCharacterAssistantTurn(database, 'owner', turn, { changed: false });
    const forged = await fetch(url, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draftVersions: [], draftVersionCount: 900, state: { draftVersions: [{ id: 'forged' }] } })
    });
    assert.equal((await forged.json()).draftVersionCount, 2);
    assert.deepEqual(await (await fetch(`${url}/versions`)).json(), versions);
    const restored = await fetch(`${url}/versions/${versions[1].id}/restore`, { method: 'POST' });
    assert.equal(restored.status, 200);
    assert.equal((await restored.json()).character.name, 'Before');
  });
});

function savedCardRows(database) {
  return Object.fromEntries([
    'characters', 'assets', 'avatar_assets', 'world_books', 'world_book_entries',
    'character_world_books', 'tags', 'character_tags', 'regex_rules'
  ].map(table => [table, database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}

test('resetting a draft reads the complete saved card, clears stale AI state and preserves the replaced draft', async t => {
  const database = fixture(t);
  const saved = createCharacter(database, 'owner', { name: 'Initial saved card' });
  const firstBook = createWorldBook(database, 'owner', { name: 'First linked book' });
  const primaryBook = createWorldBook(database, 'owner', { name: 'Primary linked book' });
  linkCharacter(database, 'owner', firstBook.id, saved.id, 2);
  linkCharacter(database, 'owner', primaryBook.id, saved.id, 1);
  const session = createCharacterAssistantSession(database, 'owner', { characterId: saved.id, title: 'Keep this conversation' });
  const oldChanges = [{ ref: 'new:old', profile: { name: 'Do not create this draft book' } }];
  updateDraft(database, session.id, {
    persona: 'Old assistant draft', avatarUrl: '/old-avatar.png',
    authorAdvancedSettings: { statusBarBlueprint: { template: 'Old status template' } },
    worldBookWorkspace: { targets: oldChanges }, worldBookChanges: oldChanges, modSuggestions: [{ name: 'Old mod' }]
  });
  updateCharacterAssistantSession(database, 'owner', session.id, {
    statePatch: {
      version: 4, providerProfileId: 'chosen-provider', modelOverride: 'chosen-model',
      thinkingLevel: 'high', providerStreaming: false, worldBookAutomatic: true,
      options: { profile: true, worldBook: false, advancedSettings: true, staleCharacter: { persona: 'Do not keep' } },
      requirement: 'Old unsent input', selectedWorldBookIds: [],
      status: 'paused', checkpoint: { character: { persona: 'Stale checkpoint' } }, checkpointUpdatedAt: 'old',
      continuation: { character: { persona: 'Stale continuation' } }, plan: { steps: [{ title: 'Old plan' }] },
      planPhase: 'paused', planContext: { character: { persona: 'Stale plan' } }, planProgress: { completed: 1 },
      planExtraRequirement: 'Old plan input', context: { draft: 'Old context' },
      worldBookWorkspace: { targets: oldChanges }, worldBookChanges: oldChanges,
      worldBookApplyRequest: { requestId: 'old-request' }, worldBookTargetOverride: ['old-target'],
      avatarDraft: { baselineUrl: '/old-avatar.png' }, worldBookLinkDraft: { baselineIds: [] },
      process: [{ text: 'Old process' }], toolCalls: [{ name: 'old-tool' }], reasoning: 'Old reasoning',
      warnings: ['Old warning'], lastError: 'Old failure', lastRunStatus: 'failed',
      conversationHistory: [{ role: 'user', content: 'Old runtime copy' }], unknownDraftState: { character: 'Do not keep' }
    }
  });
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
  const authoritative = updateCharacter(database, 'owner', saved.id, {
    name: 'Authoritative card', gender: 'female', age: '30', background: 'Saved background', worldview: 'Saved world',
    persona: 'Saved persona', openingMessage: 'Saved opening', visibility: 'public', tags: ['Saved tag'], avatarUrl: dataUrl,
    regexRules: [{ label: 'Saved rule', pattern: 'saved', replacement: 'actual', flags: 'g', scope: 'output', enabled: true }],
    authorAdvancedSettings: {
      statusBarPrompt: 'Saved status prompt', customCss: '.saved { color: red; }', customCssEnabled: true, customCssRiskAccepted: true,
      customJs: 'console.log("saved")', customJsEnabled: true, customJsRiskAccepted: true,
      desktopBackgroundUrl: dataUrl, mobileBackgroundUrl: dataUrl,
      statusBarBlueprint: { name: 'Saved panel', template: '<section>{{HP}}</section>', variables: [{ name: 'HP', type: 'number', value: 97, min: 0, max: 100, unit: 'points' }] },
      accessorySkills: { statusBarAgent: { enabled: true, modelOverride: 'saved-model' } }
    }
  });
  setCharacterTags(database, 'owner', saved.id, ['Saved tag']);
  const beforeSavedRows = savedCardRows(database);
  const beforeSession = getCharacterAssistantSession(database, 'owner', session.id);
  await withServer(sessionsApp(database), async baseUrl => {
    const endpoint = `${baseUrl}/sessions/${session.id}/reset-draft-from-character`;
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: 'forged-target', character: { persona: 'Never use the request draft' } })
    });
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    assert.deepEqual(result.session.character, result.character);
    assert.deepEqual(result.character, {
      ...authoritative, worldBookId: primaryBook.id,
      characterTags: [{ id: database.prepare('SELECT id FROM tags WHERE user_id = ? AND name = ?').get('owner', 'Saved tag').id, name: 'Saved tag', color: '' }]
    });
    assert.equal(result.session.title, beforeSession.title);
    assert.deepEqual(result.session.messages, beforeSession.messages);
    assert.deepEqual(result.session.state.selectedWorldBookIds, [primaryBook.id, firstBook.id]);
    assert.deepEqual(result.session.state.options, { profile: true, worldBook: false, advancedSettings: true });
    for (const key of ['version', 'providerProfileId', 'modelOverride', 'thinkingLevel', 'providerStreaming', 'worldBookAutomatic']) {
      assert.deepEqual(result.session.state[key], beforeSession.state[key]);
    }
    for (const key of ['checkpoint', 'continuation', 'plan', 'planContext', 'planProgress', 'context', 'worldBookWorkspace', 'worldBookApplyRequest', 'worldBookTargetOverride', 'avatarDraft', 'worldBookLinkDraft']) {
      assert.equal(result.session.state[key], null);
    }
    for (const key of ['process', 'toolCalls', 'warnings', 'worldBookChanges', 'modSuggestions', 'conversationHistory']) {
      assert.deepEqual(result.session.state[key], []);
    }
    assert.equal(result.session.state.status, 'idle');
    assert.equal(result.session.state.planPhase, 'idle');
    for (const key of ['requirement', 'checkpointUpdatedAt', 'planExtraRequirement', 'reasoning', 'lastError', 'lastRunStatus']) {
      assert.equal(result.session.state[key], '');
    }
    assert.equal(Object.hasOwn(result.session.state, 'unknownDraftState'), false);
    assert.deepEqual(getCharacterAssistantSession(database, 'owner', session.id), result.session);
    assert.deepEqual(savedCardRows(database), beforeSavedRows);
    const versions = listCharacterAssistantDraftVersions(database, 'owner', session.id);
    const oldVersion = database.prepare('SELECT character_json, state_json FROM character_assistant_draft_versions WHERE id = ?').get(versions[0].id);
    assert.equal(JSON.parse(oldVersion.character_json).persona, 'Old assistant draft');
    assert.deepEqual(JSON.parse(oldVersion.state_json).worldBookChanges, oldChanges);
    assert.equal((await fetch(endpoint, { method: 'POST' })).status, 200);
    assert.equal(listCharacterAssistantDraftVersions(database, 'owner', session.id).length, versions.length);
    const turn = beginCharacterAssistantTurn(database, 'owner', session.id, { requirement: 'Continue from the saved card' });
    assert.deepEqual(turn.session.character, result.character);
    assert.equal(turn.session.state.checkpoint, null);
    assert.deepEqual(turn.baseline.state.worldBookChanges, []);
    assert.deepEqual(turn.baseline.state.selectedWorldBookIds, [primaryBook.id, firstBook.id]);
    finishCharacterAssistantTurn(database, 'owner', turn, { changed: false, assistantMessage: 'Read the synchronized draft' });
    const restored = restoreCharacterAssistantDraftVersion(database, 'owner', session.id, versions[0].id);
    assert.equal(restored.character.persona, 'Old assistant draft');
    assert.deepEqual(restored.state.worldBookChanges, oldChanges);
    assert.deepEqual(savedCardRows(database), beforeSavedRows);
  });
});

test('reset draft isolates users and bound characters, rejects running sessions and removes the old save direction', async t => {
  const database = fixture(t);
  const own = createCharacter(database, 'owner', { name: 'Owned card' });
  const foreign = createCharacter(database, 'other', { name: 'Public foreign card', visibility: 'public' });
  const session = createCharacterAssistantSession(database, 'owner', { characterId: own.id, character: { name: 'Draft without history' } });
  const unbound = createCharacterAssistantSession(database, 'owner', { character: { name: 'Unbound' } });
  const corrupted = createCharacterAssistantSession(database, 'owner', { characterId: own.id });
  database.prepare('UPDATE character_assistant_sessions SET character_id = ? WHERE id = ?').run(foreign.id, corrupted.id);
  await withServer(sessionsApp(database), async baseUrl => {
    const post = (id, userId = 'owner') => fetch(`${baseUrl}/sessions/${id}/reset-draft-from-character`, { method: 'POST', headers: { 'x-test-user': userId } });
    assert.equal((await post('missing')).status, 404);
    assert.equal((await post(session.id, 'other')).status, 404);
    assert.equal((await post(unbound.id)).status, 400);
    assert.equal((await post(corrupted.id)).status, 403);
    const turn = beginCharacterAssistantTurn(database, 'owner', session.id, { requirement: 'Running' });
    const beforeRunning = database.prepare('SELECT * FROM character_assistant_sessions WHERE id = ?').get(session.id);
    assert.equal((await post(session.id)).status, 409);
    assert.deepEqual(database.prepare('SELECT * FROM character_assistant_sessions WHERE id = ?').get(session.id), beforeRunning);
    assert.equal(listCharacterAssistantDraftVersions(database, 'owner', session.id).length, 0);
    finishCharacterAssistantTurn(database, 'owner', turn, { changed: false });
    const reset = await post(session.id);
    assert.equal(reset.status, 200);
    const result = await reset.json();
    assert.equal(result.session.character.name, own.name);
    assert.deepEqual(result.session.state.selectedWorldBookIds, []);
    assert.equal(result.character.worldBookId, null);
    assert.equal((await fetch(`${baseUrl}/sessions/${session.id}/versions/old-version/sync`, { method: 'POST' })).status, 404);
    assert.equal(getCharacter(database, 'owner', own.id).name, 'Owned card');
    assert.equal(getCharacter(database, 'other', foreign.id).name, 'Public foreign card');
  });
});

test('reset draft rolls back its recovery version and session together when persistence fails', async t => {
  const database = fixture(t);
  const saved = createCharacter(database, 'owner', { name: 'Saved card' });
  const session = createCharacterAssistantSession(database, 'owner', {
    characterId: saved.id, character: { name: 'Keep this draft' }, state: { checkpoint: { character: { name: 'Keep checkpoint' } } }
  });
  const before = database.prepare('SELECT * FROM character_assistant_sessions WHERE id = ?').get(session.id);
  const beforeSavedRows = savedCardRows(database);
  database.exec(`CREATE TEMP TRIGGER reject_reset_session BEFORE UPDATE ON character_assistant_sessions
    BEGIN SELECT RAISE(ABORT, 'simulated session save failure'); END`);
  await withServer(sessionsApp(database), async baseUrl => {
    const response = await fetch(`${baseUrl}/sessions/${session.id}/reset-draft-from-character`, { method: 'POST' });
    assert.equal(response.status, 500);
    assert.deepEqual(database.prepare('SELECT * FROM character_assistant_sessions WHERE id = ?').get(session.id), before);
    assert.deepEqual(listCharacterAssistantDraftVersions(database, 'owner', session.id), []);
    assert.deepEqual(savedCardRows(database), beforeSavedRows);
  });
});

test('session-scoped ordinary world book saves enforce ownership and active generation locks', async t => {
  const database = fixture(t);
  const session = createCharacterAssistantSession(database, 'owner', { character: { name: 'Unbound card' } });
  const otherSession = createCharacterAssistantSession(database, 'other', { character: { name: 'Other card' } });
  await withServer(sessionsApp(database), async baseUrl => {
    const post = (assistantSessionId, userId = 'owner') => fetch(`${baseUrl}/world-books/apply-changes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-user': userId },
      body: JSON.stringify({ assistantSessionId, requestId: 'client-request', changes: [{ ref: 'new:private', profile: { name: 'Private book' } }] })
    });
    assert.equal((await post(session.id, 'other')).status, 404);
    assert.equal((await post('missing-session')).status, 404);
    const turn = beginCharacterAssistantTurn(database, 'owner', session.id, { requirement: 'Busy' });
    assert.equal((await post(session.id)).status, 409);
    finishCharacterAssistantTurn(database, 'owner', turn, { changed: false });
    const first = await post(session.id);
    assert.equal(first.status, 200);
    const second = await post(otherSession.id, 'other');
    assert.equal(second.status, 200);
    assert.notEqual((await first.json()).books[0].book.id, (await second.json()).books[0].book.id);
    assert.equal(listWorldBooks(database, 'owner').length, 1);
    assert.equal(listWorldBooks(database, 'other').length, 1);
  });
});

test('assistant world book saves reuse individual changes across larger and subset batches', async t => {
  const database = fixture(t);
  const existing = createWorldBook(database, 'owner', { name: 'Existing book' });
  const session = createCharacterAssistantSession(database, 'owner', { character: { name: 'Draft' } });
  const firstChanges = [
    { ref: 'new:A', profile: { name: 'Book A' }, entries: [{ name: 'Lore A', content: 'Keep once' }] },
    { ref: `existing:${existing.id}`, bookId: existing.id, baseRevision: existing.revision, profile: { description: 'Applied once' } }
  ];
  await withServer(sessionsApp(database), async baseUrl => {
    const post = changes => fetch(`${baseUrl}/world-books/apply-changes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assistantSessionId: session.id, requestId: 'ordinary-save', changes: worldBookApplyRequest(changes) })
    });
    assert.equal((await post(firstChanges)).status, 200);
    const firstBook = listWorldBooks(database, 'owner').find(book => book.name === 'Book A');
    const largerChanges = [...firstChanges, { ref: 'new:B', profile: { name: 'Book B' }, entries: [] }];
    for (const changes of [largerChanges, [firstChanges[0]], [firstChanges[1]], [...largerChanges].reverse()]) {
      const response = await post(changes);
      assert.equal(response.status, 200, await response.clone().text());
    }
    assert.equal(listWorldBooks(database, 'owner').length, 3);
    assert.equal(listWorldBooks(database, 'owner').find(book => book.name === 'Book A').id, firstBook.id);
    assert.equal(getWorldBook(database, 'owner', existing.id).description, 'Applied once');
    assert.equal(getWorldBook(database, 'owner', firstBook.id).entries.length, 1);
  });
});

test('legacy assistant batch receipts seed individual receipts before later subset saves', async t => {
  const database = fixture(t);
  const session = createCharacterAssistantSession(database, 'owner', { character: { name: 'Draft' } });
  const changes = [{ ref: 'new:A', profile: { name: 'Book A' } }, { ref: 'new:B', profile: { name: 'Book B' } }];
  const prepared = prepareWorldBookChangesForSave(database, 'owner', applyWorldBookChangesSchema.parse({
    requestId: 'legacy', assistantSessionId: session.id, changes
  }));
  const legacyPayload = { ...prepared };
  delete legacyPayload.changeReceiptScope;
  const first = applyWorldBookChanges(database, 'owner', legacyPayload);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM world_book_change_requests').get().count, 1);
  applyWorldBookChanges(database, 'owner', prepared);
  const subset = prepareWorldBookChangesForSave(database, 'owner', applyWorldBookChangesSchema.parse({
    requestId: 'subset', assistantSessionId: session.id, changes: [changes[0]]
  }));
  assert.equal(applyWorldBookChanges(database, 'owner', subset).books[0].book.id, first.books[0].book.id);
  assert.equal(listWorldBooks(database, 'owner').length, 2);
});

test('draft version retention caps count and stored characters per session', t => {
  const database = fixture(t);
  const session = createCharacterAssistantSession(database, 'owner', { character: { name: 'Before' } });
  for (let index = 0; index < 35; index += 1) updateDraft(database, session.id, { name: `Draft ${index}` });
  assert.equal(getCharacterAssistantSession(database, 'owner', session.id).draftVersionCount, 30);
  const newest = listCharacterAssistantDraftVersions(database, 'owner', session.id)[0];
  assert.equal(restoreCharacterAssistantDraftVersion(database, 'owner', session.id, newest.id).character.name, 'Draft 34');
  const largeSession = createCharacterAssistantSession(database, 'owner', { character: { name: 'Large' } });
  const content = 'x'.repeat(3_500_000);
  for (let index = 0; index < 6; index += 1) updateDraft(database, largeSession.id, { name: `Large ${index}`, persona: content });
  const usage = database.prepare(`SELECT COUNT(*) AS count, SUM(length(character_json) + length(state_json)) AS chars
    FROM character_assistant_draft_versions WHERE session_id = ?`).get(largeSession.id);
  assert.ok(usage.count > 0 && usage.count < 7);
  assert.ok(usage.chars <= 16_000_000);
  assert.equal(getCharacterAssistantSession(database, 'owner', session.id).draftVersionCount, 30);
});
