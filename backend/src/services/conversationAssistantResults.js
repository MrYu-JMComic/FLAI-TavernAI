import {
  applyRegexRules,
  touchCharacter
} from '../modules/characters.js';
import { buildUsageSnapshot } from './providers.js';
import { prepareChatAttachmentsForStorage } from './chatAttachments.js';
import { hasAssistantPayload } from './conversationGenerationDiagnostics.js';
import { withSavepoint } from '../modules/savepoint.js';
import { countSwipes, replaceMessageWithAlternative } from '../modules/swipes.js';
import { assertCurrentGeneration } from './conversationTimeline.js';
import { writeConversationCheckpoint } from '../repositories/conversationSnapshotRepository.js';
import { toMessage } from '../routes/helpers.js';

export function createConversationAssistantResultService({
  db,
  newId,
  nowIso,
  createConversationMessage,
  updateConversationTimestamp,
  onAssistantSaved = () => null
}) {
  function saveInterruptedAssistantResult({ userId, conversation, character, rules, partialAssistant, macroContext = {}, ticket }) {
    if (!hasAssistantPayload(partialAssistant)) {
      return null;
    }
    try { assertCurrentGeneration(db, ticket); } catch (error) {
      if (error.code === 'CONVERSATION_TIMELINE_CHANGED') return null;
      throw error;
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
      macroContext,
      ticket,
      interrupted: true
    });
  }

  function saveAssistantResult({ userId, conversation, character, rules, result, macroContext = {}, ticket, interrupted = false }) {
    const content = applyRegexRules(result.content || '', rules, 'output', macroContext);
    const reasoning = result.reasoning || '';
    if (!String(content || '').trim() && !String(reasoning || '').trim()) {
      return null;
    }
    const usage = buildUsageSnapshot(result.usage, result);
    return withSavepoint(db, 'sp_save_assistant_result', () => {
    assertCurrentGeneration(db, ticket);
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
    if (interrupted) {
      db.prepare("UPDATE messages SET postprocess_state = 'interrupted' WHERE id = ?").run(assistantMessage.id);
      assistantMessage.postprocessState = 'interrupted';
    } else {
      const job = onAssistantSaved({ userId, conversation, assistantMessage, ticket });
      if (job) {
        assistantMessage.postprocessState = 'queued';
        assistantMessage.postprocessJobId = job.id;
      }
    }
    return assistantMessage;
    });
  }

  /**
   * Replace the target assistant message with a regenerated reply. The previous
   * text is retained as a swipe; the timeline restores the pre-message checkpoint
   * and re-queues postprocessing for the new content.
   */
  function saveRegeneratedAssistantResult({ userId, conversation, character, rules, result, macroContext = {}, ticket, targetMessageId }) {
    const content = applyRegexRules(result.content || '', rules, 'output', macroContext);
    const reasoning = result.reasoning || '';
    if (!String(content || '').trim() && !String(reasoning || '').trim()) {
      return null;
    }
    const usage = buildUsageSnapshot(result.usage, result);
    return withSavepoint(db, 'sp_save_regenerated_assistant_result', () => {
      assertCurrentGeneration(db, ticket);
      const existing = db
        .prepare('SELECT * FROM messages WHERE id = ? AND user_id = ? AND conversation_id = ?')
        .get(targetMessageId, userId, conversation.id);
      if (!existing || existing.role !== 'assistant') {
        throw Object.assign(new Error('要重新生成的回复不存在'), { status: 404, code: 'MESSAGE_NOT_FOUND', publicMessage: '要重新生成的回复不存在' });
      }
      const timeline = replaceMessageWithAlternative(db, userId, existing, { content, reasoning, usage }, {
        postprocessOptions: generationThinkingOptions(ticket)
      });
      updateConversationTimestamp(db, nowIso, userId, conversation.id);
      touchCharacter(db, userId, character.id);
      const assistantMessage = toMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(targetMessageId));
      assistantMessage.regenerated = true;
      assistantMessage.swipeCount = countSwipes(db, userId, targetMessageId) + 1;
      assistantMessage.timeline = timeline;
      if (timeline?.postprocessJobId) {
        assistantMessage.postprocessState = 'queued';
        assistantMessage.postprocessJobId = timeline.postprocessJobId;
      }
      return assistantMessage;
    });
  }

  function saveAssistantImageResult({ userId, conversation, character, result, ticket }) {
    assertCurrentGeneration(db, ticket);
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
    writeConversationCheckpoint(db, userId, conversation.id);

    return assistantMessage;
  }

  return {
    saveAssistantImageResult,
    saveAssistantResult,
    saveInterruptedAssistantResult,
    saveRegeneratedAssistantResult
  };
}

function generationThinkingOptions(ticket) {
  const options = {};
  if (ticket?.thinkingLevel) options.thinkingLevel = ticket.thinkingLevel;
  if (typeof ticket?.thinkingEnabled === 'boolean') options.thinkingEnabled = ticket.thinkingEnabled;
  return options;
}
