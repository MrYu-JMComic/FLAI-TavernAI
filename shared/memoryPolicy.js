export const MEMORY_POLICY_VERSION = 1;
export const MEMORY_MODES = ['structured', 'raw'];
export const MEMORY_ISOLATIONS = ['cast', 'actor'];
export const EMBEDDING_DIMENSIONS = [256, 512, 768, 1024];

export const DEFAULT_MEMORY_POLICY = Object.freeze({
  version: MEMORY_POLICY_VERSION,
  mode: 'structured',
  isolation: 'cast',
  actorId: '',
  coreWaitMs: 15000,
  syncMode: 'background',
  shortTermTurns: 8,
  autoConsolidate: true,
  statusLink: false,
  unknownContextTokens: 32768,
  recallLimit: 24,
  summaryEnabled: true
});

export const DEFAULT_MEMORY_EMBEDDING = Object.freeze({
  enabled: false,
  providerProfileId: '',
  model: 'qwen3.7-text-embedding-flash',
  dimensions: 1024,
  region: 'cn-beijing',
  documentTemplateVersion: '1',
  queryTemplateVersion: '1',
  normalizationVersion: '1',
  quotaUsdPerCny: 0,
  queryInstruction: 'Given a role-play query, retrieve relevant narrative facts and events.'
});
export const MEMORY_POLICY_FIELDS = Object.keys(DEFAULT_MEMORY_POLICY);
export const MEMORY_EMBEDDING_FIELDS = Object.keys(DEFAULT_MEMORY_EMBEDDING);

/** Normalize a partial policy over inherited defaults without changing its provider bindings. */
export function normalizeMemoryPolicy(value = {}, fallback = DEFAULT_MEMORY_POLICY) {
  const input = object(value);
  const base = { ...DEFAULT_MEMORY_POLICY, ...object(fallback) };
  return {
    version: MEMORY_POLICY_VERSION,
    mode: oneOf(input.mode, MEMORY_MODES, base.mode),
    isolation: oneOf(input.isolation, MEMORY_ISOLATIONS, base.isolation),
    actorId: text(input.actorId ?? base.actorId, 160),
    coreWaitMs: integer(input.coreWaitMs, base.coreWaitMs, 1000, 60000),
    syncMode: oneOf(input.syncMode, ['background', 'blocking'], base.syncMode),
    shortTermTurns: integer(input.shortTermTurns, base.shortTermTurns, 1, 32),
    autoConsolidate: typeof input.autoConsolidate === 'boolean' ? input.autoConsolidate : base.autoConsolidate,
    statusLink: typeof input.statusLink === 'boolean' ? input.statusLink : base.statusLink,
    unknownContextTokens: integer(input.unknownContextTokens, base.unknownContextTokens, 4096, 262144),
    recallLimit: integer(input.recallLimit, base.recallLimit, 1, 64),
    summaryEnabled: typeof input.summaryEnabled === 'boolean' ? input.summaryEnabled : base.summaryEnabled
  };
}

/** Embeddings have a separate explicit binding; an empty binding never follows the chat model. */
export function normalizeMemoryEmbedding(value = {}, fallback = DEFAULT_MEMORY_EMBEDDING) {
  const input = object(value);
  const base = { ...DEFAULT_MEMORY_EMBEDDING, ...object(fallback) };
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : base.enabled,
    providerProfileId: text(input.providerProfileId ?? base.providerProfileId, 160),
    model: text(input.model ?? base.model, 160) || DEFAULT_MEMORY_EMBEDDING.model,
    dimensions: EMBEDDING_DIMENSIONS.includes(Number(input.dimensions)) ? Number(input.dimensions) : base.dimensions,
    region: text(input.region ?? base.region, 60),
    documentTemplateVersion: text(input.documentTemplateVersion ?? base.documentTemplateVersion, 40),
    queryTemplateVersion: text(input.queryTemplateVersion ?? base.queryTemplateVersion, 40),
    normalizationVersion: text(input.normalizationVersion ?? base.normalizationVersion, 40),
    quotaUsdPerCny: Number.isFinite(Number(input.quotaUsdPerCny)) && Number(input.quotaUsdPerCny) >= 0
      ? Math.min(100, Number(input.quotaUsdPerCny)) : base.quotaUsdPerCny,
    queryInstruction: text(input.queryInstruction ?? base.queryInstruction, 1000)
  };
}

/** Remove conversation actors and private execution bindings from portable author defaults. */
export function portableMemoryDefaults(skill = {}) {
  return {
    ...object(skill),
    providerProfileId: '',
    memoryPolicy: { ...normalizeMemoryPolicy(skill.memoryPolicy), actorId: '' },
    embedding: { ...normalizeMemoryEmbedding(skill.embedding), enabled: false, providerProfileId: '', quotaUsdPerCny: 0 }
  };
}

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function text(value, limit) { return String(value ?? '').trim().slice(0, limit); }
function oneOf(value, options, fallback) { return options.includes(value) ? value : fallback; }
function integer(value, fallback, min, max) {
  return Number.isFinite(Number(value)) && value !== null && value !== '' && value !== undefined
    ? Math.min(max, Math.max(min, Math.round(Number(value)))) : fallback;
}
