import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FLAI_DB_PATH = ':memory:';
process.env.APP_SECRET = 'test-secret-town-world-generator';

const { createAppDatabase } = await import('../db.js');
const { listTownEvents, listTownResidents } = await import('../modules/townSimulation.js');
const { generateProceduralTownMap } = await import('../modules/townMapGenerator.js');
const { generateTownFromBlueprint } = await import('../modules/townWorldGenerator.js');
const { nowIso } = await import('../security.js');

const PROMPT = '我想要一个常年被海雾笼罩的贸易港。港口最近不断有人失踪，灯塔守望者怀疑海上出现了异常，但酒馆老板似乎隐瞒着与失踪商船有关的秘密。';
const BLUEPRINT = {
  name: '雾港',
  description: '海雾终年不散的贸易港，失踪商船与灯塔异光正在撕裂居民之间脆弱的信任。',
  environment: {
    biome: 'coastal',
    atmosphere: '潮湿、昏暗，远处总能听见低沉雾笛。',
    settlementPattern: 'coastal',
    water: 'coast'
  },
  locations: [
    { id: 'location-1', name: '断潮灯塔', kind: 'lighthouse', description: '守望外海航道的古老灯塔。', importance: 5 },
    { id: 'location-2', name: '北雾码头', kind: 'harbor', description: '失踪商船最后停靠的码头。', importance: 4 },
    { id: 'location-3', name: '雾鸥酒馆', kind: 'tavern', description: '水手与走私客交换消息的酒馆。', importance: 4 }
  ],
  residents: [
    {
      name: '艾琳',
      role: '灯塔守望者',
      summary: '谨慎的守望者，坚信海雾中存在会回应灯光的东西。',
      goal: '查明灯塔异光与失踪商船的关系',
      mood: '警觉',
      startingLocation: '断潮灯塔',
      activities: ['校准灯塔透镜', '记录海雾中的光点'],
      dialogue: ['昨夜海上的光又靠近了一些。', '别相信每一声从雾里传来的呼救。'],
      memories: ['三天前，她看见一艘无灯商船逆潮驶入浓雾。']
    },
    {
      name: '罗恩',
      role: '酒馆老板',
      summary: '消息灵通的酒馆老板，极力掩饰自己与失踪船长的交易。',
      goal: '在走私账册曝光前找回它',
      mood: '焦虑',
      startingLocation: '雾鸥酒馆',
      activities: ['招待靠港水手', '暗中打听失踪船员'],
      dialogue: ['雾里什么怪事都有，别大惊小怪。', '那艘船从没来过我的酒馆。'],
      memories: ['失踪船长把一册封蜡账本藏在酒窖后墙。']
    }
  ],
  openingEvents: ['一艘没有船员的商船在黎明时漂入北雾码头。'],
  rules: ['浓雾会在夜间改变近海航道。', '居民只会依据自己亲历或听闻的信息行动。']
};

test('procedural map generation is stable for one AI blueprint and changes with the world idea', () => {
  const first = generateProceduralTownMap(BLUEPRINT, PROMPT);
  const second = generateProceduralTownMap(BLUEPRINT, PROMPT);
  const changedPrompt = generateProceduralTownMap(BLUEPRINT, `${PROMPT} 城镇建在巨型鲸骨上。`);
  const changedBlueprint = structuredClone(BLUEPRINT);
  changedBlueprint.environment = { ...changedBlueprint.environment, biome: 'forest', water: 'river' };
  const changedEnvironment = generateProceduralTownMap(changedBlueprint, PROMPT);

  assert.deepEqual(first, second);
  assert.notEqual(first.seed, changedPrompt.seed);
  assert.notEqual(first.seed, changedEnvironment.seed);
  assert.equal(first.renderMode, 'procedural-v1');
  assert.equal(first.width, 1600);
  assert.equal(first.height, 900);
  assert.equal(first.imageUrl, undefined);
  assert.ok(first.roads.length >= BLUEPRINT.locations.length - 1);
  assert.ok(first.buildings.length > BLUEPRINT.locations.length);
  assert.ok(first.terrainPatches.length > 0);
  assert.ok(first.waterBodies.some((item) => item.kind === 'coast'));
  assert.ok(first.decorations.length > 0);
});

test('world generator persists the natural-language prompt, AI initialization and map-space coordinates', () => {
  const database = createAppDatabase(':memory:');
  const userId = 'world-generator-user';
  database.prepare(
    'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)'
  ).run(userId, userId, 'hash', nowIso());

  const snapshot = generateTownFromBlueprint(database, userId, {
    prompt: PROMPT,
    blueprint: BLUEPRINT,
    simulationStatus: 'paused'
  });

  assert.equal(snapshot.town.name, '雾港');
  assert.equal(snapshot.town.creationPrompt, PROMPT);
  assert.equal(snapshot.town.mapConfig.renderMode, 'procedural-v1');
  assert.equal(snapshot.town.mapConfig.width, 1600);
  assert.equal(snapshot.town.mapConfig.height, 900);
  assert.equal(snapshot.town.settings.generationSource, 'ai');
  assert.equal(snapshot.town.settings.mapGenerator, 'procedural-v1');
  assert.equal(snapshot.residents.length, 2);
  assert.ok(snapshot.residents.every((resident) => resident.state.mapX >= 0 && resident.state.mapX <= 1600));
  assert.ok(snapshot.residents.every((resident) => resident.state.mapY >= 0 && resident.state.mapY <= 900));
  assert.ok(snapshot.residents.every((resident) => resident.profile.goal && resident.profile.activities.length >= 2));
  assert.deepEqual(new Set(listTownResidents(database, userId, snapshot.town.id).map((item) => item.name)), new Set(['艾琳', '罗恩']));
  assert.ok(listTownEvents(database, userId, snapshot.town.id).every((event) => event.source === 'ai-world-generation'));
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM town_memories WHERE town_id = ? AND source_kind = 'ai-world-generation'").get(snapshot.town.id).count,
    4
  );
  database.close();
});
