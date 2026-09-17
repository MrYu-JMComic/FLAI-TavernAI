import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { townVenue } from '../../../shared/townAssets.js';
import { activeTownConditions } from '../../../shared/townLife.js';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'town-life-persistence-tests';
const { createAppDatabase } = await import('../db.js');
const { createTown, createTownResident, getTown, getTownSchedule, listTownResidents, recordTownEvent, updateTownClock, updateTownResidentState } = await import('../modules/townSimulation.js');
const { runDueTownSimulationSteps, runTownSimulationStep } = await import('../modules/townEngine.js');
const { applyTownTurnPlan, buildTownTurnContext } = await import('../modules/townAiEngine.js');
const { buildTownResidentCognitionContext } = await import('../modules/townCognitionEngine.js');
const { rebuildTownMap } = await import('../modules/townWorldGenerator.js');
const { findTownJourney } = await import('../modules/townNavigation.js');
const { townWithIntervention } = await import('../modules/townWorldConditions.js');
const { createTownsRouter } = await import('../routes/towns.js');
const { insertUser, withServer } = await import('./routeTestUtils.js');

function fixture() {
  const db = createAppDatabase(':memory:');
  const userId = 'life-owner';
  insertUser(db, userId);
  insertUser(db, 'other-owner');
  const mapConfig = {
    width: 1600, height: 900,
    locations: [
      townVenue({ id: 'home', name: 'Home', kind: 'house', x: 100, y: 100, importance: 2, description: 'A shared home' }),
      townVenue({ id: 'office', name: 'Office', kind: 'office', x: 300, y: 100, importance: 3, description: 'A workplace' }),
      townVenue({ id: 'cafe', name: 'Cafe', kind: 'cafe', x: 100, y: 500, importance: 2, description: 'A cafe' })
    ],
    roads: [{ from: 'home', to: 'office', points: [{ x: 100, y: 100 }, { x: 300, y: 100 }] }, { from: 'home', to: 'cafe', points: [{ x: 100, y: 100 }, { x: 100, y: 500 }] }]
  };
  const town = createTown(db, userId, { name: 'Test neighborhood', creationPrompt: 'PRIVATE WORLD SECRET', minuteOfDay: 480, simulationStatus: 'paused', mapConfig, settings: { tickMinutes: 15, publicDescription: 'A quiet neighborhood' } });
  const resident = createTownResident(db, userId, town.id, { name: 'Resident', currentLocation: 'Home', profile: { goal: 'Work and rest', activities: ['Read', 'Practice'], simulation: { homeLocationId: 'home', workLocationId: 'office', workStartMinute: 480, workEndMinute: 1020 } }, state: { mapX: 100, mapY: 100 } });
  return { db, userId, town, resident };
}

function quietPlan(resident, eventId = '') {
  return {
    event: { eventType: 'world.changed', uiType: 'world', title: 'A quiet interval', detail: 'The resident considers the next step.', participantIds: [resident.id], respondsToEventId: eventId },
    actions: [{ residentId: resident.id, locationId: 'home', actionKind: 'personal', activity: 'Read at home', intention: 'Consider the next step', mood: 'Calm', memory: 'I spent some time reading at home.', importance: 5 }]
  };
}

test('manual steps preserve pause and create the next daily schedule at midnight', () => {
  const { db, userId, town, resident } = fixture();
  try {
    assert.equal(runTownSimulationStep(db, userId, town.id).advanced, false);
    const step = runTownSimulationStep(db, userId, town.id, { force: true });
    assert.equal(step.snapshot.town.simulationStatus, 'paused');
    assert.equal(step.snapshot.town.minuteOfDay, 495);
    updateTownClock(db, userId, town.id, { minuteOfDay: 1425 });
    const midnight = runTownSimulationStep(db, userId, town.id, { force: true });
    assert.equal(midnight.snapshot.town.currentDay, 2);
    assert.equal(midnight.snapshot.town.minuteOfDay, 0);
    assert.ok(getTownSchedule(db, userId, town.id, resident.id, 2));
  } finally { db.close(); }
});

test('continuous simulation rolls back needs, schedules, events and clock together', () => {
  const { db, userId, town } = fixture();
  try {
    const before = listTownResidents(db, userId, town.id);
    db.exec("CREATE TRIGGER fail_life_event BEFORE INSERT ON town_events BEGIN SELECT RAISE(ABORT, 'life event failure'); END");
    assert.throws(() => runTownSimulationStep(db, userId, town.id, { force: true }), /life event failure/);
    assert.deepEqual(listTownResidents(db, userId, town.id), before);
    assert.equal(getTown(db, userId, town.id).minuteOfDay, 480);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM town_schedules').get().total, 0);
  } finally { db.close(); }
});

test('closure prevents paid work and expires using simulation time', () => {
  const { db, userId, town } = fixture();
  try {
    recordTownEvent(db, userId, town.id, { eventType: 'world.intervention', source: 'player', title: 'Office closed', payload: { effect: 'closure', locationId: 'office', durationMinutes: 30 } });
    const result = runTownSimulationStep(db, userId, town.id, { force: true });
    assert.equal(activeTownConditions(result.snapshot.town).length, 1);
    assert.equal(result.snapshot.residents[0].state.life.earned, 0);
    const next = runTownSimulationStep(db, userId, town.id, { force: true });
    assert.equal(activeTownConditions(next.snapshot.town).length, 0);
  } finally { db.close(); }
});

test('a failed world is paused without blocking another running world', () => {
  const { db, userId, town } = fixture();
  try {
    const other = createTown(db, userId, { name: 'Second neighborhood', simulationStatus: 'running', mapConfig: town.mapConfig });
    createTownResident(db, userId, other.id, { name: 'Neighbor', currentLocation: 'Home', state: { mapX: 100, mapY: 100 } });
    updateTownClock(db, userId, town.id, { simulationStatus: 'running' });
    const checkpoint = Date.now() - 5000;
    db.prepare('UPDATE town_worlds SET engine_checkpoint_at = ?').run(new Date(checkpoint).toISOString());
    db.exec("CREATE TRIGGER fail_one_world BEFORE INSERT ON town_events WHEN NEW.town_id = (SELECT id FROM town_worlds WHERE name = 'Test neighborhood') BEGIN SELECT RAISE(ABORT, 'one world failed'); END");
    const errors = [];
    const results = runDueTownSimulationSteps(db, { nowMs: checkpoint + 4500, onError: (error) => errors.push(error.message) });
    assert.ok(errors.length > 0);
    assert.equal(getTown(db, userId, town.id).simulationStatus, 'paused');
    assert.equal(getTown(db, userId, town.id).minuteOfDay, 480);
    assert.equal(results.find((result) => result.townId === other.id).steps, 1);
    assert.equal(getTown(db, userId, other.id).minuteOfDay, 495);
  } finally { db.close(); }
});

test('rain affects journey time and is persisted when AI handles the intervention', () => {
  const { db, userId, town, resident } = fixture();
  try {
    const intervention = recordTownEvent(db, userId, town.id, { eventType: 'world.intervention', source: 'player', title: 'Rain begins', payload: { effect: 'rain', durationMinutes: 180 } });
    const wet = townWithIntervention(town, intervention);
    const location = town.mapConfig.locations[1];
    assert.ok(findTownJourney(wet, resident, location).minutes > findTownJourney(town, resident, location).minutes);
    const context = buildTownTurnContext(db, userId, town.id);
    assert.equal(context.world.conditions[0].kind, 'rain');
    const result = applyTownTurnPlan(db, userId, town.id, quietPlan(resident, intervention.id), { expectedVersion: context.version, expectedTick: 480 });
    assert.equal(activeTownConditions(result.snapshot.town)[0].sourceEventId, intervention.id);
  } finally { db.close(); }
});

test('AI rejects same-clock resident changes and impossible destinations without writes', () => {
  const { db, userId, town, resident } = fixture();
  try {
    const context = buildTownTurnContext(db, userId, town.id);
    updateTownResidentState(db, userId, town.id, resident.id, { state: { currentActivity: 'Changed during generation' } });
    assert.throws(() => applyTownTurnPlan(db, userId, town.id, quietPlan(resident), { expectedTick: 480, expectedVersion: context.version }), (error) => error.code === 'TOWN_AI_STEP_CONFLICT');
    const map = { ...town.mapConfig, roads: [], locations: town.mapConfig.locations.map((location) => location.id === 'office' ? { ...location, x: 1500, y: 800 } : location) };
    db.prepare('UPDATE town_worlds SET map_config_json = ? WHERE id = ?').run(JSON.stringify(map), town.id);
    const plan = quietPlan(resident);
    plan.actions[0].locationId = 'office';
    assert.throws(() => applyTownTurnPlan(db, userId, town.id, plan));
    assert.equal(getTown(db, userId, town.id).minuteOfDay, 480);
  } finally { db.close(); }
});

test('resident cognition does not receive world secrets or other residents private discoveries', () => {
  const { db, userId, town, resident } = fixture();
  try {
    const other = createTownResident(db, userId, town.id, { name: 'Other', currentLocation: 'Office' });
    recordTownEvent(db, userId, town.id, { residentId: other.id, eventType: 'resident.discovery', title: 'PRIVATE DISCOVERY', payload: { participantIds: [other.id] } });
    const context = buildTownResidentCognitionContext(db, userId, town.id, resident.id);
    assert.equal(context.world.description, 'A quiet neighborhood');
    assert.ok(!JSON.stringify(context).includes('PRIVATE WORLD SECRET'));
    assert.ok(!JSON.stringify(context).includes('PRIVATE DISCOVERY'));
  } finally { db.close(); }
});

test('map rebuild preserves ownership, logical places, time and a copy of the previous map', () => {
  const { db, userId, town, resident } = fixture();
  try {
    assert.equal(rebuildTownMap(db, 'other-owner', town.id, 'modern'), null);
    const rebuilt = rebuildTownMap(db, userId, town.id, 'modern');
    assert.equal(rebuilt.town.id, town.id);
    assert.equal(rebuilt.town.minuteOfDay, 480);
    assert.equal(rebuilt.town.mapConfig.generatorVersion, 2);
    assert.deepEqual(rebuilt.town.settings.previousMapConfig, town.mapConfig);
    assert.equal(rebuilt.residents.find((row) => row.id === resident.id).currentLocation, 'Home');
    assert.deepEqual(new Set(rebuilt.town.mapConfig.locations.map((row) => row.id)), new Set(town.mapConfig.locations.map((row) => row.id)));
  } finally { db.close(); }
});

test('manual-step and map routes validate ownership, speed and pause requirements', async () => {
  const { db, userId, town } = fixture();
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => { request.auth = { user: { id: request.headers['x-test-user'] || userId } }; next(); });
  app.use('/api/towns', createTownsRouter({ db, requireAuth: (_request, _response, next) => next(), withListCache: (_request, response, data) => response.json(data) }));
  app.use((error, _request, response, _next) => response.status(400).json({ error: error.message }));
  try {
    await withServer(app, async (baseUrl) => {
      const request = (suffix, body, user = userId, method = 'POST') => fetch(`${baseUrl}/api/towns/${town.id}${suffix}`, { method, headers: { 'Content-Type': 'application/json', 'x-test-user': user }, body: JSON.stringify(body) });
      assert.equal((await request('/step', {}, 'other-owner')).status, 404);
      assert.equal((await request('/step', { steps: 0 })).status, 400);
      const stepped = await (await request('/step', { steps: 2 })).json();
      assert.equal(stepped.snapshot.town.minuteOfDay, 510);
      assert.equal(stepped.snapshot.town.simulationStatus, 'paused');
      assert.equal((await request('/clock', { realSecondsPerTick: 0 }, userId, 'PATCH')).status, 400);
      const speed = await (await request('/clock', { realSecondsPerTick: 2, simulationStatus: 'running' }, userId, 'PATCH')).json();
      assert.equal(speed.settings.realSecondsPerTick, 2);
      assert.equal((await request('/step', {})).status, 409);
      assert.equal((await request('/map/rebuild', { architecture: 'modern' })).status, 409);
      assert.equal((await request('/map/rebuild', { architecture: 'missing' })).status, 400);
    });
  } finally { db.close(); }
});
