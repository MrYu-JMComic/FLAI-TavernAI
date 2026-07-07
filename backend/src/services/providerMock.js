import { extractText } from './providerContent.js';

export function mockCompletion(messages, settings = {}) {
  const lastUserMessage = findLastUserMessageContent(messages);
  const providerHint = settings.apiKeyError
    ? settings.apiKeyError
    : '保存 API Key 后，这里会切换为真实模型回复。';
  return {
    content: `本地 Mock 回复：我收到了“${lastUserMessage}”。${providerHint}`,
    reasoning: '',
    usage: null,
    provider: 'Local Mock',
    providerType: 'mock',
    model: 'local-mock'
  };
}

function findLastUserMessageContent(messages = []) {
  if (Array.isArray(messages)) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role === 'user') {
        return extractText(message.content);
      }
    }
    return '';
  }

  if (!messages || typeof messages[Symbol.iterator] !== 'function') {
    return '';
  }

  let content = '';
  for (const message of messages) {
    if (message?.role === 'user') {
      content = extractText(message.content);
    }
  }
  return content;
}

export async function streamMockCompletion(messages, emit, settings = {}) {
  const result = mockCompletion(messages, settings);
  const content = String(result.content || '');
  const chunkSize = 10;
  for (let index = 0; index < content.length; index += chunkSize) {
    await emit('content', { text: content.slice(index, index + chunkSize) });
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return result;
}
