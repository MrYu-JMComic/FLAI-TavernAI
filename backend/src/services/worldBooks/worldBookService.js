// The only business write entry point for world books.
//
// Routes call in after auth and schema validation; the AI assistant produces a
// draft and the caller commits it through here, never straight to SQL. All SQL
// lives in repositories/worldBookRepository.js and all value rules live in
// domain/worldBooks/.
//
// Every function takes (database, userId, ...) so ownership is always explicit.
import { newId, nowIso } from '../../security.js';
import { withSavepoint } from '../../modules/savepoint.js';
import { AppError } from '../../errors.js';
import {
  hashWorldBookValue,
  worldBookRevision,
  WORLD_BOOK_ENTRY_FIELDS,
  WORLD_BOOK_PROFILE_FIELDS
} from '../../domain/worldBooks/revision.js';
import {
  deleteCharacterWorldBookLink,
  deleteWorldBookEntryRecord,
  deleteWorldBookRecord,
  insertWorldBookEntryRecord,
  insertWorldBookRecord,
  insertWorldBookChangeRequest,
  listCharacterWorldBookRows,
  listLinkedBookIdRowsForCharacters,
  listLinkedCharacterIds,
  listOwnedWorldBookRows,
  listWorldBookEntryRows,
  readMaxEntryOrderIndex,
  readOwnedCharacterRow,
  readOwnedWorldBookRow,
  readOwnedWorldBookWithCount,
  readWorldBookChangeRequest,
  readWorldBookEntryRow,
  touchWorldBookRecord,
  updateWorldBookEntryRecord,
  updateWorldBookEntryPatchRecord,
  updateWorldBookProfilePatchRecord,
  updateWorldBookRecord,
  upsertCharacterWorldBookLink
} from '../../repositories/worldBookRepository.js';
import {
  normalizeEntryPayload,
  normalizeLorebookContextPercent,
  normalizeScanDepth,
  normalizeWorldBookDescription,
  normalizeWorldBookName,
  toWorldBook,
  toWorldBookEntry
} from '../../domain/worldBooks/normalization.js';

// The `characterId` field on a world book maps to the junction row at this order.
const PRIMARY_LINK_ORDER_INDEX = 0;

// -- World book reads --

export function listWorldBooks(database, userId) {
  return listOwnedWorldBookRows(database, userId).map(toWorldBook);
}

export function getWorldBook(database, userId, bookId) {
  const row = readOwnedWorldBookWithCount(database, userId, bookId);
  if (!row) {
    return null;
  }
  const book = {
    ...toWorldBook(row),
    linkedCharacters: listLinkedCharacterIds(database, row.user_id, bookId),
    entries: listWorldBookEntryRows(database, bookId).map(toWorldBookEntry)
  };
  return { ...book, revision: worldBookRevision(book) };
}

// -- World book writes --

/** Apply all selected assistant changes together, without changing role links. */
export function applyWorldBookChanges(database, userId, payload = {}) {
  const requestId = String(payload.requestId || '').trim();
  if (!requestId || requestId.length > 160 || !Array.isArray(payload.changes) || !payload.changes.length) {
    throw new AppError(400, 'WORLD_BOOK_CHANGES_INVALID', '请提供有效的世界书变更和请求编号。');
  }
  const { changeReceiptScope, ...receiptPayload } = payload;
  const payloadHash = hashWorldBookValue(receiptPayload);

  return withSavepoint(database, 'sp_world_book_apply_changes', () => {
    const receipt = readWorldBookChangeRequest(database, userId, requestId);
    if (receipt) {
      if (receipt.payload_hash !== payloadHash) {
        throw new AppError(409, 'WORLD_BOOK_REQUEST_REUSED', '此请求已经应用，请为新的变更重新提交。');
      }
      const books = JSON.parse(receipt.result_json).map(({ ref, bookId }) => {
        const book = getWorldBook(database, userId, bookId);
        if (!book) throw new AppError(409, 'WORLD_BOOK_APPLIED_TARGET_MISSING', '已应用的世界书已被删除，请刷新列表。');
        return { ref, book };
      });
      // Older assistant batch receipts can safely seed their per-change records.
      if (changeReceiptScope) {
        for (const change of payload.changes) {
          const changeRequestId = assistantChangeRequestId(changeReceiptScope, change);
          if (readWorldBookChangeRequest(database, userId, changeRequestId)) continue;
          const applied = books.find(item => item.ref === change.ref);
          insertWorldBookChangeRequest(database, userId, changeRequestId,
            hashWorldBookValue({ requestId: changeRequestId, changes: [change] }),
            [{ ref: change.ref, bookId: applied.book.id }]);
        }
      }
      return { books };
    }

    const refs = new Set();
    const bookIds = new Set();
    const books = payload.changes.map((change) => {
      const ref = String(change?.ref || '').trim();
      const bookId = String(change?.bookId || '').trim();
      if (!ref || refs.has(ref) || (bookId && bookIds.has(bookId))) {
        throw new AppError(400, 'WORLD_BOOK_CHANGES_INVALID', '每本世界书只能提交一份变更。');
      }
      refs.add(ref);
      if (bookId) bookIds.add(bookId);
      if (changeReceiptScope) {
        return applyWorldBookChanges(database, userId, {
          requestId: assistantChangeRequestId(changeReceiptScope, change), changes: [change]
        }).books[0];
      }
      return { ref, book: applyWorldBookChange(database, userId, change, bookId) };
    });
    insertWorldBookChangeRequest(database, userId, requestId, payloadHash,
      books.map(({ ref, book }) => ({ ref, bookId: book.id })));
    return { books };
  });
}

function assistantChangeRequestId(scope, change) {
  return `character-assistant-item:${hashWorldBookValue([scope, change])}`;
}

function applyWorldBookChange(database, userId, change, bookId) {
  const profile = pickChangeFields(change.profile, WORLD_BOOK_PROFILE_FIELDS);
  const upserts = Array.isArray(change.upserts) ? change.upserts : [];
  const removals = Array.isArray(change.removals) ? change.removals : [];
  let book;
  if (bookId) {
    book = getWorldBook(database, userId, bookId);
    if (!book) throw new AppError(404, 'WORLD_BOOK_NOT_FOUND', '世界书不存在或已被删除。');
    if (!change.baseRevision || change.baseRevision !== book.revision) {
      throw new AppError(409, 'WORLD_BOOK_REVISION_CONFLICT', `《${book.name}》已发生变化，请重新读取后应用。`);
    }
    if (change.entries?.length) {
      throw new AppError(400, 'WORLD_BOOK_CHANGES_INVALID', '已有世界书需要使用条目差量更新。');
    }
    const normalizers = {
      name: normalizeWorldBookName,
      description: normalizeWorldBookDescription,
      scanDepth: normalizeScanDepth,
      lorebookContextPercent: normalizeLorebookContextPercent
    };
    updateWorldBookProfilePatchRecord(database, userId, book.id,
      Object.fromEntries(Object.entries(profile).map(([key, value]) => [key, normalizers[key](value)])));
  } else {
    if (removals.length || upserts.some((entry) => entry.entryId)) {
      throw new AppError(400, 'WORLD_BOOK_CHANGES_INVALID', '新建世界书不能更新或删除已有条目。');
    }
    book = createWorldBook(database, userId, profile);
    for (const entry of change.entries || []) createEntry(database, userId, book.id, entry);
  }

  const existingEntries = new Map(book.entries.map((entry) => [entry.id, entry]));
  const removedIds = new Set(removals);
  const touchedIds = new Set();
  for (const entryId of removals) {
    if (!existingEntries.has(entryId)) {
      throw new AppError(404, 'WORLD_BOOK_ENTRY_NOT_FOUND', '要删除的条目不存在于当前世界书。');
    }
    deleteEntry(database, userId, book.id, entryId);
  }
  for (const upsert of upserts) {
    const entryId = String(upsert.entryId || '').trim();
    const identity = entryId || String(upsert.localId || '').trim();
    if (identity && (touchedIds.has(identity) || removedIds.has(identity))) {
      throw new AppError(400, 'WORLD_BOOK_CHANGES_INVALID', '同一个条目不能重复修改或同时修改和删除。');
    }
    if (identity) touchedIds.add(identity);
    const patch = pickChangeFields(upsert.patch, WORLD_BOOK_ENTRY_FIELDS);
    if (!entryId) {
      createEntry(database, userId, book.id, patch);
      continue;
    }
    const existing = existingEntries.get(entryId);
    if (!existing) throw new AppError(404, 'WORLD_BOOK_ENTRY_NOT_FOUND', '要更新的条目不存在于当前世界书。');
    const normalized = normalizeEntryPayload({ ...existing, ...patch }, existing);
    updateWorldBookEntryPatchRecord(database, book.id, entryId,
      pickChangeFields(normalized, Object.keys(patch)));
    if (Object.keys(patch).length) touchWorldBookRecord(database, book.id);
  }
  return getWorldBook(database, userId, book.id);
}

function pickChangeFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(fields.filter((key) => Object.hasOwn(value, key) && value[key] !== undefined)
    .map((key) => [key, value[key]]));
}

export function createWorldBook(database, userId, payload = {}) {
  const timestamp = nowIso();
  const id = newId();
  // Validate before writing anything so an unknown character rejects the whole create.
  const characterId = requireOwnedCharacterId(database, userId, payload.characterId);

  return withSavepoint(database, 'sp_world_book_create', () => {
    insertWorldBookRecord(database, {
      id,
      userId,
      name: normalizeWorldBookName(payload.name),
      description: normalizeWorldBookDescription(payload.description),
      scanDepth: normalizeScanDepth(payload.scanDepth),
      lorebookContextPercent: normalizeLorebookContextPercent(payload.lorebookContextPercent),
      createdAt: timestamp,
      updatedAt: timestamp
    });
    if (characterId) {
      upsertCharacterWorldBookLink(database, id, characterId, PRIMARY_LINK_ORDER_INDEX);
    }
    return getWorldBook(database, userId, id);
  });
}

export function updateWorldBook(database, userId, bookId, payload = {}) {
  const existing = readOwnedWorldBookRow(database, userId, bookId);
  if (!existing) {
    return null;
  }
  const nextCharacterId = payload.characterId !== undefined
    ? requireOwnedCharacterId(database, userId, payload.characterId)
    : undefined;

  return withSavepoint(database, 'sp_world_book_update', () => {
    updateWorldBookRecord(database, userId, bookId, {
      name: normalizeWorldBookName(payload.name ?? existing.name),
      description: normalizeWorldBookDescription(payload.description ?? existing.description),
      scanDepth: payload.scanDepth !== undefined
        ? normalizeScanDepth(payload.scanDepth)
        : normalizeScanDepth(existing.scan_depth),
      lorebookContextPercent: payload.lorebookContextPercent !== undefined
        ? normalizeLorebookContextPercent(payload.lorebookContextPercent)
        : normalizeLorebookContextPercent(existing.lorebook_context_percent),
      updatedAt: nowIso()
    });
    if (nextCharacterId !== undefined) {
      applyPrimaryCharacterLink(database, userId, bookId, nextCharacterId);
    }
    return getWorldBook(database, userId, bookId);
  });
}

/**
 * `characterId` is the book's primary link. Setting it attaches that character at
 * order 0; clearing it detaches whichever character currently holds that slot.
 * Additional links made from the character editor are left alone.
 */
function applyPrimaryCharacterLink(database, userId, bookId, characterId) {
  if (characterId) {
    upsertCharacterWorldBookLink(database, bookId, characterId, PRIMARY_LINK_ORDER_INDEX);
    return;
  }
  const current = readOwnedWorldBookWithCount(database, userId, bookId)?.character_id || '';
  if (current) {
    deleteCharacterWorldBookLink(database, bookId, current);
  }
}

export function deleteWorldBook(database, userId, bookId) {
  return deleteWorldBookRecord(database, userId, bookId) > 0;
}

// -- Entry writes --

export function createEntry(database, userId, bookId, payload = {}) {
  if (!readOwnedWorldBookRow(database, userId, bookId)) {
    return null;
  }

  const id = newId();
  return withSavepoint(database, 'sp_world_book_entry_create', () => {
    insertWorldBookEntryRecord(database, {
      id,
      bookId,
      data: normalizeEntryPayload(payload),
      orderIndex: readMaxEntryOrderIndex(database, bookId) + 1,
      createdAt: nowIso()
    });
    touchWorldBookRecord(database, bookId);
    return readEntry(database, id);
  });
}

export function updateEntry(database, userId, bookId, entryId, payload = {}) {
  if (!readOwnedWorldBookRow(database, userId, bookId)) {
    return null;
  }

  const existing = readEntry(database, entryId);
  if (!existing || existing.worldBookId !== bookId) {
    return null;
  }

  return withSavepoint(database, 'sp_world_book_entry_update', () => {
    updateWorldBookEntryRecord(database, bookId, entryId, normalizeEntryPayload({ ...existing, ...payload }, existing));
    touchWorldBookRecord(database, bookId);
    return readEntry(database, entryId);
  });
}

export function deleteEntry(database, userId, bookId, entryId) {
  if (!readOwnedWorldBookRow(database, userId, bookId)) {
    return false;
  }

  return withSavepoint(database, 'sp_world_book_entry_delete', () => {
    if (deleteWorldBookEntryRecord(database, bookId, entryId) === 0) {
      return false;
    }
    touchWorldBookRecord(database, bookId);
    return true;
  });
}

// -- Character links --

/**
 * Attach a world book to a character. Both sides must belong to `userId`;
 * returns false when either is missing so routes can answer 404.
 */
export function linkCharacter(database, userId, bookId, characterId, orderIndex = 0) {
  if (!readOwnedWorldBookRow(database, userId, bookId)) {
    return false;
  }
  if (!readOwnedCharacterRow(database, userId, characterId)) {
    return false;
  }
  upsertCharacterWorldBookLink(database, bookId, characterId, orderIndex);
  return true;
}

export function unlinkCharacter(database, userId, bookId, characterId) {
  if (!readOwnedWorldBookRow(database, userId, bookId)) {
    return false;
  }
  if (!readOwnedCharacterRow(database, userId, characterId)) {
    return false;
  }
  return deleteCharacterWorldBookLink(database, bookId, characterId) > 0;
}

export function listCharacterWorldBooks(database, characterId) {
  return listCharacterWorldBookRows(database, characterId).map(toWorldBook);
}

/** The character's primary world book id, or null. */
export function resolveCharacterWorldBookId(database, characterId) {
  return resolveCharacterWorldBookIds(database, [characterId]).get(characterId) || null;
}

/**
 * Primary world book id per character, resolved through `character_world_books`
 * in one pass.
 */
export function resolveCharacterWorldBookIds(database, characterIds = []) {
  const ids = [...new Set(characterIds.filter(Boolean))];
  const result = new Map();
  if (!ids.length) {
    return result;
  }

  for (const row of listLinkedBookIdRowsForCharacters(database, ids)) {
    if (row?.id && !result.has(row.character_id)) {
      result.set(row.character_id, row.id);
    }
  }

  return result;
}

function readEntry(database, entryId) {
  const row = readWorldBookEntryRow(database, entryId);
  return row ? toWorldBookEntry(row) : null;
}

function requireOwnedCharacterId(database, userId, value) {
  const characterId = String(value || '').trim();
  if (!characterId) {
    return null;
  }
  if (!readOwnedCharacterRow(database, userId, characterId)) {
    throw new Error('Character does not exist');
  }
  return characterId;
}
