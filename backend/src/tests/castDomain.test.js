import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import {
  createCastBehavior,
  createCastMember,
  createCastMemory,
  deleteCastBehaviorEntry,
  ensureConversationProtagonist,
  rollbackCastAuditEvent,
  setCastMemberVisibility,
  transferCastItem,
  updateCastBehaviorEntry,
  updateCastMemberProfile,
  upsertCastMemberItem,
} from '../services/cast/castCommandService.js';
import { getCastMember, listCastMemories } from '../repositories/castRepository.js';
import { getCastItem } from '../repositories/castItemRepository.js';
import { listCastAuditEvents } from '../repositories/auditRepository.js';

test('cast command service enforces identity, revisions, and auditable rollback', () => {
  const fixture = createFixture();
  const { database, userId, conversationId } = fixture;
  try {
    const protagonist = ensureConversationProtagonist(database, userId, conversationId);
    assert.equal(protagonist.memberType, 'protagonist');
    assert.equal(protagonist.canonicalName, 'Hero');

    const alice = createCastMember(database, userId, conversationId, {
      canonicalName: ' Alice ',
      aliases: ['Al', 'Ａｌ'],
      relationship: 'ally',
    });
    assert.deepEqual(alice.aliases, ['Al']);

    assert.throws(
      () => createCastMember(database, userId, conversationId, {
        canonicalName: 'Bob',
        aliases: ['Alice'],
      }),
      (error) => error.code === 'CAST_CONFLICT' && error.statusCode === 409
    );

    assert.throws(
      () => updateCastMemberProfile(database, userId, conversationId, alice.id, {
        currentLocationLabel: 'Clock tower',
        revision: alice.revision + 1,
      }),
      (error) => error.code === 'CAST_CONFLICT'
    );
    assert.equal(getCastMember(database, conversationId, alice.id).currentLocationLabel, '');

    const moved = updateCastMemberProfile(database, userId, conversationId, alice.id, {
      currentLocationLabel: 'Clock tower',
      revision: alice.revision,
    });
    assert.equal(moved.currentLocationLabel, 'Clock tower');
    assert.equal(moved.revision, 2);

    const moveAudit = listCastAuditEvents(database, conversationId, { memberId: alice.id }).items
      .find((event) => event.action === 'member.update');
    const rolledBack = rollbackCastAuditEvent(database, userId, conversationId, moveAudit.id);
    assert.equal(rolledBack.resource.currentLocationLabel, '');
    assert.equal(rolledBack.event.rollbackOfEventId, moveAudit.id);

    const renamed = updateCastMemberProfile(database, userId, conversationId, alice.id, {
      canonicalName: 'Alice Vale',
      revision: rolledBack.resource.revision,
    });
    const renamedAgain = updateCastMemberProfile(database, userId, conversationId, alice.id, {
      relationship: 'trusted ally',
      revision: renamed.revision,
    });
    const renameAudit = listCastAuditEvents(database, conversationId, { memberId: alice.id }).items
      .find((event) => event.action === 'member.update'
        && event.before?.canonicalName === 'Alice'
        && event.after?.canonicalName === 'Alice Vale');
    assert.throws(
      () => rollbackCastAuditEvent(database, userId, conversationId, renameAudit.id),
      (error) => error.code === 'CAST_CONFLICT'
    );
    assert.equal(getCastMember(database, conversationId, alice.id).revision, renamedAgain.revision);

    const hidden = setCastMemberVisibility(database, userId, conversationId, alice.id, 'hidden', {
      expectedRevision: renamedAgain.revision,
    });
    assert.equal(hidden.visibility, 'hidden');

    const firstPage = listCastAuditEvents(database, conversationId, {
      memberId: alice.id,
      limit: 2,
    });
    assert.equal(firstPage.items.length, 2);
    assert.equal(firstPage.hasMore, true);
    const secondPage = listCastAuditEvents(database, conversationId, {
      memberId: alice.id,
      limit: 2,
      beforeCreatedAt: firstPage.nextCursor.createdAt,
      beforeId: firstPage.nextCursor.id,
    });
    assert.ok(secondPage.items.length > 0);
    assert.equal(
      secondPage.items.some((event) => firstPage.items.some((first) => first.id === event.id)),
      false
    );
  } finally {
    database.close();
  }
});

test('cast command service applies memory sealing, deduplication, behavior, and clothing ownership rules', () => {
  const fixture = createFixture();
  const { database, userId, conversationId } = fixture;
  try {
    ensureConversationProtagonist(database, userId, conversationId);
    let alice = createCastMember(database, userId, conversationId, { canonicalName: 'Alice' });
    const bob = createCastMember(database, userId, conversationId, { canonicalName: 'Bob' });
    alice = updateCastMemberProfile(database, userId, conversationId, alice.id, {
      memorySealed: true,
      revision: alice.revision,
    });

    assert.throws(
      () => createCastMemory(database, userId, conversationId, alice.id, {
        content: 'Alice found the key.',
      }, { sourceKind: 'auto_sync' }),
      (error) => error.code === 'CAST_FORBIDDEN'
    );
    assert.equal(listCastMemories(database, conversationId, alice.id).length, 0);

    const memory = createCastMemory(database, userId, conversationId, alice.id, {
      content: 'Alice found   the key.',
      importance: 0.6,
    });
    const reinforced = createCastMemory(database, userId, conversationId, alice.id, {
      content: 'Ａｌｉｃｅ found the key.',
      importance: 0.9,
    });
    assert.equal(reinforced.id, memory.id);
    assert.equal(reinforced.importance, 0.9);
    assert.equal(reinforced.reinforcementCount, 1);
    assert.equal(listCastMemories(database, conversationId, alice.id).length, 1);

    const behavior = createCastBehavior(database, userId, conversationId, alice.id, {
      triggerCondition: 'Danger',
      action: 'Warn the group',
      priority: 10,
    });
    const disabled = updateCastBehaviorEntry(
      database,
      userId,
      conversationId,
      alice.id,
      behavior.id,
      { enabled: false, revision: behavior.revision }
    );
    assert.equal(disabled.enabled, false);
    assert.deepEqual(
      deleteCastBehaviorEntry(database, userId, conversationId, alice.id, behavior.id, {
        expectedRevision: disabled.revision,
      }),
      { deletedId: behavior.id }
    );

    const coat = upsertCastMemberItem(database, userId, conversationId, alice.id, {
      name: 'Red coat',
      itemKind: 'clothing',
      clothingSlot: 'torso',
      equipped: true,
      coverage: ['chest', 'arms'],
    });
    assert.equal(coat.ownerMemberId, alice.id);
    assert.equal(coat.equipped, true);

    const transferred = transferCastItem(database, userId, conversationId, coat.id, {
      memberId: bob.id,
      revision: coat.revision,
    });
    assert.equal(transferred.ownerKind, 'cast');
    assert.equal(transferred.ownerMemberId, bob.id);
    assert.equal(getCastItem(database, conversationId, coat.id).ownerMemberId, bob.id);

    const transferAudit = listCastAuditEvents(database, conversationId, { limit: 30 }).items
      .find((event) => event.action === 'item.transfer' && event.subjectId === coat.id);
    const transferRollback = rollbackCastAuditEvent(database, userId, conversationId, transferAudit.id);
    assert.equal(transferRollback.resource.ownerMemberId, alice.id);
    assert.equal(getCastItem(database, conversationId, coat.id).ownerMemberId, alice.id);
  } finally {
    database.close();
  }
});

function createFixture() {
  const database = createAppDatabase(':memory:');
  const timestamp = '2025-01-01T00:00:00.000Z';
  const userId = 'user-cast';
  const characterId = 'character-cast';
  const conversationId = 'conversation-cast';
  database.prepare(
    `INSERT INTO users (id, username, password_hash, display_name, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(userId, 'cast-user', 'hash', 'Player', timestamp);
  database.prepare(
    `INSERT INTO characters (id, user_id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(characterId, userId, 'Hero', timestamp, timestamp);
  database.prepare(
    `INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(conversationId, userId, characterId, 'Cast test', timestamp, timestamp);
  return { database, userId, conversationId };
}
