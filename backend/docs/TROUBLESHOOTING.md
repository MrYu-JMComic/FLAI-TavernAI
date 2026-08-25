# AI 工具调用错误诊断和解决指南

## 常见错误及解决方案

### 1. "schema at top-level requires unspecified property 'id'"

**错误来源**: Gemini/Google AI

**原因**:
- Gemini 对工具 schema 有严格要求
- 不允许空的 `required` 数组
- object 类型必须有明确的 `properties` 或 `additionalProperties`

**解决方案**: ✅ 已自动修复
- 创建了 `toolProviderAdapter.js` 提供商适配器
- 集成到 `providerRequestBody.js`
- Gemini 请求会自动：
  - 移除空的 `required` 数组
  - 确保所有 object 类型有 `properties` 或 `additionalProperties`

**验证**:
```bash
node --input-type=module -e "
import { adaptToolsForProvider } from './backend/src/services/toolProviderAdapter.js';
const tools = [/* your tools */];
const adapted = adaptToolsForProvider(tools, 'gemini');
console.log(adapted);
"
```

---

### 2. "sceneAgent timed out"

**错误来源**: 场景代理超时

**原因**:
- 场景组织任务太复杂
- AI 模型响应太慢
- 网络延迟

**解决方案**:

#### A. 增加超时时间
编辑 `backend/src/services/accessoryAgents.js`:

```javascrip
// 查找
const agentTimeoutMs = 20000;

// 修改为
const agentTimeoutMs = 45000;  // 增加到 45 秒
```

#### B. 优化场景复杂度
- 减少一次处理的场景节点数量
- 简化场景描述
- 分批处理大型场景

#### C. 使用更快的模型
在高级设置中为场景代理选择更快的模型：
- GPT-4 Turbo (推荐)
- Claude 3.5 Sonne
- DeepSeek-V3

---

### 3. "exclusiveMinimum/exclusiveMaximum not supported"

**错误来源**: Claude/Anthropic

**解决方案**: ✅ 已自动修复
- `toolSchemaOptimizer.js` 自动转换
- `exclusiveMinimum: 0` → `minimum: 0.0001` (浮点数)
- `exclusiveMinimum: 0` → `minimum: 1` (整数)

---

### 4. 工具调用没有响应

**可能原因**:
1. API Key 无效或过期
2. 模型不支持工具调用
3. 网关配置错误
4. 工具 schema 格式错误

**诊断步骤**:

1. **检查 API Key**:
   ```bash
   # 在用户设置页面确认 API Key 已保存
   ```

2. **检查模型支持**:
   支持工具调用的模型：
   - ✅ GPT-4, GPT-4 Turbo, GPT-3.5 Turbo
   - ✅ Claude 3 系列
   - ✅ Gemini Pro, Gemini Ultra
   - ✅ DeepSeek-V3
   - ❌ 基础模型（如 text-davinci-003）

3. **验证工具 schema**:
   ```bash
   node backend/src/services/validate-tools.js
   ```

4. **检查网络连接**:
   ```bash
   curl -I https://api.openai.com/v1/models
   ```

---

## 调试工具

### 1. 工具验证脚本

运行完整的工具兼容性检查：

```bash
node backend/src/services/validate-tools.js
```

### 2. 提供商适配测试

测试特定提供商的工具适配：

```bash
node --input-type=module -e "
import { adaptToolsForProvider, validateToolsForProvider } from './backend/src/services/toolProviderAdapter.js';

const tools = [/* your tools */];
const providerType = 'gemini';  // 或 'openai', 'anthropic', 'deepseek'

const adapted = adaptToolsForProvider(tools, providerType);
const errors = validateToolsForProvider(adapted, providerType);

console.log('适配后的工具:', JSON.stringify(adapted, null, 2));
console.log('验证错误:', errors);
"
```

### 3. 实时请求日志

在 `backend/src/services/providerRequestBody.js` 中添加调试日志：

```javascrip
if (options.tools?.length) {
  let tools = optimizeTools(options.tools);
  tools = adaptToolsForProvider(tools, settings.providerType);

  // 添加调试日志
  console.log('[DEBUG] Provider:', settings.providerType);
  console.log('[DEBUG] Tools count:', tools.length);
  console.log('[DEBUG] First tool:', JSON.stringify(tools[0], null, 2));

  body.tools = tools;
  body.tool_choice = options.toolChoice || 'auto';
}
```

---

## 性能优化

### 减少工具数量

不是所有场景都需要所有工具。根据上下文动态选择工具：

```javascrip
// 示例：根据对话内容选择只读工具
const tools = [];

if (needsSceneLookup) {
  tools.push(...sceneReadTools);
}

if (needsWorldBookLookup) {
  tools.push(...worldBookReadTools);
}

// 只传递必要的工具
await runToolCompletion(settings, messages, tools, executeTool);
```

### 并行处理

对于独立的代理任务，使用并行处理：

```javascrip
// 并行运行多个代理
await Promise.allSettled([
  runSceneAgent(params),
  runStatusAgent(params),
  runWorldDirector(params)
]);
```

### 超时配置

根据任务复杂度调整超时：

```javascrip
// backend/src/services/accessoryAgents.js
const agentTimeoutMs = 20000;           // 简单任务
const statusBarAgentTimeoutMs = 45000;  // 复杂任务（状态栏）
const sceneAgentTimeoutMs = 60000;      // 建议：场景任务
```

---

## 提供商特定注意事项

### Gemini

- ❌ 不支持空的 `required` 数组
- ❌ object 类型必须有 `properties`
- ✅ 已通过 `toolProviderAdapter.js` 自动处理

### Claude/Anthropic

- ❌ 不支持 `exclusiveMinimum/exclusiveMaximum`
- ✅ 已通过 `toolSchemaOptimizer.js` 自动转换
- ℹ️ 使用自己的工具格式，但会自动转换

### DeepSeek

- ✅ 遵循 OpenAI 标准
- ✅ 支持思维链推理（thinking）
- ℹ️ 需要 `stream_options: { include_usage: true }` 获取 token 统计

### OpenAI

- ✅ 标准实现，兼容性最好
- ✅ 支持所有 JSON Schema 特性
- ℹ️ GPT-3.5 对复杂工具支持较弱

---

## 最佳实践

### 1. 工具设计

```javascrip
// ✅ 好的工具定义
{
  type: 'function',
  function: {
    name: 'update_npc',
    description: '更新 NPC 信息。只在对话明确提到变化时使用。',
    parameters: {
      type: 'object',
      properties: {
        npcName: { type: 'string', description: 'NPC 名称' },
        status: {
          type: 'string',
          enum: ['active', 'left', 'dead'],
          description: 'NPC 状态'
        }
      },
      required: ['npcName']  // 明确必填字段
    }
  }
}

// ❌ 避免
{
  name: 'update_npc',  // 缺少 type 和 function 包装
  parameters: {
    npcName: 'string',  // 错误的 schema 格式
    status: { type: 'string' }
    // 缺少 required
  }
}
```

### 2. 错误处理

```javascrip
try {
  const result = await runToolCompletion(settings, messages, tools, executeTool);
  return result;
} catch (error) {
  if (error.message.includes('schema at top-level')) {
    console.error('工具 schema 错误，请检查 required 字段和 properties');
  } else if (error.message.includes('timed out')) {
    console.error('代理超时，考虑增加 agentTimeoutMs');
  }
  throw error;
}
```

### 3. 渐进式启用

对于新功能，逐步启用工具：

> 人物域自动同步与 AI 整理不适用本节；这两条链路只生成并校验
> `CastChangePlanV1`，不得启用工具调用。

```javascrip
// 第 1 阶段：仅启用核心只读工具
const coreTools = [sceneReadTool()];

// 第 2 阶段：添加辅助工具
const enhancedTools = [...coreTools, worldBookSearchTool()];

// 第 3 阶段：完整功能
const fullTools = [...enhancedTools, ...worldDirectorTools()];
```

---

## 故障排查清单

- [ ] 检查 API Key 是否有效
- [ ] 确认模型支持工具调用
- [ ] 验证工具 schema 格式
- [ ] 检查网络连接
- [ ] 查看控制台错误日志
- [ ] 运行工具验证脚本
- [ ] 测试提供商适配
- [ ] 调整超时设置
- [ ] 简化工具复杂度
- [ ] 尝试不同的模型

---

## 获取帮助

如果问题仍然存在：

1. 收集错误信息：
   - 完整的错误堆栈
   - 使用的模型和提供商
   - 工具定义（脱敏后）
   - 请求参数

2. 运行诊断：
   ```bash
   node backend/src/services/validate-tools.js > diagnostic.log 2>&1
   ```

3. 检查相关文档：
   - [工具优化文档](./TOOL_OPTIMIZATION.md)
   - [优化总结](./OPTIMIZATION_SUMMARY.md)
