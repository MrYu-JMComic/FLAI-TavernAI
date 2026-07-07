import fs from 'node:fs';
import path from 'node:path';
import { appConfig } from '../config.js';
import { avatarUploadDir } from '../db.js';
import { assetIdFromUrl, assetKinds, assetUrl } from '../modules/assets.js';
import { newId, nowIso } from '../security.js';
import {
  defaultImageTypes,
  defaultImageTypesWithGif,
  parseImageBuffer,
  parseImageDataUrl as parseSharedImageDataUrl
} from './imageDataUrls.js';

const avatarMaxBytes = appConfig.upload.avatarMaxBytes;
const backgroundMaxBytes = appConfig.upload.backgroundMaxBytes;
const imageMaxPixels = appConfig.upload.imageMaxPixels;
const supportedImageTypes = defaultImageTypes;
const supportedBackgroundImageTypes = defaultImageTypesWithGif;
export const characterBackgroundOwnerTypes = {
  desktop: 'character-background-desktop',
  mobile: 'character-background-mobile'
};
export const conversationBackgroundOwnerTypes = {
  desktop: 'conversation-background-desktop',
  mobile: 'conversation-background-mobile'
};
const characterAssetOwnerTypes = new Set([
  'character',
  characterBackgroundOwnerTypes.desktop,
  characterBackgroundOwnerTypes.mobile
]);
const avatarShortUrlPrefix = '/api/avatars/';

export function avatarShortUrl(assetId) {
  return assetId ? `${avatarShortUrlPrefix}${assetId}` : '';
}

export function getUserAvatarUrl(database, userId) {
  const assetRow = database
    .prepare("SELECT id FROM assets WHERE owner_type = 'user' AND owner_id = ? AND kind = ? ORDER BY updated_at DESC, rowid DESC")
    .get(userId, assetKinds.avatar);
  if (assetRow) {
    return assetUrl(assetRow.id);
  }

  const row = database
    .prepare("SELECT id FROM avatar_assets WHERE owner_type = 'user' AND owner_id = ?")
    .get(userId);
  return avatarShortUrl(row?.id);
}

export function migrateLegacyAvatarUploads(database) {
  const rows = database
    .prepare("SELECT id, user_id, avatar_url FROM characters WHERE avatar_url LIKE '/uploads/avatars/%'")
    .all();
  const update = database.prepare('UPDATE characters SET avatar_url = ?, updated_at = ? WHERE id = ?');

  for (const row of rows) {
    try {
      const avatarUrl = saveAvatarInput(database, {
        userId: row.user_id,
        ownerType: 'character',
        ownerId: row.id,
        value: row.avatar_url
      });
      if (avatarUrl && avatarUrl !== row.avatar_url) {
        update.run(avatarUrl, nowIso(), row.id);
      }
    } catch {
      // Keep the old value if a legacy file cannot be migrated.
    }
  }
}

export function saveAvatarInput(database, { userId, ownerType, ownerId, value }) {
  return saveImageAssetInput(database, {
    userId,
    ownerType,
    ownerId,
    value,
    maxBytes: avatarMaxBytes,
    imageTypes: supportedImageTypes,
    unsupportedMessage: '头像仅支持 PNG、JPG 或 WebP',
    tooLargeMessage: '头像不能超过 2MB'
  });
}

export function saveBackgroundImageInput(database, { userId, ownerType, ownerId, value }) {
  return saveImageAssetInput(database, {
    userId,
    ownerType,
    ownerId,
    value,
    maxBytes: backgroundMaxBytes,
    imageTypes: supportedBackgroundImageTypes,
    unsupportedMessage: '背景图片仅支持 PNG、JPG、WebP 或 GIF',
    tooLargeMessage: '背景图片不能超过 4MB'
  });
}

function saveImageAssetInput(database, {
  userId,
  ownerType,
  ownerId,
  value,
  maxBytes,
  imageTypes,
  unsupportedMessage,
  tooLargeMessage
}) {
  const input = String(value || '').trim();
  if (!input) {
    deleteAvatarAsset(database, ownerType, ownerId);
    return '';
  }

  if (input.startsWith('/api/assets/')) {
    return keepExistingAssetUrl(database, { userId, ownerType, ownerId, input });
  }

  if (input.startsWith(avatarShortUrlPrefix)) {
    return keepExistingShortUrl(database, { userId, ownerType, ownerId, input });
  }

  const normalized = input.startsWith('data:')
    ? parseAvatarDataUrl(input, { maxBytes, imageTypes, unsupportedMessage, tooLargeMessage })
    : readLegacyUpload(input, { maxBytes, imageTypes, tooLargeMessage });

  if (!normalized) {
    return input;
  }

  const kind = imageAssetKindForOwnerType(ownerType);
  const existing = getExistingImageAssetTimestamp(database, { ownerType, ownerId, kind });
  const id = newId();
  const createdAt = existing?.created_at || nowIso();
  const updatedAt = nowIso();

  deleteAvatarAsset(database, ownerType, ownerId);
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
      ownerType,
      ownerId,
      kind,
      normalized.mimeType,
      '',
      '',
      normalized.base64Data,
      normalized.byteSize,
      '{}',
      createdAt,
      updatedAt
    );

  return assetUrl(id);
}

export function deleteAvatarAsset(database, ownerType, ownerId) {
  const kind = imageAssetKindForOwnerType(ownerType);
  database
    .prepare('DELETE FROM assets WHERE owner_type = ? AND owner_id = ? AND kind = ?')
    .run(ownerType, ownerId, kind);
  database
    .prepare('DELETE FROM avatar_assets WHERE owner_type = ? AND owner_id = ?')
    .run(ownerType, ownerId);
}

export function getAvatarAssetForViewer(database, viewerId, assetId) {
  const assetRow = database.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);
  if (assetRow) {
    return canViewStoredImageAsset(database, viewerId, assetRow) ? toStoredImageAsset(assetRow) : null;
  }

  const row = database.prepare('SELECT * FROM avatar_assets WHERE id = ?').get(assetId);
  if (!row) {
    return null;
  }

  if (row.user_id === viewerId) {
    return toAvatarAsset(row);
  }

  if (characterAssetOwnerTypes.has(row.owner_type)) {
    const character = database
      .prepare("SELECT id FROM characters WHERE id = ? AND user_id = ? AND (user_id = ? OR visibility = 'public')")
      .get(row.owner_id, row.user_id, viewerId);
    if (character) {
      return toAvatarAsset(row);
    }
  }

  return null;
}

export function parseAvatarDataUrl(dataUrl, options = {}) {
  const {
    maxBytes = avatarMaxBytes,
    maxPixels = imageMaxPixels,
    imageTypes = supportedImageTypes,
    unsupportedMessage = '头像仅支持 PNG、JPG 或 WebP',
    tooLargeMessage = '头像不能超过 2MB',
    tooManyPixelsMessage = '图片像素过大',
    invalidMessage = 'Invalid avatar image data'
  } = options;
  return parseSharedImageDataUrl(dataUrl, {
    maxBytes,
    maxPixels,
    imageTypes,
    unsupportedMessage,
    tooLargeMessage,
    tooManyPixelsMessage,
    invalidMessage
  });
}

function keepExistingShortUrl(database, { userId, ownerType, ownerId, input }) {
  const assetId = getAvatarShortUrlAssetId(input);
  if (!assetId) {
    return input;
  }
  const assetRow = database.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);
  if (assetRow) {
    return isOwnedImageAsset(assetRow, { userId, ownerType, ownerId })
      ? assetUrl(assetRow.id)
      : '';
  }

  const row = database.prepare('SELECT * FROM avatar_assets WHERE id = ?').get(assetId);
  if (!row) {
    // Asset no longer exists — preserve the existing URL to avoid silently clearing the avatar
    return input;
  }

  if (row.user_id === userId && row.owner_type === ownerType && row.owner_id === ownerId) {
    return avatarShortUrl(row.id);
  }

  // Ownership mismatch — clear the URL (belongs to another user/type)
  return '';
}

function keepExistingAssetUrl(database, { userId, ownerType, ownerId, input }) {
  const id = assetIdFromUrl(input);
  if (!id) {
    return input;
  }
  const row = database.prepare('SELECT * FROM assets WHERE id = ?').get(id);
  if (!row) {
    return input;
  }
  return isOwnedImageAsset(row, { userId, ownerType, ownerId })
    ? assetUrl(row.id)
    : '';
}

function imageAssetKindForOwnerType(ownerType) {
  if (
    ownerType === characterBackgroundOwnerTypes.desktop ||
    ownerType === characterBackgroundOwnerTypes.mobile ||
    ownerType === conversationBackgroundOwnerTypes.desktop ||
    ownerType === conversationBackgroundOwnerTypes.mobile
  ) {
    return assetKinds.background;
  }
  return assetKinds.avatar;
}

function getExistingImageAssetTimestamp(database, { ownerType, ownerId, kind }) {
  const assetRow = database
    .prepare(
      `SELECT created_at
       FROM assets
       WHERE owner_type = ? AND owner_id = ? AND kind = ?
       ORDER BY created_at ASC, rowid ASC`
    )
    .get(ownerType, ownerId, kind);
  if (assetRow) {
    return assetRow;
  }
  return database
    .prepare('SELECT created_at FROM avatar_assets WHERE owner_type = ? AND owner_id = ?')
    .get(ownerType, ownerId);
}

function isOwnedImageAsset(row, { userId, ownerType, ownerId }) {
  return row.user_id === userId &&
    row.owner_type === ownerType &&
    row.owner_id === ownerId &&
    row.kind === imageAssetKindForOwnerType(ownerType);
}

function canViewStoredImageAsset(database, viewerId, row) {
  if (row.user_id === viewerId) {
    return true;
  }
  if (characterAssetOwnerTypes.has(row.owner_type)) {
    const character = database
      .prepare("SELECT id FROM characters WHERE id = ? AND user_id = ? AND (user_id = ? OR visibility = 'public')")
      .get(row.owner_id, row.user_id, viewerId);
    return Boolean(character);
  }
  return false;
}

function getAvatarShortUrlAssetId(input) {
  const text = String(input || '');
  if (!text.startsWith(avatarShortUrlPrefix)) {
    return '';
  }
  const start = avatarShortUrlPrefix.length;
  if (start >= text.length) {
    return '';
  }
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '/') {
      return '';
    }
  }
  return text.slice(start);
}

function readLegacyUpload(value, options = {}) {
  const {
    maxBytes = avatarMaxBytes,
    imageTypes = supportedImageTypes,
    tooLargeMessage = '头像不能超过 2MB'
  } = options;
  if (!String(value || '').startsWith('/uploads/avatars/')) {
    return null;
  }

  const filename = path.basename(value);
  const extension = path.extname(filename).slice(1).toLowerCase();
  const mimeType = imageTypes.get(extension);
  if (!mimeType) {
    return null;
  }

  const filePath = path.resolve(avatarUploadDir, filename);
  if (!filePath.startsWith(path.resolve(avatarUploadDir))) {
    return null;
  }
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const buffer = fs.readFileSync(filePath);
  const parsed = parseImageBuffer(buffer, {
    expectedMimeType: mimeType,
    maxBytes,
    maxPixels: imageMaxPixels,
    tooLargeMessage,
    tooManyPixelsMessage: '图片像素过大',
    invalidMessage: 'Invalid avatar image data'
  });

  return {
    mimeType: parsed.mimeType,
    base64Data: parsed.base64Data,
    byteSize: parsed.byteSize
  };
}

function toAvatarAsset(row) {
  return {
    id: row.id,
    mimeType: row.mime_type,
    base64Data: row.base64_data,
    byteSize: row.byte_size,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    updatedAt: row.updated_at
  };
}

function toStoredImageAsset(row) {
  return {
    id: row.id,
    mimeType: row.mime_type,
    base64Data: row.base64_data,
    byteSize: row.byte_size,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    updatedAt: row.updated_at
  };
}
