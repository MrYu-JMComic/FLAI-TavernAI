/**
 * 工具 Schema 优化器
 * 在保留参数约束的前提下规范工具定义。
 */

/**
 * 优化 JSON Schema 以确保跨模型兼容性
 *
 * 整数开边界可以精确转换为闭边界；浮点开边界不能用任意增量近似。
 * 保留显式 additionalProperties 和 strict，递归处理嵌套结构。
 */
export function optimizeToolSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  // 克隆以避免修改原对象
  const optimized = Array.isArray(schema) ? [...schema] : { ...schema };

  // Integer bounds can be normalized exactly; keep fractional bounds exclusive.
  if (optimized.type === 'integer' && typeof optimized.exclusiveMinimum === 'number') {
    const value = optimized.exclusiveMinimum;
    delete optimized.exclusiveMinimum;
    optimized.minimum = Math.max(optimized.minimum ?? -Infinity, Math.floor(value) + 1);
  }

  // 2. 处理 exclusiveMaximum -> maximum (向下取整)
  if (optimized.type === 'integer' && typeof optimized.exclusiveMaximum === 'number') {
    const value = optimized.exclusiveMaximum;
    delete optimized.exclusiveMaximum;

    optimized.maximum = Math.min(optimized.maximum ?? Infinity, Math.ceil(value) - 1);
  }

  // 3. 处理空 object 类型
  if (optimized.type === 'object' && !optimized.properties && !('additionalProperties' in optimized)) {
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
    ...tool,
    function: {
      ...tool.function,
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
