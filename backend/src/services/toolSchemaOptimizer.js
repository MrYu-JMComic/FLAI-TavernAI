/**
 * 工具 Schema 优化器
 * 确保工具定义兼容所有主流 AI 模型：GPT、Gemini、DeepSeek、Claude、Grok 等
 */

/**
 * 优化 JSON Schema 以确保跨模型兼容性
 *
 * 兼容性问题：
 * 1. exclusiveMinimum/exclusiveMaximum: Claude/Anthropic 不支持，需转换为 minimum/maximum
 * 2. 空 properties: 某些模型要求至少有一个属性或使用 additionalProperties
 * 3. 深度嵌套: 某些模型对嵌套深度有限制
 * 4. maxLength/minLength: 所有主流模型都支持
 * 5. enum: 所有主流模型都支持
 */
export function optimizeToolSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  // 克隆以避免修改原对象
  const optimized = Array.isArray(schema) ? [...schema] : { ...schema };

  // 1. 处理 exclusiveMinimum -> minimum (向上取整)
  if ('exclusiveMinimum' in optimized) {
    const value = optimized.exclusiveMinimum;
    delete optimized.exclusiveMinimum;

    if (typeof value === 'number') {
      // 对于整数类型，exclusive 0 变为 minimum 1
      if (optimized.type === 'integer') {
        optimized.minimum = Math.ceil(value) + 1;
      } else {
        // 对于浮点数，使用一个小的增量
        optimized.minimum = value + 0.0001;
      }
    }
  }

  // 2. 处理 exclusiveMaximum -> maximum (向下取整)
  if ('exclusiveMaximum' in optimized) {
    const value = optimized.exclusiveMaximum;
    delete optimized.exclusiveMaximum;

    if (typeof value === 'number') {
      if (optimized.type === 'integer') {
        optimized.maximum = Math.floor(value) - 1;
      } else {
        optimized.maximum = value - 0.0001;
      }
    }
  }

  // 3. 处理空 object 类型
  if (optimized.type === 'object' && !optimized.properties && !optimized.additionalProperties) {
    // 添加 additionalProperties: true 以明确允许任意属性
    optimized.additionalProperties = true;
  }

  // 4. 递归优化嵌套的 properties
  if (optimized.properties) {
    optimized.properties = Object.fromEntries(
      Object.entries(optimized.properties).map(([key, value]) => [
        key,
        optimizeToolSchema(value)
      ])
    );
  }

  // 5. 递归优化数组 items
  if (optimized.items) {
    optimized.items = optimizeToolSchema(optimized.items);
  }

  // 6. 递归优化 additionalProperties（如果是 schema）
  if (optimized.additionalProperties && typeof optimized.additionalProperties === 'object') {
    optimized.additionalProperties = optimizeToolSchema(optimized.additionalProperties);
  }

  // 7. 递归优化 anyOf/oneOf/allOf
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(optimized[key])) {
      optimized[key] = optimized[key].map(s => optimizeToolSchema(s));
    }
  }

  return optimized;
}

/**
 * 优化完整的工具定义
 */
export function optimizeTool(tool) {
  if (!tool || tool.type !== 'function') {
    return tool;
  }

  const optimized = {
    type: 'function',
    function: {
      name: tool.function.name,
      description: tool.function.description || '',
      parameters: tool.function.parameters ? optimizeToolSchema(tool.function.parameters) : {
        type: 'object',
        properties: {},
        additionalProperties: true
      }
    }
  };

  // 确保 parameters 是完整的 object schema
  if (optimized.function.parameters.type === 'object') {
    if (!optimized.function.parameters.properties) {
      optimized.function.parameters.properties = {};
    }
    // 确保 required 数组存在且有效
    if (tool.function.parameters?.required) {
      optimized.function.parameters.required = tool.function.parameters.required;
    }
  }

  return optimized;
}

/**
 * 批量优化工具数组
 */
export function optimizeTools(tools) {
  if (!Array.isArray(tools)) {
    return tools;
  }
  return tools.map(tool => optimizeTool(tool));
}

/**
 * 验证工具定义的基本结构
 */
export function validateToolStructure(tool) {
  const errors = [];

  if (!tool) {
    errors.push('Tool is null or undefined');
    return errors;
  }

  if (tool.type !== 'function') {
    errors.push(`Invalid tool type: ${tool.type}, expected 'function'`);
  }

  if (!tool.function) {
    errors.push('Missing function property');
    return errors;
  }

  if (!tool.function.name || typeof tool.function.name !== 'string') {
    errors.push('Missing or invalid function name');
  }

  if (!tool.function.description || typeof tool.function.description !== 'string') {
    errors.push('Missing or invalid function description');
  }

  if (!tool.function.parameters) {
    errors.push('Missing parameters property');
  } else if (tool.function.parameters.type !== 'object') {
    errors.push(`Invalid parameters type: ${tool.function.parameters.type}, expected 'object'`);
  }

  return errors;
}

/**
 * 创建标准工具定义的辅助函数
 */
export function createTool(name, description, properties, required = []) {
  return optimizeTool({
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties,
        required
      }
    }
  });
}
