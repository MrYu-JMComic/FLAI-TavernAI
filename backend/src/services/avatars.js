import fs from 'node:fs';
import path from 'node:path';
import { avatarUploadDir } from '../db.js';
import { newId, nowIso } from '../security.js';

const avatarMaxBytes = 2 * 1024 * 1024;
const supportedImageTypes = new Map([
  ['png', 'image/png'],
  ['jpeg', 'image/jpeg'],
  ['jpg', 'image/jpeg'],
  ['webp', 'image/webp']
]);

export function avatarShortUrl(assetId) {
  return assetId ? `/api/avatars/${assetId}` : '';
}

export function getUserAvatarUrl(database, userId) {
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
  const input = String(value || '').trim();
  if (!input) {
    deleteAvatarAsset(database, ownerType, ownerId);
    return '';
  }

  if (input.startsWith('/api/avatars/')) {
    return keepExistingShortUrl(database, { userId, ownerType, ownerId, input });
  }

  const normalized = input.startsWith('data:')
    ? parseAvatarDataUrl(input)
    : readLegacyUpload(input);

  if (!normalized) {
    return input;
  }

  const existing = database
    .prepare('SELECT created_at FROM avatar_assets WHERE owner_type = ? AND owner_id = ?')
    .get(ownerType, ownerId);
  const id = newId();
  const createdAt = existing?.created_at || nowIso();
  const updatedAt = nowIso();

  database
    .prepare(
      `INSERT INTO avatar_assets (
        id, user_id, owner_type, owner_id, mime_type, base64_data, byte_size, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_type, owner_id) DO UPDATE SET
        id = excluded.id,
        user_id = excluded.user_id,
        mime_type = excluded.mime_type,
        base64_data = excluded.base64_data,
        byte_size = excluded.byte_size,
        updated_at = excluded.updated_at`
    )
    .run(
      id,
      userId,
      ownerType,
      ownerId,
      normalized.mimeType,
      normalized.base64Data,
      normalized.byteSize,
      createdAt,
      updatedAt
    );

  return avatarShortUrl(id);
}

export function deleteAvatarAsset(database, ownerType, ownerId) {
  database
    .prepare('DELETE FROM avatar_assets WHERE owner_type = ? AND owner_id = ?')
    .run(ownerType, ownerId);
}

export function getAvatarAssetForViewer(database, viewerId, assetId) {
  const row = database.prepare('SELECT * FROM avatar_assets WHERE id = ?').get(assetId);
  if (!row) {
    return null;
  }

  if (row.user_id === viewerId) {
    return toAvatarAsset(row);
  }

  if (row.owner_type === 'character') {
    const character = database
      .prepare("SELECT id FROM characters WHERE id = ? AND (user_id = ? OR visibility = 'public')")
      .get(row.owner_id, viewerId);
    if (character) {
      return toAvatarAsset(row);
    }
  }

  return null;
}

export function parseAvatarDataUrl(dataUrl) {
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || ''));
  if (!match) {
    throw new Error('头像仅支持 PNG、JPG 或 WebP');
  }

  const extension = match[1].toLowerCase();
  const mimeType = supportedImageTypes.get(extension);
  const base64Data = match[2];
  const buffer = Buffer.from(base64Data, 'base64');

  if (buffer.length > avatarMaxBytes) {
    throw new Error('头像不能超过 2MB');
  }

  return {
    mimeType,
    base64Data,
    byteSize: buffer.length
  };
}

function keepExistingShortUrl(database, { userId, ownerType, ownerId, input }) {
  const assetId = input.split('/').pop();
  const row = database.prepare('SELECT * FROM avatar_assets WHERE id = ?').get(assetId);
  if (!row) {
    return '';
  }

  if (row.user_id === userId && row.owner_type === ownerType && row.owner_id === ownerId) {
    return avatarShortUrl(row.id);
  }

  return '';
}

function readLegacyUpload(value) {
  if (!String(value || '').startsWith('/uploads/avatars/')) {
    return null;
  }

  const filename = path.basename(value);
  const extension = path.extname(filename).slice(1).toLowerCase();
  const mimeType = supportedImageTypes.get(extension);
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
  if (buffer.length > avatarMaxBytes) {
    throw new Error('头像不能超过 2MB');
  }

  return {
    mimeType,
    base64Data: buffer.toString('base64'),
    byteSize: buffer.length
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
