// Cross-validates the two consumers of domain/worldBooks/entryRules.js.
//
// Before the rules were shared, the chat runtime (worldBookMatcher) and the
// read-only preview (worldBookMatchPreview, which also backs the AI
// `preview_world_book_entries` tool) each implemented key splitting, string-mode
// regex parsing and selective logic separately, and nothing asserted they
// agreed. These tests pin that agreement.
//
// Probability and inclusion groups are deliberately excluded from the equality
// assertions: the runtime rolls `Math.random` for both, while a preview must be
// reproducible. They are covered separately below.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import { createCharacter } from '../modules/characters.js';
import { createEntry, createWorldBook, getWorldBook } from '../services/worldBooks/worldBookService.js';
import { matchWorldBookEntries } from '../services/worldBooks/worldBookRuntime.js';
import { matchesWorldBookEntry } from '../services/worldBooks/worldBookMatcher.js';
import { buildWorldBookMatchPreview } from '../services/worldBooks/worldBookMatchPreview.js';
import { insertUser } from './routeTestUtils.js';

// Entries that exercise every trigger rule, with no probability, inclusion
// group or stateful rule, so the runtime is deterministic.
const TRIGGER_CASES = [
  { name: 'literal', triggerKeys: 'lantern', content: 'Lantern lore.' },
  { name: 'literal multi key', triggerKeys: 'alpha,  beta ', content: 'Alpha or beta.' },
  { name: 'regex mode', triggerKeys: 'drag[o]n', regexMode: true, content: 'Dragon lore.' },
  { name: 'regex mode invalid', triggerKeys: '[unclosed', regexMode: true, content: 'Never matches.' },
  { name: 'string mode regex', triggerKeys: '/w(i|o)rld/i', content: 'World lore.' },
  { name: 'string mode invalid regex', triggerKeys: '/[/bad/', content: 'Falls back to literal.' },
  { name: 'selective any', triggerKeys: 'questone', selective: true, selectiveLogic: 0, keysSecondary: 'sword', content: 'Any.' },
  { name: 'selective not any', triggerKeys: 'questtwo', selective: true, selectiveLogic: 1, keysSecondary: 'sword', content: 'Not any.' },
  { name: 'selective not all', triggerKeys: 'questthree', selective: true, selectiveLogic: 2, keysSecondary: 'sword,shield', content: 'Not all.' },
  { name: 'selective without secondary keys', triggerKeys: 'questfour', selective: true, selectiveLogic: 0, content: 'No secondary.' },
  { name: 'no trigger keys', triggerKeys: '', content: 'Unreachable by keys.' }
];

const SCAN_TEXTS = [
  'a lit Lantern hangs here',
  'beta comes after alpha',
  'a Dragon flies overhead',
  'the World ends quietly',
  'text with /[/bad/ inside',
  'questone with a sword drawn',
  'questone alone',
  'questtwo with a sword drawn',
  'questtwo alone',
  'questthree with sword and shield',
  'questthree with only a sword',
  'questfour stands alone',
  'nothing relevant at all',
  '[unclosed'
];

function fixture(t, entries = TRIGGER_CASES) {
  const database = createAppDatabase(':memory:');
  t.after(() => database.close());
  const userId = 'world-book-rules-user';
  insertUser(database, userId);
  const character = createCharacter(database, userId, { name: 'Rules Character' });
  database
    .prepare('INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('rules-conversation', userId, character.id, 'Rules', '2026-01-01', '2026-01-01');
  const book = createWorldBook(database, userId, { name: 'Rules book', characterId: character.id });
  for (const entry of entries) createEntry(database, userId, book.id, entry);
  return { database, userId, character, book };
}

function entryRows(database, bookId) {
  return database
    .prepare('SELECT * FROM world_book_entries WHERE world_book_id = ? ORDER BY order_index ASC')
    .all(bookId);
}

function previewMatchedIds(book, text) {
  const preview = buildWorldBookMatchPreview(book, { text });
  return new Set(preview.explanations.filter((item) => item.matched).map((item) => item.id));
}

test('runtime matcher and preview agree on every trigger rule', (t) => {
  const { database, userId, book } = fixture(t);
  const rows = entryRows(database, book.id);
  const previewBook = getWorldBook(database, userId, book.id);

  for (const text of SCAN_TEXTS) {
    const lowerText = text.toLowerCase();
    // matchesWorldBookEntry does not inspect `enabled` or `always_active`; the
    // pipeline filters those. Every fixture entry is enabled and key-driven.
    const runtimeMatched = new Set(
      rows.filter((row) => matchesWorldBookEntry(row, lowerText, text)).map((row) => row.id)
    );
    const previewMatched = previewMatchedIds(previewBook, text);

    assert.deepEqual(
      [...runtimeMatched].sort(),
      [...previewMatched].sort(),
      `runtime and preview disagreed for scan text: ${text}`
    );
  }
});

test('runtime pipeline and preview agree on the same scan text', (t) => {
  const { database, userId, character, book } = fixture(t);
  const previewBook = getWorldBook(database, userId, book.id);

  for (const text of SCAN_TEXTS) {
    const pipelineMatched = new Set(
      matchWorldBookEntries(database, character.id, [text], {
        conversationId: 'rules-conversation',
        persistState: false
      }).map((entry) => entry.id)
    );
    assert.deepEqual(
      [...pipelineMatched].sort(),
      [...previewMatchedIds(previewBook, text)].sort(),
      `pipeline and preview disagreed for scan text: ${text}`
    );
  }
});

test('disabled entries are inactive on both paths', (t) => {
  const { database, userId, character, book } = fixture(t, [
    { name: 'disabled', triggerKeys: 'lantern', content: 'Hidden.', enabled: false }
  ]);
  const previewBook = getWorldBook(database, userId, book.id);
  const explanation = buildWorldBookMatchPreview(previewBook, { text: 'a lantern' }).explanations[0];

  assert.equal(explanation.matched, false);
  assert.equal(explanation.status, 'disabled');
  assert.equal(
    matchWorldBookEntries(database, character.id, ['a lantern'], {
      conversationId: 'rules-conversation',
      persistState: false
    }).length,
    0
  );
});

test('always-active entries activate on both paths without trigger keys', (t) => {
  const { database, userId, character, book } = fixture(t, [
    { name: 'always', triggerKeys: '', content: 'Always here.', alwaysActive: true }
  ]);
  const previewBook = getWorldBook(database, userId, book.id);
  const explanation = buildWorldBookMatchPreview(previewBook, { text: 'anything' }).explanations[0];

  assert.equal(explanation.matched, true);
  assert.equal(explanation.status, 'always_active');
  assert.equal(
    matchWorldBookEntries(database, character.id, ['anything'], {
      conversationId: 'rules-conversation',
      persistState: false
    }).length,
    1
  );
});

test('preview reports probability without rolling it while the runtime rolls', (t) => {
  const { database, userId, character, book } = fixture(t, [
    { name: 'coin flip', triggerKeys: 'lantern', content: 'Maybe.', useProbability: true, probability: 50 }
  ]);
  const previewBook = getWorldBook(database, userId, book.id);
  const explanation = buildWorldBookMatchPreview(previewBook, { text: 'a lantern' }).explanations[0];

  assert.equal(explanation.matched, true);
  assert.equal(explanation.status, 'probability_preview');
  assert.equal(explanation.probabilityMode, 'runtime_random');

  const originalRandom = Math.random;
  try {
    Math.random = () => 0.1;
    assert.equal(matchRuntime(database, character.id).length, 1);
    Math.random = () => 0.9;
    assert.equal(matchRuntime(database, character.id).length, 0);
  } finally {
    Math.random = originalRandom;
  }
});

test('preview picks the highest-weight inclusion group winner deterministically', (t) => {
  const { database, userId, book } = fixture(t, [
    { name: 'light', triggerKeys: 'lantern', content: 'Light.', group: 'lighting', groupWeight: 1 },
    { name: 'heavy', triggerKeys: 'lantern', content: 'Heavy.', group: 'lighting', groupWeight: 9 }
  ]);
  const previewBook = getWorldBook(database, userId, book.id);
  const preview = buildWorldBookMatchPreview(previewBook, { text: 'a lantern' });

  assert.equal(preview.groups.length, 1);
  assert.equal(preview.groups[0].conflict, true);
  assert.equal(preview.groups[0].previewWinnerName, 'heavy');
  assert.equal(preview.effectiveMatchCount, 1);
  assert.equal(preview.effectiveMatches[0].name, 'heavy');
  // Both entries still trigger; the group only decides which one survives.
  assert.equal(preview.matchCount, 2);
});

test('runtime keeps exactly one inclusion group winner', (t) => {
  const { database, character } = fixture(t, [
    { name: 'light', triggerKeys: 'lantern', content: 'Light.', group: 'lighting', groupWeight: 1 },
    { name: 'heavy', triggerKeys: 'lantern', content: 'Heavy.', group: 'lighting', groupWeight: 9 }
  ]);

  const originalRandom = Math.random;
  try {
    Math.random = () => 0.99;
    assert.equal(matchRuntime(database, character.id).length, 1);
    Math.random = () => 0.01;
    assert.equal(matchRuntime(database, character.id).length, 1);
  } finally {
    Math.random = originalRandom;
  }
});

function matchRuntime(database, characterId) {
  return matchWorldBookEntries(database, characterId, ['a lantern'], {
    conversationId: 'rules-conversation',
    persistState: false
  });
}
