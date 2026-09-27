const DEFAULT_INPUT_TOKEN_LIMIT = 4_096 * 4;
const DEFAULT_RESERVED_OUTPUT_TOKENS = 4_096;
const DEFAULT_IMAGE_TOKENS = 1_024;
const MAX_TOKEN_VALUE = 10_000_000;

export function estimatePromptTokens(messages, options = {}) {
  const warnings = [];
  const countText = createTextCounter(options.countTextTokens, warnings);
  const normalizedMessages = [
    ...(Array.isArray(messages) ? messages : []),
    ...(Array.isArray(options.additionalMessages) ? options.additionalMessages : [])
  ];
  const protocol = protocolHeuristic(options.providerType, options.model);
  const imageTokens = readTokenInteger(
    options.imageTokensPerImage,
    DEFAULT_IMAGE_TOKENS,
    'image token estimate',
    warnings
  );
  let textTokens = 0;
  let images = 0;

  for (const message of normalizedMessages) {
    const content = message?.content;
    if (typeof content === 'string') {
      textTokens += countText(content);
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (typeof part === 'string') textTokens += countText(part);
        else if (isImagePart(part)) images += 1;
        else if (typeof part?.text === 'string') textTokens += countText(part.text);
        else if (part != null) textTokens += countText(stableSerialize(part));
      }
    } else if (content != null) {
      textTokens += countText(stableSerialize(content));
    }
    if (typeof message?.name === 'string') textTokens += countText(message.name);
    if (message?.tool_calls) textTokens += countText(stableSerialize(message.tool_calls));
    if (message?.function_call) textTokens += countText(stableSerialize(message.function_call));
    if (message?.tool_call_id) textTokens += countText(String(message.tool_call_id));
  }

  const tools = Array.isArray(options.tools) ? options.tools : [];
  const toolSchemaTokens = tools.length ? countText(stableSerialize(tools)) : 0;
  const messageOverheadTokens = protocol.base + normalizedMessages.length * protocol.perMessage;
  const toolOverheadTokens = tools.length * protocol.perTool;
  const imageTokenTotal = images * imageTokens;
  const tokens = textTokens + toolSchemaTokens + messageOverheadTokens
    + toolOverheadTokens + imageTokenTotal;

  warnings.push('Token count includes conservative protocol, image, and serialization heuristics.');
  return {
    tokens,
    estimatedTokens: tokens,
    estimated: true,
    exact: false,
    method: options.countTextTokens
      ? `injected text counter + ${protocol.name} envelope heuristic`
      : `mixed-script character heuristic + ${protocol.name} envelope heuristic`,
    warning: warnings.join(' '),
    breakdown: {
      textTokens,
      toolSchemaTokens,
      messageOverheadTokens,
      toolOverheadTokens,
      imageTokens: imageTokenTotal,
      imageCount: images,
    },
  };
}

export function resolvePromptTokenBudget(settings = {}, options = {}) {
  const warnings = [];
  const inputAllocation = readTokenInteger(
    options.inputTokenLimit ?? settings.inputTokenLimit,
    DEFAULT_INPUT_TOKEN_LIMIT,
    'input token allocation',
    warnings
  );
  const reservationSource = options.reservedOutputTokens
    ?? options.maxTokens
    ?? settings.reservedOutputTokens
    ?? settings.maxTokens;
  const reservedOutputTokens = readTokenInteger(
    reservationSource,
    DEFAULT_RESERVED_OUTPUT_TOKENS,
    'reply reservation',
    warnings
  );
  const imageTokensPerImage = readTokenInteger(
    options.imageTokensPerImage ?? settings.imageTokensPerImage,
    DEFAULT_IMAGE_TOKENS,
    'image token estimate',
    warnings
  );
  const configuredWindow = readOptionalTokenInteger(
    options.contextWindowTokens ?? settings.contextWindowTokens,
    'context window',
    warnings
  );
  const forModel = options.forModel ?? settings.forModel;
  const forProviderType = options.forProviderType ?? settings.forProviderType;
  const modelMatches = !forModel || forModel === settings.model;
  const providerMatches = !forProviderType || forProviderType === settings.providerType;
  const explicitlyScoped = Boolean(forModel || forProviderType);
  const appliesWindow = configuredWindow !== null && explicitlyScoped && modelMatches && providerMatches;
  if (configuredWindow !== null && !explicitlyScoped) {
    warnings.push('Ignored context window because it was not scoped to a model or provider.');
  } else if (configuredWindow !== null && (!modelMatches || !providerMatches)) {
    warnings.push('Ignored context window because its model/provider scope does not match.');
  }

  const windowInputLimit = appliesWindow ? configuredWindow - reservedOutputTokens : null;
  const overflow = appliesWindow && windowInputLimit < 0;
  const effectiveInputLimit = overflow
    ? 0
    : Math.min(inputAllocation, windowInputLimit ?? inputAllocation);
  if (overflow) warnings.push('Reply reservation exceeds the configured context window.');

  return {
    inputTokenLimit: inputAllocation,
    reservedOutputTokens,
    imageTokensPerImage,
    contextWindowTokens: appliesWindow ? configuredWindow : null,
    effectiveInputLimit,
    overflow,
    estimated: true,
    exact: false,
    method: appliesWindow ? 'configured scoped window budget' : 'application input allocation',
    warning: warnings.join(' '),
  };
}

function createTextCounter(counter, warnings) {
  if (typeof counter !== 'function') return estimateTextTokens;
  return (text) => {
    try {
      const value = counter(String(text));
      if (isTokenCount(value)) return value;
      warnings.push('Injected text counter returned an invalid value; used the heuristic fallback.');
    } catch {
      warnings.push('Injected text counter failed; used the heuristic fallback.');
    }
    return estimateTextTokens(text);
  };
}

function estimateTextTokens(value) {
  let ascii = 0;
  let nonLatin = 0;
  for (const character of String(value)) {
    if (character.codePointAt(0) <= 0x7f) ascii += 1;
    else nonLatin += 1;
  }
  return Math.ceil(ascii / 3.5) + nonLatin;
}

function isImagePart(part) {
  const type = String(part?.type || '').toLowerCase();
  return type === 'image' || type === 'image_url' || type === 'input_image'
    || Object.hasOwn(part || {}, 'image_url');
}

function stableSerialize(value) {
  try {
    return JSON.stringify(value) || '';
  } catch {
    return String(value);
  }
}

function protocolHeuristic(providerType, model) {
  const identity = `${providerType || ''} ${model || ''}`.toLowerCase();
  if (identity.includes('anthropic') || identity.includes('claude')) {
    return { name: 'Anthropic-style', base: 8, perMessage: 6, perTool: 16 };
  }
  if (identity.includes('openai') || /\bgpt\b|\bo[1-9]\b/.test(identity)) {
    return { name: 'OpenAI-style', base: 6, perMessage: 5, perTool: 14 };
  }
  return { name: 'generic chat', base: 10, perMessage: 7, perTool: 18 };
}

function readTokenInteger(value, fallback, label, warnings) {
  if (value === undefined || value === null) return fallback;
  if (!isTokenInteger(value)) {
    warnings.push(`Ignored invalid ${label}.`);
    return fallback;
  }
  return value;
}

function readOptionalTokenInteger(value, label, warnings) {
  if (value === undefined || value === null) return null;
  if (!isTokenInteger(value)) {
    warnings.push(`Ignored invalid ${label}.`);
    return null;
  }
  return value;
}

function isTokenInteger(value) {
  return typeof value === 'number' && Number.isFinite(value)
    && Number.isInteger(value) && value > 0 && value <= MAX_TOKEN_VALUE;
}

function isTokenCount(value) {
  return typeof value === 'number' && Number.isFinite(value)
    && Number.isInteger(value) && value >= 0 && value <= MAX_TOKEN_VALUE;
}
