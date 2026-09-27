import { TOWN_ASSETS, townArchitecture, townVenue } from '../../../shared/townAssets.js';
import { distanceToSegment, pointTouchesTownWater } from '../../../shared/townGeometry.js';
import { buildTownRoads } from './townNavigation.js';

const MAP_WIDTH = 1600;
const MAP_HEIGHT = 900;

const BIOME_PALETTES = Object.freeze({
  temperate: { ground: '#8f9b68', groundAlt: '#73845a', water: '#4d8392', waterEdge: '#b8c79b', road: '#c4a66e', roadEdge: '#7f6a4d', wall: '#d7c394', roof: '#744b3e', tree: '#496545', rock: '#77796f' },
  coastal: { ground: '#9fa879', groundAlt: '#7f916b', water: '#3f8194', waterEdge: '#d1c693', road: '#c9ae78', roadEdge: '#806d52', wall: '#e0cc9d', roof: '#67515a', tree: '#4f7053', rock: '#777b77' },
  forest: { ground: '#667b51', groundAlt: '#4d6847', water: '#477b82', waterEdge: '#83a47b', road: '#9f8b62', roadEdge: '#5f5743', wall: '#c1ad7d', roof: '#61443a', tree: '#2f5238', rock: '#657068' },
  desert: { ground: '#c5a66f', groundAlt: '#ad8959', water: '#4a8e99', waterEdge: '#d8bd78', road: '#d5bc87', roadEdge: '#8b6e4b', wall: '#d9bc83', roof: '#925b43', tree: '#65734a', rock: '#8f775e' },
  snow: { ground: '#d8dfdc', groundAlt: '#b6c8c8', water: '#527f9d', waterEdge: '#e9f1ef', road: '#b4aba0', roadEdge: '#72767c', wall: '#dad3c7', roof: '#536474', tree: '#405c56', rock: '#7d858b' },
  volcanic: { ground: '#4f4b48', groundAlt: '#353637', water: '#6e392e', waterEdge: '#9a5e42', road: '#73665a', roadEdge: '#262728', wall: '#8f8478', roof: '#4e3031', tree: '#48503f', rock: '#24282b' },
  swamp: { ground: '#687356', groundAlt: '#535e4b', water: '#4f7169', waterEdge: '#83906b', road: '#938263', roadEdge: '#565040', wall: '#b2a477', roof: '#58473f', tree: '#354f40', rock: '#64675e' },
  fantasy: { ground: '#7c8d74', groundAlt: '#596f69', water: '#527ca4', waterEdge: '#9ec3b1', road: '#c2a576', roadEdge: '#665c5e', wall: '#d3c6ad', roof: '#684c78', tree: '#3d6555', rock: '#747084' }
});

export function generateProceduralTownMap(blueprint, creationPrompt = '') {
  const environment = blueprint.environment || {};
  const sourceLocations = Array.isArray(blueprint.locations) ? blueprint.locations : [];
  if (!sourceLocations.length) throw new Error('AI 世界蓝图缺少地图地点');
  const biome = BIOME_PALETTES[environment.biome] ? environment.biome : 'temperate';
  const seedBlueprint = {
    name: blueprint.name,
    environment,
    locations: sourceLocations.map((location) => ({
      name: location.name,
      kind: location.kind,
      importance: location.importance
    })),
    rules: Array.isArray(blueprint.rules) ? blueprint.rules : []
  };
  const seed = hashText(`${creationPrompt}\u0000${JSON.stringify(seedBlueprint)}`);
  const random = createRandom(seed);
  const waterBodies = buildWaterBodies(environment.water, random);
  const architecture = townArchitecture(environment, sourceLocations);
  const locations = layoutLocations(sourceLocations, environment.settlementPattern, random, waterBodies);
  const roads = buildTownRoads(locations, waterBodies, MAP_WIDTH, MAP_HEIGHT, architecture);
  const buildings = buildBuildings(locations, architecture, random, waterBodies, roads);
  const terrainPatches = buildTerrainPatches(random);
  const decorations = buildDecorations(environment.biome, random, waterBodies, roads, buildings);
  return {
    renderMode: 'procedural-v1',
    generatorVersion: 2,
    assetCatalogVersion: 1,
    architecture,
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    seed,
    biome,
    atmosphere: String(environment.atmosphere || ''),
    palette: architecture === 'modern'
      ? { ...BIOME_PALETTES[biome], ...(['temperate', 'coastal'].includes(biome) ? { ground: '#94b397', groundAlt: '#719779' } : {}), road: '#bdc7c4', roadEdge: '#6c837a', wall: '#e0e7df', roof: '#647f89' }
      : BIOME_PALETTES[biome],
    locations,
    roads,
    buildings,
    terrainPatches,
    waterBodies,
    decorations
  };
}

function layoutLocations(source, pattern = 'clustered', random, waterBodies) {
  const count = Math.max(1, source.length);
  const locations = [];
  for (let index = 0; index < count; index += 1) {
    const row = townVenue(source[index]);
    const asset = TOWN_ASSETS[row.assetId];
    const footprint = Math.hypot(asset.width, asset.height) / 2 + 6;
    const preferred = patternPoint(pattern, index, count, random, locations);
    const candidates = [preferred];
    for (let y = 110; y <= MAP_HEIGHT - 90; y += 115) {
      for (let x = 110; x <= MAP_WIDTH - 90; x += 125) candidates.push({ x: x + jitter(random, 8), y: y + jitter(random, 8) });
    }
    const valid = candidates.filter((point) => (
      point.x >= 90 && point.x <= MAP_WIDTH - 90 && point.y >= 90 && point.y <= MAP_HEIGHT - 90
      && !pointTouchesTownWater(point, waterBodies, 72)
      && locations.every((location) => distance(point, location) >= (count > 12 ? 125 : 160) && distance(point, { x: location.buildingX, y: location.buildingY }) >= location.footprint + 30)
    )).sort((a, b) => distance(a, preferred) - distance(b, preferred));
    let placement = null;
    for (const point of valid) {
      for (const [dx, dy] of [[0, -1], [1, 0], [-1, 0], [0, 1]]) {
        const plot = { x: Math.round(point.x + dx * (footprint + 36)), y: Math.round(point.y + dy * (footprint + 36)) };
        if (plot.x < footprint + 10 || plot.x > MAP_WIDTH - footprint - 10 || plot.y < footprint + 10 || plot.y > MAP_HEIGHT - footprint - 10) continue;
        if (pointTouchesTownWater(plot, waterBodies, footprint)) continue;
        if (locations.some((location) => distance(plot, location) < footprint + 30 || distance(plot, { x: location.buildingX, y: location.buildingY }) < footprint + location.footprint + 48)) continue;
        placement = { point, plot };
        break;
      }
      if (placement) break;
    }
    if (!placement) throw new Error('地图没有足够的可用陆地容纳地点，请减少地点或调整水体。');
    const { point, plot } = placement;
    locations.push({
      ...row,
      x: Math.round(point.x),
      y: Math.round(point.y),
      radius: 72,
      buildingX: plot.x,
      buildingY: plot.y,
      footprint,
      labelX: Math.round(point.x),
      labelY: Math.round(point.y + 65)
    });
  }
  return locations;
}

function patternPoint(pattern, index, count, random, existing) {
  const marginX = 170;
  const marginY = 130;
  if (pattern === 'linear') {
    const progress = (index + 1) / (count + 1);
    return {
      x: marginX + progress * (MAP_WIDTH - marginX * 2),
      y: MAP_HEIGHT * 0.5 + Math.sin(progress * Math.PI * 2) * 125 + jitter(random, 55)
    };
  }
  if (pattern === 'coastal') {
    const columns = Math.max(2, Math.ceil(Math.sqrt(count)));
    return {
      x: 540 + (index % columns) * (820 / Math.max(1, columns - 1)) + jitter(random, 55),
      y: marginY + Math.floor(index / columns) * (620 / Math.max(1, Math.ceil(count / columns) - 1)) + jitter(random, 55)
    };
  }
  if (pattern === 'radial') {
    if (index === 0) return { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
    const angle = ((index - 1) / Math.max(1, count - 1)) * Math.PI * 2 + random() * 0.35;
    const radius = Math.min(310, 155 + count * 18) + jitter(random, 45);
    return { x: MAP_WIDTH / 2 + Math.cos(angle) * radius, y: MAP_HEIGHT / 2 + Math.sin(angle) * radius * 0.72 };
  }
  if (pattern === 'clustered') {
    const cluster = index % Math.min(3, Math.max(1, Math.ceil(count / 3)));
    const centers = [{ x: 610, y: 390 }, { x: 1010, y: 520 }, { x: 910, y: 260 }];
    const center = centers[cluster];
    const angle = random() * Math.PI * 2;
    const radius = 55 + random() * 180;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius * 0.72 };
  }
  return scatteredPoint(random, existing, marginX, marginY);
}

function scatteredPoint(random, existing, marginX, marginY) {
  let candidate = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
  for (let attempt = 0; attempt < 30; attempt += 1) {
    candidate = {
      x: marginX + random() * (MAP_WIDTH - marginX * 2),
      y: marginY + random() * (MAP_HEIGHT - marginY * 2)
    };
    if (existing.every((point) => distance(point, candidate) > 170)) return candidate;
  }
  return candidate;
}

function buildBuildings(locations, architecture, random, waterBodies, roads) {
  const buildings = locations.map((location) => {
    const asset = TOWN_ASSETS[location.assetId];
    return { id: `building-${location.id}-1`, locationId: location.id, kind: location.assetId, assetId: location.assetId,
      architecture, landmark: true, x: location.buildingX, y: location.buildingY, width: asset.width, height: asset.height,
      rotation: 0, variant: Math.floor(random() * 4), floors: architecture === 'modern' ? asset.floors : Math.min(2, asset.floors) };
  });
  for (const location of locations) {
    const count = location.assetId === 'park' || location.assetId === 'car' ? 1 : 2 + Math.floor(location.importance / 2);
    for (let index = 1; index < count; index += 1) {
      const assetId = 'house';
      const asset = TOWN_ASSETS[assetId];
      const scale = 0.6 + random() * 0.15;
      const width = Math.round(asset.width * scale);
      const height = Math.round(asset.height * scale);
      const clearance = Math.hypot(width, height) / 2 + 6;
      let point = null;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const angle = attempt / 12 * Math.PI * 2;
        const radius = 52 + Math.floor(attempt / 12) * 14;
        const candidate = { x: Math.round(location.x + Math.cos(angle) * radius), y: Math.round(location.y + Math.sin(angle) * radius) };
        if (candidate.x < clearance || candidate.x > MAP_WIDTH - clearance || candidate.y < clearance || candidate.y > MAP_HEIGHT - clearance) continue;
        if (pointTouchesTownWater(candidate, waterBodies, clearance)) continue;
        if (buildings.some((building) => distance(building, candidate) < clearance + Math.hypot(building.width, building.height) / 2 + 6)) continue;
        if (roads.some((road) => road.points.slice(1).some((to, segment) => distanceToSegment(candidate, road.points[segment], to) < clearance + 14))) continue;
        point = candidate;
        break;
      }
      if (!point) {
        continue;
      }
      buildings.push({
        id: `building-${location.id}-${index + 1}`,
        locationId: location.id,
        kind: assetId,
        assetId,
        architecture,
        landmark: false,
        ...point,
        width,
        height,
        rotation: 0,
        variant: Math.floor(random() * 4),
        floors: architecture === 'modern' ? asset.floors : Math.min(2, asset.floors)
      });
    }
  }
  return buildings;
}

function buildTerrainPatches(random) {
  const patches = [];
  for (let index = 0; index < 38; index += 1) {
    patches.push({
      x: Math.round(random() * MAP_WIDTH),
      y: Math.round(random() * MAP_HEIGHT),
      radiusX: Math.round(45 + random() * 150),
      radiusY: Math.round(28 + random() * 90),
      opacity: Number((0.08 + random() * 0.13).toFixed(2))
    });
  }
  return patches;
}

function buildWaterBodies(type, random) {
  if (type === 'coast') {
    const edge = 330 + random() * 100;
    return [{
      kind: 'coast',
      points: [
        { x: 0, y: 0 },
        { x: edge + jitter(random, 45), y: 0 },
        { x: edge + jitter(random, 70), y: 220 },
        { x: edge + jitter(random, 60), y: 460 },
        { x: edge + jitter(random, 55), y: 700 },
        { x: edge + jitter(random, 45), y: MAP_HEIGHT },
        { x: 0, y: MAP_HEIGHT }
      ]
    }];
  }
  if (type === 'river') {
    const horizontal = random() > 0.5;
    const points = [];
    for (let index = 0; index < 7; index += 1) {
      points.push(horizontal
        ? { x: index * (MAP_WIDTH / 6), y: MAP_HEIGHT * 0.48 + jitter(random, 120) }
        : { x: MAP_WIDTH * 0.5 + jitter(random, 150), y: index * (MAP_HEIGHT / 6) });
    }
    return [{ kind: 'river', width: 68 + Math.round(random() * 38), points }];
  }
  if (type === 'lake') {
    return [{
      kind: 'lake',
      x: Math.round(270 + random() * (MAP_WIDTH - 540)),
      y: Math.round(220 + random() * (MAP_HEIGHT - 440)),
      radiusX: Math.round(130 + random() * 120),
      radiusY: Math.round(75 + random() * 70),
      rotation: Math.round((random() - 0.5) * 28)
    }];
  }
  return [];
}

function buildDecorations(biome, random, waterBodies, roads, buildings) {
  const decorations = [];
  const treeChance = ['forest', 'temperate', 'swamp', 'fantasy'].includes(biome) ? 0.72 : 0.34;
  for (let index = 0; index < 130; index += 1) {
    const item = {
      kind: random() < treeChance ? 'tree' : 'rock',
      x: Math.round(25 + random() * (MAP_WIDTH - 50)),
      y: Math.round(25 + random() * (MAP_HEIGHT - 50)),
      scale: Number((0.55 + random() * 0.8).toFixed(2))
    };
    if (pointTouchesTownWater(item, waterBodies, 14)) continue;
    if (buildings.some((building) => distance(item, building) < Math.hypot(building.width, building.height) / 2 + 18)) continue;
    if (roads.some((road) => road.points.slice(1).some((to, segment) => distanceToSegment(item, road.points[segment], to) < 25))) continue;
    decorations.push(item);
  }
  return decorations;
}

function hashText(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function jitter(random, amount) {
  return (random() - 0.5) * amount * 2;
}

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}
