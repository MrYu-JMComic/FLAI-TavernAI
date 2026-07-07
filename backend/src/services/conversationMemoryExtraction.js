import { createConversationMemory, listConversationMemories } from '../modules/conversationMemories.js';

const AUTO_MEMORY_LIMIT = 6;
const MEMORY_SENTENCE_LIMIT = 180;

export function recordAutomaticConversationMemories(database, userId, conversationId, options = {}) {
  const userMessage = options.userMessage || {};
  const assistantMessage = options.assistantMessage || {};
  const candidates = extractConversationMemoryCandidates({
    messages: [
      {
        id: userMessage.id,
        role: 'user',
        content: userMessage.content
      },
      {
        id: assistantMessage.id,
        role: 'assistant',
        content: assistantMessage.content
      }
    ]
  });
  if (!candidates.length) {
    return [];
  }

  const existing = listConversationMemories(database, userId, conversationId, { includeArchived: true });
  if (!existing) {
    return [];
  }
  const existingKeys = buildExistingMemoryKeys(existing);
  const created = [];
  for (const candidate of candidates) {
    const key = memoryDedupeKey(candidate);
    if (!key || existingKeys.has(key)) {
      continue;
    }
    existingKeys.add(key);
    const memory = createConversationMemory(database, userId, conversationId, {
      memoryType: candidate.memoryType,
      subject: candidate.subject,
      content: candidate.content,
      confidence: candidate.confidence,
      sourceMessageId: candidate.sourceMessageId || assistantMessage.id || userMessage.id || '',
      sourceKind: 'auto',
      sourceExcerpt: candidate.sourceExcerpt,
      enabled: false
    });
    if (memory) {
      created.push(memory);
    }
    if (created.length >= AUTO_MEMORY_LIMIT) {
      break;
    }
  }
  return created;
}

export function extractConversationMemoryCandidates(options = {}) {
  const sources = normalizeMemorySources(options);
  if (!sources.length) {
    return [];
  }

  const candidates = [];
  for (const source of sources) {
    collectSourceMemoryCandidates(candidates, source);
    if (candidates.length >= AUTO_MEMORY_LIMIT * 3) {
      break;
    }
  }
  return dedupeCandidates(candidates);
}

function collectSourceMemoryCandidates(candidates, source) {
  const start = candidates.length;
  collectPreferenceCandidates(candidates, source.text);
  collectRelationshipCandidates(candidates, source.text);
  collectLocationCandidates(candidates, source.text);
  collectEventCandidates(candidates, source.text);
  collectFactCandidates(candidates, source.text);
  for (let index = start; index < candidates.length; index += 1) {
    candidates[index].sourceMessageId = source.id;
    candidates[index].sourceRole = source.role;
  }
}

function collectPreferenceCandidates(candidates, text) {
  collectRegexCandidates(candidates, text, [
    /(?:我|用户|玩家|player|user)\s*(?:喜欢|偏好|更想|希望|不喜欢|讨厌|避免)\s*([^。！？.!?\n]{2,80})/gi,
    /\b(?:I|user|player)\s+(?:like|prefer|want|hope|hate|dislike|avoid)\s+([^.!?\n]{2,100})/gi
  ], (match) => ({
    memoryType: 'preference',
    subject: 'user',
    content: trimMemorySentence(match[0]),
    confidence: 0.74,
    sourceExcerpt: trimMemorySentence(match[0])
  }));
}

function collectRelationshipCandidates(candidates, text) {
  collectRegexCandidates(candidates, text, [
    /([\u4e00-\u9fa5A-Za-z0-9_]{1,24})\s*(?:信任|喜欢|讨厌|怀疑|保护|背叛|帮助|依赖|认识)\s*([\u4e00-\u9fa5A-Za-z0-9_]{1,24})/g,
    /\b([A-Z][A-Za-z0-9_]{1,24}|player|user)\s+(trusts|likes|hates|suspects|protects|betrayed|helps|knows|depends on)\s+([A-Z][A-Za-z0-9_]{1,24}|the player|the user|user|player)\b/g
  ], (match) => ({
    memoryType: 'relationship',
    subject: normalizeSubject(match[1]),
    content: trimMemorySentence(match[0]),
    confidence: 0.78,
    sourceExcerpt: trimMemorySentence(match[0])
  }));
}

function collectLocationCandidates(candidates, text) {
  collectRegexCandidates(candidates, text, [
    /(?:抵达|来到|进入|离开|位于|住在|藏在|前往)\s*([^，。！？.!?\n]{2,50})/g,
    /\b(?:arrived at|entered|left|went to|is at|stays in|lives in|hidden in)\s+([A-Z][A-Za-z0-9 _-]{2,60})/gi
  ], (match) => ({
    memoryType: 'location',
    subject: trimMemorySentence(match[1]).slice(0, 80),
    content: trimMemorySentence(match[0]),
    confidence: 0.7,
    sourceExcerpt: trimMemorySentence(match[0])
  }));
}

function collectEventCandidates(candidates, text) {
  const sentences = splitSentences(text);
  for (const sentence of sentences) {
    if (!hasEventSignal(sentence)) {
      continue;
    }
    candidates.push({
      memoryType: 'event',
      subject: inferEventSubject(sentence),
      content: trimMemorySentence(sentence),
      confidence: 0.68,
      sourceExcerpt: trimMemorySentence(sentence)
    });
    if (candidates.length >= AUTO_MEMORY_LIMIT * 2) {
      return;
    }
  }
}

function collectFactCandidates(candidates, text) {
  collectRegexCandidates(candidates, text, [
    /([\u4e00-\u9fa5A-Za-z0-9_]{2,30})\s*(?:是|拥有|携带|掌握|知道)\s*([^。！？.!?\n]{2,80})/g,
    /\b([A-Z][A-Za-z0-9_]{1,30})\s+(?:is|has|carries|knows)\s+([^.!?\n]{2,100})/g
  ], (match) => ({
    memoryType: 'fact',
    subject: normalizeSubject(match[1]),
    content: trimMemorySentence(match[0]),
    confidence: 0.62,
    sourceExcerpt: trimMemorySentence(match[0])
  }));
}

function collectRegexCandidates(candidates, text, patterns, createCandidate) {
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) {
      const candidate = createCandidate(match);
      if (candidate?.content) {
        candidates.push(candidate);
      }
      if (candidates.length >= AUTO_MEMORY_LIMIT * 3) {
        return;
      }
      if (!pattern.global) {
        break;
      }
    }
  }
}

function dedupeCandidates(candidates = []) {
  const deduped = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate);
    const key = memoryDedupeKey(normalized);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalized);
    if (deduped.length >= AUTO_MEMORY_LIMIT) {
      break;
    }
  }
  return deduped;
}

function normalizeCandidate(candidate = {}) {
  return {
    memoryType: normalizeMemoryType(candidate.memoryType),
    subject: String(candidate.subject || '').trim().slice(0, 160),
    content: trimMemorySentence(candidate.content),
    confidence: normalizeConfidence(candidate.confidence),
    sourceExcerpt: trimMemorySentence(candidate.sourceExcerpt || candidate.content),
    sourceMessageId: String(candidate.sourceMessageId || '').trim().slice(0, 160),
    sourceRole: normalizeSourceRole(candidate.sourceRole)
  };
}

function buildExistingMemoryKeys(memories = []) {
  const keys = new Set();
  for (const memory of Array.isArray(memories) ? memories : []) {
    const key = memoryDedupeKey(memory);
    if (key) {
      keys.add(key);
    }
  }
  return keys;
}

function memoryDedupeKey(memory = {}) {
  const content = normalizeComparableText(memory.content);
  if (!content) {
    return '';
  }
  return [
    normalizeMemoryType(memory.memoryType),
    normalizeComparableText(memory.subject),
    content
  ].join('|');
}

function normalizeMemorySources(options = {}) {
  const sources = [];
  if (Array.isArray(options.messages)) {
    for (const message of options.messages) {
      appendMemorySource(sources, message?.content, {
        id: message?.id,
        role: message?.role
      });
    }
    return sources;
  }
  appendMemorySource(sources, options.userText, { role: 'user' });
  appendMemorySource(sources, options.assistantText, { role: 'assistant' });
  return sources;
}

function appendMemorySource(sources, content, metadata = {}) {
  const text = String(content || '').trim().slice(0, 6000);
  if (!text) {
    return;
  }
  sources.push({
    id: String(metadata.id || '').trim().slice(0, 160),
    role: normalizeSourceRole(metadata.role),
    text
  });
}

function splitSentences(text) {
  const sentences = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (!'。！？.!?\n'.includes(text[index])) {
      continue;
    }
    pushSentence(sentences, text.slice(start, index + 1));
    start = index + 1;
    if (sentences.length >= 24) {
      break;
    }
  }
  if (sentences.length < 24) {
    pushSentence(sentences, text.slice(start));
  }
  return sentences;
}

function pushSentence(sentences, value) {
  const sentence = trimMemorySentence(value);
  if (sentence.length >= 8) {
    sentences.push(sentence);
  }
}

function hasEventSignal(sentence) {
  return /(?:发现|找到|获得|拿到|救下|击败|承诺|失去|抵达|离开|解开|found|discovered|obtained|rescued|defeated|promised|lost|arrived|left|unlocked)/i
    .test(sentence);
}

function inferEventSubject(sentence) {
  const match = /([\u4e00-\u9fa5A-Za-z0-9_]{2,24})/.exec(sentence);
  return match ? normalizeSubject(match[1]) : '';
}

function trimMemorySentence(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MEMORY_SENTENCE_LIMIT);
}

function normalizeSubject(value) {
  return String(value || '').trim().replace(/[，。！？.!?]+$/g, '').slice(0, 80);
}

function normalizeComparableText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeMemoryType(value) {
  const normalized = String(value || '').trim();
  return ['event', 'relationship', 'location', 'preference', 'fact', 'summary'].includes(normalized)
    ? normalized
    : 'event';
}

function normalizeSourceRole(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'assistant' || normalized === 'user' ? normalized : 'unknown';
}

function normalizeConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, number));
}
