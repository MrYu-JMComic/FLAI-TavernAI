import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-cast-cross-module';

const { createAppDatabase } = await import('../db.js');
const {
  createCastMember,
  createCastMemory,
  ensureConversationProtagonist,
  recordCastConversationTurn,
  replaceCastTurnQueue,
  setCastEmotionState,
  setCastPersonalityAnchor,
  transferCastItem,
} = await import('../services/cast/castCommandService.js');
const {
  getCastCognition,
  getCastConversationTurns,
  getCastItems,
  getCastMemberDetail,
  getCastTurnQueue,
  getProtagonist,
} = await import('../services/cast/castQueryService.js');
const { decayCastMemories } = await import('../services/cast/castMemoryLifecycle.js');
const { generateMultiRoleTurns } = await import('../services/cast/multiRoleService.js');
const { buildPromptPipeline } = await import('../services/promptPipeline.js');
const {
  advanceWorldTime,
  scheduleCastActivity,
} = await import('../modules/dynamicWorld.js');
const {
  createEncounter,
  performEncounterAction,
} = await import('../modules/encounters.js');
const { getGameplayDashboard } = await import('../modules/gameplayDashboard.js');
const { claimRewardGrant, proposeRewardGrant } = await import('../modules/rewards.js');
const {
  buildSceneContext,
  listSceneWorkspace,
  upsertSceneItem,
  upsertSceneNode,
  upsertSceneRoute,
} = await import('../modules/scenes.js');
const { newId, nowIso } = await import('../security.js');

function setup() {
  const database = createAppDatabase(':memory:');
  const userId = `cast-cross-${newId()}`;
  const characterId = newId();
  const conversationId = newId();
  const timestamp = nowIso();
  database.prepare(
    'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)'
  ).run(userId, userId, 'hash', timestamp);
  database.prepare(
    'INSERT INTO characters (id, user_id, name, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(characterId, userId, '旅者', 'private', timestamp, timestamp);
  database.prepare(
    'INSERT INTO conversations (id, user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(conversationId, userId, characterId, '人物跨模块测试', timestamp, timestamp);
  const protagonist = ensureConversationProtagonist(database, userId, conversationId);
  return { database, userId, characterId, conversationId, protagonist };
}

test('scene, dynamic world, dashboard, and encounters share stable cast member ids', () => {
  const env = setup();
  try {
    const tavern = upsertSceneNode(env.database, env.userId, env.conversationId, {
      nodeType: 'building',
      name: '酒馆',
    });
    const square = upsertSceneNode(env.database, env.userId, env.conversationId, {
      nodeType: 'area',
      name: '广场',
    });
    const tower = upsertSceneNode(env.database, env.userId, env.conversationId, {
      nodeType: 'building',
      name: '钟楼',
    });
    upsertSceneRoute(env.database, env.userId, env.conversationId, {
      fromNodeId: tavern.id,
      toNodeId: square.id,
      bidirectional: true,
    });
    upsertSceneRoute(env.database, env.userId, env.conversationId, {
      fromNodeId: square.id,
      toNodeId: tower.id,
      bidirectional: true,
    });
    const npc = createCastMember(env.database, env.userId, env.conversationId, {
      canonicalName: '莉娅',
      currentLocationLabel: '酒馆',
      currentSceneNodeId: tavern.id,
      relationship: '信任',
    });
    const worldItem = upsertSceneItem(env.database, env.userId, env.conversationId, {
      nodeId: tavern.id,
      itemCode: 'itm-scene-key',
      name: '黄铜钥匙',
      quantity: 2,
    });
    assert.equal(listSceneWorkspace(env.database, env.userId, env.conversationId).items[0].id, worldItem.id);
    assert.match(buildSceneContext(env.database, env.userId, env.conversationId), /itm-scene-key/);

    const scheduled = scheduleCastActivity(env.database, env.userId, env.conversationId, {
      memberId: npc.id,
      title: '敲钟',
      locationNodeId: tower.id,
      durationMinutes: 30,
    });
    assert.equal(scheduled.ok, true);
    const scheduledDashboard = getGameplayDashboard(env.database, env.userId, env.conversationId, {
      encounterEnabled: true,
    });
    assert.equal(scheduledDashboard.counts.npcs, 1);
    assert.equal(scheduledDashboard.presentNpcs[0].memberId, npc.id);
    assert.equal(scheduledDashboard.npcActivities[0].memberId, npc.id);

    const advanced = advanceWorldTime(env.database, env.userId, env.conversationId, { minutes: 60 });
    assert.deepEqual(advanced.summary.completed, [scheduled.activity.id]);
    const moved = getCastMemberDetail(env.database, env.userId, env.conversationId, npc.id).member;
    assert.equal(moved.currentSceneNodeId, tower.id);
    assert.equal(moved.currentLocationLabel, '钟楼');

    const encounter = createEncounter(env.database, env.userId, env.conversationId, {
      memberIds: [npc.id],
    }, { initiativeRolls: [20, 10] });
    assert.equal(encounter.ok, true);
    assert.deepEqual(
      new Set(encounter.encounter.participants.map((participant) => participant.memberId)),
      new Set([env.protagonist.id, npc.id])
    );

    const carried = transferCastItem(
      env.database,
      env.userId,
      env.conversationId,
      worldItem.id,
      { memberId: npc.id, revision: worldItem.revision }
    );
    assert.equal(carried.ownerMemberId, npc.id);
    assert.equal(listSceneWorkspace(env.database, env.userId, env.conversationId).items.length, 0);
  } finally {
    env.database.close();
  }
});

test('encounter item rewards are claimed through the protagonist cast inventory', () => {
  const env = setup();
  try {
    const npc = createCastMember(env.database, env.userId, env.conversationId, {
      canonicalName: '强盗',
    });
    const created = createEncounter(env.database, env.userId, env.conversationId, {
      memberIds: [npc.id],
    }, { initiativeRolls: [20, 10] });
    const player = created.encounter.participants.find((participant) => participant.actorType === 'player');
    const opponent = created.encounter.participants.find((participant) => participant.actorType === 'npc');
    const acted = performEncounterAction(env.database, env.userId, env.conversationId, created.encounter.id, {
      actorId: player.id,
      targetId: opponent.id,
      actionType: 'attack',
    }, { roll: 20, damageRoll: 6, bonusDamageRoll: 6 });
    assert.equal(acted.encounter.outcome, 'victory');

    const proposal = proposeRewardGrant(env.database, env.userId, env.conversationId, {
      sourceType: 'encounter',
      sourceId: created.encounter.id,
      rewards: {
        items: [{ itemCode: 'itm-bandit-map', name: '藏宝图', quantity: 1 }],
      },
    });
    assert.equal(proposal.ok, true);
    const claimed = claimRewardGrant(
      env.database,
      env.userId,
      env.conversationId,
      proposal.grant.id
    );
    assert.equal(claimed.ok, true);
    assert.equal(claimed.results.items[0].ownerMemberId, env.protagonist.id);
    assert.equal(
      getCastItems(env.database, env.userId, env.conversationId, env.protagonist.id)[0].itemCode,
      'itm-bandit-map'
    );
  } finally {
    env.database.close();
  }
});

test('HMDT state, memory decay, turn queue, and multi-role generation use cast services', async () => {
  const env = setup();
  try {
    const first = createCastMember(env.database, env.userId, env.conversationId, {
      canonicalName: '米拉',
    });
    const second = createCastMember(env.database, env.userId, env.conversationId, {
      canonicalName: '诺亚',
    });
    setCastPersonalityAnchor(env.database, env.userId, env.conversationId, first.id, {
      name: '米拉',
      identity: '守卫',
      traitVector: { cautious: 80 },
    });
    setCastEmotionState(env.database, env.userId, env.conversationId, first.id, { joy: 40 }, {
      recordHistory: true,
      impact: { joy: 5 },
      trigger: '重逢',
    });
    assert.equal(getCastCognition(env.database, env.userId, env.conversationId, first.id).emotion.emotion.joy, 40);

    const memory = createCastMemory(env.database, env.userId, env.conversationId, first.id, {
      content: '旧城门曾在暴雨中倒塌。',
      importance: 0.5,
      decayRate: 0.1,
    });
    env.database.prepare(
      'UPDATE cast_memories SET updated_at = ?, created_at = ? WHERE id = ?'
    ).run('2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', memory.id);
    const decay = decayCastMemories(env.database, env.userId, env.conversationId, {
      now: new Date('2026-08-11T00:00:00.000Z'),
    });
    assert.equal(decay.updated, 1);

    const queue = replaceCastTurnQueue(
      env.database,
      env.userId,
      env.conversationId,
      [first.id, second.id]
    );
    assert.deepEqual(queue.map((entry) => entry.memberId), [first.id, second.id]);
    recordCastConversationTurn(env.database, env.userId, env.conversationId, {
      speakerKind: 'user',
      speakerName: 'User',
      content: '先报告情况。',
    });

    const calls = [];
    const generated = await generateMultiRoleTurns({ model: 'current-chat-model' }, {
      database: env.database,
      userId: env.userId,
      conversationId: env.conversationId,
      input: '你们分别说说看法。',
      memberIds: [first.id, second.id],
    }, {
      complete: async (settings, messages, options) => {
        calls.push({ settings, messages, options });
        const target = messages[0].content.match(/exactly one story character: ([^.]+)/)?.[1] || '角色';
        return { content: `${target}：收到。`, model: settings.model };
      },
    });
    assert.equal(generated.turns.length, 2);
    assert.deepEqual(generated.turns.map((turn) => turn.speakerMemberId), [first.id, second.id]);
    assert.ok(calls.every((call) => !Object.hasOwn(call.options, 'tools')));
    assert.ok(calls.every((call) => call.settings.model === 'current-chat-model'));
    assert.deepEqual(
      getCastTurnQueue(env.database, env.userId, env.conversationId).map((entry) => entry.status),
      ['completed', 'completed']
    );
    assert.equal(
      getCastConversationTurns(env.database, env.userId, env.conversationId, { limit: 20 })
        .filter((turn) => turn.speakerKind === 'cast').length,
      2
    );
  } finally {
    env.database.close();
  }
});

test('memory decay traverses every page for a cast member', () => {
  const env = setup();
  try {
    const member = createCastMember(env.database, env.userId, env.conversationId, {
      canonicalName: 'Archive Keeper',
    });
    for (let index = 0; index < 205; index += 1) {
      createCastMemory(env.database, env.userId, env.conversationId, member.id, {
        content: `Archived observation ${index}`,
        importance: 0.5,
        decayRate: 0.1,
      });
    }
    env.database.prepare(
      'UPDATE cast_memories SET updated_at = ?, created_at = ? WHERE member_id = ?'
    ).run('2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', member.id);

    const decay = decayCastMemories(env.database, env.userId, env.conversationId, {
      now: new Date('2026-08-11T00:00:00.000Z'),
    });

    assert.equal(decay.scanned, 205);
    assert.equal(decay.updated, 205);
    assert.deepEqual(decay.memberIds, [member.id]);
  } finally {
    env.database.close();
  }
});

test('main prompt pipeline reads compressed cast context without NPC tools', () => {
  const env = setup();
  try {
    const member = createCastMember(env.database, env.userId, env.conversationId, {
      canonicalName: 'Context Sentinel',
      relationship: 'ally',
      currentLocationLabel: 'North Gate',
    });
    createCastMemory(env.database, env.userId, env.conversationId, member.id, {
      content: 'The eastern bridge is closed.',
      importance: 0.8,
    });

    const pipeline = buildPromptPipeline(env.database, {
      user: { id: env.userId, username: 'tester' },
      conversation: { id: env.conversationId, settings: {} },
      character: {
        id: env.characterId,
        ownerId: env.userId,
        name: 'Traveler',
        persona: 'Observant',
      },
      content: 'What changed at the gate?',
      history: [],
      persistWorldBookState: false,
    });

    assert.match(pipeline.sections.cast.context, /Context Sentinel/);
    assert.match(pipeline.sections.cast.context, /eastern bridge is closed/);
    assert.ok(pipeline.priority.activeContext.includes('cast_state'));
    assert.doesNotMatch(
      JSON.stringify(pipeline.modelMessages),
      /get_npc_|record_npc_|upsert_npc|sync_npc_|finish_npc_/
    );
  } finally {
    env.database.close();
  }
});
