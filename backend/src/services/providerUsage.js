import { normalizeProviderModel } from './providerModels.js';
import { readNumber, readOptionalNumber, roundMoney } from './providerNumbers.js';

const deepSeekPricingCnyPerMillion = {
  'deepseek-v4-flash': {
    cachedInput: 0.02,
    uncachedInput: 1,
    output: 2
  },
  'deepseek-v4-pro': {
    cachedInput: 0.025,
    uncachedInput: 3,
    output: 6
  }
};

export function buildUsageSnapshot(usage, metadata = {}) {
  if (!usage) {
    return null;
  }
  metadata = metadata ?? {};

  const providerType = metadata.providerType || metadata.provider_type || '';
  const model = normalizeProviderModel(providerType, metadata.model);
  const outputTokens = readNumber(usage.completion_tokens, usage.completionTokens, usage.output_tokens, usage.outputTokens, 0);
  const inputTokens = readNumber(usage.prompt_tokens, usage.promptTokens, usage.input_tokens, usage.inputTokens, 0);
  const explicitTotalTokens = readOptionalNumber(usage.total_tokens ?? usage.totalTokens ?? usage.total);
  const totalTokens = explicitTotalTokens ?? inputTokens + outputTokens;
  const cachedInputTokens = readNumber(
    usage.prompt_cache_hit_tokens,
    usage.promptCacheHitTokens,
    usage.input_cache_hit_tokens,
    usage.inputCacheHitTokens,
    usage.prompt_tokens_details?.cached_tokens,
    usage.promptTokensDetails?.cachedTokens,
    0
  );
  const uncachedInputTokens = readNumber(
    usage.prompt_cache_miss_tokens,
    usage.promptCacheMissTokens,
    usage.input_cache_miss_tokens,
    usage.inputCacheMissTokens,
    Math.max(inputTokens - cachedInputTokens, 0)
  );
  const pricing = providerType === 'deepseek' ? deepSeekPricingCnyPerMillion[model] : null;
  const totalCostCny = pricing
    ? roundMoney(
        (cachedInputTokens * pricing.cachedInput +
          uncachedInputTokens * pricing.uncachedInput +
          outputTokens * pricing.output) /
          1_000_000
      )
    : null;

  return {
    ...usage,
    _flai: {
      providerType,
      model,
      totalTokens,
      totalCostCny,
      currency: 'CNY'
    }
  };
}

export function summarizeUsageSnapshots(usages = []) {
  usages = usages && typeof usages[Symbol.iterator] === 'function' ? usages : [];
  let totalTokens = 0;
  let totalCostCny = 0;
  let hasCost = false;

  for (const usage of usages) {
    if (!usage) {
      continue;
    }

    const flai = usage._flai || {};
    totalTokens += readNumber(flai.totalTokens, usage.total_tokens, usage.totalTokens, 0);
    const cost = readOptionalNumber(flai.totalCostCny);
    if (cost !== null) {
      hasCost = true;
      totalCostCny += cost;
    }
  }

  return {
    totalTokens,
    totalCostCny: hasCost ? roundMoney(totalCostCny) : null,
    currency: 'CNY'
  };
}
