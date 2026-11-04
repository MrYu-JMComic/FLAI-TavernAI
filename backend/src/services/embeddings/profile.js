import { createHash } from 'node:crypto';
import { getProviderProfileRow } from '../../repositories/providerProfileRepository.js';
import { providerWithSecret } from '../providers.js';
import { applyProviderNetworkPolicy } from '../providerNetworkPolicy.js';
import { VECTOR_DIMENSIONS } from '../../db/vectorRuntime.js';

export const DEFAULT_EMBEDDING_MODEL = 'qwen3.7-text-embedding-flash';
export const DEFAULT_QUERY_INSTRUCTION = 'Given a role-play query, retrieve relevant narrative facts and events.';
export const EMBEDDING_PRICE = Object.freeze({
  model: DEFAULT_EMBEDDING_MODEL,
  region: 'cn-beijing',
  currency: 'CNY',
  perThousandInputTokens: 0.000125,
  version: 'dashscope-cn-beijing-sync-2026-11-01',
  source: 'https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api'
});

/** Normalize the complete vector space; profile ID alone never identifies one. */
export function normalizeEmbeddingProfile(value = {}, settings = {}) {
  const dimensions = Number(value.dimensions ?? 1024);
  if (!VECTOR_DIMENSIONS.includes(dimensions)) throw embeddingError('EMBEDDING_DIMENSIONS_INVALID', '向量维度必须为 256、512、768 或 1024。');
  const model = String(value.model || DEFAULT_EMBEDDING_MODEL).trim();
  if (model !== DEFAULT_EMBEDDING_MODEL) throw embeddingError('EMBEDDING_MODEL_UNSUPPORTED', '当前 DashScope 向量适配器只支持 qwen3.7-text-embedding-flash；不会回退到聊天模型。');
  const endpoint = dashScopeEmbeddingEndpoint(settings.baseUrl || value.endpoint || 'https://dashscope.aliyuncs.com');
  const region = String(value.region || 'cn-beijing');
  if (region !== EMBEDDING_PRICE.region || /^dashscope-(?:intl|us|eu|sg)\./i.test(new URL(endpoint).hostname)) {
    throw embeddingError('EMBEDDING_REGION_UNPRICED', '本版只配置了北京同步向量 API 的人民币价目；其他地域暂时使用全文和图谱检索，不能套用北京价格。');
  }
  const usdRate = Number(value.quotaUsdPerCny);
  const profile = {
    providerProfileId: String(value.providerProfileId || settings.id || '').trim(),
    protocol: 'dashscope-text-embedding-v1',
    endpoint,
    model,
    dimensions,
    region,
    documentTemplateVersion: String(value.documentTemplateVersion || '1'),
    queryTemplateVersion: String(value.queryTemplateVersion || '1'),
    normalizationVersion: String(value.normalizationVersion || '1'),
    queryInstruction: String(value.queryInstruction || DEFAULT_QUERY_INSTRUCTION).trim(),
    quotaUsdPerCny: Number.isFinite(usdRate) && usdRate > 0 ? usdRate : null
  };
  // Pricing and quota conversion do not change the geometric vector space.
  const { quotaUsdPerCny, ...space } = profile;
  return { ...profile, fingerprint: hashEmbeddingValue(space) };
}

/** Resolve only the explicitly selected, owned encrypted profile; never follow chat fallback. */
export function resolveEmbeddingProfile(database, userId, value = {}, options = {}) {
  if (value.enabled !== true) return { enabled: false, profile: null, settings: null };
  const id = String(value.providerProfileId || '').trim();
  if (!id) throw embeddingError('EMBEDDING_PROFILE_REQUIRED', '请为向量记忆单独选择已保存的供应商配置。');
  const row = getProviderProfileRow(database, userId, id);
  if (!row) throw embeddingError('EMBEDDING_PROFILE_MISSING', '向量供应商配置已删除或不属于当前用户，请重新选择。');
  let settings = providerWithSecret(row);
  if (!settings.apiKey || settings.apiKeyError) throw embeddingError('EMBEDDING_CREDENTIALS_INVALID', '请修复向量供应商的 API Key。');
  const user = database.prepare('SELECT id,is_root_admin AS isRootAdmin FROM users WHERE id=?').get(userId);
  settings = applyProviderNetworkPolicy(settings, options.config, user || { id: userId });
  const profile = normalizeEmbeddingProfile(value, settings);
  return { enabled: true, profile, settings: { ...settings, model: profile.model } };
}

export function dashScopeEmbeddingEndpoint(baseUrl) {
  const url = new URL(String(baseUrl));
  let prefix = url.pathname.replace(/\/+$/, '');
  const native = '/api/v1/services/embeddings/text-embedding/text-embedding';
  if (prefix.endsWith(native)) prefix = prefix.slice(0, -native.length);
  else prefix = prefix.replace(/\/(?:compatible-mode\/v1|api\/v1|v1)$/, '');
  url.pathname = `${prefix}${native}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function hashEmbeddingValue(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

export function embeddingError(code, message) {
  return Object.assign(new Error(message), { code, publicMessage: message, retryable: false });
}
