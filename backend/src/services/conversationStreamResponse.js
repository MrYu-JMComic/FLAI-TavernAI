import {
  captureAssistantStreamText,
  createChatDiagnosticId,
  hasAssistantPayload,
  isAbortError,
  logAssistantPayloadFailure
} from './conversationGenerationDiagnostics.js';
import { createStreamEmitQueue } from './providerStreamEmit.js';
import { streamCompletion } from './providers.js';

export const CHAT_STREAM_HEARTBEAT_MS = 15_000;

export async function streamAssistantResponse({
  request,
  response,
  userId,
  conversation,
  character,
  rules,
  modelMessages,
  settings,
  userMessage,
  statusBar = null,
  worldBookMatches = [],
  thinkingEnabled = true,
  completionOptions = {},
  writeSse,
  getStatusBar,
  saveAssistantResult,
  saveInterruptedAssistantResult,
  startAccessoryAgentsInBackground
}) {
  request.socket?.setTimeout?.(0);
  response.socket?.setTimeout?.(0);
  response.setTimeout?.(0);
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Content-Encoding': 'identity',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  response.flushHeaders?.();

  const controller = new AbortController();
  request.on('aborted', () => controller.abort());
  response.on('close', () => {
    if (!response.writableEnded) {
      controller.abort();
    }
  });

  const serverTimeout = setTimeout(() => {
    if (!response.destroyed) {
      controller.abort(new Error('服务端生成超时，请重试。'));
    }
  }, 300_000);

  const partialAssistant = {
    content: '',
    reasoning: ''
  };
  const streamWrites = createStreamEmitQueue(async (event, data) => {
    captureAssistantStreamText(partialAssistant, event, data);
    await writeSse(response, event, data);
  });
  const emit = streamWrites.emit;
  if (userMessage) {
    await emit('user_message', { userMessage });
  }
  await emit('meta', {
    provider: settings.gatewayName,
    model: settings.model,
    reasoning: settings.supportsReasoning && thinkingEnabled,
    worldBookMatches
  });
  const heartbeat = setInterval(() => {
    void emit('ping', { at: Date.now() });
  }, CHAT_STREAM_HEARTBEAT_MS);

  try {
    const result = await streamCompletion(settings, modelMessages, emit, controller.signal, { thinkingEnabled, ...completionOptions });
    if (!hasAssistantPayload(result)) {
      const diagnosticId = createChatDiagnosticId();
      logAssistantPayloadFailure({
        diagnosticId,
        stage: 'provider-empty',
        mode: 'stream',
        request,
        conversation,
        character,
        settings,
        result,
        partialAssistant,
        modelMessages,
        worldBookMatches
      });
      await emit('error', { error: '模型没有返回正文，请重试或检查当前模型/网关是否支持该对话格式。', diagnosticId });
      await streamWrites.wait();
      response.end();
      return;
    }

    const assistantMessage = saveAssistantResult({
      userId,
      conversation,
      character,
      rules,
      result,
      macroContext: {
        userName: request.auth?.user?.displayName || request.auth?.user?.username || '用户',
        charName: character.name || ''
      }
    });
    if (!assistantMessage) {
      const diagnosticId = createChatDiagnosticId();
      logAssistantPayloadFailure({
        diagnosticId,
        stage: 'postprocess-empty',
        mode: 'stream',
        request,
        conversation,
        character,
        settings,
        result,
        partialAssistant,
        modelMessages,
        worldBookMatches
      });
      await emit('error', { error: '模型回复被处理后为空，请检查输出正则或重试。', diagnosticId });
      await streamWrites.wait();
      response.end();
      return;
    }
    const latestStatusBar = getStatusBar();
    await emit('done', {
      userMessage,
      assistantMessage,
      usage: assistantMessage.usage,
      provider: result.provider,
      worldBookMatches,
      statusBar: latestStatusBar,
      accessoryBackground: true
    });
    await streamWrites.wait();
    response.end();
    startAccessoryAgentsInBackground({
      userId,
      conversation,
      character,
      userMessage,
      assistantMessage,
      settings,
      statusBar: latestStatusBar || statusBar
    });
  } catch (error) {
    const serverAborted = isAbortError(error) || controller.signal.aborted || response.destroyed;
    if (serverAborted) {
      const interruptedMessage = saveInterruptedAssistantResult({
        userId,
        conversation,
        character,
        rules,
        partialAssistant,
        macroContext: {
          userName: request.auth?.user?.displayName || request.auth?.user?.username || '用户',
          charName: character.name || ''
        }
      });
      // Client disconnect closes/destroys the response — nothing to emit.
      // Server-initiated abort (timeout) leaves the socket writable: tell the client why.
      if (!response.destroyed && !response.writableEnded) {
        const reason = controller.signal.reason;
        await emit('error', {
          error: reason?.message || error?.message || '生成已中断',
          interrupted: true,
          ...(interruptedMessage ? { assistantMessage: interruptedMessage } : {})
        });
        await streamWrites.wait();
        response.end();
      }
      return;
    }

    const interruptedMessage = saveInterruptedAssistantResult({
      userId,
      conversation,
      character,
      rules,
      partialAssistant,
      macroContext: {
        userName: request.auth?.user?.displayName || request.auth?.user?.username || '用户',
        charName: character.name || ''
      }
    });
    if (!response.destroyed && !response.writableEnded) {
      await emit('error', {
        error: error?.message || '生成失败',
        ...(interruptedMessage ? { assistantMessage: interruptedMessage } : {})
      });
      await streamWrites.wait();
      response.end();
    }
  } finally {
    clearInterval(heartbeat);
    clearTimeout(serverTimeout);
  }
}
