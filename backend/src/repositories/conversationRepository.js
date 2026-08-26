import {
  createCursorScope,
  decodeCursor,
  encodeCursor,
  normalizeCursorLimit
} from '../services/cursorPagination.js';
import { measureSync } from '../services/performanceMetrics.js';

export function listConversationRows(database, userId, options = {}) {
  const characterId = String(options.characterId || '').trim();
  const paginated = options.pagination === 'cursor';
  const limit = normalizeCursorLimit(options.limit);
  const scope = createCursorScope('conversations', { userId, characterId });
  const params = [userId];
  const clauses = ['conversations.user_id = ?'];
  if (characterId) {
    clauses.push('conversations.character_id = ?');
    params.push(characterId);
  }
  if (paginated && options.cursor) {
    const [updatedAt, rowId] = decodeCursor(options.cursor, scope, { values: 2 });
    clauses.push('(conversations.updated_at < ? OR (conversations.updated_at = ? AND conversations.rowid < ?))');
    params.push(updatedAt, updatedAt, rowId);
  }
  if (paginated) params.push(limit + 1);

  const rows = measureSync('sqlite.conversations.list', () => database.prepare(
    `SELECT conversations.*, conversations.rowid AS _cursor_rowid,
            characters.name AS character_name, characters.avatar_url
     FROM conversations
     JOIN characters ON characters.id = conversations.character_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY conversations.updated_at DESC, conversations.rowid DESC
     ${paginated ? 'LIMIT ?' : ''}`
  ).all(...params));

  if (!paginated) return { rows, nextCursor: '' };
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);
  return {
    rows: pageRows,
    nextCursor: hasMore && last
      ? encodeCursor(scope, [last.updated_at, Number(last._cursor_rowid)])
      : ''
  };
}
