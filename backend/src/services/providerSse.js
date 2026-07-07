import { findSseBlockSeparator, forEachSseLine } from '../../../shared/sse.js';

export async function* parseSse(stream) {
  if (!stream || typeof stream.getReader !== 'function') {
    throw new Error('AI 流式响应不可用，请稍后重试。');
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await readSseChunk(reader);
    if (done) {
      buffer += decoder.decode();
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let separator = findSseBlockSeparator(buffer);
    while (separator) {
      const block = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator.length);
      const event = parseSseBlock(block);
      if (event.data) {
        yield event;
      }
      separator = findSseBlockSeparator(buffer);
    }
  }

  if (buffer.trim()) {
    const event = parseSseBlock(buffer);
    if (event.data) {
      yield event;
    }
  }
}

async function readSseChunk(reader) {
  try {
    return await reader.read();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw error;
    }
    throw new Error('AI 流式响应中断，请稍后重试。', { cause: error });
  }
}

function parseSseBlock(block) {
  const event = { event: 'message', data: '' };
  let hasData = false;

  forEachSseLine(block, (line) => {
    if (line.startsWith('event:')) {
      event.event = line.slice(6).trim();
    }
    if (line.startsWith('data:')) {
      if (hasData) {
        event.data += '\n';
      }
      event.data += line.slice(5).trimStart();
      hasData = true;
    }
  });

  return event;
}
