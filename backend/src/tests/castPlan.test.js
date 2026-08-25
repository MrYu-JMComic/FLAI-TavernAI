import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppDatabase } from '../db/runtime.js';
import {
  applyCastChangePlan,
  parseAndValidateCastPlan,
} from '../services/cast/castPlanService.js';
import {
  createCastMember,
  ensureConversationProtagonist,
} from '../services/cast/castCommandService.js';
import { getCastRoster } from '../services/cast/castQueryService.js';
import {
  getCastChangeBatchByKey,
  listCastMemories,
} from '../repositories/castRepository.js';
import { buildCastChangePlanJsonSchema } from '../domain/cast/changePlan.js';
import { CAST_AUTO_SYNC_OPERATIONS } from '../domain/cast/constants.js';

test('CastChangePlanV1 prompt schema is derived from the strict domain contract', () => {
  const schema = buildCastChangePlanJsonSchema({
    allowedOperations: CAST_AUTO_SYNC_OPERATIONS,
    maxOperations: 40,
    requireEvidence: true,
  });
  const operationSchema = schema.properties.operations;
  const variants = operationSchema.items.oneOf;

  assert.equal(schema.additionalProperties, false);
  assert.equal(operationSchema.maxItems, 40);
  assert.deepEqual(
    variants.map((variant) => variant.properties.op.const),
    CAST_AUTO_SYNC_OPERATIONS
  );
  assert.equal(variants.every((variant) => variant.additionalProperties === false), true);
  assert.equal(variants.every((variant) => variant.required.includes('evidence')), true);
  assert.throws(
    () => buildCastChangePlanJsonSchema({ allowedOperations: ['unknown.operation'] }),
    /Unknown CastChangePlanV1/
  );
});

test('CastChangePlanV1 rejects prose, unknown fields, forbidden operations, and oversized auto sync plans', () => {
  assert.throws(
    () => parseAndValidateCastPlan('Please apply {"version":1,"operations":[]}', {
      sourceKind: 'auto_sync',
      scope: 'conversation',
    }),
    (error) => error.code === 'CAST_PLAN_JSON'
  );
  assert.throws(
    () => parseAndValidateCastPlan(JSON.stringify({
      version: 1,
      conversationId: 'injected',
      operations: [],
    }), { sourceKind: 'manual', scope: 'conversation' }),
    (error) => error.code === 'CAST_PLAN_SCHEMA'
  );
  assert.throws(
    () => parseAndValidateCastPlan(JSON.stringify({
      version: 1,
      operations: [{
        op: 'memory.delete',
        target: { memberId: 'member-1', memoryId: 'memory-1' },
        evidence: { messageId: 'message-1', quote: 'quote' },
      }],
    }), { sourceKind: 'auto_sync', scope: 'conversation' }),
    (error) => error.code === 'CAST_PLAN_FORBIDDEN_OPERATION'
  );

  const operations = Array.from({ length: 41 }, (_, index) => ({
    op: 'member.create',
    target: { name: `NPC ${index}` },
    changes: {},
    evidence: { messageId: 'message-1', quote: 'arrived' },
  }));
  assert.throws(
    () => parseAndValidateCastPlan(JSON.stringify({ version: 1, operations }), {
      sourceKind: 'auto_sync',
      scope: 'conversation',
    }),
    (error) => error.code === 'CAST_PLAN_LIMIT'
  );

  const fenced = parseAndValidateCastPlan('```json\n{"version":1,"operations":[]}\n```', {
    sourceKind: 'manual',
    scope: 'conversation',
  });
  assert.deepEqual(fenced, { version: 1, summary: '', operations: [] });
});

test('auto sync plan verifies evidence, applies atomically, and is idempotent', () => {
  const fixture = createFixture();
  const { database, userId, conversationId } = fixture;
  try {
    ensureConversationProtagonist(database, userId, conversationId);
    database.prepare(
      `INSERT INTO messages (id, user_id, conversation_id, role, content, created_at)
       VALUES (?, ?, ?, 'assistant', ?, ?)`
    ).run(
      'message-cast',
      userId,
      conversationId,
      'Alice arrived at the clock tower and showed the iron key.',
      '2025-01-01T00:01:00.000Z'
    );
    const plan = {
      version: 1,
      summary: 'Alice joined the scene.',
      operations: [
        {
          op: 'member.create',
          target: { name: 'Alice' },
          changes: { currentLocationLabel: 'Clock tower' },
          evidence: { messageId: 'message-cast', quote: 'Alice arrived at the clock tower' },
          confidence: 0.98,
        },
        {
          op: 'memory.create',
          target: { name: 'Alice' },
          changes: { content: 'Alice showed the iron key.', importance: 0.8 },
          evidence: { messageId: 'message-cast', quote: 'showed the iron key' },
          confidence: 0.95,
        },
      ],
    };

    const first = applyCastChangePlan(database, userId, conversationId, plan, {
      sourceKind: 'auto_sync',
      scope: 'conversation',
      idempotencyKey: 'auto:message-cast',
    });
    assert.equal(first.idempotent, false);
    assert.equal(first.batch.status, 'applied');
    assert.equal(first.batch.result.applied, 2);
    const alice = getCastRoster(database, userId, conversationId).npcs[0];
    assert.equal(alice.canonicalName, 'Alice');
    assert.equal(alice.currentLocationLabel, 'Clock tower');
    assert.equal(listCastMemories(database, conversationId, alice.id).length, 1);

    const second = applyCastChangePlan(database, userId, conversationId, plan, {
      sourceKind: 'auto_sync',
      scope: 'conversation',
      idempotencyKey: 'auto:message-cast',
    });
    assert.equal(second.idempotent, true);
    assert.equal(getCastRoster(database, userId, conversationId).npcs.length, 1);
    assert.equal(listCastMemories(database, conversationId, alice.id).length, 1);

    assert.throws(
      () => applyCastChangePlan(database, userId, conversationId, {
        ...plan,
        operations: [{
          ...plan.operations[0],
          target: { name: 'Mallory' },
          evidence: { messageId: 'message-cast', quote: 'text not in the message' },
        }],
      }, {
        sourceKind: 'auto_sync',
        scope: 'conversation',
        idempotencyKey: 'auto:bad-evidence',
      }),
      (error) => error.code === 'CAST_PLAN_EVIDENCE'
    );
    assert.equal(getCastRoster(database, userId, conversationId).npcs.length, 1);
    assert.equal(getCastChangeBatchByKey(database, conversationId, 'auto:bad-evidence').status, 'failed');
  } finally {
    database.close();
  }
});

test('a failing multi-operation plan rolls back every domain write and audit event', () => {
  const fixture = createFixture();
  const { database, userId, conversationId } = fixture;
  try {
    ensureConversationProtagonist(database, userId, conversationId);
    const auditCountBefore = database.prepare(
      'SELECT COUNT(*) AS count FROM conversation_audit_events'
    ).get().count;
    assert.throws(
      () => applyCastChangePlan(database, userId, conversationId, {
        version: 1,
        operations: [
          { op: 'member.create', target: { name: 'Temporary NPC' }, changes: {} },
          {
            op: 'memory.create',
            target: { name: 'Missing NPC' },
            changes: { content: 'This operation must fail.' },
          },
        ],
      }, {
        sourceKind: 'ai_organize',
        scope: 'conversation',
        idempotencyKey: 'organize:rollback',
      }),
      (error) => error.code === 'CAST_NOT_FOUND'
    );
    assert.equal(getCastRoster(database, userId, conversationId).npcs.length, 0);
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM conversation_audit_events').get().count,
      auditCountBefore
    );
    const failedBatch = getCastChangeBatchByKey(database, conversationId, 'organize:rollback');
    assert.equal(failedBatch.status, 'failed');
    assert.equal(failedBatch.result.code, 'CAST_NOT_FOUND');
  } finally {
    database.close();
  }
});

test('an application timeout rolls back the entire plan and records one failed batch', () => {
  const fixture = createFixture();
  const { database, userId, conversationId } = fixture;
  try {
    ensureConversationProtagonist(database, userId, conversationId);
    const auditCountBefore = database.prepare(
      'SELECT COUNT(*) AS count FROM conversation_audit_events'
    ).get().count;
    const times = [0, 0, 100];
    assert.throws(
      () => applyCastChangePlan(database, userId, conversationId, {
        version: 1,
        operations: [
          { op: 'member.create', target: { name: 'Temporary NPC' }, changes: {} },
          { op: 'member.create', target: { name: 'Late NPC' }, changes: {} },
        ],
      }, {
        sourceKind: 'ai_organize',
        scope: 'conversation',
        idempotencyKey: 'organize:application-timeout',
        transactionTimeoutMs: 50,
        clock: () => times.shift() ?? 100,
      }),
      (error) => error.code === 'CAST_PLAN_TIMEOUT' && error.statusCode === 504
    );
    assert.equal(getCastRoster(database, userId, conversationId).npcs.length, 0);
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM conversation_audit_events').get().count,
      auditCountBefore
    );
    const failedBatch = getCastChangeBatchByKey(
      database,
      conversationId,
      'organize:application-timeout'
    );
    assert.equal(failedBatch.status, 'failed');
    assert.equal(failedBatch.result.code, 'CAST_PLAN_TIMEOUT');
  } finally {
    database.close();
  }
});

test('single-member organization cannot mutate another member', () => {
  const fixture = createFixture();
  const { database, userId, conversationId } = fixture;
  try {
    ensureConversationProtagonist(database, userId, conversationId);
    const alice = createCastMember(database, userId, conversationId, { canonicalName: 'Alice' });
    const bob = createCastMember(database, userId, conversationId, { canonicalName: 'Bob' });
    assert.throws(
      () => applyCastChangePlan(database, userId, conversationId, {
        version: 1,
        operations: [{
          op: 'member.update',
          target: { memberId: bob.id },
          changes: { relationship: 'changed outside scope' },
        }],
      }, {
        sourceKind: 'ai_organize',
        scope: 'member',
        scopeMemberId: alice.id,
        idempotencyKey: 'organize:scope-violation',
      }),
      (error) => error.code === 'CAST_FORBIDDEN'
    );
    assert.equal(getCastRoster(database, userId, conversationId).npcs
      .find((member) => member.id === bob.id).relationship, '');
  } finally {
    database.close();
  }
});

function createFixture() {
  const database = createAppDatabase(':memory:');
  const timestamp = '2025-01-01T00:00:00.000Z';
  const userId = 'user-plan';
  const characterId = 'character-plan';
  const conversationId = 'conversation-plan';
  database.prepare(
    `INSERT INTO users (id, username, password_hash, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(userId, 'plan-user', 'hash', timestamp);
  database.prepare(
    `INSERT INTO characters (id, user_id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(characterId, userId, 'Hero', timestamp, timestamp);
  database.prepare(
    `INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(conversationId, userId, characterId, 'Plan test', timestamp, timestamp);
  return { database, userId, conversationId };
}
