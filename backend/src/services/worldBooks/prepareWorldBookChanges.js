import { AppError } from '../../errors.js';
import { assertCharacterAssistantSessionIdle } from '../../modules/characterAssistantSessions.js';
import { hashWorldBookValue } from '../../domain/worldBooks/revision.js';
import { sanitizeText } from '../sanitize.js';

export function prepareWorldBookChangesForSave(database, userId, payload) {
  const prepared = {
    requestId: payload.requestId,
    changes: payload.changes.map(change => ({
      ...change,
      profile: {
        ...change.profile,
        ...(change.profile.name !== undefined ? { name: sanitizeText(change.profile.name) } : {})
      }
    }))
  };
  const sessionId = String(payload.assistantSessionId || '').trim();
  if (!sessionId) return prepared;
  if (!assertCharacterAssistantSessionIdle(database, userId, sessionId)) {
    throw new AppError(404, 'CHARACTER_ASSISTANT_SESSION_NOT_FOUND', '助手会话不存在。');
  }
  // Repeated assistant saves share receipts without rewriting the draft state.
  prepared.requestId = `character-assistant:${sessionId}:${hashWorldBookValue(prepared.changes)}`;
  prepared.changeReceiptScope = sessionId;
  return prepared;
}
