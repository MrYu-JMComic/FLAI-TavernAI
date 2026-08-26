import { clampNumber } from '../../utils/number.js';

const DEFAULT_RECALL_WEIGHTS = Object.freeze({ recency: 0.35, importance: 0.25, relevance: 0.4 });

export function scoreTownMemoryRecord(memory, query = '', options = {}) {
  const weights = normalizeTownRecallWeights(options.weights);
  const referenceTick = normalizeTick(options.referenceTick, memory.occurredTick);
  const ageHours = Math.max(0, referenceTick - memory.occurredTick) / 60;
  const recency = Math.pow(clampNumber(options.recencyDecay, 0.5, 1, 0.99), ageHours);
  const importance = clampNumber(memory.importance, 1, 10, 5) / 10;
  const relevance = calculateTokenRelevance(query, [memory.content, ...(memory.keywords || [])].join(' '));
  const score = (recency * weights.recency) + (importance * weights.importance) + (relevance * weights.relevance);
  return {
    ...memory,
    score: round(score),
    scoreParts: {
      recency: round(recency),
      importance: round(importance),
      relevance: round(relevance)
    }
  };
}

export function tokenizeTownMemoryText(value) {
  const normalized = String(value || '').normalize('NFKC').toLowerCase();
  const tokens = normalized.match(/[a-z0-9]+|[\u3400-\u9fff]+/gu) || [];
  const output = new Set();
  for (const token of tokens) {
    if (/^[\u3400-\u9fff]+$/u.test(token)) {
      for (const character of token) output.add(character);
      for (let index = 0; index < token.length - 1; index += 1) output.add(token.slice(index, index + 2));
    } else if (token.length > 1) {
      output.add(token);
    }
  }
  return [...output];
}

export function normalizeTownRecallWeights(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const raw = {
    recency: clampNumber(source.recency, 0, 1, DEFAULT_RECALL_WEIGHTS.recency),
    importance: clampNumber(source.importance, 0, 1, DEFAULT_RECALL_WEIGHTS.importance),
    relevance: clampNumber(source.relevance, 0, 1, DEFAULT_RECALL_WEIGHTS.relevance)
  };
  const total = raw.recency + raw.importance + raw.relevance;
  if (total <= 0) return { ...DEFAULT_RECALL_WEIGHTS };
  return {
    recency: raw.recency / total,
    importance: raw.importance / total,
    relevance: raw.relevance / total
  };
}

function calculateTokenRelevance(query, text) {
  const queryTokens = new Set(tokenizeTownMemoryText(query));
  if (!queryTokens.size) return 0;
  const textTokens = new Set(tokenizeTownMemoryText(text));
  let overlap = 0;
  for (const token of queryTokens) {
    if (textTokens.has(token)) overlap += 1;
  }
  return overlap / Math.sqrt(queryTokens.size * Math.max(1, textTokens.size));
}

function normalizeTick(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
