import assert from 'node:assert/strict';
import test from 'node:test';
import { readRepoText } from './frontendSfcTestUtils.js';

const appSource = readRepoText('backend/src/app.js');
const conversationsSource = readRepoText('backend/src/routes/conversations.js');
const charactersSource = readRepoText('backend/src/routes/characters.js');

test('server sets baseline security headers on every response', () => {
  assert.match(appSource, /setHeader\('X-Content-Type-Options', 'nosniff'\)/);
  assert.match(appSource, /setHeader\('X-Frame-Options', 'SAMEORIGIN'\)/);
  assert.match(appSource, /setHeader\('Referrer-Policy', 'same-origin'\)/);
});

test('auth limiter uses the supported limit option instead of legacy max', () => {
  assert.match(appSource, /limit: authRateLimitMax/);
  assert.doesNotMatch(appSource, /max: authRateLimitMax/);
});

test('list routes stay on batched queries instead of per-row lookups', () => {
  assert.match(conversationsSource, /getConversationUsageSummaries\(db, request\.auth\.user\.id\)/);
  assert.doesNotMatch(conversationsSource, /rows\.map\(\(row\) => withConversationUsage/);
  assert.match(charactersSource, /withCharacterListExtras\(characters\)/);
  assert.doesNotMatch(charactersSource, /characters\.map\(\(c\) => withCharacterTags\(withWorldBookId\(c\)\)\)/);
  assert.match(appSource, /function withCharacterListExtras\(characters\)/);
  assert.match(appSource, /getCharacterWorldBookIds\(db, ids\)/);
  assert.match(appSource, /getCharacterTagsMap\(db, ids\)/);
});
