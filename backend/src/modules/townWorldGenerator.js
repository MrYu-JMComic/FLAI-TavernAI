import {
  createTown,
  createTownResident,
  getTown,
  getTownSnapshot,
  listTownResidents,
  recordTownEvent,
  recordTownMemory,
  updateTownResidentState
} from './townSimulation.js';
import { generateProceduralTownMap } from './townMapGenerator.js';
import { normalizeTownLifeProfile, normalizeTownLifeState } from '../../../shared/townLife.js';
import { TOWN_ARCHITECTURES, townResidentSprite } from '../../../shared/townAssets.js';
import { withSavepoint } from './savepoint.js';
import { nowIso } from '../security.js';

export function generateTownFromBlueprint(database, userId, payload = {}) {
  const prompt = String(payload.prompt || '').trim();
  const idempotencyKey = String(payload.idempotencyKey || '').trim().slice(0, 200);
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

  if (idempotencyKey) {
    const existing = database.prepare(
      'SELECT id FROM town_worlds WHERE user_id = ? AND idempotency_key = ?'
    ).get(userId, idempotencyKey);
    if (existing) {
      return getTownSnapshot(database, userId, existing.id, { eventLimit: 200 });
    }
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
        simulationVersion: 2,
        publicDescription: blueprint.publicDescription || blueprint.environment?.atmosphere || '',
        worldRules: blueprint.rules || [],
        environment: blueprint.environment || {}
      },
      idempotencyKey
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
      const simulation = normalizeTownLifeProfile({ simulation: seed.simulation }, mapConfig.locations, location.name);
      const resident = createTownResident(database, userId, town.id, {
        name: seed.name,
        role: seed.role,
        currentLocation: location.name,
        profile: {
          summary: seed.summary,
          goal: seed.goal,
          activities: seed.activities,
          dialogue: seed.dialogue,
          simulation,
          sprite: townResidentSprite(index),
          routeLocationIds: mapConfig.locations.map((item) => item.id)
        },
        state: {
          life: normalizeTownLifeState({}, simulation),
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

export function rebuildTownMap(database, userId, townId, architecture) {
  const town = getTown(database, userId, townId);
  if (!town) return null;
  if (town.simulationStatus !== 'paused') throw new Error('请先暂停世界再重建地图');
  if (!TOWN_ARCHITECTURES.includes(architecture)) throw new Error('未知的建筑风格');
  const locations = town.mapConfig?.locations || [];
  if (locations.length < 3) throw new Error('地图至少需要三个已有地点');
  const residents = listTownResidents(database, userId, townId);
  if (residents.some((resident) => !locations.some((location) => location.name === resident.currentLocation))) throw new Error('有居民处于未知地点，无法安全重建地图');
  const environment = { biome: town.mapConfig.biome || 'temperate', settlementPattern: 'scattered', water: town.mapConfig.waterBodies?.[0]?.kind || 'none', ...town.settings.environment, architecture };
  const mapConfig = generateProceduralTownMap({ name: town.name, environment, locations, rules: town.settings.worldRules || [] }, town.creationPrompt);
  return withSavepoint(database, 'sp_town_map_rebuild', () => {
    const settings = { ...town.settings, environment, previousMapConfig: town.mapConfig };
    database.prepare('UPDATE town_worlds SET map_config_json = ?, settings_json = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(mapConfig), JSON.stringify(settings), nowIso(), townId, userId);
    for (let index = 0; index < residents.length; index += 1) {
      const resident = residents[index];
      const location = findLocation(mapConfig.locations, resident.currentLocation);
      updateTownResidentState(database, userId, townId, resident.id, {
        state: { mapX: location.x + (index % 3 - 1) * 8, mapY: location.y + Math.floor(index / 3) * 6,
          ...(resident.state.life ? { life: { ...resident.state.life, journey: null, action: { ...resident.state.life.action, remainingMinutes: 0 } } } : {}) }
      });
    }
    recordTownEvent(database, userId, townId, { eventType: 'world.map.rebuilt', source: 'player-map-edit', title: '地图布局已更新', detail: '建筑风格与道路已更新，居民仍位于各自原有地点。', payload: { uiType: 'world', architecture } });
    return getTownSnapshot(database, userId, townId, { eventLimit: 200 });
  });
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
