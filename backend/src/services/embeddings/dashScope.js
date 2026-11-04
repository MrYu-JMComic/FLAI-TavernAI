import { randomUUID } from 'node:crypto';
import { providerFetchUrl, readJsonResponse } from '../providerHttp.js';
import { reserveProviderCost, settleProviderCost, getUserQuota } from '../quotas.js';
import { EMBEDDING_PRICE, embeddingError } from './profile.js';

/** Embed compact text in documented batches, with network policy and one quota settlement per request. */
export async function embedTexts(database, options = {}) {
  const { userId, conversationId, profile, settings, signal, textType = 'document', operation = 'ingest' } = options;
  const texts = Array.isArray(options.texts) ? options.texts : [];
  if (!['query', 'document'].includes(textType)) throw embeddingError('EMBEDDING_TEXT_TYPE_INVALID', '向量文本类型无效。');
  if (!texts.length) return { vectors: [], usage: [], profileFingerprint: profile.fingerprint };
  if (texts.length > 2000 || texts.some((text) => typeof text !== 'string' || !text.trim() || text.length > 16000)) {
    throw embeddingError('EMBEDDING_TEXT_INVALID', '向量记录必须是非空的短文本，每条最多 16000 字符，每次最多 2000 条。');
  }
  // Enforce the priced region even when a caller supplies a raw profile or has no local billing database.
  if (profile.region !== EMBEDDING_PRICE.region) {
    throw embeddingError('EMBEDDING_REGION_UNPRICED', '本版只支持北京同步向量 API；其他地域没有已核验价目，不能套用北京价格。');
  }
  if (database && userId && !profile.quotaUsdPerCny && getUserQuota(database, userId).maxDailyCostMicros > 0) {
    throw embeddingError('EMBEDDING_QUOTA_CONVERSION_REQUIRED', '向量供应商以人民币计费；请先配置人民币到美元的配额换算率。当前继续使用全文和图谱检索。');
  }
  const vectors = [];
  const usages = [];
  for (let start = 0; start < texts.length; start += 20) {
    signal?.throwIfAborted();
    options.assertCurrent?.();
    const batch = texts.slice(start, start + 20);
    const reservation = reserveProviderCost(database, userId);
    const response = await providerFetchUrl(settings, profile.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify({
        model: profile.model,
        input: { texts: batch },
        parameters: { text_type: textType, dimension: profile.dimensions, output_type: 'dense',
          ...(textType === 'query' && profile.queryInstruction ? { instruct: profile.queryInstruction } : {}) }
      }),
      signal,
      timeoutMs: 30000,
      // Transport retries stay inside this one invocation/reservation. Never model-fallback.
      idempotent: true
    });
    const json = await readJsonResponse(response);
    const tokenValue = Number(json.usage?.total_tokens ?? json.usage?.input_tokens);
    const inputTokens = Number.isFinite(tokenValue) && tokenValue >= 0 ? Math.floor(tokenValue) : 0;
    const priced = profile.region === EMBEDDING_PRICE.region && profile.model === EMBEDDING_PRICE.model && Number.isFinite(tokenValue);
    const costCny = priced ? inputTokens * EMBEDDING_PRICE.perThousandInputTokens / 1000 : null;
    const quotaCostMicros = costCny !== null && profile.quotaUsdPerCny ? Math.ceil(costCny * profile.quotaUsdPerCny * 1_000_000) : null;
    settleProviderCost(database, reservation, { inputTokens, costMicros: quotaCostMicros ?? 0 });
    const usage = {
      requestId: String(json.request_id || randomUUID()), inputTokens, costCny, currency: 'CNY',
      model: profile.model, region: profile.region, priceVersion: priced ? EMBEDDING_PRICE.version : 'unpriced',
      quotaUsdPerCny: profile.quotaUsdPerCny, quotaCostMicros,
      operation
    };
    // Bill the actual successful provider invocation once even if its source was deleted meanwhile.
    // The owning conversation's cascade deliberately removes its private accounting details.
    if (database && userId && conversationId && database.prepare('SELECT 1 FROM conversations WHERE id=? AND user_id=?').get(conversationId, userId)) {
      database.prepare(`INSERT OR IGNORE INTO memory_embedding_usage
        (id,user_id,conversation_id,request_id,fingerprint,operation,model,region,input_tokens,cost_cny,currency,price_version,quota_usd_per_cny,quota_cost_micros,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), userId, conversationId, usage.requestId, profile.fingerprint,
        operation, profile.model, profile.region, inputTokens, costCny, 'CNY', usage.priceVersion, profile.quotaUsdPerCny, quotaCostMicros, new Date().toISOString());
    }
    usages.push(usage);
    const rows = json.output?.embeddings;
    if (!Array.isArray(rows) || rows.length !== batch.length) throw embeddingError('EMBEDDING_RESPONSE_INVALID', '向量响应条数不匹配。');
    const ordered = new Array(batch.length);
    for (const row of rows) {
      const index = Number(row.text_index);
      const vector = row.embedding;
      if (!Number.isInteger(index) || index < 0 || index >= batch.length || ordered[index] || !Array.isArray(vector)
        || vector.length !== profile.dimensions || vector.some((number) => typeof number !== 'number' || !Number.isFinite(number) || !Number.isFinite(Math.fround(number)))
        || !vector.some((number) => number !== 0)) throw embeddingError('EMBEDDING_RESPONSE_INVALID', '向量响应索引、维度或数值无效。');
      ordered[index] = vector;
    }
    options.assertCurrent?.();
    vectors.push(...ordered);
  }
  return { vectors, usage: usages, profileFingerprint: profile.fingerprint };
}
