/**
 * 特定提供商的工具 schema 适配器
 * 处理不同 AI 提供商对工具定义的特殊要求
 */

/**
 * 为特定提供商适配工具定义
 * @param {object[]} tools
 * @param {string} providerType
 * @param {string} [modelName] - 可选，用于当 providerType 为 custom 时通过模型名推断所需适配
 */
export function adaptToolsForProvider(tools, providerType, modelName = '') {
  if (!Array.isArray(tools)) {
    return tools;
  }

  // 通过模型名检测 Gemini（custom 代理或直连时 providerType 为 custom/google 等）
  const isGeminiModel = /gemini/i.test(modelName);

  switch (providerType) {
    case 'gemini':
    case 'google':
      return adaptToolsForGemini(tools);
    case 'deepseek':
      return adaptToolsForDeepSeek(tools);
    case 'anthropic':
    case 'claude':
      return adaptToolsForAnthropic(tools);
    default:
      // 对 custom/未知 provider，如果模型名含 gemini 则同样应用 Gemini 适配
      return isGeminiModel ? adaptToolsForGemini(tools) : tools;
  }
}

/**
 * Gemini 特殊适配
 *
 * Gemini 的特殊要求：
 * 1. 不支持某些高级 JSON Schema 特性
 * 2. required 字段必须存在且不能为空数组
 * 3. 所有 object 类型必须有明确的 properties 或 additionalProperties
 */
function adaptToolsForGemini(tools) {
  return tools.map(tool => {
    if (tool.type !== 'function') {
      return tool;
    }

    const adapted = JSON.parse(JSON.stringify(tool)); // 深拷贝

    if (adapted.function.parameters) {
      adapted.function.parameters = adaptSchemaForGemini(adapted.function.parameters);
    }

    return adapted;
  });
}

function adaptSchemaForGemini(schema) {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  const adapted = { ...schema };

  // Gemini 不支持 anyOf, oneOf, allOf - 将它们转换为更简单的形式
  if (adapted.anyOf || adapted.oneOf || adapted.allOf) {
    const variants = adapted.anyOf || adapted.oneOf || adapted.allOf;
    // 合并所有变体的 required 字段，将它们都变成可选
    const allRequired = new Set();
    for (const variant of variants) {
      if (variant.required) {
        for (const field of variant.required) {
          allRequired.add(field);
        }
      }
    }
    // 不设置 required，让所有字段都是可选的
    delete adapted.required;
    delete adapted.anyOf;
    delete adapted.oneOf;
    delete adapted.allOf;
  }

  // Gemini 要求：如果有 required 字段，不能为空数组
  if (Array.isArray(adapted.required) && adapted.required.length === 0) {
    delete adapted.required;
  }

  // Gemini 要求：object 类型必须有 properties
  if (adapted.type === 'object') {
    if (!adapted.properties) {
      adapted.properties = {};
    }
    // 如果没有 required 且 properties 为空，确保有 additionalProperties
    if (Object.keys(adapted.properties).length === 0 && !adapted.additionalProperties) {
      adapted.additionalProperties = true;
    }
  }

  // 递归处理 properties
  if (adapted.properties) {
    adapted.properties = Object.fromEntries(
      Object.entries(adapted.properties).map(([key, value]) => [
        key,
        adaptSchemaForGemini(value)
      ])
    );
  }

  // 递归处理 items
  if (adapted.items) {
    adapted.items = adaptSchemaForGemini(adapted.items);
  }

  return adapted;
}

/**
 * DeepSeek 特殊适配
 */
function adaptToolsForDeepSeek(tools) {
  // DeepSeek 遵循 OpenAI 标准，通常不需要特殊处理
  return tools;
}

/**
 * Anthropic/Claude 特殊适配
 */
function adaptToolsForAnthropic(tools) {
  // Anthropic 使用自己的格式，但通过 providerAnthropic.js 处理
  // 这里的工具已经是 OpenAI 格式，会在 Anthropic 适配器中转换
  return tools;
}

/**
 * 验证工具是否适合特定提供商
 */
export function validateToolsForProvider(tools, providerType) {
  const errors = [];

  for (const tool of tools) {
    if (tool.type !== 'function') {
      errors.push(`工具类型必须是 'function'，当前: ${tool.type}`);
      continue;
    }

    if (!tool.function?.name) {
      errors.push('工具缺少 name 字段');
    }

    if (!tool.function?.description) {
      errors.push(`工具 ${tool.function?.name || '未命名'} 缺少 description`);
    }

    if (!tool.function?.parameters) {
      errors.push(`工具 ${tool.function?.name || '未命名'} 缺少 parameters`);
      continue;
    }

    const params = tool.function.parameters;

    if (params.type !== 'object') {
      errors.push(`工具 ${tool.function.name} 的 parameters.type 必须是 'object'`);
    }

    // Gemini 特殊检查
    if (providerType === 'gemini' || providerType === 'google') {
      if (params.type === 'object' && !params.properties && !params.additionalProperties) {
        errors.push(`工具 ${tool.function.name} 的 parameters 缺少 properties 或 additionalProperties (Gemini 要求)`);
      }
    }
  }

  return errors;
}
