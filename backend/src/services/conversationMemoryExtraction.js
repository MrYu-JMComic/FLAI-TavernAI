import { createConversationMemory, listConversationMemories } from '../modules/conversationMemories.js';

const AUTO_MEMORY_LIMIT = 12;
const MEMORY_SENTENCE_LIMIT = 1_000;

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
      sourceMessageId: candidate.sourceMessageId || '',
      sourceKind: 'auto',
      sourceExcerpt: candidate.sourceExcerpt,
      enabled: true
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

  const perSource = sources.map((source) => {
    const candidates = [];
    collectSourceMemoryCandidates(candidates, source);
    return candidates;
  });
  const candidates = [];
  for (let index = 0; index < AUTO_MEMORY_LIMIT; index += 1) {
    for (const entries of perSource) if (entries[index]) candidates.push(entries[index]);
  }
  return dedupeCandidates(candidates);
}

function collectSourceMemoryCandidates(candidates, source) {
  if (!['user', 'assistant'].includes(source.role)) return;
  for (const sentence of splitSentences(source.text)) {
    if (source.role === 'user' && isConversationRequest(sentence)) continue;
    const memoryType = classifyMemorySentence(sentence, source.role);
    candidates.push({
      memoryType,
      subject: memoryType === 'preference' ? 'user' : '',
      content: trimMemorySentence(sentence),
      confidence: memoryType === 'summary' ? 0.55 : 0.7,
      sourceExcerpt: trimMemorySentence(sentence),
      sourceMessageId: source.id,
      sourceRole: source.role
    });
    if (candidates.length >= AUTO_MEMORY_LIMIT) return;
  }
}

function isConversationRequest(text) {
  if (/[?？]["'”’）)]?$/.test(text)) return true;
  return /^(?:请)?(?:简短|简洁|详细|继续|续写|重写|回答|确认|输出|总结|扩写|用.{0,12}(?:字|句|段).*(?:回答|回复|描述)|不要(?:代写|重复))/.test(text)
    || /^(?:please\s+)?(?:reply|respond|answer|continue|rewrite|summarize)\b/i.test(text);
}

function classifyMemorySentence(text, role) {
  if (/(?:如果|假如|假设|也许|可能|或许|\b(?:if|might|maybe|perhaps|imagine|suppose)\b)/i.test(text)) return 'hypothesis';
  if (/(?:打算|准备|计划|将会|想要|想去|想把|想买|希望|明天|后天|下次|\b(?:will|want to|hope to|plan to|intend to|tomorrow|next time)\b)/i.test(text)) return 'intent';
  if (role === 'user' && /^(?:我|用户|玩家|I|user|player)\s*(?:喜欢|偏好|不喜欢|讨厌|避免|prefer\b|like\b|dislike\b|hate\b|avoid\b|don't like\b|do not like\b)/i.test(text)) return 'preference';
  if (/(?:信任|喜欢|讨厌|怀疑|保护|背叛|帮助|依赖|认识|\b(?:trusts|likes|hates|suspects|protects|betrayed|helps|knows|depends on)\b)/i.test(text)) return 'relationship';
  if (/(?:抵达|来到|进入|离开|位于|住在|藏在|前往|\b(?:arrived at|entered|left|went to|is at|stays in|lives in|hidden in)\b)/i.test(text)) return 'location';
  if (/(?:发现|找到|获得|拿到|救下|击败|承诺|失去|交给|交出|交付|完成|打开|关上|点头|摇头|坐下|站起|递给|递回|放进|接过|收下|归还|取出|抱住|亲吻|离世|死了|\b(?:found|discovered|obtained|rescued|defeated|promised|lost|unlocked|handed|delivered|completed|opened|closed|nodded|sat|stood|hugged|kissed|died)\b)/i.test(text)) return 'event';
  if (/(?:是|拥有|携带|掌握|知道|\b(?:is|has|carries|knows)\b)/i.test(text)) return 'fact';
  // Retain ordinary narration verbatim instead of requiring a fixed verb list.
  return 'summary';
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
  const text = String(content || '').trim().slice(0, 60_000);
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
  return [...new Intl.Segmenter('zh', { granularity: 'sentence' }).segment(text)]
    .flatMap((part) => part.segment.split(/\n+/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 2 && !/^(?:好|好的|嗯|哦|继续|ok|yes|no|understood)[。.!！\s]*$/i.test(sentence));
}

function trimMemorySentence(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MEMORY_SENTENCE_LIMIT);
}

function normalizeComparableText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeMemoryType(value) {
  const normalized = String(value || '').trim();
  return ['event', 'relationship', 'location', 'preference', 'fact', 'summary', 'intent', 'hypothesis'].includes(normalized)
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
