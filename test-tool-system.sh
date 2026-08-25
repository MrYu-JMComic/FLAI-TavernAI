#!/bin/bash
echo "🔧 开始测试工具系统..."
echo ""

echo "1️⃣ 验证服务器语法..."
node -c backend/src/server.js && echo "✅ 服务器语法正常" || echo "❌ 服务器语法错误"
echo ""

echo "2️⃣ 测试工具优化器..."
node backend/src/services/validate-tools.js
echo ""

echo "3️⃣ 测试提供商适配器..."
node --input-type=module -e "
import { adaptToolsForProvider } from './backend/src/services/toolProviderAdapter.js';
const testTool = {
  type: 'function',
  function: {
    name: 'test',
    description: 'test',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: [] }
  }
};
const adapted = adaptToolsForProvider([testTool], 'gemini');
console.log(adapted[0].function.parameters.required === undefined ? '✅ Gemini 适配正常' : '❌ Gemini 适配失败');
"
echo ""

echo "4️⃣ 测试 schema 优化..."
node --input-type=module -e "
import { optimizeTools } from './backend/src/services/toolSchemaOptimizer.js';
const testTool = {
  type: 'function',
  function: {
    name: 'test',
    description: 'test',
    parameters: { type: 'object', properties: { amount: { type: 'number', exclusiveMinimum: 0 } } }
  }
};
const optimized = optimizeTools([testTool]);
console.log(optimized[0].function.parameters.properties.amount.minimum === 0.0001 ? '✅ Schema 优化正常' : '❌ Schema 优化失败');
"
echo ""

echo "✅ 工具系统测试完成！"
