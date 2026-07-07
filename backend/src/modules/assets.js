import { appConfig } from '../config.js';
import { newId, nowIso } from '../security.js';
import { parseJson } from '../utils/json.js';
import { defaultImageTypesWithGif, parseImageDataUrl } from '../services/imageDataUrls.js';

const assetMaxBytes = appConfig.upload.assetMaxBytes;
const assetMaxPixels = appConfig.upload.imageMaxPixels;
const supportedAssetTypes = defaultImageTypesWithGif;

export const assetKinds = Object.freeze({
  characterGallery: 'character-gallery',
  chatImage: 'chat-image',
  background: 'background',
  avatar: 'avatar'
});

const publicCharacterAssetOwnerTypes = new Set([
  'character',
  'character-background-desktop',
  'character-background-mobile'
]);

export function assetUrl(assetId) {
  return assetId ? `/api/assets/${assetId}` : '';
}

export function createAsset(database, userId, payload = {}) {
  const normalized = normalizeAssetPayload(payload);
  const parsed = parseImageDataUrl(normalized.dataUrl, {
    maxBytes: assetMaxBytes,
    maxPixels: assetMaxPixels,
    imageTypes: supportedAssetTypes,
    unsupportedMessage: '资产仅支持 PNG、JPG、WebP 或 GIF',
    tooLargeMessage: '资产不能超过 6MB',
    tooManyPixelsMessage: '资产图片像素过大',
    invalidMessage: '资产图片数据无效'
  });
  const timestamp = nowIso();
  const id = newId();
  database
    .prepare(
      `INSERT INTO assets (
        id, user_id, owner_type, owner_id, kind, mime_type, name, alt,
        base64_data, byte_size, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      userId,
      normalized.ownerType,
      normalized.ownerId,
      normalized.kind,
      parsed.mimeType,
      normalized.name,
      normalized.alt,
      parsed.base64Data,
      parsed.byteSize,
      JSON.stringify(normalized.metadata),
      timestamp,
      timestamp
    );
  return getAsset(database, userId, id);
}

export function saveAssetInput(database, userId, options = {}) {
  const value = String(options.value || '').trim();
  if (!value) {
    return '';
  }
  if (!isDataUrl(value)) {
    return value;
  }
  const asset = createAsset(database, userId, {
    dataUrl: value,
    ownerType: options.ownerType,
    ownerId: options.ownerId,
    kind: options.kind,
    name: options.name,
    alt: options.alt,
    metadata: options.metadata
  });
  return asset.url;
}

export function listAssets(database, userId, options = {}) {
  const kind = String(options.kind || '').trim();
  const params = [userId];
  let where = 'WHERE user_id = ?';
  if (kind) {
    where += ' AND kind = ?';
    params.push(kind);
  }
  const rows = database
    .prepare(
      `SELECT id, owner_type, owner_id, kind, mime_type, name, alt, byte_size,
              metadata_json, created_at, updated_at
       FROM assets
       ${where}
       ORDER BY created_at DESC, rowid DESC
       LIMIT 200`
    )
    .all(...params);
  return rows.map(toAssetSummary);
}

export function getAsset(database, userId, assetId) {
  const row = database.prepare('SELECT * FROM assets WHERE id = ? AND user_id = ?').get(assetId, userId);
  return row ? toAsset(row) : null;
}

export function getAssetForViewer(database, viewerId, assetId) {
  const row = database.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);
  if (!row) {
    return null;
  }

  if (row.user_id === viewerId) {
    return toAsset(row);
  }

  if (publicCharacterAssetOwnerTypes.has(row.owner_type)) {
    const character = database
      .prepare("SELECT id FROM characters WHERE id = ? AND user_id = ? AND visibility = 'public'")
      .get(row.owner_id, row.user_id);
    if (character) {
      return toAsset(row);
    }
  }

  return null;
}

export function deleteAsset(database, userId, assetId) {
  const result = database.prepare('DELETE FROM assets WHERE id = ? AND user_id = ?').run(assetId, userId);
  return result.changes > 0;
}

export function assetIdFromUrl(value) {
  const match = String(value || '').trim().match(/^\/api\/assets\/([^/?#]+)$/);
  return match ? match[1] : '';
}

function isDataUrl(value) {
  return /^data:[^;,]+\/[^;,]+;base64,/i.test(String(value || '').trim());
}

function normalizeAssetPayload(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  return {
    dataUrl: String(source.dataUrl || source.url || '').trim(),
    ownerType: String(source.ownerType || '').trim().slice(0, 80),
    ownerId: String(source.ownerId || '').trim().slice(0, 160),
    kind: String(source.kind || 'generic').trim().slice(0, 60) || 'generic',
    name: String(source.name || '').trim().slice(0, 160),
    alt: String(source.alt || '').trim().slice(0, 240),
    metadata: normalizeMetadata(source.metadata)
  };
}

function normalizeMetadata(value) {
  const metadata = typeof value === 'string' ? parseJson(value, {}) : value;
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') {
    return {};
  }
  return metadata;
}

function toAssetSummary(row = {}) {
  return {
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    kind: row.kind,
    mimeType: row.mime_type,
    name: row.name,
    alt: row.alt,
    byteSize: row.byte_size,
    metadata: parseJson(row.metadata_json, {}),
    url: assetUrl(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toAsset(row = {}) {
  return {
    ...toAssetSummary(row),
    base64Data: row.base64_data,
    dataUrl: `data:${row.mime_type};base64,${row.base64_data}`
  };
}
