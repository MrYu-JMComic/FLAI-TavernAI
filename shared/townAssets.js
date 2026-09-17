export const TOWN_ARCHITECTURES = Object.freeze(['modern', 'traditional', 'fantasy']);

export function townResidentSprite(index) {
  const variant = Math.max(0, Math.floor(Number(index) || 0)) % 8;
  return { column: (variant % 4) * 3 + 1, row: variant < 4 ? 0 : 4 };
}

export const TOWN_ASSETS = Object.freeze({
  house: { category: 'home', width: 64, height: 54, floors: 1, services: ['sleep', 'eat', 'wash', 'relax'], capacity: 4, open: 0, close: 1440 },
  apartment: { category: 'home', width: 76, height: 64, floors: 4, services: ['sleep', 'eat', 'wash', 'relax'], capacity: 12, open: 0, close: 1440 },
  office: { category: 'work', width: 82, height: 68, floors: 5, services: ['work', 'social'], capacity: 16, open: 480, close: 1200 },
  workshop: { category: 'work', width: 80, height: 62, floors: 1, services: ['work', 'social'], capacity: 8, open: 420, close: 1200 },
  shop: { category: 'commerce', width: 64, height: 54, floors: 1, services: ['work', 'eat', 'social'], capacity: 8, open: 420, close: 1320 },
  cafe: { category: 'commerce', width: 66, height: 56, floors: 1, services: ['work', 'eat', 'social', 'relax'], capacity: 10, open: 420, close: 1380 },
  hotel: { category: 'home', width: 88, height: 70, floors: 3, services: ['sleep', 'wash', 'eat', 'work'], capacity: 16, open: 0, close: 1440 },
  park: { category: 'outdoors', width: 100, height: 80, floors: 0, services: ['relax', 'social', 'explore'], capacity: 24, open: 0, close: 1440 },
  clinic: { category: 'civic', width: 78, height: 62, floors: 2, services: ['care', 'work', 'wash'], capacity: 12, open: 0, close: 1440 },
  school: { category: 'civic', width: 94, height: 64, floors: 2, services: ['work', 'learn', 'social'], capacity: 24, open: 420, close: 1140 },
  hall: { category: 'civic', width: 84, height: 64, floors: 2, services: ['work', 'social', 'learn'], capacity: 20, open: 480, close: 1140 },
  station: { category: 'transport', width: 100, height: 58, floors: 1, services: ['work', 'social', 'explore'], capacity: 20, open: 300, close: 1440 },
  harbor: { category: 'transport', width: 100, height: 62, floors: 1, services: ['work', 'explore'], capacity: 16, open: 0, close: 1440 },
  lighthouse: { category: 'work', width: 48, height: 48, floors: 4, services: ['work', 'explore'], capacity: 4, open: 0, close: 1440 },
  car: { category: 'transport', width: 46, height: 28, floors: 0, services: ['relax'], capacity: 4, open: 0, close: 1440 }
});

const ASSET_ALIASES = Object.freeze({
  residential: 'house', residence: 'house', home: 'house', housing: 'apartment',
  workplace: 'office', tower: 'office', market: 'shop', store: 'shop',
  restaurant: 'cafe', tavern: 'cafe', bar: 'cafe', inn: 'hotel', lodge: 'hotel',
  garden: 'park', square: 'park', plaza: 'park', forest: 'park', farm: 'workshop',
  hospital: 'clinic', library: 'school', temple: 'hall', castle: 'hall',
  factory: 'workshop', dock: 'harbor', port: 'harbor', bridge: 'station',
  '公寓': 'apartment', '住宅': 'house', '民居': 'house',
  '写字楼': 'office', '酒店': 'hotel', '酒吧': 'cafe',
  '公园': 'park', '学校': 'school', '医院': 'clinic',
  '商店': 'shop', '餐厅': 'cafe', '轿车': 'car'
});

export function townAssetId(location = {}) {
  if (Object.hasOwn(TOWN_ASSETS, location.assetId)) return location.assetId;
  const kind = String(location.kind || '').trim().toLowerCase();
  return Object.hasOwn(TOWN_ASSETS, kind) ? kind : Object.hasOwn(ASSET_ALIASES, kind) ? ASSET_ALIASES[kind] : 'house';
}

export function townVenue(location = {}) {
  const assetId = townAssetId(location);
  const asset = TOWN_ASSETS[assetId];
  const explicitServices = Array.isArray(location.services)
    ? location.services.filter((service) => TOWN_SERVICE_IDS.includes(service))
    : [];
  return {
    ...location,
    assetId,
    services: explicitServices.length ? [...new Set(explicitServices)] : [...asset.services],
    capacity: boundedInteger(location.capacity, 1, 100, asset.capacity),
    opensAt: boundedInteger(location.opensAt, 0, 1439, asset.open),
    closesAt: boundedInteger(location.closesAt, 1, 1440, asset.close)
  };
}

export const TOWN_SERVICE_IDS = Object.freeze(['sleep', 'eat', 'wash', 'relax', 'work', 'social', 'explore', 'care', 'learn']);

export function townArchitecture(environment = {}, locations = []) {
  if (TOWN_ARCHITECTURES.includes(environment.architecture)) return environment.architecture;
  if (locations.some((location) => ['office', 'apartment', 'car', 'clinic'].includes(townAssetId(location)))) return 'modern';
  return environment.biome === 'fantasy' ? 'fantasy' : 'traditional';
}

export function isTownVenueOpen(location, minute) {
  const { opensAt, closesAt } = townVenue(location);
  const time = ((Number(minute) || 0) % 1440 + 1440) % 1440;
  if (opensAt === closesAt || opensAt === 0 && closesAt === 1440) return true;
  return opensAt < closesAt ? time >= opensAt && time < closesAt : time >= opensAt || time < closesAt;
}

function boundedInteger(value, minimum, maximum, fallback) {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.round(value))) : fallback;
}
