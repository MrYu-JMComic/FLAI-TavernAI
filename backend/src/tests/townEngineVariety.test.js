import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-town-engine-variety';

const { createAppDatabase } = await import('../db.js');
const {
  createTown,
  createTownResident,
  listTownEvents,
  recordTownEvent
} = await import('../modules/townSimulation.js');
const { runTownSimulationStep } = await import('../modules/townEngine.js');
const { nowIso } = await import('../security.js');

function setupTown(residentSpecs, settings = {}) {
  const database = createAppDatabase(':memory:');
  const userId = 'variety-user';
  database.prepare(
    'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)'
  ).run(userId, 'variety-user', 'hash', nowIso());
  const town = createTown(database, userId, {
    name: '多样性测试镇',
    simulationStatus: 'running',
    currentDay: 1,
    minuteOfDay: 0,
    settings: { tickMinutes: 15, ...settings }
  });
  const residents = residentSpecs.map((spec) => createTownResident(database, userId, town.id, spec));
  return { database, userId, town, residents };
}

test('a resident never holds a conversation with themselves', () => {
  // Two residents and an even stepIndex used to resolve speaker and listener to the
  // same person via residents[(stepIndex + 2) % 2].
  const { database, userId, town } = setupTown([
    { name: '甲', role: '测试', profile: { activities: ['行动一', '行动二'], dialogue: ['甲的台词'] } },
    { name: '乙', role: '测试', profile: { activities: ['行动三', '行动四'], dialogue: ['乙的台词'] } }
  ]);

  for (let i = 0; i < 30; i += 1) {
    runTownSimulationStep(database, userId, town.id);
  }

  const social = (listTownEvents(database, userId, town.id, { limit: 200 }) || [])
    .filter((event) => event.eventType === 'resident.social');
  assert.ok(social.length > 0, 'expected at least one social event');
  for (const event of social) {
    const participants = event.payload?.participantIds || [];
    assert.equal(new Set(participants).size, participants.length, `duplicate participants in ${event.title}`);
    assert.equal(participants.length, 2, `expected two distinct participants in ${event.title}`);
  }
});

test('a lone resident reacting to an intervention is not duplicated', () => {
  const { database, userId, town, residents } = setupTown([
    { name: '独居者', role: '测试', profile: { activities: ['独自散步'], dialogue: ['只有我一个人。'] } }
  ]);
  recordTownEvent(database, userId, town.id, {
    eventType: 'world.intervention',
    source: 'user',
    title: '突发大雨',
    detail: '夜市被大雨打断',
    occurredTick: 15
  });

  const result = runTownSimulationStep(database, userId, town.id);
  assert.ok(result.advanced);
  assert.equal(result.generated.kind, 'intervention');
  assert.deepEqual(result.generated.residentIds, [residents[0].id]);

  const memoryCount = database.prepare(
    "SELECT COUNT(*) AS c FROM town_memories WHERE resident_id = ? AND source_kind = 'intervention'"
  ).get(residents[0].id).c;
  assert.equal(memoryCount, 1, 'lone resident should record the intervention once');
});

test('engine dialogue and activities vary instead of cycling in lockstep', () => {
  const { database, userId, town } = setupTown([
    {
      name: '话多者',
      role: '测试',
      profile: {
        activities: ['活动A', '活动B', '活动C', '活动D'],
        dialogue: ['台词一', '台词二', '台词三', '台词四']
      }
    },
    {
      name: '同伴',
      role: '测试',
      profile: {
        activities: ['活动E', '活动F', '活动G', '活动H'],
        dialogue: ['回应一', '回应二', '回应三', '回应四']
      }
    }
  ]);

  for (let i = 0; i < 36; i += 1) {
    runTownSimulationStep(database, userId, town.id);
  }

  const social = (listTownEvents(database, userId, town.id, { limit: 200 }) || [])
    .filter((event) => event.eventType === 'resident.social');
  const lines = new Set(social.map((event) => event.detail));
  assert.ok(lines.size > 1, `expected varied dialogue, saw ${lines.size} distinct line(s)`);

  const actions = (listTownEvents(database, userId, town.id, { limit: 200 }) || [])
    .filter((event) => event.eventType === 'resident.action');
  const activities = new Set(actions.map((event) => event.payload?.activity).filter(Boolean));
  assert.ok(activities.size > 1, `expected varied activities, saw ${activities.size}`);
});

test('engine selection is reproducible for identical worlds', () => {
  const specs = [
    { name: '甲', role: '测试', profile: { activities: ['行动一', '行动二'], dialogue: ['台词甲', '台词乙'] } },
    { name: '乙', role: '测试', profile: { activities: ['行动三', '行动四'], dialogue: ['台词丙', '台词丁'] } }
  ];
  const runOnce = () => {
    const { database, userId, town } = setupTown(specs);
    for (let i = 0; i < 12; i += 1) runTownSimulationStep(database, userId, town.id);
    return (listTownEvents(database, userId, town.id, { limit: 100 }) || [])
      .map((event) => `${event.eventType}:${event.detail}`)
      .join('|');
  };
  // Same world id is regenerated per run, so compare structure rather than exact ids:
  // determinism is per (town, resident, tick), and repeated runs of the same shape must
  // produce the same number of social versus action events.
  const first = runOnce();
  const second = runOnce();
  const countKind = (log, kind) => log.split('|').filter((entry) => entry.startsWith(kind)).length;
  assert.equal(countKind(first, 'resident.social'), countKind(second, 'resident.social'));
  assert.equal(countKind(first, 'resident.action'), countKind(second, 'resident.action'));
});
