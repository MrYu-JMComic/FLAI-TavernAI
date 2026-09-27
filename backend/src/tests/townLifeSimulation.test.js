import assert from 'node:assert/strict';
import test from 'node:test';
import { simulateTownLife, townReachableLocations } from '../modules/townLifeSimulation.js';
import { generateProceduralTownMap } from '../modules/townMapGenerator.js';
import { pointTouchesTownWater, townDistance } from '../../../shared/townGeometry.js';
import { normalizeTownLifeState } from '../../../shared/townLife.js';
import { townVenue } from '../../../shared/townAssets.js';

function townFixture() {
  const locations = [
    townVenue({ id: 'home', name: 'Home', kind: 'house', x: 100, y: 100 }),
    townVenue({ id: 'office', name: 'Office', kind: 'office', x: 1060, y: 100 }),
    townVenue({ id: 'cafe', name: 'Cafe', kind: 'cafe', x: 100, y: 700 })
  ];
  return {
    id: 'world', currentDay: 1, minuteOfDay: 600, settings: { tickMinutes: 15 },
    mapConfig: { width: 1600, height: 900, locations, roads: [
      { from: 'home', to: 'office', points: [{ x: 100, y: 100 }, { x: 1060, y: 100 }] },
      { from: 'home', to: 'cafe', points: [{ x: 100, y: 100 }, { x: 100, y: 700 }] }
    ] }
  };
}

function residentFixture(id = 'a', overrides = {}) {
  return {
    id, name: id, role: 'Resident', currentLocation: 'Home',
    profile: { goal: 'Build a stable life', activities: ['Read', 'Practice'], simulation: { homeLocationId: 'home', workLocationId: 'office', hourlyWage: 12, startingMoney: 120, personality: { conscientiousness: 80 } } },
    state: { mapX: 100, mapY: 100, life: normalizeTownLifeState() },
    ...overrides
  };
}

test('urgent needs cause an affordable meal with one charge per action', () => {
  const town = townFixture();
  const resident = residentFixture();
  resident.state.life.needs.hunger = 10;
  const result = simulateTownLife(town, [resident], 15).residents[0];
  assert.equal(result.state.life.action.kind, 'eat');
  assert.ok(result.state.life.needs.hunger > 35);
  assert.equal(result.state.life.money, 118);
  assert.equal(result.state.life.spent, 2);
  assert.equal(resident.state.life.money, 120, 'simulation must not mutate its input snapshot');
});

test('travel consumes simulated time and only the time after arrival earns wages', () => {
  const town = townFixture();
  const resident = residentFixture();
  const first = simulateTownLife(town, [resident], 15).residents[0];
  assert.equal(first.currentLocation, 'Home');
  assert.ok(first.state.life.journey);
  assert.ok(first.state.mapX > 100 && first.state.mapX < 1060);
  assert.equal(first.state.mapY, 100);
  assert.equal(first.state.life.money, 120);
  assert.ok(!townReachableLocations(town, resident, 15).some((location) => location.id === 'office'));
  const second = simulateTownLife({ ...town, minuteOfDay: 615 }, [first], 15).residents[0];
  assert.equal(second.currentLocation, 'Office');
  assert.equal(second.state.life.journey, null);
  assert.equal(second.state.mapX, 1060);
  assert.ok(second.state.life.earned > 0 && second.state.life.earned < 1);
});

test('social encounters require co-location and update both sides once', () => {
  const town = townFixture();
  const a = residentFixture('a', { currentLocation: 'Cafe', state: { mapX: 100, mapY: 700, life: normalizeTownLifeState() } });
  const b = residentFixture('b', { currentLocation: 'Office', state: { mapX: 1060, mapY: 100, life: normalizeTownLifeState() } });
  const forced = new Map([
    ['a', { actionKind: 'social', locationId: 'cafe', activity: 'Meet a neighbor' }],
    ['b', { actionKind: 'social', locationId: 'office', activity: 'Meet a neighbor' }]
  ]);
  assert.equal(simulateTownLife(town, [a, b], 15, { actions: forced }).interactions.length, 0);
  b.currentLocation = 'Cafe';
  b.state.mapX = 100;
  b.state.mapY = 700;
  forced.set('b', { actionKind: 'social', locationId: 'cafe', activity: 'Meet a neighbor' });
  const result = simulateTownLife(town, [a, b], 15, { actions: forced });
  assert.equal(result.interactions.length, 1);
  assert.equal(result.residents[0].state.life.relationships.b.familiarity, 3);
  assert.equal(result.residents[1].state.life.relationships.a.familiarity, 3);
  assert.ok(result.residents.every((resident) => resident.state.life.needs.social > 70));
});

test('personality changes the choice between work and social needs', () => {
  const town = townFixture();
  const decide = (conscientiousness, extraversion) => {
    const resident = residentFixture('a', { currentLocation: 'Cafe', state: { mapX: 100, mapY: 700, life: normalizeTownLifeState() } });
    resident.profile.simulation.workLocationId = 'cafe';
    resident.profile.simulation.personality = { conscientiousness, extraversion };
    resident.state.life.needs.social = 25;
    const peer = residentFixture('peer', { currentLocation: 'Cafe', state: { mapX: 100, mapY: 700, life: normalizeTownLifeState() } });
    peer.profile.simulation.workLocationId = '';
    return simulateTownLife(town, [resident, peer], 5).residents[0].state.life.action.kind;
  };
  assert.equal(decide(100, 10), 'work');
  assert.equal(decide(0, 100), 'social');
});

test('unavailable food never grants free hunger recovery or negative money', () => {
  const town = townFixture();
  const resident = residentFixture();
  resident.state.life.money = 0;
  resident.state.life.needs.hunger = 10;
  const result = simulateTownLife(town, [resident], 15).residents[0];
  assert.ok(result.state.life.money >= 0);
  assert.ok(result.state.life.needs.hunger <= 10);
});

test('fractional wages accumulate without minting extra money or paying beyond the shift', () => {
  const town = townFixture();
  const resident = residentFixture('worker', { currentLocation: 'Office', state: { mapX: 1060, mapY: 100, life: normalizeTownLifeState() } });
  resident.profile.simulation.hourlyWage = 7;
  const forced = new Map([['worker', { locationId: 'office', actionKind: 'work', activity: 'Work' }]]);
  const hourly = simulateTownLife(town, [resident], 60, { actions: forced }).residents[0];
  assert.equal(hourly.state.life.earned, 7);
  assert.equal(hourly.state.life.money, 127);
  resident.profile.simulation.workEndMinute = 602;
  const endOfShift = simulateTownLife(town, [resident], 5, { actions: forced }).residents[0];
  assert.ok(endOfShift.state.life.earned <= 7 * 2 / 60);
});

test('life simulation is deterministic and bounded across a full simulated day', () => {
  const town = townFixture();
  const initial = [residentFixture('a'), residentFixture('b')];
  const simulateDay = () => {
    let residents = initial;
    for (let elapsed = 0; elapsed < 1440; elapsed += 15) {
      const tick = 600 + elapsed;
      residents = simulateTownLife({ ...town, currentDay: Math.floor(tick / 1440) + 1, minuteOfDay: tick % 1440 }, residents, 15).residents;
    }
    return residents;
  };
  const result = simulateDay();
  assert.deepEqual(result, simulateDay());
  for (const resident of result) {
    assert.ok(Object.values(resident.state.life.needs).every((value) => Number.isFinite(value) && value >= 0 && value <= 100));
    assert.ok(resident.state.life.money >= 0);
    assert.ok(resident.state.life.earned > 0);
    assert.ok(resident.state.life.spent > 0);
  }
});

test('generated maps reserve land, non-overlapping footprints, connected roads and typed assets', () => {
  for (const water of ['none', 'river', 'lake', 'coast']) {
    const blueprint = {
      name: 'City', environment: { biome: 'temperate', atmosphere: 'Clear', settlementPattern: 'clustered', water, architecture: 'modern' },
      locations: Array.from({ length: 8 }, (_, index) => ({ id: `place-${index}`, name: `Place ${index}`, kind: ['house', 'office', 'park', 'cafe'][index % 4], importance: 3 })), rules: []
    };
    const map = generateProceduralTownMap(blueprint, `A walkable city ${water}`);
    assert.equal(map.generatorVersion, 2);
    assert.equal(map.architecture, 'modern');
    assert.equal(map.roads.length, 7);
    for (const location of map.locations) {
      assert.ok(!pointTouchesTownWater(location, map.waterBodies, 70), `location on water: ${water}`);
      assert.ok(map.buildings.some((building) => building.locationId === location.id && building.landmark));
    }
    for (const [index, building] of map.buildings.entries()) {
      assert.ok(!pointTouchesTownWater(building, map.waterBodies, Math.hypot(building.width, building.height) / 2));
      for (const other of map.buildings.slice(index + 1)) assert.ok(townDistance(building, other) >= (Math.hypot(building.width, building.height) + Math.hypot(other.width, other.height)) / 2);
    }
  }
});
