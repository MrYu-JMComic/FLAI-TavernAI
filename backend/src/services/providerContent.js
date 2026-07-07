export function extractReasoning(value = {}) {
  return mergeReasoning(
    extractText(
      value.reasoning_content ||
        value.reasoning ||
        value.reasoning_details ||
        value.reasoningDetails ||
        value.reasoning_delta ||
        (value.thought === true ? '' : value.thought) ||
        value.thoughts ||
        value.thinking ||
        value.thinking_content ||
        value.thinking_delta ||
        value.delta?.reasoning ||
        value.delta?.thinking
    ),
    extractReasoningBlocks(value.content)
  );
}

export function extractText(value) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    let text = '';
    for (const item of value) {
      if (!isReasoningBlock(item)) {
        text += extractText(item?.text || item?.content || item);
      }
    }
    return text;
  }

  if (typeof value === 'object') {
    return extractText(value.text || value.content || value.parts);
  }

  return String(value);
}

export function extractReasoningBlocks(value) {
  if (!Array.isArray(value)) {
    return '';
  }
  let reasoning = '';
  for (const item of value) {
    if (!isReasoningBlock(item)) {
      continue;
    }
    const text = extractText(item?.thinking || item?.text || item?.content || item);
    if (text) {
      reasoning = reasoning ? `${reasoning}\n\n${text}` : text;
    }
  }
  return reasoning;
}

function isReasoningBlock(item) {
  return Boolean(item && typeof item === 'object' && (item.type === 'thinking' || item.type === 'reasoning' || item.thought === true));
}

export function mergeReasoning(...items) {
  let merged = '';
  for (const item of items) {
    merged = appendReasoning(merged, item);
  }
  return merged;
}

export function appendReasoning(merged, item) {
  const value = String(item || '').trim();
  if (!value) {
    return merged;
  }
  return merged ? `${merged}\n\n${value}` : value;
}

export function splitThinkingTags(text) {
  const value = String(text || '');
  if (!value) {
    return { content: '', reasoning: '' };
  }
  let reasoning = '';
  let content = value.replace(/<thinking\b[^>]*>([\s\S]*?)<\/thinking>/gi, (_match, inner) => {
    reasoning = appendReasoning(reasoning, inner);
    return '';
  });
  content = content.replace(/<thinking\b[^>]*>[\s\S]*$/i, (match) => {
    const inner = match.replace(/^<thinking\b[^>]*>/i, '').trim();
    reasoning = appendReasoning(reasoning, inner);
    return '';
  });
  content = content.replace(/<\/thinking>/gi, '');
  return {
    content: content.trimStart(),
    reasoning
  };
}

export function createThinkingTagFilter({ onContent, onReasoning }) {
  let buffer = '';
  let inThinking = false;
  const openTag = '<thinking>';
  const closeTag = '</thinking>';

  const drain = (flush = false) => {
    while (buffer) {
      const lower = buffer.toLowerCase();
      if (!inThinking) {
        const index = lower.indexOf(openTag);
        if (index >= 0) {
          emitStreamText(onContent, buffer.slice(0, index));
          buffer = buffer.slice(index + openTag.length);
          inThinking = true;
          continue;
        }
        const emitLength = flush ? buffer.length : safeTagEmitLength(buffer, openTag);
        if (emitLength <= 0) {
          break;
        }
        emitStreamText(onContent, buffer.slice(0, emitLength));
        buffer = buffer.slice(emitLength);
        break;
      }

      const index = lower.indexOf(closeTag);
      if (index >= 0) {
        emitStreamText(onReasoning, buffer.slice(0, index));
        buffer = buffer.slice(index + closeTag.length);
        inThinking = false;
        continue;
      }
      const emitLength = flush ? buffer.length : safeTagEmitLength(buffer, closeTag);
      if (emitLength <= 0) {
        break;
      }
      emitStreamText(onReasoning, buffer.slice(0, emitLength));
      buffer = buffer.slice(emitLength);
      break;
    }
  };

  return {
    push(text) {
      buffer += String(text || '');
      drain(false);
    },
    flush() {
      drain(true);
      buffer = '';
    }
  };
}

function emitStreamText(callback, text) {
  if (text) {
    callback(text);
  }
}

function safeTagEmitLength(value, tag) {
  const lower = String(value || '').toLowerCase();
  const target = String(tag || '').toLowerCase();
  const maxKeep = Math.min(target.length - 1, lower.length);
  for (let keep = maxKeep; keep > 0; keep -= 1) {
    if (target.startsWith(lower.slice(-keep))) {
      return lower.length - keep;
    }
  }
  return lower.length;
}
