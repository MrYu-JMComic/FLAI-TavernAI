import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import { createCharacter } from '../modules/characters.js';
import {
  createTalentPool,
  deleteTalentPool,
  getTalentPool,
  listTalentPools,
  rollTalent,
  updateTalentPool
} from '../modules/talents.js';
import { insertUser } from './routeTestUtils.js';

test('talent pools are isolated by owner and legacy pools remain read-only', () => {
  const database = createAppDatabase(':memory:');
  try {
    insertUser(database, 'talent-owner-a');
    insertUser(database, 'talent-owner-b');
    const character = createCharacter(database, 'talent-owner-b', { name: 'B character' });
    const pool = createTalentPool(database, 'talent-owner-a', {
      name: 'A pool',
      talents: [{ name: 'A talent' }]
    });

    const page = listTalentPools(database, 'talent-owner-a', { limit: 1 });
    assert.equal(Array.isArray(page.items), true);
    assert.equal(page.items.length, 1);

    assert.equal(listTalentPools(database, 'talent-owner-a').some((item) => item.id === pool.id), true);
    assert.equal(listTalentPools(database, 'talent-owner-b').some((item) => item.id === pool.id), false);
    assert.equal(getTalentPool(database, pool.id, 'talent-owner-b'), null);
    assert.equal(updateTalentPool(database, pool.id, { name: 'hijack' }, 'talent-owner-b'), null);
    assert.equal(deleteTalentPool(database, pool.id, 'talent-owner-b'), false);
    assert.equal(rollTalent(database, character.id, pool.id, 'talent-owner-b').error, '天赋池不存在');

    database.prepare(
      `INSERT INTO talent_pools (id, name, description, talents_json, created_at)
       VALUES ('legacy-pool', 'Legacy', '', '[]', ?)`
    ).run(new Date().toISOString());
    const legacy = getTalentPool(database, 'legacy-pool', 'talent-owner-b');
    assert.equal(legacy.readOnly, true);
    assert.equal(updateTalentPool(database, 'legacy-pool', { name: 'changed' }, 'talent-owner-b'), null);
    assert.equal(deleteTalentPool(database, 'legacy-pool', 'talent-owner-b'), false);
  } finally {
    database.close();
  }
});
