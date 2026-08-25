import { createSseParser } from '../../../shared/sse.js';

export async function* parseSse(stream) {
  if (!stream || typeof stream.getReader !== 'function') {
    throw new Error('AI 流式响应不可用，请稍后重试。');
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();

  try {
    while (true) {
      const { done, value } = await readSseChunk(reader);
      if (done) {
        break;
      }

      for (const event of parser.push(decoder.decode(value, { stream: true }))) {
        yield event;
      }
    }

    for (const event of parser.push(decoder.decode())) {
      yield event;
    }
    for (const event of parser.end()) {
      yield event;
    }
  } finally {
    await reader.cancel().catch(() => {});
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
