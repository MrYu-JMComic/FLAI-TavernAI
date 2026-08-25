import {
  createTown,
  createTownResident,
  getTownSnapshot,
  recordTownEvent,
  recordTownMemory
} from './townSimulation.js';
import { generateProceduralTownMap } from './townMapGenerator.js';

export function generateTownFromBlueprint(database, userId, payload = {}) {
  const prompt = String(payload.prompt || '').trim();
  const blueprint = payload.blueprint;
  if (!prompt) throw new Error('请输入你的世界构想');
  if (
    !blueprint?.name
    || !blueprint?.description
    || !blueprint?.environment
    || !Array.isArray(blueprint.locations)
    || blueprint.locations.length < 3
    || !Array.isArray(blueprint.residents)
    || blueprint.residents.length < 2
    || !Array.isArray(blueprint.openingEvents)
    || !blueprint.openingEvents.length
  ) {
    throw new Error('AI 世界蓝图无效');
  }

  const mapConfig = generateProceduralTownMap(blueprint, prompt);
  database.exec('BEGIN');
  try {
    const town = createTown(database, userId, {
      name: blueprint.name,
      description: blueprint.description,
      creationPrompt: prompt,
      mapConfig,
      simulationStatus: payload.simulationStatus || 'paused',
      currentDay: 1,
      minuteOfDay: 480,
      settings: {
        tickMinutes: 15,
        realSecondsPerTick: 4,
        generationSource: 'ai',
        mapGenerator: 'procedural-v1',
        worldRules: blueprint.rules || [],
        environment: blueprint.environment || {}
      }
    });
    if (!town) throw new Error('无法为当前用户创建世界');

    const residents = [];
    for (let index = 0; index < blueprint.residents.length; index += 1) {
      const seed = blueprint.residents[index];
      const location = findLocation(mapConfig.locations, seed.startingLocation);
      if (!location) {
        throw new Error(`AI 居民“${seed.name}”的起始地点“${seed.startingLocation}”不存在`);
      }
      const spawn = findSpawnPoint(mapConfig, location, index);
      const resident = createTownResident(database, userId, town.id, {
        name: seed.name,
        role: seed.role,
        currentLocation: location.name,
        profile: {
          summary: seed.summary,
          goal: seed.goal,
          activities: seed.activities,
          dialogue: seed.dialogue,
          sprite: { column: (index % 6) * 2 + 1, row: index % 2 === 0 ? 2 : 6 },
          routeLocationIds: mapConfig.locations.map((item) => item.id)
        },
        state: {
          mood: seed.mood,
          mapX: spawn.x,
          mapY: spawn.y,
          currentActivity: seed.activities[0] || '观察周围',
          currentIntention: seed.goal
        }
      });
      residents.push(resident);
      const memories = Array.isArray(seed.memories) ? seed.memories : [];
      for (let memoryIndex = 0; memoryIndex < memories.length; memoryIndex += 1) {
        recordTownMemory(database, userId, town.id, resident.id, {
          memoryType: 'observation',
          content: memories[memoryIndex],
          importance: Math.min(9, 5 + memoryIndex),
          sourceKind: 'ai-world-generation',
          occurredTick: 450 + memoryIndex * 5
        });
      }
      recordTownMemory(database, userId, town.id, resident.id, {
        memoryType: 'plan',
        content: `我在${location.name}开始新的一天，当前目标是：${seed.goal}`,
        importance: 7,
        sourceKind: 'ai-world-generation',
        occurredTick: 480
      });
    }

    for (const text of blueprint.openingEvents) {
      recordTownEvent(database, userId, town.id, {
        eventType: 'world.opening',
        source: 'ai-world-generation',
        title: text,
        detail: text,
        payload: { uiType: 'opening' },
        occurredTick: 480
      });
    }
    database.exec('COMMIT');
    return getTownSnapshot(database, userId, town.id, { eventLimit: 200 });
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function findLocation(locations, name) {
  return locations.find((item) => item.name === name) || null;
}

function findSpawnPoint(mapConfig, location, residentIndex) {
  const buildings = mapConfig.buildings.filter((building) => building.locationId === location.id);
  const building = buildings[residentIndex % Math.max(1, buildings.length)];
  if (!building) return { x: location.x, y: location.y };
  return {
    x: Math.round((location.x + building.x) / 2),
    y: Math.round((location.y + building.y) / 2)
  };
}
