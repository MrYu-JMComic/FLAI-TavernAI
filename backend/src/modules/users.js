import { getUserAvatarUrl } from '../services/avatars.js';

/**
 * Format a user row into a public-facing user object.
 * @param {object} database - db instance
 * @param {object} row - raw user row from DB
 * @returns {object} public user representation
 */
export function publicUser(database, row) {
  const accountName = row.accountName || row.username;
  const displayName = row.displayName ?? row.display_name ?? '';
  const permissionGroup = normalizePermissionGroup(row.permissionGroup ?? row.permission_group);
  const isRootAdmin = Boolean(row.isRootAdmin ?? row.is_root_admin);
  const avatarUrl = row.avatarUrl || row.avatar_url || getUserAvatarUrl(database, row.id);
  return {
    id: row.id,
    username: accountName,
    accountName,
    displayName,
    permissionGroup,
    permissionLabel: permissionLabel({ permissionGroup, isRootAdmin }),
    isRootAdmin,
    avatarUrl,
    createdAt: row.created_at || row.createdAt
  };
}

/**
 * Get full user profile with stats and owned characters.
 */
export function getUserProfile(database, userId) {
  const row = database.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return {
    user: publicUser(database, row),
    stats: getUserStats(database, userId),
    ownedCharacters: getOwnedCharacterStats(database, userId)
  };
}

/**
 * Get aggregated stats for a user's characters, usage, and likes.
 * Uses 3 optimized queries instead of N+1.
 */
export function getUserStats(database, userId) {
  const row = database
    .prepare(
      `SELECT
        COUNT(*) AS ownedAiCount,
        SUM(CASE WHEN visibility = 'public' THEN 1 ELSE 0 END) AS publicAiCount,
        SUM(CASE WHEN visibility = 'private' THEN 1 ELSE 0 END) AS privateAiCount,
        (SELECT COUNT(DISTINCT c.id) FROM conversations c WHERE c.character_id IN (SELECT id FROM characters WHERE user_id = ?)) AS totalUseCount,
        (SELECT COUNT(DISTINCT c.user_id) FROM conversations c WHERE c.character_id IN (SELECT id FROM characters WHERE user_id = ?)) AS userCount,
        (SELECT COUNT(cl.user_id) FROM character_likes cl WHERE cl.character_id IN (SELECT id FROM characters WHERE user_id = ?)) AS likeCount
       FROM characters
       WHERE user_id = ?`
    )
    .get(userId, userId, userId, userId);

  return {
    ownedAiCount: Number(row?.ownedAiCount || 0),
    publicAiCount: Number(row?.publicAiCount || 0),
    privateAiCount: Number(row?.privateAiCount || 0),
    likeCount: Number(row?.likeCount || 0),
    totalUseCount: Number(row?.totalUseCount || 0),
    userCount: Number(row?.userCount || 0)
  };
}

/**
 * Get per-character stats for characters owned by a user.
 */
export function getOwnedCharacterStats(database, userId) {
  return database
    .prepare(
      `SELECT
        characters.id,
        characters.name,
        characters.avatar_url,
        characters.visibility,
        characters.created_at,
        characters.last_used_at,
        COUNT(DISTINCT conversations.id) AS use_count,
        COUNT(DISTINCT character_likes.user_id) AS like_count
       FROM characters
       LEFT JOIN conversations ON conversations.character_id = characters.id
       LEFT JOIN character_likes ON character_likes.character_id = characters.id
       WHERE characters.user_id = ?
       GROUP BY characters.id
       ORDER BY COALESCE(characters.last_used_at, characters.created_at) DESC, characters.rowid DESC`
    )
    .all(userId)
    .map((row) => ({
      id: row.id,
      name: row.name,
      avatarUrl: row.avatar_url || '',
      visibility: row.visibility === 'public' ? 'public' : 'private',
      useCount: Number(row.use_count || 0),
      likeCount: Number(row.like_count || 0),
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at || null
    }));
}

function normalizePermissionGroup(value) {
  return ['admin', 'user', 'guest'].includes(value) ? value : 'user';
}

function permissionLabel({ permissionGroup, isRootAdmin }) {
  if (isRootAdmin) {
    return '真管理员';
  }
  return {
    admin: '管理员组',
    user: '用户组',
    guest: '游客组'
  }[permissionGroup] || '用户组';
}
