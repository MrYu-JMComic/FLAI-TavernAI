import {
  applyRegexRules,
  touchCharacter
} from '../modules/characters.js';
import { buildUsageSnapshot } from './providers.js';
import { prepareChatAttachmentsForStorage } from './chatAttachments.js';
import { hasAssistantPayload } from './conversationGenerationDiagnostics.js';

export function createConversationAssistantResultService({
  db,
  newId,
  nowIso,
  createConversationMessage,
  updateConversationTimestamp
}) {
  function saveInterruptedAssistantResult({ userId, conversation, character, rules, partialAssistant, macroContext = {} }) {
    if (!hasAssistantPayload(partialAssistant)) {
      return null;
    }
    return saveAssistantResult({
      userId,
      conversation,
      character,
      rules,
      result: {
        content: partialAssistant.content,
        reasoning: partialAssistant.reasoning,
        usage: null,
        provider: 'interrupted'
      },
      macroContext
    });
  }

  function saveAssistantResult({ userId, conversation, character, rules, result, macroContext = {} }) {
    const content = applyRegexRules(result.content || '', rules, 'output', macroContext);
    const reasoning = result.reasoning || '';
    if (!String(content || '').trim() && !String(reasoning || '').trim()) {
      return null;
    }
    const usage = buildUsageSnapshot(result.usage, result);
    const assistantMessage = createConversationMessage(db, newId, nowIso, {
      userId,
      conversationId: conversation.id,
      role: 'assistant',
      content,
      reasoning,
      usage
    });
    updateConversationTimestamp(db, nowIso, userId, conversation.id);
    touchCharacter(db, userId, character.id);

    return assistantMessage;
  }

  function saveAssistantImageResult({ userId, conversation, character, result }) {
    const { storedAttachments: attachments } = prepareChatAttachmentsForStorage(db, userId, conversation.id, result.attachments);
    if (!attachments.length) {
      return null;
    }
    const usage = buildUsageSnapshot(result.usage, result);
    const assistantMessage = createConversationMessage(db, newId, nowIso, {
      userId,
      conversationId: conversation.id,
      role: 'assistant',
      content: String(result.content || '已生成图片').trim() || '已生成图片',
      attachments,
      reasoning: '',
      usage
    });
    updateConversationTimestamp(db, nowIso, userId, conversation.id);
    touchCharacter(db, userId, character.id);

    return assistantMessage;
  }

  return {
    saveAssistantImageResult,
    saveAssistantResult,
    saveInterruptedAssistantResult
  };
}
