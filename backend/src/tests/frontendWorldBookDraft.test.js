import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {
  normalizeAiWorldBookDraft,
  normalizeWorldBookEntryForCreate
} from '../../../frontend/src/utils/worldBookDraft.js';

test('AI world book create payload uses the save API field types', () => {
  const entry = normalizeWorldBookEntryForCreate({
    id: 'draft-only-id',
    name: '雾港',
    triggerKeys: '雾港,港口城邦',
    content: '雾港由领航公会治理。',
    position: 'at_depth',
    role: 2,
    depth: 3.8,
    group: '港口',
    inclusionGroup: 'legacy-group',
    sticky: 10000,
    cooldown: '',
    orderIndex: 4.9
  });

  assert.equal(entry.role, 2);
  assert.equal(entry.depth, 3);
  assert.equal(entry.group, '港口');
  assert.equal(entry.sticky, 9999);
  assert.equal(entry.cooldown, null);
  assert.equal(entry.orderIndex, 4);
  assert.equal(Object.hasOwn(entry, 'id'), false);
  assert.equal(Object.hasOwn(entry, 'inclusionGroup'), false);
});

test('AI world book preview keeps only drafts that can be created', () => {
  const draft = normalizeAiWorldBookDraft({
    name: '雾港航路',
    scanDepth: 6,
    lorebookContextPercent: 30,
    entries: [
      { name: '雾港', triggerKeys: '雾港', content: '港口设定。' },
      { name: '缺少触发词', content: '不会进入草稿。' },
      { name: '常驻规则', content: '始终生效。', alwaysActive: true }
    ]
  });

  assert.equal(draft.entries.length, 2);
  assert.deepEqual(draft.entries.map((entry) => entry.name), ['雾港', '常驻规则']);
});

test('standalone and character AI creation paths share one frontend entry normalizer', () => {
  const standaloneSource = fs.readFileSync(new URL('../../../frontend/src/views/WorldBookView.vue', import.meta.url), 'utf8');
  const characterSource = fs.readFileSync(new URL('../../../frontend/src/composables/character/useCharacterAiGeneration.js', import.meta.url), 'utf8');

  assert.match(standaloneSource, /normalizeWorldBookEntryForCreate\(entry\)/);
  assert.match(characterSource, /normalizeWorldBookEntryForCreate\(draft\.entries\[index\], index\)/);
  assert.match(characterSource, /await rollbackCreatedWorldBook\(createdBook\)/);
  assert.match(characterSource, /onWorldBookCreated\?\.\(/);
});
