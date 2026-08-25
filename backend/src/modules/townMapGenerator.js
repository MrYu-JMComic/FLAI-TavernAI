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
  const locations = layoutLocations(sourceLocations, environment.settlementPattern, random);
  const roads = buildRoads(locations, random);
  const buildings = buildBuildings(locations, blueprint.environment, random);
  const terrainPatches = buildTerrainPatches(random);
  const waterBodies = buildWaterBodies(environment.water, random);
  const decorations = buildDecorations(environment.biome, random);
  return {
    renderMode: 'procedural-v1',
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    seed,
    biome,
    atmosphere: String(environment.atmosphere || ''),
    palette: BIOME_PALETTES[biome],
    locations,
    roads,
    buildings,
    terrainPatches,
    waterBodies,
    decorations
  };
}

function layoutLocations(source, pattern = 'clustered', random) {
  const count = Math.max(1, source.length);
  const locations = [];
  for (let index = 0; index < count; index += 1) {
    const point = patternPoint(pattern, index, count, random, locations);
    const row = source[index];
    locations.push({
      ...row,
      x: Math.round(point.x),
      y: Math.round(point.y),
      radius: 72 + (Number(row.importance) || 3) * 12
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

function buildRoads(locations, random) {
  const roads = [];
  for (let index = 1; index < locations.length; index += 1) {
    const current = locations[index];
    let nearest = locations[0];
    for (let candidateIndex = 1; candidateIndex < index; candidateIndex += 1) {
      const candidate = locations[candidateIndex];
      if (distance(current, candidate) < distance(current, nearest)) nearest = candidate;
    }
    roads.push(makeRoad(current, nearest, random));
  }
  if (locations.length > 3) {
    roads.push(makeRoad(locations[0], locations[locations.length - 1], random));
  }
  return roads;
}

function makeRoad(from, to, random) {
  const midpoint = {
    x: (from.x + to.x) / 2 + jitter(random, 48),
    y: (from.y + to.y) / 2 + jitter(random, 48)
  };
  return {
    id: `road-${from.id}-${to.id}`,
    from: from.id,
    to: to.id,
    points: [{ x: from.x, y: from.y }, midpoint, { x: to.x, y: to.y }]
  };
}

function buildBuildings(locations, environment, random) {
  const densityBonus = environment?.settlementPattern === 'clustered' ? 2 : 0;
  const buildings = [];
  for (const location of locations) {
    const count = Math.min(15, 3 + location.importance * 2 + densityBonus);
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + random() * 0.5;
      const radius = 42 + random() * location.radius;
      const width = 28 + Math.round(random() * 34);
      const height = 22 + Math.round(random() * 28);
      buildings.push({
        id: `building-${location.id}-${index + 1}`,
        locationId: location.id,
        kind: index === 0 ? location.kind : 'house',
        x: Math.round(clamp(location.x + Math.cos(angle) * radius, 45, MAP_WIDTH - 45)),
        y: Math.round(clamp(location.y + Math.sin(angle) * radius * 0.68, 45, MAP_HEIGHT - 45)),
        width,
        height,
        rotation: Math.round((random() - 0.5) * 18),
        floors: index === 0 ? Math.min(3, 1 + Math.ceil(location.importance / 2)) : 1
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

function buildDecorations(biome, random) {
  const decorations = [];
  const treeChance = ['forest', 'temperate', 'swamp', 'fantasy'].includes(biome) ? 0.72 : 0.34;
  for (let index = 0; index < 130; index += 1) {
    decorations.push({
      kind: random() < treeChance ? 'tree' : 'rock',
      x: Math.round(25 + random() * (MAP_WIDTH - 50)),
      y: Math.round(25 + random() * (MAP_HEIGHT - 50)),
      scale: Number((0.55 + random() * 0.8).toFixed(2))
    });
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

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
